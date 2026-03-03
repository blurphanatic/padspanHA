# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

import asyncio
import base64
import hashlib
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import MAPS_STORE_KEY, MAPS_DIR, DEFAULT_FLOOR_ID

MAX_MAP_BYTES = 20 * 1024 * 1024  # 20 MB decoded limit

def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def _sha256(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()

@dataclass
class MapsStore:
    hass: HomeAssistant
    store: Store
    maps_dir: Path
    data: dict[str, Any] = field(default_factory=lambda: {"maps": []})

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = Store(hass, 1, MAPS_STORE_KEY)
        self.maps_dir = Path(hass.config.path("www")) / MAPS_DIR
        self.data = {"maps": []}

    async def async_setup(self) -> None:
        await asyncio.to_thread(self.maps_dir.mkdir, parents=True, exist_ok=True)
        loaded = await self.store.async_load()
        if isinstance(loaded, dict) and "maps" in loaded:
            self.data = loaded
        else:
            self.data = {"maps": []}

        # Normalize existing
        for m in self.data.get("maps", []):
            m.setdefault("receivers", [])
            m.setdefault("beacons", [])
            m.setdefault("calibration", {"mode": "none", "px_per_meter": None, "reference_points": []})
            m.setdefault("notes", "")
            m.setdefault("floor_id", DEFAULT_FLOOR_ID)
            m.setdefault("room_bounds", {})
            # Normalize receivers to include optional fields
            recs = m.get("receivers") or []
            if isinstance(recs, list):
                for r in recs:
                    if isinstance(r, dict):
                        r.setdefault("room", "")
                        r.setdefault("source", "")
            m.setdefault("stack", {"z_level": 0, "x_offset": 0.0, "y_offset": 0.0, "scale": 1.0, "ceiling_height_m": 2.4})
            m.setdefault("created", _now_iso())
            m.setdefault("updated", m.get("created", _now_iso()))

        await self.store.async_save(self.data)

    def list_maps(self) -> list[dict[str, Any]]:
        return list(self.data.get("maps", []))

    def get_map(self, map_id: str) -> dict[str, Any] | None:
        for m in self.data.get("maps", []):
            if m.get("id") == map_id:
                return m
        return None

    async def async_add_map(self, name: str, filename: str, mime: str, width: int, height: int, png_base64: str, floor_id: str | None = None) -> dict[str, Any]:
        # Reject oversized uploads before decoding
        max_b64_len = (MAX_MAP_BYTES * 4) // 3 + 4
        if len(png_base64) > max_b64_len:
            raise ValueError(f"Map image exceeds {MAX_MAP_BYTES // (1024*1024)} MB limit")
        raw = base64.b64decode(png_base64)
        if len(raw) > MAX_MAP_BYTES:
            raise ValueError(f"Map image exceeds {MAX_MAP_BYTES // (1024*1024)} MB limit")
        map_id = os.urandom(8).hex()
        file_name = f"{map_id}.png"
        file_path = self.maps_dir / file_name
        await asyncio.to_thread(file_path.write_bytes, raw)

        info = {
            "id": map_id,
            "name": (name or "Untitled Map")[:120],
            "created": _now_iso(),
            "updated": _now_iso(),
            "image": {
                "filename": file_name,
                "original_filename": (filename or "map")[:180],
                "mime": "image/png",
                "original_mime": (mime or "image/*")[:80],
                "width": int(width or 0),
                "height": int(height or 0),
                "size_bytes": len(raw),
                "sha256": _sha256(raw),
            },
            "calibration": {"mode": "none", "px_per_meter": None, "reference_points": []},
            "receivers": [],
            "beacons": [],
            "room_bounds": {},
            "floor_id": str(floor_id or DEFAULT_FLOOR_ID)[:40],
            "notes": "",
            "stack": {"z_level": 0, "x_offset": 0.0, "y_offset": 0.0, "scale": 1.0, "ceiling_height_m": 2.4},
        }

        self.data.setdefault("maps", [])
        self.data["maps"].append(info)
        await self.store.async_save(self.data)
        return info

    async def async_update_map(self, map_id: str, *, receivers: list[dict[str, Any]] | None = None, beacons: list[dict[str, Any]] | None = None, calibration: dict[str, Any] | None = None, notes: str | None = None, floor_id: str | None = None, room_bounds: dict[str, Any] | None = None, stack: dict | None = None) -> dict[str, Any]:
        m = self.get_map(map_id)
        if not m:
            raise KeyError("not_found")

        if isinstance(receivers, list):
            clean: list[dict[str, Any]] = []
            for r in receivers:
                if not isinstance(r, dict):
                    continue
                rx = {
                    "id": str(r.get("id") or "")[:80],
                    "label": str(r.get("label") or "")[:120],
                    "x": float(r.get("x") or 0.0),
                    "y": float(r.get("y") or 0.0),
                    "room": str(r.get("room") or "")[:120],
                    "source": str(r.get("source") or "")[:80],
                }
                rx["x"] = max(0.0, min(1.0, rx["x"]))
                rx["y"] = max(0.0, min(1.0, rx["y"]))
                if rx["id"] or rx["label"]:
                    clean.append(rx)
            m["receivers"] = clean

        if isinstance(beacons, list):
            clean_bk: list[dict[str, Any]] = []
            for bk in beacons:
                if not isinstance(bk, dict):
                    continue
                entry = {
                    "id": str(bk.get("id") or f"bk_{os.urandom(4).hex()}")[:80],
                    "label": str(bk.get("label") or "")[:120],
                    "key": str(bk.get("key") or "")[:200],
                    "x": float(bk.get("x") or 0.0),
                    "y": float(bk.get("y") or 0.0),
                    "kind": str(bk.get("kind") or "")[:20],
                }
                entry["x"] = max(0.0, min(1.0, entry["x"]))
                entry["y"] = max(0.0, min(1.0, entry["y"]))
                if entry["key"]:
                    clean_bk.append(entry)
            m["beacons"] = clean_bk

        if isinstance(calibration, dict):
            m["calibration"] = {
                "mode": str(calibration.get("mode") or "none"),
                "px_per_meter": calibration.get("px_per_meter"),
                "reference_points": calibration.get("reference_points") or [],
            }

        if notes is not None:
            m["notes"] = str(notes)[:10000]

        if floor_id is not None:
            m["floor_id"] = str(floor_id or DEFAULT_FLOOR_ID)[:40]

        if isinstance(room_bounds, dict):
            # room_bounds: { roomName: {type:"poly", points:[[x,y],...]} | {type:"circle", cx,cy,r} }
            clean_rb: dict[str, Any] = {}
            for room, b in room_bounds.items():
                if not isinstance(room, str) or not isinstance(b, dict):
                    continue
                rname = room[:120]
                btype = str(b.get("type") or "poly")
                if btype == "poly":
                    pts = b.get("points")
                    if not isinstance(pts, list) or len(pts) < 3:
                        continue
                    clean_pts = []
                    for p in pts:
                        if not isinstance(p, (list, tuple)) or len(p) < 2:
                            continue
                        x = float(p[0])
                        y = float(p[1])
                        x = max(0.0, min(1.0, x))
                        y = max(0.0, min(1.0, y))
                        clean_pts.append([x, y])
                    if len(clean_pts) >= 3:
                        clean_rb[rname] = {"type": "poly", "points": clean_pts}
                elif btype == "circle":
                    try:
                        cx = float(b.get("cx") or 0.5)
                        cy = float(b.get("cy") or 0.5)
                        rr = float(b.get("r") or 0.12)
                        cx = max(0.0, min(1.0, cx))
                        cy = max(0.0, min(1.0, cy))
                        rr = max(0.01, min(0.5, rr))
                        clean_rb[rname] = {"type": "circle", "cx": cx, "cy": cy, "r": rr}
                    except Exception:
                        continue
            m["room_bounds"] = clean_rb

        if isinstance(stack, dict):
            z = max(0, min(20, int(stack.get("z_level", 0))))
            sc = max(0.1, min(10.0, float(stack.get("scale", 1.0))))
            ceil_h = max(1.5, min(20.0, float(stack.get("ceiling_height_m", 2.4))))
            rot = float(stack.get("rotation", 0.0))
            new_stack: dict[str, Any] = {
                "z_level": z,
                "x_offset": float(stack.get("x_offset", 0.0)),
                "y_offset": float(stack.get("y_offset", 0.0)),
                "scale": sc,
                "ceiling_height_m": ceil_h,
                "rotation": rot,
            }
            # Preserve alignment fields
            if "is_master" in stack:
                new_stack["is_master"] = bool(stack["is_master"])
            elif m.get("stack", {}).get("is_master"):
                new_stack["is_master"] = True
            if "ref_map_id" in stack:
                new_stack["ref_map_id"] = str(stack["ref_map_id"]) if stack["ref_map_id"] else None
            elif m.get("stack", {}).get("ref_map_id"):
                new_stack["ref_map_id"] = m["stack"]["ref_map_id"]
            if "ref_ar" in stack:
                new_stack["ref_ar"] = float(stack["ref_ar"]) if stack["ref_ar"] is not None else None
            elif m.get("stack", {}).get("ref_ar") is not None:
                new_stack["ref_ar"] = m["stack"]["ref_ar"]
            if "scale_x_adj" in stack:
                new_stack["scale_x_adj"] = max(0.01, min(100.0, float(stack.get("scale_x_adj", 1.0))))
            elif m.get("stack", {}).get("scale_x_adj") is not None:
                new_stack["scale_x_adj"] = m["stack"]["scale_x_adj"]
            if "tie_ins" in stack:
                new_stack["tie_ins"] = stack["tie_ins"] if isinstance(stack["tie_ins"], list) else []
            elif m.get("stack", {}).get("tie_ins"):
                new_stack["tie_ins"] = m["stack"]["tie_ins"]
            m["stack"] = new_stack

        m["updated"] = _now_iso()
        await self.store.async_save(self.data)
        return m

    async def async_replace_image(
        self,
        map_id: str,
        png_base64: str,
        width: int,
        height: int,
        crop: dict | None = None,
    ) -> dict[str, Any]:
        """Replace the PNG for an existing map and renormalize stored coordinates.

        crop (optional) describes the region of the *original* image that was
        kept: {fx0, fy0, fx1, fy1} as 0-1 fractions.  All receiver positions
        and room-bound polygon points are remapped so they remain correct in the
        new (cropped) image coordinate space.
        """
        m = self.get_map(map_id)
        if not m:
            raise KeyError("not_found")

        raw = base64.b64decode(png_base64)

        # Overwrite the same file so the browser cache-busts via map.updated timestamp
        file_path = (self.maps_dir / m["image"]["filename"]).resolve()
        if not str(file_path).startswith(str(self.maps_dir.resolve())):
            raise ValueError("Invalid filename")
        await asyncio.to_thread(file_path.write_bytes, raw)

        m["image"]["width"]      = int(width)
        m["image"]["height"]     = int(height)
        m["image"]["size_bytes"] = len(raw)
        m["image"]["sha256"]     = _sha256(raw)

        # Renormalize stored coordinates if a crop rectangle was supplied
        if crop:
            fx0 = float(crop.get("fx0", 0))
            fy0 = float(crop.get("fy0", 0))
            fx1 = float(crop.get("fx1", 1))
            fy1 = float(crop.get("fy1", 1))
            fw  = fx1 - fx0
            fh  = fy1 - fy0
            if fw > 0 and fh > 0:
                def _rx(px: float) -> float:
                    return max(0.0, min(1.0, (float(px) - fx0) / fw))
                def _ry(py: float) -> float:
                    return max(0.0, min(1.0, (float(py) - fy0) / fh))

                for r in m.get("receivers", []):
                    r["x"] = _rx(r.get("x", 0))
                    r["y"] = _ry(r.get("y", 0))

                for bk in m.get("beacons", []):
                    bk["x"] = _rx(bk.get("x", 0))
                    bk["y"] = _ry(bk.get("y", 0))

                for b in m.get("room_bounds", {}).values():
                    if isinstance(b, dict):
                        if b.get("type") == "poly" and isinstance(b.get("points"), list):
                            b["points"] = [[_rx(p[0]), _ry(p[1])] for p in b["points"] if len(p) >= 2]
                        elif b.get("type") == "circle":
                            b["cx"] = _rx(b.get("cx", 0.5))
                            b["cy"] = _ry(b.get("cy", 0.5))

        m["updated"] = _now_iso()
        await self.store.async_save(self.data)
        return m

    async def async_prune_stale_receivers(self, known_sources: set[str], known_names: set[str]) -> int:
        """Remove receivers from all maps that don't match any known radio.

        Returns the number of receivers removed.
        """
        removed = 0
        dirty = False
        for m in self.data.get("maps", []):
            recs = m.get("receivers")
            if not isinstance(recs, list) or not recs:
                continue
            before = len(recs)
            m["receivers"] = [
                r for r in recs
                if (r.get("id") or "") in known_sources
                or (r.get("source") or "") in known_sources
                or (r.get("label") or "") in known_names
            ]
            diff = before - len(m["receivers"])
            if diff > 0:
                removed += diff
                dirty = True
        if dirty:
            await self.store.async_save(self.data)
        return removed

    async def async_remove_receiver_by_source(self, source: str) -> int:
        """Remove receivers matching a specific source from all maps.

        Matches if r["id"] == source or r["source"] == source.
        Returns the number of receivers removed.
        """
        removed = 0
        dirty = False
        for m in self.data.get("maps", []):
            recs = m.get("receivers")
            if not isinstance(recs, list) or not recs:
                continue
            before = len(recs)
            m["receivers"] = [
                r for r in recs
                if (r.get("id") or "") != source
                and (r.get("source") or "") != source
            ]
            diff = before - len(m["receivers"])
            if diff > 0:
                removed += diff
                dirty = True
        if dirty:
            await self.store.async_save(self.data)
        return removed

    async def async_delete_map(self, map_id: str) -> None:
        m = self.get_map(map_id)
        if not m:
            return
        fn = m.get("image", {}).get("filename")
        if fn:
            fp = (self.maps_dir / str(fn)).resolve()
            if str(fp).startswith(str(self.maps_dir.resolve())) and fp.exists():
                try:
                    await asyncio.to_thread(fp.unlink)
                except Exception:
                    pass
        self.data["maps"] = [x for x in self.data.get("maps", []) if x.get("id") != map_id]
        await self.store.async_save(self.data)
