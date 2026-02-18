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

from .const import MAPS_STORE_KEY, MAPS_DIR

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
            m.setdefault("calibration", {"mode": "none", "px_per_meter": None, "reference_points": []})
            m.setdefault("notes", "")
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

    async def async_add_map(self, name: str, filename: str, mime: str, width: int, height: int, png_base64: str) -> dict[str, Any]:
        raw = base64.b64decode(png_base64)
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
            "notes": "",
        }

        self.data.setdefault("maps", [])
        self.data["maps"].append(info)
        await self.store.async_save(self.data)
        return info

    async def async_update_map(self, map_id: str, *, receivers: list[dict[str, Any]] | None = None, calibration: dict[str, Any] | None = None, notes: str | None = None) -> dict[str, Any]:
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
                }
                rx["x"] = max(0.0, min(1.0, rx["x"]))
                rx["y"] = max(0.0, min(1.0, rx["y"]))
                if rx["id"] or rx["label"]:
                    clean.append(rx)
            m["receivers"] = clean

        if isinstance(calibration, dict):
            m["calibration"] = {
                "mode": str(calibration.get("mode") or "none"),
                "px_per_meter": calibration.get("px_per_meter"),
                "reference_points": calibration.get("reference_points") or [],
            }

        if notes is not None:
            m["notes"] = str(notes)[:10000]

        m["updated"] = _now_iso()
        await self.store.async_save(self.data)
        return m

    async def async_delete_map(self, map_id: str) -> None:
        m = self.get_map(map_id)
        if not m:
            return
        fn = m.get("image", {}).get("filename")
        if fn:
            fp = self.maps_dir / str(fn)
            if fp.exists():
                try:
                    await asyncio.to_thread(fp.unlink)
                except Exception:
                    pass
        self.data["maps"] = [x for x in self.data.get("maps", []) if x.get("id") != map_id]
        await self.store.async_save(self.data)
