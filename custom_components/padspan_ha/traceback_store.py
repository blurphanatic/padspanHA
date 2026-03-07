# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Persistent traceback store — rolling ring buffer of object position snapshots.

Every ~10 s the snapshot builder appends a compact position record for each
tracked object (identified or followed).  The store keeps up to 7 days and
60 480 frames (~10 s interval × 7 days).  Older frames are pruned on save.

Data structure on disk:
  { "frames": [ {ts, objects: [{k, r, rssi, src}]} ] }

Each frame is ~10 s of wall-clock time.  The frontend fetches a time-window
and animates objects on the 3D map.
"""

import logging
import time
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

_LOGGER = logging.getLogger(__name__)

STORE_KEY = "padspan_ha.traceback"
MAX_FRAMES = 60480          # 7 days at ~10 s interval
MAX_AGE_S = 86400 * 7       # 7 days
SAVE_INTERVAL_S = 30         # flush to disk every 30 s
MIN_FRAME_INTERVAL_S = 8     # min gap between recorded frames


class TracebackStore:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store = Store(hass, 1, STORE_KEY)
        self.frames: list[dict[str, Any]] = []
        self._last_save_ts: float = 0
        self._last_frame_ts: float = 0

    async def async_load(self) -> None:
        loaded = await self._store.async_load()
        if isinstance(loaded, dict):
            self.frames = loaded.get("frames") or []
        else:
            self.frames = []
        self._prune()
        self._last_save_ts = time.time()
        _LOGGER.debug("TracebackStore loaded: %d frames", len(self.frames))

    def record_frame(self, objects: list[dict[str, Any]], followed_set: set[str] | None = None) -> None:
        """Record a position snapshot for identified/followed objects only.

        Called from the snapshot builder (~every 10 s).  Only records
        objects that are identified (labelled/known) or followed — matching
        what overview actually displays.  Raw unidentified BLE noise is excluded.
        """
        now = time.time()
        if now - self._last_frame_ts < MIN_FRAME_INTERVAL_S:
            return
        self._last_frame_ts = now

        _fset = followed_set or set()

        compact: list[dict[str, Any]] = []
        for o in objects:
            room = o.get("room")
            if not room or room in ("unknown", "not_home"):
                continue
            key = o.get("key") or o.get("address") or o.get("entity_id") or ""
            if not key:
                continue
            # Only record identified or followed objects (skip anonymous BLE noise)
            is_identified = o.get("identified") or o.get("user_label")
            is_followed = key in _fset or o.get("address", "") in _fset or o.get("entity_id", "") in _fset
            if not is_identified and not is_followed:
                continue
            entry: dict[str, Any] = {
                "k": key,
                "r": room,
            }
            # Optional enrichment (compact)
            rssi = o.get("rssi")
            if rssi is not None:
                entry["rssi"] = rssi
            label = o.get("user_label") or o.get("name")
            if label and label != key:
                entry["n"] = label[:30]
            kind = o.get("kind")
            if kind:
                entry["t"] = kind  # type/kind
            # Best source scanner
            sources = o.get("sources") or []
            if sources:
                src = sources[0] if isinstance(sources[0], str) else (sources[0].get("source") if isinstance(sources[0], dict) else "")
                if src:
                    entry["src"] = src
            compact.append(entry)

        if not compact:
            return

        self.frames.append({
            "ts": now,
            "o": compact,
        })

    async def async_maybe_save(self) -> None:
        """Save to disk if enough time has elapsed."""
        now = time.time()
        if now - self._last_save_ts < SAVE_INTERVAL_S:
            return
        self._prune()
        await self._store.async_save({"frames": self.frames})
        self._last_save_ts = now

    def get_frames(
        self,
        start_ts: float | None = None,
        end_ts: float | None = None,
        obj_key: str | None = None,
        max_frames: int = 4000,
    ) -> list[dict[str, Any]]:
        """Return frames within the time window, optionally filtered to one object."""
        now = time.time()
        if start_ts is None:
            start_ts = now - 300  # default 5 min
        if end_ts is None:
            end_ts = now

        result: list[dict[str, Any]] = []
        for f in self.frames:
            ts = f.get("ts", 0)
            if ts < start_ts or ts > end_ts:
                continue
            if obj_key:
                # Filter to frames that contain this object
                filtered_objs = [o for o in f.get("o", []) if o.get("k") == obj_key]
                if not filtered_objs:
                    continue
                result.append({"ts": ts, "o": filtered_objs})
            else:
                result.append(f)
            if len(result) >= max_frames:
                break

        # If too many frames, downsample evenly
        if len(result) > max_frames:
            step = len(result) / max_frames
            result = [result[int(i * step)] for i in range(max_frames)]

        return result

    def get_object_keys(self) -> list[dict[str, str]]:
        """Return all unique object keys seen in traceback with their latest label/kind."""
        seen: dict[str, dict[str, str]] = {}
        for f in reversed(self.frames):
            for o in f.get("o", []):
                k = o.get("k", "")
                if k and k not in seen:
                    seen[k] = {
                        "key": k,
                        "name": o.get("n", k),
                        "kind": o.get("t", ""),
                    }
            if len(seen) > 500:
                break
        return list(seen.values())

    def get_time_range(self) -> dict[str, float]:
        """Return the earliest and latest timestamp in the store."""
        if not self.frames:
            return {"start": 0, "end": 0, "count": 0}
        return {
            "start": self.frames[0].get("ts", 0),
            "end": self.frames[-1].get("ts", 0),
            "count": len(self.frames),
        }

    def _prune(self) -> None:
        cutoff = time.time() - MAX_AGE_S
        self.frames = [f for f in self.frames if f.get("ts", 0) > cutoff]
        if len(self.frames) > MAX_FRAMES:
            self.frames = self.frames[-MAX_FRAMES:]
