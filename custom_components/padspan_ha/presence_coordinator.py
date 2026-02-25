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

  Stage 1 — EMA RSSI per source
    smoothed = EMA_ALPHA * live_rssi + (1 - EMA_ALPHA) * prev_smoothed
    α = 0.35  →  ~65 % weight carried from previous reading; responds to real
    movement in ~3–4 polls (30–40 s) while ignoring single-poll spikes.
    Sources that stop reporting are decayed toward -100 dBm and pruned when they
    fall below -95 dBm (~4–5 polls after last seen).

  Stage 2 — Majority-vote window
    At each poll, the candidate room (area of source with highest smoothed RSSI)
    is added to a rolling window of VOTE_WINDOW (3) entries.  The confirmed room
    only changes when one room appears ≥ VOTE_THRESHOLD (2) times in the window.
    At 10 s/poll this means a room switch requires ~20 s of consistent dominance.

HOME/AWAY PERSISTENCE
─────────────────────
Devices that disappear from the live snapshot are kept in the result dict with a
synthetic age_s that grows each poll.  Entities read age_s and return "not_home"
when it exceeds the configured away timeout (Settings → Presence → Away timeout;
default 300 s / 5 min).  Entities never go "unavailable" due to the device being
away — "not_home" is a permanently valid HA state.
"""
from __future__ import annotations

import logging
import time
from collections import deque
from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DOMAIN, DATA_SETTINGS

_LOGGER = logging.getLogger(__name__)

_SCAN_INTERVAL = timedelta(seconds=10)

# ── Smoothing constants ──────────────────────────────────────────────────────
# Fraction of the new reading blended into the smoothed value each poll.
# Lower = more smoothing, slower response.  0.35 is a good balance for BLE tags.
_EMA_ALPHA: float = 0.35

# Rolling window for majority-vote room confirmation.
# Candidate room must win VOTE_THRESHOLD out of the last VOTE_WINDOW polls.
_VOTE_WINDOW: int = 3
_VOTE_THRESHOLD: int = 2

# RSSI threshold below which a silent source is pruned from the EMA cache.
_EMA_PRUNE_DBM: float = -95.0

# Phantom RSSI injected each poll for sources that have gone silent (drives decay).
_EMA_SILENCE_DBM: float = -100.0


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

        # ── RSSI smoothing state (keyed by MAC address) ──────────────────────
        # {addr: {source: smoothed_rssi}}
        self._ema_rssi: dict[str, dict[str, float]] = {}

        # ── Room-vote state (keyed by object key) ────────────────────────────
        # {key: deque of recent candidate rooms}
        self._room_votes: dict[str, deque] = {}
        # {key: confirmed_room | None}  — the current stable room assignment
        self._confirmed_room: dict[str, str | None] = {}

    # ── main update ──────────────────────────────────────────────────────────

    async def _async_update_data(self) -> dict[str, Any]:
        from .websocket import _live_snapshot  # noqa: PLC0415  (circular-import guard)

        try:
            snap = await _live_snapshot(self.hass)
        except Exception as err:
            raise UpdateFailed(f"PadSpan snapshot error: {err}") from err

        now = time.monotonic()

        # Build {addr_upper: {source: rssi}} from raw BLE advertisements
        addr_src_rssi: dict[str, dict[str, float]] = {}
        for ad in (snap.get("ble") or {}).get("advertisements") or []:
            addr = str(ad.get("address") or "").upper()
            src  = ad.get("source")
            rssi = ad.get("rssi")
            if addr and src and rssi is not None:
                addr_src_rssi.setdefault(addr, {})[str(src)] = float(rssi)

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

            # Cache the live copy for home/away persistence
            self._last_seen[key] = now
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
                # Store EMA-smoothed per-source RSSI for scanner distance sensors
                obj["_source_rssi"] = dict(self._ema_rssi.get(addr, {}))
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
                # Store EMA-smoothed per-source RSSI for scanner distance sensors
                obj["_source_rssi"] = dict(self._ema_rssi.get(key, {}))
                self._known_objs[key] = dict(obj)  # refresh with smoothed data

            result[key] = obj

        # ── Carry forward stale objects (home/away persistence) ──────────────
        for key, last_obj in self._known_objs.items():
            if key in result:
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
        """
        live_srcs = addr_src_rssi.get(addr, {})

        # ── Stage 1: EMA ─────────────────────────────────────────────────────
        if addr not in self._ema_rssi:
            self._ema_rssi[addr] = {}
        ema = self._ema_rssi[addr]

        # Update sources that reported this poll
        for src, rssi in live_srcs.items():
            if src in ema:
                ema[src] = _EMA_ALPHA * rssi + (1.0 - _EMA_ALPHA) * ema[src]
            else:
                ema[src] = rssi  # first observation — seed without smoothing

        # Decay sources that did NOT report (drifts toward -100 dBm and pruned)
        for src in list(ema):
            if src not in live_srcs:
                ema[src] = _EMA_ALPHA * _EMA_SILENCE_DBM + (1.0 - _EMA_ALPHA) * ema[src]
                if ema[src] < _EMA_PRUNE_DBM:
                    del ema[src]

        # Candidate room: area of source with highest smoothed RSSI
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
        if counts:
            top_room = max(counts, key=lambda r: counts[r])
            if counts[top_room] >= vote_threshold:
                if top_room != confirmed:
                    _LOGGER.debug(
                        "Room confirmed for %s: %s → %s (votes %s)",
                        key, confirmed, top_room, dict(counts),
                    )
                confirmed = top_room

        self._confirmed_room[key] = confirmed
        return confirmed
