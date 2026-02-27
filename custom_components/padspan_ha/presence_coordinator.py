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

Two-stage pipeline applied each poll cycle:

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

  Stage 2 — Majority-vote window
    At each poll, the candidate room (area of source with highest smoothed RSSI)
    is added to a rolling window of VOTE_WINDOW (3) entries.  The confirmed room
    only changes when one room appears ≥ VOTE_THRESHOLD (2) times in the window.
    At 10 s/poll this means a room switch requires ~20 s of consistent dominance.

    The vote window is cleared when a device re-appears after being away, preventing
    stale votes from the previous location from influencing re-entry assignment.

HOME/AWAY PERSISTENCE
─────────────────────
Devices that disappear from the live snapshot are kept in the result dict with a
synthetic age_s that grows each poll.  A 2-poll grace period (≈20 s) prevents a
momentary signal gap from triggering an away event.  Entities read age_s and return
"not_home" when it exceeds the configured away timeout (Settings → Presence → Away
timeout; default 300 s / 5 min).  Entities never go "unavailable" — "not_home" is
a permanently valid HA state.

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
import time
from collections import deque
from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DOMAIN, DATA_SETTINGS, DEFAULT_KALMAN_Q, DEFAULT_KALMAN_R

_LOGGER = logging.getLogger(__name__)

_SCAN_INTERVAL = timedelta(seconds=10)

# ── Kalman / smoothing constants ─────────────────────────────────────────────
# Defaults — overridable via Settings → Presence → Signal Filter
_KALMAN_Q: float = DEFAULT_KALMAN_Q   # process noise
_KALMAN_R: float = DEFAULT_KALMAN_R   # measurement noise

# Rolling window for majority-vote room confirmation.
# Candidate room must win VOTE_THRESHOLD out of the last VOTE_WINDOW polls.
_VOTE_WINDOW: int = 3
_VOTE_THRESHOLD: int = 2

# RSSI threshold below which a silent source is pruned from the Kalman cache.
_EMA_PRUNE_DBM: float = -95.0

# Phantom RSSI injected each poll for sources that have gone silent (drives decay).
_EMA_SILENCE_DBM: float = -100.0

# Number of consecutive missed polls before a device starts accumulating age_s.
# Grace period = _AWAY_GRACE_POLLS * _SCAN_INTERVAL = 2 * 10s = 20s.
_AWAY_GRACE_POLLS: int = 2


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
        # {key: float}  — room assignment confidence ∈ [0, 1]
        self._room_confidence: dict[str, float] = {}

    # ── main update ──────────────────────────────────────────────────────────

    async def _async_update_data(self) -> dict[str, Any]:
        from .websocket import _live_snapshot  # noqa: PLC0415  (circular-import guard)

        try:
            snap = await _live_snapshot(self.hass)
        except Exception as err:
            raise UpdateFailed(f"PadSpan snapshot error: {err}") from err

        now = time.monotonic()

        # Build {addr_upper: {source: rssi}} and {addr_upper: tx_power} from advertisements
        addr_src_rssi: dict[str, dict[str, float]] = {}
        addr_tx_power: dict[str, int] = {}
        for ad in (snap.get("ble") or {}).get("advertisements") or []:
            addr = str(ad.get("address") or "").upper()
            src  = ad.get("source")
            rssi = ad.get("rssi")
            if addr and src and rssi is not None:
                addr_src_rssi.setdefault(addr, {})[str(src)] = float(rssi)
            # Capture TX Power Level from the advertisement (BLE AD type 0x0A)
            tx_pwr = ad.get("tx_power")
            if addr and tx_pwr is not None and addr not in addr_tx_power:
                addr_tx_power[addr] = int(tx_pwr)

        # Build {source: area} from BLE radios
        source_to_area: dict[str, str] = {}
        for r in (snap.get("ble") or {}).get("radios") or []:
            src  = r.get("source")
            area = r.get("area_name") or r.get("area")
            if src and area:
                source_to_area[str(src)] = str(area)

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
                if obj.get("kind") in ("ble", "private_ble"):
                    addr_clear = str(obj.get("address") or "").upper()
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
                addr = str(obj.get("address") or "").upper()
                smoothed_room = self._smooth_room(
                    key, addr, addr_src_rssi, source_to_area,
                    _dyn_vote_window, _dyn_vote_threshold)
                if smoothed_room:
                    obj["room"] = smoothed_room
                obj["_smoothed"] = True
                obj["room_confidence"] = self._room_confidence.get(key, 0.0)
                # Store Kalman-smoothed per-source RSSI for scanner distance sensors
                obj["_source_rssi"] = dict(self._ema_rssi.get(addr, {}))
                # Propagate TX power if seen in advertisements
                if addr in addr_tx_power:
                    obj.setdefault("tx_power", addr_tx_power[addr])
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
                    _dyn_vote_window, _dyn_vote_threshold)
                if smoothed_room:
                    obj["room"] = smoothed_room
                obj["_smoothed"] = True
                obj["room_confidence"] = self._room_confidence.get(key, 0.0)
                # Store Kalman-smoothed per-source RSSI for scanner distance sensors
                obj["_source_rssi"] = dict(self._ema_rssi.get(key, {}))
                self._known_objs[key] = dict(obj)  # refresh with smoothed data

            result[key] = obj

        # ── Carry forward stale objects (home/away persistence) ──────────────
        for key, last_obj in self._known_objs.items():
            if key in result:
                continue
            # Grace period: don't start aging until _AWAY_GRACE_POLLS consecutive misses.
            # This prevents a single missed advertisement from triggering an away event.
            miss = self._away_miss.get(key, 0) + 1
            self._away_miss[key] = miss
            if miss < _AWAY_GRACE_POLLS:
                # Grace period — treat as still present (age_s = 0)
                grace = dict(last_obj)
                grace["age_s"] = 0.0
                grace.pop("_stale", None)
                result[key] = grace
                continue
            elapsed = now - self._last_seen.get(key, now)
            stale = dict(last_obj)
            stale["age_s"]  = elapsed
            stale["_stale"] = True
            # Preserve the last confirmed room in the stale entry
            if stale.get("kind") in ("ble", "private_ble", "ibeacon") and self._confirmed_room.get(key):
                stale["room"] = self._confirmed_room[key]
            result[key] = stale

        return result

    # ── smoothing helpers ─────────────────────────────────────────────────────

    def _smooth_room(
        self,
        key: str,
        addr: str,
        addr_src_rssi: dict[str, dict[str, float]],
        source_to_area: dict[str, str],
        vote_window: int = _VOTE_WINDOW,
        vote_threshold: int = _VOTE_THRESHOLD,
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

        # Decay sources that did NOT report (drifts toward -100 dBm and pruned)
        for src in list(ema):
            if src not in live_srcs:
                p = kp.get(src, _R)
                K = p / (p + _R)
                ema[src] = ema[src] + K * (_EMA_SILENCE_DBM - ema[src])
                kp[src] = (1.0 - K) * p + _Q
                if ema[src] < _EMA_PRUNE_DBM:
                    del ema[src]
                    kp.pop(src, None)

        # Candidate room: area of source with highest Kalman-smoothed RSSI
        candidate: str | None = None
        if ema:
            best_src = max(ema, key=lambda s: ema[s])
            candidate = source_to_area.get(best_src)

        # ── Stage 2: majority-vote window (size adjusts to room_change_delay_s) ──
        existing = self._room_votes.get(key)
        if existing is None or existing.maxlen != vote_window:
            # Resize the deque when the setting changes; preserve existing votes
            prev = list(existing) if existing else []
            self._room_votes[key] = deque(prev[-vote_window:], maxlen=vote_window)
        votes = self._room_votes[key]
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
                confirmed = top_room

        self._confirmed_room[key] = confirmed
        self._room_confidence[key] = confidence
        return confirmed
