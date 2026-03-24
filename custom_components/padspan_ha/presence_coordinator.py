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
    DOMAIN, DATA_SETTINGS, DATA_CALIBRATION, DATA_ADAPTIVE, DATA_MODEL,
    OUTSIDE_FLOOR_ID,
    DEFAULT_KALMAN_Q, DEFAULT_KALMAN_R,
    DEFAULT_REF_POWER, DEFAULT_PATH_LOSS_EXP, DEFAULT_ROOM_SIGMA_M,
    OUTSIDE_FLOOR_ID,
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

# ── Velocity gate ────────────────────────────────────────────────────────────
# Prevents "teleportation" — objects jumping to non-adjacent rooms faster than
# physically possible.  After a room change is confirmed, any subsequent change
# within the cooldown window requires UNANIMOUS vote agreement (all votes must
# agree) instead of the normal majority threshold.  This makes it progressively
# harder to hop rooms in rapid succession.
#
# The distance component uses room centroids: distant rooms (centroid distance
# > _VG_ADJACENT_THRESHOLD in normalised [0,1] coords) also require unanimous
# agreement regardless of timing.  This catches slow-drift teleportation where
# a device creeps across the building over 30+ seconds without passing through
# intermediate rooms.
_VG_RAPID_COOLDOWN_S: float = 15.0    # seconds after a room change during which the next change is gated
_VG_ADJACENT_THRESHOLD: float = 0.30  # normalised centroid distance — rooms within this are "adjacent"
_VG_ADJACENT_THRESHOLD_M: float = 8.0  # metres — Phase 2 real-world adjacency threshold
_ADJACENCY_SIGMOID_MID_M: float = 8.0  # metres — Phase 2 adjacency prior sigmoid midpoint

# ── Outdoor / isolated scanner penalties ─────────────────────────────────
_OUTDOOR_SCORE_DAMPING: float = 0.30  # multiply outdoor room scores by this when device is indoors
_ISOLATED_SCANNER_DAMPING: float = 0.50  # damping for scanners that are the only one on their floor
_ISOLATED_SCANNER_STRONG_DBM: float = -65.0  # RSSI above this = strong enough to override isolation damping

# ── Per-scanner reliability scoring (Phase 3) ────────────────────────────────
# Each scanner accumulates a rolling "disagreement" count — how often its best
# RSSI implies a different room than the consensus (confirmed room).
# reliability = 1 / (1 + disagreement_rate)  where rate ∈ [0, 1].
# Used as a weight multiplier on each scanner's Gaussian score.
_RELIABILITY_WINDOW: int = 30         # rolling window size (polls)
_RELIABILITY_MIN_POLLS: int = 6       # min observations before weight differs from 1.0
_RELIABILITY_FLOOR: float = 0.15      # minimum weight — never zero-out a scanner entirely

# ── k-NN live fingerprint gating ─────────────────────────────────────────────
# Minimum calibration points before k-NN is consulted for live room assignment.
_KNN_MIN_POINTS: int = 5
# Minimum k-NN confidence [0, 1] required to override the Gaussian candidate.
# With the normalized confidence formula (mean-sq-error / REF_VARIANCE), a
# per-scanner RMS error of ~8 dBm gives ~28% confidence, ~5 dBm gives ~50%.
_KNN_LIVE_THRESHOLD: float = 0.15


# _room_centroids_from_maps and _room_from_bounds removed.
# Fabric is the sole authority: model.room_centroids_m() and model.beacon_room_from_geometry().


def _segments_intersect(
    ax: float, ay: float, bx: float, by: float,
    cx: float, cy: float, dx: float, dy: float,
) -> bool:
    """Return True if segment AB crosses segment CD."""
    def _cross(o1x: float, o1y: float, o2x: float, o2y: float, o3x: float, o3y: float) -> float:
        return (o2x - o1x) * (o3y - o1y) - (o2y - o1y) * (o3x - o1x)
    d1 = _cross(cx, cy, dx, dy, ax, ay)
    d2 = _cross(cx, cy, dx, dy, bx, by)
    d3 = _cross(ax, ay, bx, by, cx, cy)
    d4 = _cross(ax, ay, bx, by, dx, dy)
    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True
    return False


def _barrier_attenuation(
    sx: float, sy: float, s_map: str,
    rx: float, ry: float, r_map: str,
    barriers: list[dict],
) -> float:
    """Compute total RF attenuation (dBm) for barriers crossing the line from
    scanner (sx,sy) to room centroid (rx,ry). Only considers barriers on the
    same map as the scanner."""
    total = 0.0
    for bar in barriers:
        if bar.get("map_id") != s_map:
            continue
        pts = bar["points"]
        for i in range(len(pts) - 1):
            if _segments_intersect(sx, sy, rx, ry, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]):
                total += bar["attenuation_dbm"]
                break  # one crossing per barrier is enough
    return total


class PresenceCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Central BLE room-presence engine for PadSpan HA.

    Polls the live BLE snapshot every 10 seconds and runs each advertisement
    through a multi-stage pipeline:
        1. Kalman filter (per-scanner RSSI smoothing)
        2. Gaussian room scoring (distance-weighted room assignment)
        3. Majority-vote window (temporal stabilization)

    The result dict maps object keys to enriched dicts containing the
    confirmed room, confidence scores, and optional k-NN sub-room position.
    Sensor and device_tracker entities consume this via HA's coordinator
    pattern (async_config_entry_first_refresh / async_add_listener).
    """

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

        # ── Velocity gate state ────────────────────────────────────────────────
        # {key: monotonic_ts} — when each device last changed rooms
        self._last_room_change_mono: dict[str, float] = {}
        # {key: monotonic_ts} — when each device entered its current confirmed room
        self._room_dwell_start: dict[str, float] = {}
        # {key: monotonic_ts} — when each device arrived on its current floor
        self._floor_dwell_start: dict[str, float] = {}
        # {key: floor_id} — each device's current confirmed floor
        self._device_floor: dict[str, str] = {}
        # {room_name: (cx, cy, map_id)} — room centroids (rebuilt each poll)
        self._room_centroids: dict[str, tuple[float, float, str]] = {}
        # RF barrier data for Gaussian scoring penalty (rebuilt each poll)
        # {scanner_source: (x, y, map_id)} — scanner positions from map receivers
        self._scanner_positions: dict[str, tuple[float, float, str]] = {}
        # List of barrier dicts: [{points, attenuation_dbm, map_id}, ...]
        self._rf_barriers: list[dict] = []
        # Phase 2: True when spatial data is in metres (not map fractions)
        self._use_metres: bool = False

        # ── Per-scanner reliability (Phase 3) ─────────────────────────────────
        # {source: deque of bools} — True = scanner agreed with consensus this poll
        self._scanner_agree: dict[str, deque] = {}
        # {source: float} — cached reliability weight ∈ [_RELIABILITY_FLOOR, 1.0]
        self._scanner_reliability: dict[str, float] = {}

        # ── Adjacency co-visibility learning (Phase 1) ────────────────────────
        # Accumulates scanner co-visibility counts between rooms.
        # Key: frozenset({roomA, roomB}), value: count of polls where both rooms
        # heard the same device with RSSI > -80.
        self._co_visible: dict[frozenset, int] = {}
        # Poll counter for adjacency learning (compute every 50 polls)
        self._adj_learn_polls: int = 0

        # ── Adaptive learning rate-limit ───────────────────────────────────────
        # {key: monotonic_ts} — last adaptive observation time per device
        self._adaptive_last_obs: dict[str, float] = {}
        # Save counter — only persist to disk every N observations (not every poll)
        self._adaptive_save_counter: int = 0

    # ── main update ──────────────────────────────────────────────────────────

    async def _async_update_data(self) -> dict[str, Any]:
        """Main poll loop — called every _SCAN_INTERVAL (10s) by HA's coordinator.

        High-level flow:
          1. Fetch the live BLE snapshot (advertisements + radios + objects)
          2. Resolve rotating private addresses (RPA) to canonical IDs
          3. Build per-device, per-scanner RSSI maps and source-to-area lookups
          4. For each BLE/iBeacon object, run the smoothing pipeline (_smooth_room)
          5. Apply pinned-beacon overrides for beacons with known map positions
          6. Carry forward stale objects for home/away persistence
          7. Fire follow-alerts and record movement history for room changes

        Returns {object_key: enriched_obj_dict} consumed by HA entities.
        """
        from .websocket import _live_snapshot  # noqa: PLC0415  (circular-import guard)
        from .private_ble_resolver import get_resolver  # noqa: PLC0415

        try:
            snap = await _live_snapshot(self.hass)
        except Exception as err:
            raise UpdateFailed(f"PadSpan snapshot error: {err}") from err

        now = time.monotonic()
        # Accumulates (key, old_room, new_room) tuples during this poll cycle;
        # processed at the end for alerts, movement history, and HA tag events.
        self._pending_room_changes: list[tuple[str, str | None, str]] = []

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

        # ── Build per-device RSSI maps from raw advertisements ────────────
        # addr_src_rssi: {canonical_addr: {scanner_source: best_rssi}}
        # addr_tx_power: {canonical_addr: tx_power_level}
        # For resolved RPAs, the canonical_id is the key so all rotating MACs
        # from the same physical phone share one Kalman filter state.
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

        # ── Build source-to-area and source-to-floor lookups ──────────────
        # Phase 1: read from the positioning fabric (ModelStore) when available.
        # In auto mode, also write-back any new radios from the snapshot.
        source_to_area: dict[str, str] = {}
        source_to_floor: dict[str, str] = {}
        _model = self.hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        if _model:
            # In auto mode, sync snapshot radios into the fabric
            _radios = (snap.get("ble") or {}).get("radios") or []
            if _model.sync_mode() == "auto" and _radios:
                try:
                    await _model.async_sync_from_snapshot(_radios)
                    # One-time prune: remove ha_sync entries that aren't actual radios
                    if not getattr(self, "_fabric_pruned", False):
                        _radio_srcs = {str(r.get("source")) for r in _radios if r.get("source")}
                        _pruned = await _model.async_prune_non_radio_scanners(_radio_srcs)
                        self._fabric_pruned = True
                        if _pruned:
                            _LOGGER.info("Fabric: pruned %d non-radio scanner entries", _pruned)
                except Exception:
                    pass
            # Read scanner mappings from fabric (includes both ha_sync and manual)
            source_to_area, source_to_floor = _model.get_scanner_mappings()

        # Fallback: if fabric has no scanners yet, build from snapshot directly
        # (first poll before fabric is populated)
        if not source_to_area:
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

        # ── Apply per-scanner RSSI calibration offsets ────────────────────
        # Users can set per-scanner dBm offsets in Settings → Presence to
        # compensate for hardware differences between ESPHome boards.
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

        # ── Dynamic vote-window sizing from room_change_delay_s setting ───
        # The user sets a desired delay in seconds; we convert that to a
        # vote window size and simple-majority threshold.  E.g. 20s at 10s
        # poll → window=2, threshold=2 (must win 2 of last 2 polls).
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

        # ── Load pinned beacons from fabric (floor-based, no maps) ─────────
        _pinned: dict[str, dict[str, Any]] = {}
        try:
            if _model:
                for _bk_key, _bk_pos in _model.beacon_positions_m().items():
                    if not isinstance(_bk_pos, dict):
                        continue
                    _pinned[_bk_key] = {
                        "room": _bk_pos.get("room", ""),
                        "floor_id": _bk_pos.get("floor_id", ""),
                        "x_m": _bk_pos.get("x_m"),
                        "y_m": _bk_pos.get("y_m"),
                    }
        except Exception:
            pass

        # Floor-based room set from fabric geometry
        _fabric_rooms: set[str] = set()
        if _model:
            _fabric_rooms = set(_model.data.get("room_geometry_m", {}).keys())

        # ── Spatial data from fabric (metre-space, floor-based, no maps) ──
        self._use_metres = False
        try:
            if _model:
                self._room_centroids = _model.room_centroids_m()
                self._scanner_positions = {
                    src: (pos["x_m"], pos["y_m"], pos.get("floor_id", ""))
                    for src, pos in _model.scanner_positions_m().items()
                }
                _mb = _model.rf_barriers_m()
                self._rf_barriers = [
                    {
                        "points": [(float(p[0]), float(p[1])) for p in (b.get("points_m") or [])],
                        "attenuation_dbm": float(b.get("attenuation_dbm", 6)),
                        "material": str(b.get("material", "custom")),
                        "floor_id": str(b.get("floor_id", "")),
                    }
                    for b in _mb if len(b.get("points_m") or []) >= 2
                ]
                if self._room_centroids or self._scanner_positions:
                    self._use_metres = True
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

            # ── Per-object smoothing pipeline ──────────────────────────────
            # Only BLE and iBeacon objects go through our Kalman + Gaussian +
            # vote pipeline.  Entity-based trackers (e.g. Bermuda) arrive
            # pre-smoothed from their own integration.
            if obj.get("kind") in ("ble", "private_ble"):
                obj = dict(obj)  # copy — don't mutate the snapshot list in place
                raw_addr = str(obj.get("address") or "").upper()
                # For private_ble, use canonical_id as Kalman state key so all
                # rotating MACs share one continuous smoothing state.
                smooth_addr = _rpa_map.get(raw_addr, raw_addr)
                smoothed_room = self._smooth_room(
                    key, smooth_addr, addr_src_rssi, source_to_area,
                    _dyn_vote_window, _dyn_vote_threshold, source_to_floor,
                    _fabric_rooms)
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
                    # Phase 3: propagate metre coordinates
                    if _knn.get("x_m") is not None:
                        obj["x_m"] = _knn["x_m"]
                        obj["y_m"] = _knn["y_m"]
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
                # iBeacons may advertise from multiple MAC addresses (rotation).
                # Merge RSSI across all known addresses, keeping the strongest
                # per scanner, then feed the merged dict into _smooth_room under
                # the UUID-based key (not a MAC address).
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
                    _fabric_rooms)
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
                    # Phase 3: propagate metre coordinates
                    if _knn_ib.get("x_m") is not None:
                        obj["x_m"] = _knn_ib["x_m"]
                        obj["y_m"] = _knn_ib["y_m"]
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

        # ── Adjacency co-visibility learning (Phase 1) ────────────────────────
        # In auto mode, when no map-derived adjacency exists, learn room
        # adjacency from scanner co-visibility patterns.
        if _model and _model.sync_mode() == "auto" and not self._room_centroids:
            _CO_VIS_RSSI_THRESHOLD = -80.0
            for _addr, _src_rssi in addr_src_rssi.items():
                # Collect rooms that heard this device strongly
                _heard_rooms: set[str] = set()
                for _src, _rssi in _src_rssi.items():
                    if _rssi > _CO_VIS_RSSI_THRESHOLD:
                        _rm = source_to_area.get(_src)
                        if _rm:
                            _heard_rooms.add(_rm)
                # Every pair of rooms that heard the same device = co-visible
                _rl = sorted(_heard_rooms)
                for _i in range(len(_rl)):
                    for _j in range(_i + 1, len(_rl)):
                        _pair = frozenset({_rl[_i], _rl[_j]})
                        self._co_visible[_pair] = self._co_visible.get(_pair, 0) + 1

            self._adj_learn_polls += 1
            if self._adj_learn_polls >= 50:
                self._adj_learn_polls = 0
                # Compute adjacency from co-visibility counts above median
                if self._co_visible:
                    _counts = sorted(self._co_visible.values())
                    _median = _counts[len(_counts) // 2] if _counts else 0
                    _learned_adj: dict[str, list[str]] = {}
                    for _pair, _cnt in self._co_visible.items():
                        if _cnt >= max(_median, 2):  # at least 2 observations
                            _rooms = list(_pair)
                            _learned_adj.setdefault(_rooms[0], []).append(_rooms[1])
                            _learned_adj.setdefault(_rooms[1], []).append(_rooms[0])
                    # Write to ModelStore (only if we learned something)
                    if _learned_adj:
                        for _rm_name, _neighbors in _learned_adj.items():
                            try:
                                await _model.async_set_adjacency(_rm_name, sorted(set(_neighbors)))
                            except Exception:
                                pass
                    self._co_visible.clear()

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

        # ── Scanner health summary (Phase 3) ──────────────────────────────────
        # Expose per-scanner reliability weights for the UI to display.
        # Stored under a special key that won't collide with object keys.
        _sh: dict[str, Any] = {}
        for _src, _rel in self._scanner_reliability.items():
            _q = self._scanner_agree.get(_src)
            _polls = len(_q) if _q else 0
            _agree_pct = round(sum(_q) / _polls * 100, 0) if _polls else 100
            _sh[_src] = {
                "reliability": _rel,
                "agree_pct": _agree_pct,
                "polls": _polls,
                "room": source_to_area.get(_src, ""),
            }
        result["__scanner_health__"] = _sh

        # ── Experimental MQTT publishing ─────────────────────────────────────
        await self._async_mqtt_publish(result)

        return result

    # ── MQTT publishing (experimental) ───────────────────────────────────────

    async def _async_mqtt_publish(self, result: dict[str, Any]) -> None:
        """Publish device state to MQTT topics if enabled in settings.

        Publishes to padspan/devices/{slug}/state (JSON), /area, and /distance
        with retain=True so MQTT consumers get the last known state on connect.
        Only devices with a user_label are published (unlabeled devices are
        typically not interesting for external automation).
        Errors are silently logged — MQTT is optional and must never break the
        presence pipeline.
        """
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
        fabric_rooms: set[str] | None = None,
    ) -> str | None:
        """Run one poll cycle of the full smoothing pipeline for a single BLE device.

        Pipeline stages executed in order:
          1. Kalman filter — smooth raw RSSI per (device, scanner) pair
          2. Gaussian room scoring — convert smoothed RSSI to distance-weighted
             room scores, with hysteresis to prevent boundary flickering
          3. Floor stickiness — require extra margin for cross-floor transitions
          4. Adaptive blend — mix in learned fingerprint similarity (if enabled)
          5. k-NN override — use calibration fingerprints when confident enough
          6. Majority vote — temporal window for final room confirmation

        Args:
            key: Object key (used for vote state and confidence tracking)
            addr: Kalman state key (canonical address or UUID for iBeacons)
            addr_src_rssi: Full {addr: {source: rssi}} map for this poll cycle
            source_to_area: {scanner_source: HA_area_name}
            vote_window / vote_threshold: Dynamic sizing from room_change_delay_s
            source_to_floor: {scanner_source: floor_id} for cross-floor logic
            fabric_rooms: Room names from fabric geometry (tie-breaking)
            (Map-centric parameters removed — fabric is the sole authority)

        Returns the confirmed (stable) room name, or None if not yet established.
        Side-effects: updates self._room_confidence, _rssi_margin_confidence,
        _knn_position, _confirmed_room, and _room_votes for this key.
        """
        # Phase 1/2: resolve ModelStore for fabric adjacency + metre thresholds
        _model = self.hass.data.get(DOMAIN, {}).get(DATA_MODEL)

        # Build room→floor lookup for outdoor/floor logic
        _room_to_floor: dict[str, str] = {}
        if source_to_floor:
            for _src2, _area2 in source_to_area.items():
                _fl2 = source_to_floor.get(_src2)
                if _fl2 and _area2 not in _room_to_floor:
                    _room_to_floor[_area2] = _fl2

        # Count scanners per floor (for isolated scanner detection)
        _scanners_per_floor: dict[str, int] = {}
        for _src2 in source_to_area:
            _fl2 = source_to_floor.get(_src2, "")
            if _fl2:
                _scanners_per_floor[_fl2] = _scanners_per_floor.get(_fl2, 0) + 1

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

        # Kalman update for sources that reported this poll.
        # K (Kalman gain) adapts automatically: high P (uncertainty) → K≈1
        # (trust new measurement); low P → K≈0 (trust existing estimate).
        for src, rssi in live_srcs.items():
            if src in ema:
                p = kp.get(src, _R)
                K = p / (p + _R)                        # Kalman gain
                ema[src] = ema[src] + K * (rssi - ema[src])  # state update
                kp[src] = (1.0 - K) * p + _Q            # covariance update
            else:
                ema[src] = rssi   # first observation — seed directly
                kp[src] = _R      # initialize at max uncertainty

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

        # ── Stage 1.5 prep: read path-loss model parameters ────────────────
        # ref_power: RSSI at 1 meter (typically -59 to -65 dBm)
        # path_loss_exp: environment factor (2.0 = free space, 3-4 = indoors)
        # room_sigma_m: Gaussian width — controls how quickly score drops with distance
        try:
            _st_pl = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _d_pl  = (_st_pl.data if _st_pl else {}) or {}
            _ref   = float(_d_pl.get("ref_power",    DEFAULT_REF_POWER))
            _n_exp = float(_d_pl.get("path_loss_exp", DEFAULT_PATH_LOSS_EXP))
            _sigma = float(_d_pl.get("room_sigma_m",  DEFAULT_ROOM_SIGMA_M))
            _floor_on = bool(_d_pl.get("adaptive_floor_detection", False))
        except Exception:
            _ref   = DEFAULT_REF_POWER
            _n_exp = DEFAULT_PATH_LOSS_EXP
            _sigma = DEFAULT_ROOM_SIGMA_M
            _floor_on = False

        # ── Stage 1.5: Gaussian room scoring ─────────────────────────────
        # Why Gaussian instead of raw "max RSSI wins"?
        #   Raw RSSI comparison treats -60 and -70 as a 10-unit gap, but the
        #   actual distance difference is nonlinear (path-loss is logarithmic).
        #   Converting RSSI → distance → Gaussian weight exp(-(d/sigma)^2)
        #   makes scoring proportional to physical proximity.  A scanner
        #   behind a wall (-75 dBm ~ 8m) scores near zero, while two
        #   scanners at -60 and -63 dBm both score high — reducing flicker.
        #
        # Each room's score = max Gaussian weight across its scanners.
        # Using max (not sum) prevents rooms with more scanners from winning
        # purely due to having more hardware.
        candidate: str | None = None
        rssi_margin_confidence: float = 0.0
        if ema:
            # RSSI margin confidence: how far ahead the strongest scanner is.
            # Normalized to [0, 1] where 15 dBm gap = 1.0 (very decisive).
            # Surfaced in entity attributes for automation conditions.
            sorted_vals = sorted(ema.values(), reverse=True)
            if len(sorted_vals) >= 2:
                rssi_margin_confidence = round(
                    min(1.0, max(0.0, (sorted_vals[0] - sorted_vals[1]) / 15.0)), 2
                )
            else:
                rssi_margin_confidence = 1.0

            # Score each room by its best scanner's Gaussian weight
            room_scores: dict[str, float] = {}
            for _src, _rssi in ema.items():
                _room = source_to_area.get(_src)
                if not _room:
                    continue
                # RF barrier penalty: if scanner→room centroid line crosses
                # a barrier, subtract attenuation dBm from effective RSSI.
                _eff_rssi = _rssi
                if self._rf_barriers and self._scanner_positions and self._room_centroids:
                    _sp = self._scanner_positions.get(_src)
                    _rc = self._room_centroids.get(_room)
                    if _sp and _rc:
                        _ba = _barrier_attenuation(
                            _sp[0], _sp[1], _sp[2],
                            _rc[0], _rc[1], _rc[2],
                            self._rf_barriers,
                        )
                        _eff_rssi -= _ba
                # Learned cross-floor attenuation: if scanner is on a different
                # floor than the candidate room, apply the learned RSSI correction.
                # This makes cross-floor scanners read appropriately weaker.
                if _floor_on and source_to_floor:
                    _src_fl = source_to_floor.get(_src, "")
                    _room_fl = _room_to_floor.get(_room, "")
                    if _src_fl and _room_fl and _src_fl != _room_fl:
                        try:
                            _ad_s = self.hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
                            if _ad_s:
                                _learned_delta = _ad_s.learned_floor_attenuation(_room_fl, _src_fl)
                                if _learned_delta is not None:
                                    _eff_rssi += _learned_delta  # typically negative
                        except Exception:
                            pass
                # Path-loss model: RSSI → estimated distance in meters
                # d = 10 ^ ((ref_power - rssi) / (10 * n))
                _dist  = max(0.1, 10.0 ** ((_ref - _eff_rssi) / (10.0 * _n_exp)))
                # Gaussian weight: close scanners score ~1.0, far ones → 0
                _score = math.exp(-(_dist / _sigma) ** 2)
                # Phase 3: reliability weight — downweight scanners that
                # frequently disagree with the consensus room assignment.
                _rel = self._scanner_reliability.get(_src, 1.0)
                _score *= _rel
                if _room not in room_scores or _score > room_scores[_room]:
                    room_scores[_room] = _score

            if room_scores:
                # ── Outdoor room damping ──────────────────────────────────
                # Always penalize outdoor room scores unless the device is
                # already confirmed outdoor. Outdoor scanners pick up BLE at
                # long range but should almost never claim indoor devices.
                # Previously this only fired when device was confirmed indoor,
                # which meant unconfirmed devices got no outdoor penalty.
                _cur_room_od = self._confirmed_room.get(key)
                _cur_floor_od = _room_to_floor.get(_cur_room_od, "") if _cur_room_od else ""
                _cur_is_outdoor = _cur_floor_od == OUTSIDE_FLOOR_ID
                if not _cur_is_outdoor:
                    for _rname in list(room_scores):
                        _rf = _room_to_floor.get(_rname, "")
                        if _rf == OUTSIDE_FLOOR_ID:
                            room_scores[_rname] *= _OUTDOOR_SCORE_DAMPING

                # ── Isolated scanner damping ──────────────────────────────
                # Scanners that are the only one on their floor get damped
                # unless they have a decisively strong signal. Prevents
                # isolated outdoor/basement scanners from dominating.
                for _rname in list(room_scores):
                    _rf = _room_to_floor.get(_rname, "")
                    if _rf and _scanners_per_floor.get(_rf, 0) <= 1:
                        # Check if any scanner for this room has strong RSSI
                        _has_strong = False
                        for _src3, _rssi3 in ema.items():
                            if source_to_area.get(_src3) == _rname and _rssi3 > _ISOLATED_SCANNER_STRONG_DBM:
                                _has_strong = True
                                break
                        if not _has_strong:
                            room_scores[_rname] *= _ISOLATED_SCANNER_DAMPING

                # ── Room adjacency prior (Phase 2) ──────────────────────
                # Multiply each room's score by a transition probability
                # based on centroid distance from the current room.
                # Adjacent rooms keep full weight; distant rooms are
                # penalized via a sigmoid, making it much harder for RF
                # noise to teleport a device across the building.
                _cur_adj = self._confirmed_room.get(key)
                if _cur_adj:
                    # Try centroid-based adjacency first (map data available)
                    _fabric_adj = _model.adjacency() if _model else {}
                    _c_cur = self._room_centroids.get(_cur_adj)
                    for _rname in list(room_scores):
                        if _rname == _cur_adj:
                            continue  # current room keeps full score
                        if _c_cur:
                            _c_tgt = self._room_centroids.get(_rname)
                            if _c_tgt:
                                if _c_cur[2] == _c_tgt[2]:
                                    # Same floor/map: sigmoid on Euclidean distance
                                    _adx = _c_cur[0] - _c_tgt[0]
                                    _ady = _c_cur[1] - _c_tgt[1]
                                    _adist = math.sqrt(_adx * _adx + _ady * _ady)
                                    if self._use_metres:
                                        # Metres: adjacent (<4m) → ~1.0; far (>12m) → ~0.15
                                        _tp = 1.0 / (1.0 + math.exp(0.5 * (_adist - _ADJACENCY_SIGMOID_MID_M)))
                                    else:
                                        # Legacy normalised: adjacent (<0.15) → ~1.0; far (>0.40) → ~0.15
                                        _tp = 1.0 / (1.0 + math.exp(10.0 * (_adist - 0.25)))
                                    _tp = max(0.15, _tp)
                                else:
                                    _tp = 0.20  # different floors/maps → strong penalty
                                room_scores[_rname] *= _tp
                                continue
                        # Fallback: fabric adjacency list (no map needed)
                        if _fabric_adj and _cur_adj in _fabric_adj:
                            _tp = 1.0 if _rname in _fabric_adj[_cur_adj] else 0.20
                            room_scores[_rname] *= _tp
                        # else: no data → no penalty (degrade gracefully)

                _best_room = max(room_scores, key=lambda r: room_scores[r])
                _cur_room = self._confirmed_room.get(key)
                # ── Hysteresis: prevent boundary flicker ──────────────────
                # When a device sits between two rooms, their scores oscillate
                # within a small band.  Requiring the new room to exceed the
                # current room by a margin (default 6%) prevents rapid flipping.
                # Configurable in Settings → Presence → Hysteresis margin.
                try:
                    _st_hyst = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
                    _HYSTERESIS_MARGIN = float(((_st_hyst.data if _st_hyst else {}).get("hysteresis_margin") or 0.06))
                    _HYSTERESIS_MARGIN = max(0.0, min(0.3, _HYSTERESIS_MARGIN))
                except Exception:
                    _HYSTERESIS_MARGIN = 0.06
                if _cur_room and _cur_room in room_scores and _best_room != _cur_room:
                    if room_scores[_best_room] - room_scores[_cur_room] < _HYSTERESIS_MARGIN:
                        # Score gap too small to be decisive.  Tie-breaker:
                        # if the best room is on the master map but current
                        # isn't, prefer master (more authoritative boundaries).
                        if fabric_rooms and _cur_room not in fabric_rooms and _best_room in fabric_rooms:
                            candidate = _best_room
                        else:
                            candidate = _cur_room  # stay put — not enough evidence
                    else:
                        candidate = _best_room  # clear winner — switch rooms
                else:
                    candidate = _best_room

        # ── Floor stickiness (cross-floor hysteresis) ────────────────────────
        # BLE signals leak between floors (stairwells, thin ceilings), so a
        # device on floor 1 may occasionally score highest on a floor 2
        # scanner.  To prevent phantom floor jumps, require DOUBLE the normal
        # hysteresis margin for cross-floor transitions.  The device must be
        # decisively closer to the new floor's scanners before switching.
        _floor_hyst = locals().get("_HYSTERESIS_MARGIN", 0.06)
        if candidate and room_scores and source_to_floor:
            _cur_room_fs = self._confirmed_room.get(key)
            if _cur_room_fs and _cur_room_fs != candidate and _cur_room_fs in room_scores:
                # Derive room→floor by looking up which floor each scanner's area is on
                _room_to_fl: dict[str, str] = {}
                for _src2, _area2 in source_to_area.items():
                    _fl2 = source_to_floor.get(_src2)
                    if _fl2 and _area2 not in _room_to_fl:
                        _room_to_fl[_area2] = _fl2
                _cand_fl = _room_to_fl.get(candidate)
                _cur_fl = _room_to_fl.get(_cur_room_fs)
                if _cand_fl and _cur_fl and _cand_fl != _cur_fl:
                    # Check if an "open" (loft) barrier exists on either the
                    # candidate or current floor.  Open barriers mark areas
                    # where floors are vertically connected (e.g. a loft,
                    # mezzanine, or open stairwell), so signal flows freely
                    # and cross-floor stickiness should be reduced.
                    _involved_floors = {_cand_fl, _cur_fl}
                    _has_open = any(
                        b.get("material") == "open"
                        and b.get("floor_id") in _involved_floors
                        for b in (self._rf_barriers or [])
                    )
                    # Open/loft: normal hysteresis. Indoor floors: 2× margin.
                    # Indoor↔outdoor: 4× margin — outdoor requires overwhelming evidence.
                    _involves_outside = OUTSIDE_FLOOR_ID in _involved_floors
                    if _has_open:
                        _floor_margin = _floor_hyst
                    elif _involves_outside:
                        _floor_margin = _floor_hyst * 4.0
                    else:
                        _floor_margin = _floor_hyst * 2.0
                    if room_scores.get(candidate, 0) - room_scores.get(_cur_room_fs, 0) < _floor_margin:
                        candidate = _cur_room_fs  # stay on current floor

        # ── Adaptive learning blend ───────────────────────────────────────────
        # When adaptive learning is enabled and has accumulated enough data
        # (maturity > 5%), blend its fingerprint-similarity scores into the
        # Gaussian room scores.  This lets the system learn from confirmed
        # room assignments over time without manual calibration.
        #
        # Three adaptive adjustments (all capped to prevent the learned
        # model from dominating the physics-based Gaussian):
        #   1. Fingerprint blend (max 25%) — similarity to past observations
        #   2. Transition prior (max 8%) — favor commonly observed transitions
        #   3. Floor penalty (50% score cut) — discourage low-confidence floor jumps
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
                    # Blend weight scales with maturity (0→25%) so early data
                    # has minimal impact.  Capped at 25% to keep Gaussian dominant.
                    _blend = min(0.25, _ad_store.maturity() * 0.3)
                    for _ar in room_scores:
                        if _ar in _ad_scores:
                            room_scores[_ar] = (1.0 - _blend) * room_scores[_ar] + _blend * _ad_scores[_ar]

                    # Transition prior: boost rooms that are common destinations
                    # from the current room.  Capped at 8% to avoid positive
                    # feedback loops (device gets stuck because being in a room
                    # reinforces staying in that room).
                    _cur = self._confirmed_room.get(key)
                    if _cur:
                        _priors = _ad_store.transition_prior(_cur, room_scores.keys())
                        if _priors:
                            _prior_blend = min(0.08, _ad_store.maturity() * 0.1)
                            for _ar in room_scores:
                                room_scores[_ar] *= (1.0 + _prior_blend * _priors.get(_ar, 0.0))

                    # Adaptive floor penalty: if the adaptive model has low
                    # confidence that the device is actually on the candidate's
                    # floor, halve that room's score to discourage the transition.
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

        # ── Fingerprint positioning (k-NN or Random Forest) ─────────────────
        # When the user has collected calibration data (>= _KNN_MIN_POINTS),
        # the system can use fingerprint matching instead of (or on top of)
        # the Gaussian model.  k-NN compares the current RSSI vector against
        # calibration points and returns the nearest match with a confidence
        # score.  If confidence >= _KNN_LIVE_THRESHOLD (15%), the fingerprint
        # result overrides the Gaussian candidate.
        #
        # This also provides sub-room positioning (x_frac, y_frac) for the
        # map dot display.  The position is EMA-smoothed to prevent jumping.
        #
        # Room boundary check: the k-NN (x, y) is tested against the correct
        # map's room_bounds (not necessarily the master) since coordinates are
        # in the calibration map's coordinate space.
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
                    _LOGGER.debug(
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
                    # Room boundary check using fabric geometry (metres)
                    if _knn.get("x_m") is not None and _model:
                        _knn_fl = _knn.get("floor_id", "")
                        _geo_room = _model.beacon_room_from_geometry(
                            float(_knn["x_m"]), float(_knn["y_m"]), _knn_fl
                        )
                        if _geo_room:
                            _knn_room = _geo_room
                    # EMA smooth in metre space (floor-based)
                    _has_metres = _knn.get("x_m") is not None
                    if _has_metres:
                        _raw_x = float(_knn["x_m"])
                        _raw_y = float(_knn["y_m"])
                    else:
                        _raw_x = float(_knn.get("x_frac", 0.0))
                        _raw_y = float(_knn.get("y_frac", 0.0))
                    _prev = self._smooth_xy.get(key)
                    _prev_fl = (self._knn_position.get(key) or {}).get("floor_id", "")
                    _new_fl = _knn.get("floor_id", "")
                    _conf = float(_knn.get("confidence", 0.0))
                    _alpha = 0.15 + 0.35 * min(_conf, 1.0)
                    if _prev is not None and _prev_fl == _new_fl:
                        _sx = _prev[0] + _alpha * (_raw_x - _prev[0])
                        _sy = _prev[1] + _alpha * (_raw_y - _prev[1])
                    else:
                        _sx, _sy = _raw_x, _raw_y  # new floor or first time
                    self._smooth_xy[key] = (_sx, _sy)
                    _knn_smoothed = dict(_knn)
                    if _has_metres:
                        _knn_smoothed["x_m"] = round(_sx, 3)
                        _knn_smoothed["y_m"] = round(_sy, 3)
                        # Derive fracs for UI rendering
                        if _model:
                            for _mid, _t in (_model.data.get("map_transforms") or {}).items():
                                if _t.get("floor_id") == _new_fl:
                                    _fracs = _model.metres_to_map_frac(_sx, _sy, _mid)
                                    if _fracs and 0.0 <= _fracs[0] <= 1.0 and 0.0 <= _fracs[1] <= 1.0:
                                        _knn_smoothed["x_frac"] = round(_fracs[0], 4)
                                        _knn_smoothed["y_frac"] = round(_fracs[1], 4)
                                        _knn_smoothed["map_id"] = _mid
                                        break
                    else:
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

        # ── Stage 2: majority-vote temporal stabilization ──────────────────
        # The candidate from stages 1-1.5 can still flip between polls due to
        # RF noise.  The vote window adds temporal inertia: a room must win a
        # majority of the last N polls before it becomes the confirmed room.
        # Window size adapts to the user's room_change_delay_s setting.
        existing = self._room_votes.get(key)
        if existing is None or existing.maxlen != vote_window:
            # Resize the deque when the setting changes mid-run; keep recent votes
            prev = list(existing) if existing else []
            self._room_votes[key] = deque(prev[-vote_window:], maxlen=vote_window)
        votes = self._room_votes[key]
        # Skip None candidates (total signal dropout) — preserves the last
        # known room instead of diluting the window with empty votes.
        if candidate is not None:
            votes.append(candidate)

        # Count votes per room and check if any room meets the threshold
        counts: dict[str, int] = {}
        for v in votes:
            if v:
                counts[v] = counts.get(v, 0) + 1

        confirmed = self._confirmed_room.get(key)
        confidence = 0.0
        if counts:
            top_room = max(counts, key=lambda r: counts[r])
            top_count = counts[top_room]
            # Confidence = fraction of window agreeing on the top room (0.0–1.0)
            confidence = round(top_count / len(votes), 2)
            if top_count >= vote_threshold:
                if top_room != confirmed:
                    # ── Velocity gate ────────────────────────────────────
                    # Three checks prevent teleportation:
                    #  1. Rapid-fire: if device changed rooms very recently,
                    #     require UNANIMOUS vote (all votes agree).
                    #  2. Distance: if rooms are far apart (non-adjacent),
                    #     also require unanimous vote.
                    #  3. Indoor↔outdoor: crossing the outdoor boundary
                    #     always requires unanimous vote.
                    # All checks are soft: they raise the bar for evidence,
                    # not block transitions entirely.
                    _vg_block = False
                    if confirmed is not None:
                        _now_mono = time.monotonic()
                        # Check 1: dwell-proportional transition gate
                        # Short dwell (<30s): require unanimous (just arrived, likely noise)
                        # Medium dwell (30-120s): require supermajority
                        # Long dwell (>120s): normal threshold (device is settled)
                        _last_change = self._last_room_change_mono.get(key, 0.0)
                        _elapsed = _now_mono - _last_change if _last_change else 999.0
                        _dwell = _now_mono - self._room_dwell_start.get(key, 0.0) if self._room_dwell_start.get(key) else 999.0
                        _is_rapid = _dwell < 30.0  # short dwell = high bar
                        # Check 2: room distance (non-adjacent)
                        _is_distant = False
                        _c1 = self._room_centroids.get(confirmed)
                        _c2 = self._room_centroids.get(top_room)
                        if _c1 and _c2:
                            # Centroid-based distance check
                            if _c1[2] == _c2[2]:
                                _dx = _c1[0] - _c2[0]
                                _dy = _c1[1] - _c2[1]
                                _cdist = math.sqrt(_dx * _dx + _dy * _dy)
                                _vg_thresh = _VG_ADJACENT_THRESHOLD_M if self._use_metres else _VG_ADJACENT_THRESHOLD
                                _is_distant = _cdist > _vg_thresh
                            else:
                                _is_distant = True  # different maps → always "distant"
                        elif _model:
                            # Fallback: fabric adjacency list (no map needed)
                            _vg_adj = _model.adjacency()
                            if _vg_adj and confirmed in _vg_adj:
                                _is_distant = top_room not in _vg_adj[confirmed]
                            # else: no adjacency data → _is_distant stays False (no gate)
                        # Check 3: indoor↔outdoor transition
                        _is_outdoor_cross = False
                        _conf_fl = _room_to_floor.get(confirmed, "")
                        _top_fl = _room_to_floor.get(top_room, "")
                        if _conf_fl and _top_fl:
                            _conf_outside = _conf_fl == OUTSIDE_FLOOR_ID
                            _top_outside = _top_fl == OUTSIDE_FLOOR_ID
                            if _conf_outside != _top_outside:
                                _is_outdoor_cross = True

                        # Cross-floor transitions: require higher evidence when dwell is short
                        _is_cross_floor = False
                        if _conf_fl and _top_fl and _conf_fl != _top_fl:
                            _is_cross_floor = True
                        # Determine required vote count based on dwell + context
                        if _is_outdoor_cross:
                            _required = len(votes)  # unanimous for outdoor
                        elif _is_cross_floor and _dwell < 60.0:
                            _required = len(votes)  # unanimous for quick floor changes
                        elif _is_rapid or _is_distant:
                            _required = len(votes)  # unanimous for rapid/distant
                        elif _is_cross_floor and _dwell < 120.0:
                            _required = min(len(votes), vote_threshold + 1)  # supermajority
                        else:
                            _required = vote_threshold  # normal
                        if top_count < _required:
                            _vg_block = True
                            _LOGGER.debug(
                                "Velocity gate blocked %s: %s → %s (dwell=%.0fs, rapid=%s, distant=%s, cross_floor=%s, votes=%d/%d need %d)",
                                key[:30], confirmed, top_room, _dwell,
                                _is_rapid, _is_distant, _is_cross_floor, top_count, len(votes), _required,
                            )
                    if not _vg_block:
                        _LOGGER.debug(
                            "Room confirmed for %s: %s → %s (votes %s, confidence %.0f%%)",
                            key, confirmed, top_room, dict(counts), confidence * 100,
                        )
                        # Track room change for alert processing
                        self._pending_room_changes.append((key, confirmed, top_room))
                        _change_mono = time.monotonic()
                        self._last_room_change_mono[key] = _change_mono
                        self._room_dwell_start[key] = _change_mono
                        # Floor transition learning
                        _old_fl = _room_to_floor.get(confirmed, "")
                        _new_fl = _room_to_floor.get(top_room, "")
                        if _old_fl and _new_fl and _old_fl != _new_fl:
                            _fl_dwell = _change_mono - self._floor_dwell_start.get(key, _change_mono)
                            self._floor_dwell_start[key] = _change_mono
                            self._device_floor[key] = _new_fl
                            # Record to adaptive store for learning
                            try:
                                _ad = self.hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
                                if _ad:
                                    _ad.record_floor_transition(_old_fl, _new_fl, _fl_dwell)
                            except Exception:
                                pass
                        elif _new_fl:
                            self._device_floor[key] = _new_fl
                        confirmed = top_room

        self._confirmed_room[key] = confirmed
        self._room_confidence[key] = confidence
        self._rssi_margin_confidence[key] = rssi_margin_confidence

        # ── Phase 3: per-scanner reliability update ──────────────────────────
        # For each scanner that reported RSSI for this device, check if the
        # scanner's own room matches the confirmed room.  Scanners that
        # consistently point to the wrong room get downweighted in Gaussian
        # scoring.  Only update when we have a stable confirmation (conf >= 0.6).
        if confirmed and confidence >= 0.6 and ema:
            for _src in ema:
                _src_room = source_to_area.get(_src)
                if not _src_room:
                    continue
                _agreed = (_src_room == confirmed)
                _q = self._scanner_agree.get(_src)
                if _q is None:
                    _q = deque(maxlen=_RELIABILITY_WINDOW)
                    self._scanner_agree[_src] = _q
                _q.append(_agreed)
                if len(_q) >= _RELIABILITY_MIN_POLLS:
                    _agree_rate = sum(_q) / len(_q)
                    # Disagree rate = fraction of polls where scanner's room != consensus
                    _disagree = 1.0 - _agree_rate
                    # reliability = 1/(1+disagree) — ranges from 0.5 (always wrong) to 1.0 (always right)
                    _w = 1.0 / (1.0 + _disagree)
                    self._scanner_reliability[_src] = max(_RELIABILITY_FLOOR, round(_w, 3))
                else:
                    self._scanner_reliability[_src] = 1.0

        # ── Adaptive learning: record observation ────────────────────────────
        # Feed confirmed room assignments back into the adaptive store so it
        # can improve over time.  Only record when confidence >= 0.7 (stable)
        # and rate-limited to 1 per device per 5 min to keep data compact.
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
        """Remove all cached state for a single object key.

        Called when an object has been stale longer than _STALE_EVICT_S, or
        explicitly via clear_object_state().  Cleans up Kalman, vote, k-NN,
        confidence, and alert state to prevent unbounded memory growth.
        """
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
        self._last_room_change_mono.pop(key, None)
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
        """Auto-inject calibration points from pinned beacons that have live RSSI.

        Beacons with known map positions act as continuous calibration sources:
        since we know exactly where they are, their RSSI readings become new
        fingerprint data points.  Rate-limited to one injection per beacon per
        10 minutes to avoid flooding the calibration store.
        """
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
        """Inject calibration points for beacons with live RSSI.

        Uses fabric beacon positions (metres) when available.
        Falls back to map fracs from beacon dict.
        """
        cal_store = self.hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
        if not cal_store:
            return 0
        _model = self.hass.data.get(DOMAIN, {}).get(DATA_MODEL)

        injected = 0
        now = time.monotonic()
        for bk in beacons:
            key = bk.get("key", "")
            if not key:
                continue
            smoothed_rssi = dict(self._ema_rssi.get(key, {}))
            if not smoothed_rssi:
                smoothed_rssi = dict(self._ema_rssi.get(key.upper(), {}))
            if not smoothed_rssi:
                obj = self._known_objs.get(key) or {}
                smoothed_rssi = obj.get("_source_rssi") or {}
            if not smoothed_rssi:
                continue
            self._beacon_autocal_last[key] = now
            _pt: dict[str, Any] = {
                "floor_id": floor_id,
                "label": f"[auto] {(self._known_objs.get(key) or {}).get('user_label') or key}",
                "device_id": key,
                "duration_s": 10,
                "scanner_readings": [
                    {"source": src, "rssi_samples": [rssi]}
                    for src, rssi in smoothed_rssi.items()
                ],
            }
            # Fabric beacon position (metres, primary)
            _fb = (_model.beacon_positions_m().get(key) or {}) if _model else {}
            if _fb and _fb.get("x_m") is not None:
                _pt["x_m"] = _fb["x_m"]
                _pt["y_m"] = _fb["y_m"]
                _pt["room"] = _fb.get("room", "")
                _pt["x_frac"] = 0.5
                _pt["y_frac"] = 0.5
                _pt["map_id"] = ""
            elif bk.get("x") is not None:
                _pt["map_id"] = map_id
                _pt["x_frac"] = float(bk.get("x", 0))
                _pt["y_frac"] = float(bk.get("y", 0))
                _pt["room"] = _fb.get("room", "")
            else:
                continue
            try:
                await cal_store.async_add_point(_pt)
                await cal_store.async_prune_auto_points(max_per_beacon=50)
                injected += 1
            except Exception:
                _LOGGER.debug("Immediate beacon cal injection failed for %s", key)
        return injected

    # ── Follow-alert processing ────────────────────────────────────────────

    async def _process_room_alerts(
        self, now: float, result: dict[str, Any]
    ) -> None:
        """Send notifications for room changes based on Follow tab alert configs.

        Supports both legacy HA notify services (notify.{name}) and the newer
        entity-based notify (notify.send_message with entity_id).  Falls back
        to auto-detecting an available service, preferring email/SMTP ones.
        Rate-limited to one alert per device per 60 seconds.
        """
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
        """Remove a scanner from all devices' Kalman filter state.

        Called when a scanner is removed or reset.  Without this, stale RSSI
        entries for the removed scanner would decay slowly via the silence
        mechanism, potentially biasing room scores during that window.
        Returns the number of device entries that were cleaned.
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
        """Persist room transitions to the movement history store.

        Movement history powers the Follow tab's movement log and the
        Manage → History view.  Each transition is recorded with a timestamp,
        the object's display label, and the old/new room names.
        """
        from .const import DOMAIN, DATA_MOVEMENT, DATA_OBJECTS, DATA_DEVICE_REGISTRY
        try:
            mv_store = self.hass.data.get(DOMAIN, {}).get(DATA_MOVEMENT)
            if not mv_store:
                return
            obj_store = self.hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
            dev_reg = self.hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
            for key, old_room, new_room in self._pending_room_changes:
                label = None
                pid = None
                if dev_reg:
                    pid = dev_reg.resolve(key)
                    if pid:
                        label = dev_reg.get_label(pid)
                if not label and obj_store:
                    label = obj_store.get_label(key)
                await mv_store.record(key, old_room, new_room, label=label, padspan_id=pid)
        except Exception as err:
            _LOGGER.debug("Movement recording failed: %s", err)
