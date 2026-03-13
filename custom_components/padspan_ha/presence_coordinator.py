# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""
PadSpan HA — Presence Coordinator
===================================
A DataUpdateCoordinator that polls the live snapshot and provides
{key: object_dict} data to sensor and device_tracker entities.

SMOOTHING PIPELINE (BLE objects only)
──────────────────────────────────────
Raw BLE RSSI is extremely noisy — a device standing still can swing ±10 dBm
between consecutive advertisements.  Without smoothing, the "current room" flickers
between adjacent rooms every few seconds.

Three-stage pipeline applied each poll cycle:

  Stage 1 — Kalman-filtered RSSI per source
    Replaces the fixed-alpha EMA with an adaptive Kalman filter that adjusts
    its gain based on estimated uncertainty.  This makes the filter more
    responsive to genuine movement while still rejecting momentary RF spikes.

    Kalman update per (device, scanner) pair:
        K = P / (P + R)                  # Kalman gain
        x = x + K * (rssi_raw - x)       # filtered estimate
        P = (1 - K) * P + Q              # error covariance

    Q (process noise) — how much the true RSSI is expected to vary per poll.
      Default 0.125.  Increase for faster response; decrease for more smoothing.
    R (measurement noise) — how noisy the raw measurement is.
      Default 8.0.  Increase for more smoothing; decrease for faster response.

    Sources that stop reporting are decayed toward -100 dBm and pruned when they
    fall below -95 dBm (~4–5 polls after last seen).

  Stage 1.5 — Gaussian room scoring (replaces winner-takes-all max RSSI)
    Each scanner's Kalman RSSI is converted to an estimated distance via the
    path-loss formula, then scored with a Gaussian weight exp(−(d/σ)²) where
    σ is the configurable room_sigma_m (default 4 m).  The room with the highest
    max-score across its assigned scanners becomes the candidate.  This penalises
    scanners on the far side of a wall more proportionally than raw RSSI comparison.

    Optional k-NN override: if calibration fingerprint data (≥5 points) exists and
    the k-NN confidence exceeds 0.30, the fingerprint result replaces the Gaussian
    candidate.  Also provides sub-room (x_frac, y_frac) for map dot positioning.

  Stage 2 — Majority-vote window
    At each poll, the candidate room (from Gaussian scoring or k-NN) is added to
    a rolling window of VOTE_WINDOW (5) entries.  The confirmed room only changes
    when one room appears ≥ VOTE_THRESHOLD (3) times in the window.
    At 10 s/poll this means a room switch requires ~30 s of consistent dominance.

    The vote window is cleared when a device re-appears after being away, preventing
    stale votes from the previous location from influencing re-entry assignment.

HOME/AWAY PERSISTENCE
─────────────────────
Devices that disappear from the live snapshot are kept in the result dict with a
synthetic age_s that grows each poll.  A 2-poll grace period (≈20 s) prevents a
momentary signal gap from triggering an away event.  Devices with confident
presence (room_confidence ≥ 0.6) get an extended grace period controlled by the
signal_loss_linger_s setting (default 90 s / ~9 polls) so that brief BLE dropouts
don't erase established presence.  Entities read age_s and return "not_home" when
it exceeds the configured away timeout (Settings → Presence → Away timeout;
default 300 s / 5 min).  Entities never go "unavailable" — "not_home" is a
permanently valid HA state.

When ALL scanners go silent simultaneously (total signal dropout), the Kalman
filter decays toward -95 dBm instead of -100 dBm, preserving state ~3× longer
(~200-250 s vs ~70-80 s).  When some scanners are still active (genuine movement),
losing scanners still decay rapidly at -100 dBm for fast room switching.  The vote
window also skips None candidates during total silence, preserving the last
confirmed room assignment.

CONFIDENCE SCORE
─────────────────
Each poll computes room_confidence ∈ [0, 1] based on how decisive the vote window is:
    confidence = top_room_vote_count / vote_window_size
At 1.0 the device has been in the same room for every poll in the window.
At 0.33 (with window=3) only one poll agreed.  Surface in automations via the
extra_state_attributes of sensor.{device}_area.
"""
from __future__ import annotations

import logging
import math
import time
from collections import deque
from datetime import timedelta
from typing import Any

import voluptuous as vol
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    DOMAIN, DATA_SETTINGS, DATA_CALIBRATION, DATA_ADAPTIVE, DATA_MAPS,
    DEFAULT_KALMAN_Q, DEFAULT_KALMAN_R,
    DEFAULT_REF_POWER, DEFAULT_PATH_LOSS_EXP, DEFAULT_ROOM_SIGMA_M,
)

_LOGGER = logging.getLogger(__name__)

_SCAN_INTERVAL = timedelta(seconds=10)

# ── Kalman / smoothing constants ─────────────────────────────────────────────
# Defaults — overridable via Settings → Presence → Signal Filter
_KALMAN_Q: float = DEFAULT_KALMAN_Q   # process noise
_KALMAN_R: float = DEFAULT_KALMAN_R   # measurement noise

# Rolling window for majority-vote room confirmation.
# Candidate room must win VOTE_THRESHOLD out of the last VOTE_WINDOW polls.
# At 10s/poll, window=5 means a room switch needs ~30s of consistent dominance.
_VOTE_WINDOW: int = 5
_VOTE_THRESHOLD: int = 3

# RSSI threshold below which a silent source is pruned from the Kalman cache.
# Relaxed from -95 to -98 to preserve Kalman state longer across silent periods,
# giving ~7-8 polls (~70-80s) of memory instead of ~4-5 polls.
_EMA_PRUNE_DBM: float = -98.0

# Phantom RSSI injected each poll for sources that have gone silent (drives decay).
_EMA_SILENCE_DBM: float = -100.0

# Number of consecutive missed polls before a device starts accumulating age_s.
# Grace period = _AWAY_GRACE_POLLS * _SCAN_INTERVAL = 2 * 10s = 20s.
_AWAY_GRACE_POLLS: int = 2

# ── k-NN live fingerprint gating ─────────────────────────────────────────────
# Minimum calibration points before k-NN is consulted for live room assignment.
_KNN_MIN_POINTS: int = 5
# Minimum k-NN confidence [0, 1] required to override the Gaussian candidate.
# With the normalized confidence formula (mean-sq-error / REF_VARIANCE), a
# per-scanner RMS error of ~8 dBm gives ~28% confidence, ~5 dBm gives ~50%.
_KNN_LIVE_THRESHOLD: float = 0.15


def _room_from_bounds(room_bounds: dict, x: float, y: float) -> str:
    """Point-in-polygon / point-in-circle test against room_bounds. Returns room name or ''."""
    for room_name, b in room_bounds.items():
        if not isinstance(b, dict):
            continue
        btype = b.get("type", "poly")
        if btype == "circle":
            cx = float(b.get("cx", 0.5))
            cy = float(b.get("cy", 0.5))
            r = float(b.get("r", 0.12))
            if (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2:
                return str(room_name)
        elif btype == "poly":
            pts = b.get("points") or []
            if len(pts) < 3:
                continue
            inside = False
            n = len(pts)
            j = n - 1
            for i in range(n):
                xi, yi = float(pts[i][0]), float(pts[i][1])
                xj, yj = float(pts[j][0]), float(pts[j][1])
                if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
                    inside = not inside
                j = i
            if inside:
                return str(room_name)
    return ""


class PresenceCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Periodically fetches the live BLE snapshot and exposes smoothed room data."""

    def __init__(self, hass: HomeAssistant) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name="PadSpan HA Presence",
            update_interval=_SCAN_INTERVAL,
        )
        # ── home/away persistence ────────────────────────────────────────────
        # {key: monotonic_ts}  — when each object was last in the live snapshot
        self._last_seen: dict[str, float] = {}
        # {key: obj_dict}  — most recent live copy of each object
        self._known_objs: dict[str, dict[str, Any]] = {}
        # {key: int}  — consecutive polls the object has been absent
        self._away_miss: dict[str, int] = {}

        # ── Kalman smoothing state (keyed by addr/key) ───────────────────────
        # {addr: {source: filtered_rssi}}  — Kalman state estimate x
        self._ema_rssi: dict[str, dict[str, float]] = {}
        # {addr: {source: error_covariance}}  — Kalman state P
        self._kalman_p: dict[str, dict[str, float]] = {}

        # ── Room-vote state (keyed by object key) ────────────────────────────
        # {key: deque of recent candidate rooms}
        self._room_votes: dict[str, deque] = {}
        # {key: confirmed_room | None}  — the current stable room assignment
        self._confirmed_room: dict[str, str | None] = {}
        # {key: float}  — vote-window confidence ∈ [0, 1]
        self._room_confidence: dict[str, float] = {}
        # {key: float}  — RSSI margin confidence ∈ [0, 1] (gap between best and 2nd-best scanner)
        self._rssi_margin_confidence: dict[str, float] = {}
        # {key: dict}  — latest k-NN fingerprint result (x_frac, y_frac, confidence, nearest_room)
        self._knn_position: dict[str, dict] = {}
        # {key: (x, y)}  — EMA-smoothed position for stable map display
        self._smooth_xy: dict[str, tuple[float, float]] = {}
        # Throttle: {key: monotonic_ts} — last alert sent time per object
        self._alert_last_sent: dict[str, float] = {}
        _ALERT_COOLDOWN_S = 60  # min seconds between alerts for same device

        # ── Beacon auto-calibration rate-limit ──────────────────────────────────
        # {key: monotonic_ts} — last auto-calibration injection time per beacon
        self._beacon_autocal_last: dict[str, float] = {}

        # ── Adaptive learning rate-limit ───────────────────────────────────────
        # {key: monotonic_ts} — last adaptive observation time per device
        self._adaptive_last_obs: dict[str, float] = {}
        # Save counter — only persist to disk every N observations (not every poll)
        self._adaptive_save_counter: int = 0

    # ── main update ──────────────────────────────────────────────────────────

    async def _async_update_data(self) -> dict[str, Any]:
        from .websocket import _live_snapshot  # noqa: PLC0415  (circular-import guard)
        from .private_ble_resolver import get_resolver  # noqa: PLC0415

        try:
            snap = await _live_snapshot(self.hass)
        except Exception as err:
            raise UpdateFailed(f"PadSpan snapshot error: {err}") from err

        now = time.monotonic()
        self._pending_room_changes: list[tuple[str, str | None, str]] = []  # (key, old_room, new_room)

        # ── Resolve rotating MACs to canonical IDs ────────────────────────────
        # Build a mapping {raw_addr_upper → canonical_key} so that all rotating
        # MACs from the same phone merge into one Kalman state entry.
        resolver = await get_resolver(self.hass)
        _rpa_map: dict[str, str] = {}  # raw_addr → canonical_key
        if resolver.has_devices():
            for ad in (snap.get("ble") or {}).get("advertisements") or []:
                raw = str(ad.get("address") or "").upper()
                if raw and raw not in _rpa_map:
                    res = resolver.resolve_address(raw)
                    if res:
                        _rpa_map[raw] = str(res["canonical_id"]).upper()

        # Build {key: {source: rssi}} and {key: tx_power} from advertisements.
        # For resolved RPAs, use the canonical_id as key so all rotations share
        # one Kalman state.
        addr_src_rssi: dict[str, dict[str, float]] = {}
        addr_tx_power: dict[str, int] = {}
        for ad in (snap.get("ble") or {}).get("advertisements") or []:
            raw_addr = str(ad.get("address") or "").upper()
            addr = _rpa_map.get(raw_addr, raw_addr)  # canonical or raw
            src  = ad.get("source")
            rssi = ad.get("rssi")
            if addr and src and rssi is not None:
                existing = addr_src_rssi.setdefault(addr, {})
                # For merged RPAs, keep the strongest RSSI per source
                if str(src) not in existing or float(rssi) > existing[str(src)]:
                    existing[str(src)] = float(rssi)
            # Capture TX Power Level from the advertisement (BLE AD type 0x0A)
            tx_pwr = ad.get("tx_power")
            if addr and tx_pwr is not None and addr not in addr_tx_power:
                addr_tx_power[addr] = int(tx_pwr)

        # Build {source: area} and {source: floor} from BLE radios
        source_to_area: dict[str, str] = {}
        source_to_floor: dict[str, str] = {}
        # Pre-build area→floor lookup from HA registries (for adaptive floor detection)
        _area_to_floor: dict[str, str] = {}
        try:
            from homeassistant.helpers import area_registry as _ar_reg  # noqa: PLC0415
            for _a in _ar_reg.async_get(self.hass).async_list_areas():
                _fl = getattr(_a, "floor_id", None)
                if _a.name and _fl:
                    _area_to_floor[_a.name] = str(_fl)
        except Exception:
            pass
        for r in (snap.get("ble") or {}).get("radios") or []:
            src  = r.get("source")
            area = r.get("area_name") or r.get("area")
            if src and area:
                source_to_area[str(src)] = str(area)
                fl = _area_to_floor.get(str(area))
                if fl:
                    source_to_floor[str(src)] = fl

        # Apply per-scanner RSSI offsets to the raw addr_src_rssi dict
        try:
            _st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _scanner_offsets: dict[str, float] = ((_st.data if _st else {}).get("scanner_offsets") or {})
            if _scanner_offsets:
                for _am in addr_src_rssi.values():
                    for _src in _am:
                        _off = _scanner_offsets.get(_src)
                        if _off:
                            _am[_src] = _am[_src] + float(_off)
        except Exception:
            pass

        # Read configurable room-change delay from settings
        try:
            _st2 = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _delay_s = float(((_st2.data if _st2 else {}).get("room_change_delay_s") or 20.0))
            _delay_s = max(0.0, min(300.0, _delay_s))
            _dyn_vote_window = max(1, round(_delay_s / _SCAN_INTERVAL.total_seconds()))
            _dyn_vote_threshold = max(1, (_dyn_vote_window + 1) // 2)
        except Exception:
            _dyn_vote_window = _VOTE_WINDOW
            _dyn_vote_threshold = _VOTE_THRESHOLD

        objects: list[dict[str, Any]] = (snap.get("objects") or {}).get("list") or []
        result: dict[str, Any] = {}

        # ── Load pinned beacon positions + master map room bounds ────────────
        _pinned: dict[str, dict[str, Any]] = {}  # key → {map_id, x, y, room, floor_id}
        _master_bounds: dict[str, Any] = {}  # room_bounds from the master map (precedence)
        _master_map_id: str = ""              # master map ID (for k-NN coordinate space check)
        _master_rooms: set[str] = set()       # rooms defined on the master map
        _maps_store = None
        try:
            _maps_store = self.hass.data.get(DOMAIN, {}).get(DATA_MAPS)
            if _maps_store:
                for _m in (_maps_store.data.get("maps") or []):
                    _rb = _m.get("room_bounds") or {}
                    # Capture master map's room_bounds for precedence
                    if (_m.get("stack") or {}).get("is_master"):
                        _master_bounds = _rb
                        _master_map_id = _m.get("id", "")
                        _master_rooms = set(_rb.keys())
                    for _bk in (_m.get("beacons") or []):
                        _bk_key = _bk.get("key")
                        if _bk_key and _bk.get("x") is not None:
                            _room = _room_from_bounds(_rb, float(_bk.get("x", 0)), float(_bk.get("y", 0)))
                            _pinned[_bk_key] = {
                                "map_id": _m.get("id", ""),
                                "x": float(_bk.get("x", 0)),
                                "y": float(_bk.get("y", 0)),
                                "room": _room,
                                "floor_id": _m.get("floor_id", ""),
                            }
        except Exception:
            pass

        for obj in objects:
            key = obj.get("key", "")
            if not key:
                continue

            # ── Re-entry detection: clear stale smoothing state ──────────────
            # If this device was absent (stale) in the previous poll and is now
            # back, reset the vote window and Kalman state so old-location votes
            # don't slow down re-assignment.
            if self._known_objs.get(key, {}).get("_stale"):
                self._room_votes.pop(key, None)
                self._room_confidence.pop(key, None)
                self._knn_position.pop(key, None)
                self._smooth_xy.pop(key, None)
                if obj.get("kind") in ("ble", "private_ble"):
                    # For private_ble, use canonical_id as Kalman key
                    _raw_addr = str(obj.get("address") or "").upper()
                    addr_clear = _rpa_map.get(_raw_addr, _raw_addr)
                    self._ema_rssi.pop(addr_clear, None)
                    self._kalman_p.pop(addr_clear, None)
                elif obj.get("kind") == "ibeacon":
                    self._ema_rssi.pop(key, None)
                    self._kalman_p.pop(key, None)

            # Cache the live copy for home/away persistence
            self._last_seen[key] = now
            self._away_miss[key] = 0  # reset grace counter — device is present

            self._known_objs[key] = dict(obj)

            # Apply smoothing only to BLE objects (entity-based ones are already
            # smoothed by their source integration, e.g. Bermuda).
            if obj.get("kind") in ("ble", "private_ble"):
                obj = dict(obj)  # copy — don't mutate the snapshot list in place
                raw_addr = str(obj.get("address") or "").upper()
                # For private_ble, use canonical_id as Kalman state key so all
                # rotating MACs share one continuous smoothing state.
                smooth_addr = _rpa_map.get(raw_addr, raw_addr)
                smoothed_room = self._smooth_room(
                    key, smooth_addr, addr_src_rssi, source_to_area,
                    _dyn_vote_window, _dyn_vote_threshold, source_to_floor,
                    _master_rooms, _master_map_id, _master_bounds, _maps_store)
                if smoothed_room:
                    obj["room"] = smoothed_room
                obj["_smoothed"] = True
                obj["room_confidence"] = self._room_confidence.get(key, 0.0)
                obj["rssi_margin_confidence"] = self._rssi_margin_confidence.get(key, 0.0)
                # Propagate k-NN sub-room position when calibration data is available
                _knn = self._knn_position.get(key)
                if _knn:
                    obj["x_frac"] = _knn.get("x_frac")
                    obj["y_frac"] = _knn.get("y_frac")
                    obj["knn_confidence"] = _knn.get("confidence")
                    if _knn.get("map_id"):
                        obj["knn_map_id"] = _knn["map_id"]
                # Store Kalman-smoothed per-source RSSI for scanner distance sensors
                obj["_source_rssi"] = dict(self._ema_rssi.get(smooth_addr, {}))
                # Propagate TX power if seen in advertisements
                if smooth_addr in addr_tx_power:
                    obj.setdefault("tx_power", addr_tx_power[smooth_addr])
                elif raw_addr in addr_tx_power:
                    obj.setdefault("tx_power", addr_tx_power[raw_addr])
                self._known_objs[key] = dict(obj)  # refresh with smoothed data
            elif obj.get("kind") == "ibeacon":
                obj = dict(obj)
                # Merge per-source RSSI across all rotating MACs for this iBeacon
                merged_src: dict[str, float] = {}
                for a in (obj.get("all_addresses") or []):
                    for src, rssi in addr_src_rssi.get(str(a).upper(), {}).items():
                        if src not in merged_src or rssi > merged_src[src]:
                            merged_src[src] = rssi
                # Pass merged RSSI under the UUID key as a synthetic single-addr dict
                synthetic = {key: merged_src} if merged_src else {}
                smoothed_room = self._smooth_room(
                    key, key, synthetic, source_to_area,
                    _dyn_vote_window, _dyn_vote_threshold, source_to_floor,
                    None, _master_map_id, _master_bounds, _maps_store)
                if smoothed_room:
                    obj["room"] = smoothed_room
                obj["_smoothed"] = True
                obj["room_confidence"] = self._room_confidence.get(key, 0.0)
                obj["rssi_margin_confidence"] = self._rssi_margin_confidence.get(key, 0.0)
                # Propagate k-NN sub-room position when calibration data is available
                _knn_ib = self._knn_position.get(key)
                if _knn_ib:
                    obj["x_frac"] = _knn_ib.get("x_frac")
                    obj["y_frac"] = _knn_ib.get("y_frac")
                    obj["knn_confidence"] = _knn_ib.get("confidence")
                    if _knn_ib.get("map_id"):
                        obj["knn_map_id"] = _knn_ib["map_id"]
                # Store Kalman-smoothed per-source RSSI for scanner distance sensors
                obj["_source_rssi"] = dict(self._ema_rssi.get(key, {}))
                self._known_objs[key] = dict(obj)  # refresh with smoothed data

            # ── Pinned beacon room override ──────────────────────────────────
            if key in _pinned:
                _pin = _pinned[key]
                if _pin["room"]:
                    obj = dict(obj) if not isinstance(obj, dict) else obj
                    obj["room"] = _pin["room"]
                    self._confirmed_room[key] = _pin["room"]
                obj["_pinned"] = True

            result[key] = obj

        # ── Auto-calibration from pinned beacons ─────────────────────────────
        if _pinned:
            await self._inject_beacon_calibration(now, _pinned, result)

        # ── Read signal-loss linger setting ───────────────────────────────────
        try:
            _st_ling = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _linger_s = int((_st_ling.data if _st_ling else {}).get("signal_loss_linger_s", 90))
            _linger_s = max(10, min(300, _linger_s))
        except Exception:
            _linger_s = 90
        _linger_polls = max(2, round(_linger_s / _SCAN_INTERVAL.total_seconds()))

        # ── Carry forward stale objects (home/away persistence) ──────────────
        # Objects persist through the grace period (signal_loss_linger_s) and
        # then as stale for up to _STALE_EVICT_S, after which they are evicted
        # from all coordinator caches.
        _STALE_EVICT_S = max(float(_linger_s) * 3, 600.0)  # 3× linger or 10min
        _evict_keys: list[str] = []
        for key, last_obj in list(self._known_objs.items()):
            if key in result:
                continue
            # Grace period: don't start aging until enough consecutive misses.
            # Devices with confident presence get a longer grace (signal_loss_linger_s)
            # to ride out BLE dropouts without flickering to away.
            miss = self._away_miss.get(key, 0) + 1
            self._away_miss[key] = miss
            _last_conf = last_obj.get("room_confidence", 0.0)
            _grace = _linger_polls if _last_conf >= 0.6 else _AWAY_GRACE_POLLS
            if miss < _grace:
                # Grace period — treat as still present (age_s = 0)
                grace = dict(last_obj)
                grace["age_s"] = 0.0
                grace.pop("_stale", None)
                result[key] = grace
                continue
            elapsed = now - self._last_seen.get(key, now)
            # Evict objects that have been stale too long
            if elapsed > _STALE_EVICT_S:
                _evict_keys.append(key)
                continue
            stale = dict(last_obj)
            stale["age_s"]  = elapsed
            stale["_stale"] = True
            # Preserve the last confirmed room in the stale entry
            if stale.get("kind") in ("ble", "private_ble", "ibeacon") and self._confirmed_room.get(key):
                stale["room"] = self._confirmed_room[key]
            result[key] = stale
        # Clean up evicted objects from all caches
        for key in _evict_keys:
            self._evict_object(key)

        # ── Fire follow-alerts for room changes ────────────────────────────────
        if self._pending_room_changes:
            await self._process_room_alerts(now, result)
            await self._record_movement(result)
            # Emit HA tag events for room changes (Feature 1)
            try:
                from .const import DATA_TAG_INTEGRATION
                tag_int = self.hass.data.get(DOMAIN, {}).get(DATA_TAG_INTEGRATION)
                if tag_int:
                    await tag_int.async_emit_room_changes(
                        self._pending_room_changes, result
                    )
            except Exception:
                pass
            self._pending_room_changes.clear()

        # ── Experimental MQTT publishing ─────────────────────────────────────
        await self._async_mqtt_publish(result)

        return result

    # ── MQTT publishing (experimental) ───────────────────────────────────────

    async def _async_mqtt_publish(self, result: dict[str, Any]) -> None:
        """Publish device state to MQTT if enabled. Errors never break the pipeline."""
        try:
            st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            if not st or not (st.data or {}).get("mqtt_publish_enabled", False):
                return
            from homeassistant.components.mqtt import async_publish  # noqa: PLC0415
            import json as _json  # noqa: PLC0415
            for key, obj in result.items():
                label = obj.get("user_label")
                if not label:
                    continue
                slug = label.lower().replace(" ", "_")
                topic_base = f"padspan/devices/{slug}"
                # State JSON
                payload = {
                    "room": obj.get("room"),
                    "rssi": obj.get("rssi"),
                    "age_s": obj.get("age_s"),
                    "home": not (isinstance(obj.get("age_s"), (int, float)) and obj["age_s"] > 300),
                    "room_confidence": obj.get("room_confidence"),
                }
                await async_publish(self.hass, f"{topic_base}/state", _json.dumps(payload), retain=True)
                await async_publish(self.hass, f"{topic_base}/area", obj.get("room") or "unknown", retain=True)
                dist = obj.get("distance")
                if dist is not None:
                    await async_publish(self.hass, f"{topic_base}/distance", str(dist), retain=True)
        except ImportError:
            _LOGGER.debug("MQTT component not available — skipping MQTT publish")
        except Exception:
            _LOGGER.debug("MQTT publish error", exc_info=True)

    # ── smoothing helpers ─────────────────────────────────────────────────────

    def _smooth_room(
        self,
        key: str,
        addr: str,
        addr_src_rssi: dict[str, dict[str, float]],
        source_to_area: dict[str, str],
        vote_window: int = _VOTE_WINDOW,
        vote_threshold: int = _VOTE_THRESHOLD,
        source_to_floor: dict[str, str] | None = None,
        master_rooms: set[str] | None = None,
        master_map_id: str = "",
        master_bounds: dict | None = None,
        maps_store: Any | None = None,
    ) -> str | None:
        """
        Run one poll of the two-stage smoothing pipeline for a BLE device.
        Returns the confirmed (stable) room name, or None if not yet established.
        vote_window / vote_threshold come from the per-poll configurable delay setting.
        Stores room confidence in self._room_confidence[key].
        """
        live_srcs = addr_src_rssi.get(addr, {})

        # ── Stage 1: Kalman-filtered RSSI per source ─────────────────────────
        if addr not in self._ema_rssi:
            self._ema_rssi[addr] = {}
        if addr not in self._kalman_p:
            self._kalman_p[addr] = {}
        ema = self._ema_rssi[addr]
        kp  = self._kalman_p[addr]

        # Read Q/R from settings (allows runtime tuning without restart)
        try:
            _st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _d = (_st.data if _st else {}) or {}
            _Q = float(_d.get("kalman_q", _KALMAN_Q))
            _R = float(_d.get("kalman_r", _KALMAN_R))
        except Exception:
            _Q = _KALMAN_Q
            _R = _KALMAN_R

        # Update sources that reported this poll
        for src, rssi in live_srcs.items():
            if src in ema:
                p = kp.get(src, _R)
                K = p / (p + _R)
                ema[src] = ema[src] + K * (rssi - ema[src])
                kp[src] = (1.0 - K) * p + _Q
            else:
                ema[src] = rssi   # first observation — seed without smoothing
                kp[src] = _R      # start with maximum uncertainty

        # Decay sources that did NOT report (drifts toward silence target and pruned).
        # Total silence (no scanners reporting) uses a gentler -95 dBm phantom so
        # Kalman state survives ~20-25 polls (~200-250s) instead of ~7-8 polls.
        # Partial silence (some scanners still active = genuine movement) keeps
        # the aggressive -100 dBm target for fast pruning of losing scanners.
        _all_silent = len(live_srcs) == 0 and len(ema) > 0
        _decay_target = -95.0 if _all_silent else _EMA_SILENCE_DBM
        for src in list(ema):
            if src not in live_srcs:
                p = kp.get(src, _R)
                K = p / (p + _R)
                ema[src] = ema[src] + K * (_decay_target - ema[src])
                kp[src] = (1.0 - K) * p + _Q
                if ema[src] < _EMA_PRUNE_DBM:
                    del ema[src]
                    kp.pop(src, None)

        # Read path-loss params and room sigma from settings
        try:
            _st_pl = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _d_pl  = (_st_pl.data if _st_pl else {}) or {}
            _ref   = float(_d_pl.get("ref_power",    DEFAULT_REF_POWER))
            _n_exp = float(_d_pl.get("path_loss_exp", DEFAULT_PATH_LOSS_EXP))
            _sigma = float(_d_pl.get("room_sigma_m",  DEFAULT_ROOM_SIGMA_M))
        except Exception:
            _ref   = DEFAULT_REF_POWER
            _n_exp = DEFAULT_PATH_LOSS_EXP
            _sigma = DEFAULT_ROOM_SIGMA_M

        # ── Change A: Gaussian room scoring ──────────────────────────────────
        # Convert each scanner's Kalman-filtered RSSI → estimated distance →
        # Gaussian weight exp(−(d/σ)²).  Score each room as the max weight of
        # its assigned scanners.  Compared to winner-takes-all (max RSSI), this
        # penalises scanners on the far side of a wall more proportionally,
        # softening boundary flickering without requiring geometry data.
        candidate: str | None = None
        rssi_margin_confidence: float = 0.0
        if ema:
            # Raw RSSI gap: keep backwards-compatible rssi_margin_confidence metric
            sorted_vals = sorted(ema.values(), reverse=True)
            if len(sorted_vals) >= 2:
                rssi_margin_confidence = round(
                    min(1.0, max(0.0, (sorted_vals[0] - sorted_vals[1]) / 15.0)), 2
                )
            else:
                rssi_margin_confidence = 1.0

            # Gaussian room scoring with hysteresis
            room_scores: dict[str, float] = {}
            for _src, _rssi in ema.items():
                _room = source_to_area.get(_src)
                if not _room:
                    continue
                _dist  = max(0.1, 10.0 ** ((_ref - _rssi) / (10.0 * _n_exp)))
                _score = math.exp(-(_dist / _sigma) ** 2)
                if _room not in room_scores or _score > room_scores[_room]:
                    room_scores[_room] = _score
            if room_scores:
                _best_room = max(room_scores, key=lambda r: room_scores[r])
                _cur_room = self._confirmed_room.get(key)
                # Hysteresis: stick with current room unless new room's score
                # exceeds current room's score by a margin.  Prevents flipping
                # when two scanners are nearly equal (boundary device).
                # Read configurable hysteresis margin from settings (default 0.06)
                try:
                    _st_hyst = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
                    _HYSTERESIS_MARGIN = float(((_st_hyst.data if _st_hyst else {}).get("hysteresis_margin") or 0.06))
                    _HYSTERESIS_MARGIN = max(0.0, min(0.3, _HYSTERESIS_MARGIN))
                except Exception:
                    _HYSTERESIS_MARGIN = 0.06
                if _cur_room and _cur_room in room_scores and _best_room != _cur_room:
                    if room_scores[_best_room] - room_scores[_cur_room] < _HYSTERESIS_MARGIN:
                        # Within hysteresis — prefer master map rooms as tie-breaker
                        if master_rooms and _cur_room not in master_rooms and _best_room in master_rooms:
                            candidate = _best_room  # master map room wins the tie
                        else:
                            candidate = _cur_room  # stay — margin too small
                    else:
                        candidate = _best_room
                else:
                    candidate = _best_room

        # ── Change A2: Adaptive learning blend ──────────────────────────────
        # When adaptive learning is enabled and has accumulated data, blend
        # fingerprint-similarity scores into the Gaussian room scores.  Also
        # apply transition priors and cross-floor penalty.
        try:
            _st_ad = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _d_ad = (_st_ad.data if _st_ad else {}) or {}
            _adaptive_on = bool(_d_ad.get("adaptive_learning_enabled", False))
            _floor_on = bool(_d_ad.get("adaptive_floor_detection", False))
        except Exception:
            _adaptive_on = False
            _floor_on = False

        if _adaptive_on and ema and room_scores:
            try:
                _ad_store = self.hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
                if _ad_store and _ad_store.maturity() > 0.05:
                    _ad_scores = _ad_store.score_rooms(dict(ema), source_to_area)
                    # Cap blend at 25% (was 40%) — adaptive should assist, not dominate
                    _blend = min(0.25, _ad_store.maturity() * 0.3)
                    for _ar in room_scores:
                        if _ar in _ad_scores:
                            room_scores[_ar] = (1.0 - _blend) * room_scores[_ar] + _blend * _ad_scores[_ar]

                    # Transition prior — reduced from 15% to 8% max to prevent
                    # positive feedback loops that trap devices in rooms
                    _cur = self._confirmed_room.get(key)
                    if _cur:
                        _priors = _ad_store.transition_prior(_cur, room_scores.keys())
                        if _priors:
                            _prior_blend = min(0.08, _ad_store.maturity() * 0.1)
                            for _ar in room_scores:
                                room_scores[_ar] *= (1.0 + _prior_blend * _priors.get(_ar, 0.0))

                    # Floor penalty for cross-floor candidates
                    if _floor_on and source_to_floor and candidate:
                        _cand_floor = None
                        _cur_floor = None
                        _src_to_fl = source_to_floor or {}
                        for _src, _area in source_to_area.items():
                            if _area == candidate and _src in _src_to_fl:
                                _cand_floor = _src_to_fl[_src]
                                break
                        if _cur:
                            for _src, _area in source_to_area.items():
                                if _area == _cur and _src in _src_to_fl:
                                    _cur_floor = _src_to_fl[_src]
                                    break
                        if _cand_floor and _cur_floor and _cand_floor != _cur_floor:
                            _fl_conf = _ad_store.floor_confidence(dict(ema), _cand_floor, _src_to_fl)
                            if _fl_conf < 0.3:
                                room_scores[candidate] *= 0.5

                    # Recompute best room after blending — NO second hysteresis.
                    # Hysteresis was already applied above; applying it again
                    # made room changes require ~2x the margin to overcome.
                    _best_room = max(room_scores, key=lambda r: room_scores[r])
                    candidate = _best_room
            except Exception:
                pass  # adaptive scoring is best-effort

        # ── Change B: fingerprint positioning (k-NN or Random Forest) ─────────
        # When calibration data exists and the fingerprint match is confident
        # enough, use the result as the candidate instead of the Gaussian
        # winner.  Also captures sub-room (x_frac, y_frac) for map display.
        # Master map precedence: if the result gives a position (x_frac, y_frac),
        # test it against the master map's room_bounds.  If the position falls
        # inside a room on the master map, that room overrides nearest_room.
        try:
            _calib = self.hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
            if _calib and len(_calib.data.get("points", [])) >= _KNN_MIN_POINTS:
                # Choose algorithm based on setting
                _st2 = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
                _algo = ((_st2.data if _st2 else {}).get("positioning_algorithm") or "knn")
                if _algo == "rf" and _calib.rf_trained:
                    _knn = _calib.rf_locate(dict(ema))
                else:
                    _knn = _calib.knn_locate(dict(ema))
                # Periodic debug log (first object each cycle)
                if not hasattr(self, "_knn_log_count"):
                    self._knn_log_count = 0
                self._knn_log_count += 1
                if self._knn_log_count <= 10 or self._knn_log_count % 50 == 0:
                    _cal_srcs = set()
                    for _cp in _calib.data.get("points", []):
                        for _cr in (_cp.get("scanner_readings") or []):
                            if _cr.get("source"):
                                _cal_srcs.add(_cr["source"])
                    _overlap = set(ema.keys()) & _cal_srcs
                    _LOGGER.warning(
                        "k-NN [%s] addr=%s: ema=%d, cal_src=%d, overlap=%d, "
                        "result=%s, conf=%s, room=%s, positions_stored=%d",
                        key[:30], addr[:20], len(ema), len(_cal_srcs),
                        len(_overlap),
                        "yes" if _knn else "None",
                        _knn.get("confidence") if _knn else "N/A",
                        _knn.get("nearest_room", "") if _knn else "N/A",
                        len(self._knn_position),
                    )
                if _knn and _knn.get("confidence", 0.0) >= _KNN_LIVE_THRESHOLD:
                    _knn_room = _knn.get("nearest_room") or ""
                    # Room boundary check — use bounds from the map that k-NN
                    # coordinates belong to (they're in that map's coordinate space).
                    # Only fall back to master map bounds if k-NN is on the master.
                    if _knn.get("x_frac") is not None:
                        _knn_mid = _knn.get("map_id", "")
                        if _knn_mid == master_map_id and master_bounds:
                            _check_bounds = master_bounds
                        elif _knn_mid and maps_store:
                            _knn_map = next((m for m in (maps_store.data.get("maps") or []) if m.get("id") == _knn_mid), None)
                            _check_bounds = (_knn_map.get("room_bounds") or {}) if _knn_map else (master_bounds or {})
                        else:
                            _check_bounds = master_bounds or {}
                        if _check_bounds:
                            _geo_room = _room_from_bounds(
                                _check_bounds,
                                float(_knn["x_frac"]),
                                float(_knn["y_frac"]),
                            )
                            if _geo_room:
                                _knn_room = _geo_room
                    # Smooth x/y position with EMA to prevent map dot jumping.
                    # Higher confidence → faster tracking (alpha up to 0.5);
                    # lower confidence → more smoothing (alpha down to 0.15).
                    # Reset when the result switches maps (different coordinate space).
                    _raw_x = float(_knn.get("x_frac", 0.0))
                    _raw_y = float(_knn.get("y_frac", 0.0))
                    _prev = self._smooth_xy.get(key)
                    _prev_map = (self._knn_position.get(key) or {}).get("map_id", "")
                    _new_map = _knn.get("map_id", "")
                    _conf = float(_knn.get("confidence", 0.0))
                    _alpha = 0.15 + 0.35 * min(_conf, 1.0)  # 0.15–0.50
                    if _prev is not None and _prev_map == _new_map:
                        _sx = _prev[0] + _alpha * (_raw_x - _prev[0])
                        _sy = _prev[1] + _alpha * (_raw_y - _prev[1])
                    else:
                        _sx, _sy = _raw_x, _raw_y  # new map or first time — no smoothing
                    self._smooth_xy[key] = (_sx, _sy)
                    _knn_smoothed = dict(_knn)
                    _knn_smoothed["x_frac"] = round(_sx, 4)
                    _knn_smoothed["y_frac"] = round(_sy, 4)
                    self._knn_position[key] = _knn_smoothed
                    if _knn_room:
                        candidate = _knn_room
                else:
                    self._knn_position.pop(key, None)
                    self._smooth_xy.pop(key, None)
            else:
                self._knn_position.pop(key, None)
                self._smooth_xy.pop(key, None)
        except Exception as _knn_err:
            _LOGGER.warning("k-NN error for %s: %s", key[:30], _knn_err, exc_info=True)
            self._knn_position.pop(key, None)
            self._smooth_xy.pop(key, None)

        # ── Stage 2: majority-vote window (size adjusts to room_change_delay_s) ──
        existing = self._room_votes.get(key)
        if existing is None or existing.maxlen != vote_window:
            # Resize the deque when the setting changes; preserve existing votes
            prev = list(existing) if existing else []
            self._room_votes[key] = deque(prev[-vote_window:], maxlen=vote_window)
        votes = self._room_votes[key]
        # Don't pollute the vote window with None when no data is available
        # (preserves last known room during total signal dropout)
        if candidate is not None:
            votes.append(candidate)

        counts: dict[str, int] = {}
        for v in votes:
            if v:
                counts[v] = counts.get(v, 0) + 1

        confirmed = self._confirmed_room.get(key)
        confidence = 0.0
        if counts:
            top_room = max(counts, key=lambda r: counts[r])
            top_count = counts[top_room]
            confidence = round(top_count / len(votes), 2)
            if top_count >= vote_threshold:
                if top_room != confirmed:
                    _LOGGER.debug(
                        "Room confirmed for %s: %s → %s (votes %s, confidence %.0f%%)",
                        key, confirmed, top_room, dict(counts), confidence * 100,
                    )
                    # Track room change for alert processing
                    self._pending_room_changes.append((key, confirmed, top_room))
                confirmed = top_room

        self._confirmed_room[key] = confirmed
        self._room_confidence[key] = confidence
        self._rssi_margin_confidence[key] = rssi_margin_confidence

        # ── Adaptive learning: record observation ────────────────────────────
        # Only learn from high-confidence, stable assignments.  Rate-limited to
        # one observation per device per 300 s to keep data compact.
        if _adaptive_on and confirmed and confidence >= 0.7 and ema:
            try:
                _now_mono = time.monotonic()
                _last = self._adaptive_last_obs.get(key, 0.0)
                if _now_mono - _last >= 300.0:
                    self._adaptive_last_obs[key] = _now_mono
                    _ad = self.hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
                    if _ad:
                        # Derive floor of confirmed room
                        _conf_floor = None
                        if source_to_floor:
                            for _src, _area in source_to_area.items():
                                if _area == confirmed and _src in (source_to_floor or {}):
                                    _conf_floor = source_to_floor[_src]
                                    break
                        _ad.observe(confirmed, _conf_floor, dict(ema), source_to_area, source_to_floor or {})
                        # Record transitions
                        for _chg_key, _old, _new in self._pending_room_changes:
                            if _chg_key == key:
                                _ad.record_transition(_old, _new)
                        # Periodic save (every 20 observations, not every poll)
                        self._adaptive_save_counter += 1
                        if self._adaptive_save_counter >= 20:
                            self._adaptive_save_counter = 0
                            self.hass.async_create_task(_ad.async_save_periodic())
            except Exception:
                pass  # adaptive learning is best-effort

        return confirmed

    # ── Object state cleanup ─────────────────────────────────────────────

    def _evict_object(self, key: str) -> None:
        """Remove all cached state for a single object key (internal)."""
        self._known_objs.pop(key, None)
        self._last_seen.pop(key, None)
        self._away_miss.pop(key, None)
        self._room_votes.pop(key, None)
        self._confirmed_room.pop(key, None)
        self._room_confidence.pop(key, None)
        self._rssi_margin_confidence.pop(key, None)
        self._knn_position.pop(key, None)
        self._beacon_autocal_last.pop(key, None)
        self._adaptive_last_obs.pop(key, None)
        self._ema_rssi.pop(key, None)
        self._kalman_p.pop(key, None)

    def clear_object_state(self, key: str) -> None:
        """Public API: clear all coordinator state for an object.

        Called when a beacon is removed from beacon tune or an object
        is unfollowed — ensures the object won't linger as stale.
        """
        self._evict_object(key)
        # Also try uppercase variant (keys may differ in case)
        ku = key.upper()
        if ku != key:
            self._evict_object(ku)
        _LOGGER.debug("Cleared coordinator state for %s", key)

    # ── Beacon auto-calibration ────────────────────────────────────────────

    async def _inject_beacon_calibration(
        self, now: float, pinned: dict[str, dict], result: dict[str, Any]
    ) -> None:
        """Auto-inject calibration points from pinned beacons with RSSI data."""
        try:
            _st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            if _st:
                _auto_cal = _st.data.get("beacon_auto_calibrate", True)
                _adaptive = _st.data.get("adaptive_learning_enabled", False)
                # Auto-calibrate if either beacon_auto_calibrate or adaptive_learning is on
                if not _auto_cal and not _adaptive:
                    return
        except Exception:
            pass

        cal_store = self.hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
        if not cal_store:
            return

        _AUTOCAL_INTERVAL = 600.0  # 10 minutes between injections per beacon

        for key, pin in pinned.items():
            obj = result.get(key)
            if not obj or obj.get("_stale"):
                continue
            # Rate limit: at most 1 injection per beacon per 10 minutes
            last_ts = self._beacon_autocal_last.get(key, 0.0)
            if now - last_ts < _AUTOCAL_INTERVAL:
                continue
            # Need smoothed per-source RSSI
            smoothed_rssi: dict[str, float] = obj.get("_source_rssi") or {}
            if not smoothed_rssi:
                continue
            self._beacon_autocal_last[key] = now
            try:
                await cal_store.async_add_point({
                    "map_id": pin["map_id"],
                    "x_frac": pin["x"],
                    "y_frac": pin["y"],
                    "floor_id": pin["floor_id"],
                    "room": pin["room"],
                    "label": f"[auto] {obj.get('user_label') or key}",
                    "device_id": key,
                    "duration_s": 10,
                    "scanner_readings": [
                        {"source": src, "rssi_samples": [rssi]}
                        for src, rssi in smoothed_rssi.items()
                    ],
                })
                await cal_store.async_prune_auto_points(max_per_beacon=50)
            except Exception:
                _LOGGER.debug("Beacon auto-cal injection failed for %s", key)

    async def inject_immediate_calibration(
        self, beacons: list[dict], map_id: str, floor_id: str, room_bounds: dict
    ) -> int:
        """Immediately inject calibration points for beacons that have live RSSI.

        Called when beacon tune saves positions — bypasses the 10-minute rate limit
        and uses the presence coordinator's cached EMA RSSI.

        Returns number of calibration points injected.
        """
        cal_store = self.hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
        if not cal_store:
            return 0

        injected = 0
        now = time.monotonic()
        for bk in beacons:
            key = bk.get("key", "")
            if not key or bk.get("x") is None or bk.get("y") is None:
                continue
            # Determine room from room_bounds
            bx, by = float(bk.get("x", 0)), float(bk.get("y", 0))
            room = _room_from_bounds(room_bounds or {}, bx, by)
            # Find RSSI data — try both key directly and known object addresses
            smoothed_rssi = dict(self._ema_rssi.get(key, {}))
            if not smoothed_rssi:
                # For iBeacons, RSSI is stored under the UUID key
                smoothed_rssi = dict(self._ema_rssi.get(key.upper(), {}))
            if not smoothed_rssi:
                # Try known objects cache for the address
                obj = self._known_objs.get(key) or {}
                smoothed_rssi = obj.get("_source_rssi") or {}
            if not smoothed_rssi:
                continue
            # Reset rate limit so periodic injection also picks up new position
            self._beacon_autocal_last[key] = now
            try:
                label = (self._known_objs.get(key) or {}).get("user_label") or key
                await cal_store.async_add_point({
                    "map_id": map_id,
                    "x_frac": bx,
                    "y_frac": by,
                    "floor_id": floor_id,
                    "room": room,
                    "label": f"[auto] {label}",
                    "device_id": key,
                    "duration_s": 10,
                    "scanner_readings": [
                        {"source": src, "rssi_samples": [rssi]}
                        for src, rssi in smoothed_rssi.items()
                    ],
                })
                await cal_store.async_prune_auto_points(max_per_beacon=50)
                injected += 1
            except Exception:
                _LOGGER.debug("Immediate beacon cal injection failed for %s", key)
        return injected

    # ── Follow-alert processing ────────────────────────────────────────────

    async def _process_room_alerts(
        self, now: float, result: dict[str, Any]
    ) -> None:
        """Send email alerts for room changes based on saved alert configs."""
        from .const import DOMAIN, DATA_ALERTS

        alert_store = self.hass.data.get(DOMAIN, {}).get(DATA_ALERTS)
        if not alert_store:
            return

        for key, old_room, new_room in self._pending_room_changes:
            try:
                cfg = alert_store.get_config(key)
                if not cfg:
                    # UI saves alert config under address (e.g. "AA:BB:CC:DD:EE:FF")
                    # but key is prefixed (e.g. "ble:AA:BB:CC:DD:EE:FF"). Try address.
                    _obj = result.get(key) or self._known_objs.get(key) or {}
                    _addr = _obj.get("address") or ""
                    if _addr:
                        cfg = alert_store.get_config(_addr)
                if not cfg:
                    continue
                email = (cfg.get("email") or "").strip()
                if not email:
                    continue
                if not cfg.get("on_room_change"):
                    continue

                # Check watch_rooms filter (empty list = alert on all rooms)
                watch = cfg.get("watch_rooms") or []
                if watch and new_room not in watch:
                    continue

                # Rate limit: 60s cooldown per device
                last = self._alert_last_sent.get(key, 0.0)
                if now - last < 60:
                    _LOGGER.debug("Alert throttled for %s (%.0fs since last)", key, now - last)
                    continue

                # Get display label
                obj = result.get(key) or self._known_objs.get(key) or {}
                label = obj.get("user_label") or obj.get("name") or key

                # Find a notify service — prefer user-configured, fall back to first available
                # Supports both legacy notify.{name} and new HA 2024+ entity-based notify
                services = self.hass.services.async_services().get("notify", {})
                has_send_message = "send_message" in services
                entity_ids = [s.entity_id for s in self.hass.states.async_all("notify")]
                legacy = [k for k in services if k != "send_message"]

                if not services and not entity_ids:
                    _LOGGER.warning("Alert: no notify services available in HA")
                    continue

                preferred = cfg.get("notify_service") or ""

                message = (
                    f"{label} moved from {old_room or 'unknown'} to {new_room}"
                )
                alert_data: dict[str, Any] = {
                    "title": f"PadSpan: {label} moved",
                    "message": message,
                }
                sent = False
                # Try entity-based send_message first if applicable
                if preferred.startswith("notify.") and has_send_message:
                    try:
                        payload = {**alert_data, "entity_id": preferred}
                        if email:
                            payload["target"] = email
                        await self.hass.services.async_call("notify", "send_message", payload)
                        sent = True
                    except Exception:
                        # Fall through to legacy
                        pass
                if not sent and preferred and preferred in services:
                    try:
                        await self.hass.services.async_call(
                            "notify", preferred, {**alert_data, "target": email} if email else alert_data,
                        )
                        sent = True
                    except Exception:
                        try:
                            await self.hass.services.async_call("notify", preferred, alert_data)
                            sent = True
                        except Exception:
                            pass
                if not sent:
                    # Auto-pick: prefer entity with mail/smtp, then legacy, then first available
                    auto_targets: list[tuple[str, str, dict[str, Any]]] = []
                    for eid in entity_ids:
                        if has_send_message:
                            auto_targets.append(("send_message", eid, {**alert_data, "entity_id": eid}))
                    for svc in legacy:
                        auto_targets.append((svc, svc, alert_data))
                    # Sort: prefer mail/smtp
                    auto_targets.sort(key=lambda t: (0 if "mail" in t[1].lower() or "smtp" in t[1].lower() else 1))
                    for svc_name, _label, payload in auto_targets:
                        try:
                            await self.hass.services.async_call("notify", svc_name, payload)
                            sent = True
                            break
                        except Exception:
                            continue
                if sent:
                    self._alert_last_sent[key] = now
                    _LOGGER.info(
                        "Follow alert sent for %s: %s → %s (to %s via %s)",
                        label, old_room, new_room, email, preferred or "auto",
                    )
                else:
                    _LOGGER.warning("Follow alert: all send attempts failed for %s", label)
            except Exception as err:
                _LOGGER.warning("Follow alert failed for %s: %s", key, err)

    def clear_scanner(self, source: str) -> int:
        """Clear all in-memory smoothing state for a scanner.

        Removes source from _ema_rssi and _kalman_p for all device addresses.
        Returns the number of device entries cleaned.
        """
        cleared = 0
        for addr in list(self._ema_rssi):
            if source in self._ema_rssi[addr]:
                del self._ema_rssi[addr][source]
                self._kalman_p.get(addr, {}).pop(source, None)
                cleared += 1
                if not self._ema_rssi[addr]:
                    del self._ema_rssi[addr]
                    self._kalman_p.pop(addr, None)
        return cleared

    async def _record_movement(self, result: dict[str, Any]) -> None:
        """Record room transitions to persistent movement history."""
        from .const import DOMAIN, DATA_MOVEMENT, DATA_OBJECTS
        try:
            mv_store = self.hass.data.get(DOMAIN, {}).get(DATA_MOVEMENT)
            if not mv_store:
                return
            obj_store = self.hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
            for key, old_room, new_room in self._pending_room_changes:
                label = None
                if obj_store:
                    label = obj_store.get_label(key)
                await mv_store.record(key, old_room, new_room, label=label)
        except Exception as err:
            _LOGGER.debug("Movement recording failed: %s", err)
