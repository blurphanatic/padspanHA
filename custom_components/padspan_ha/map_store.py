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

from .const import MAPS_STORE_KEY, MAPS_DIR_NAME, MAPS_SUBDIR

def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def _sha256(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()

@dataclass
class MapStore:
    hass: HomeAssistant
    store: Store
    maps_dir: Path
    data: dict[str, Any] = field(default_factory=lambda: {"maps": []})

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = Store(hass, 1, MAPS_STORE_KEY)
        self.maps_dir = Path(hass.config.path("www")) / MAPS_DIR_NAME / MAPS_SUBDIR
        self.data = {"maps": []}

    async def async_setup(self) -> None:
        await asyncio.to_thread(self.maps_dir.mkdir, parents=True, exist_ok=True)
        loaded = await self.store.async_load()
        if isinstance(loaded, dict) and "maps" in loaded:
            self.data = loaded
        else:
            self.data = {"maps": []}

        # Normalize
        for m in self.data.get("maps", []):
            m.setdefault("receivers", [])
            m.setdefault("calibration", {"mode": "none", "px_per_meter": None, "reference_points": []})
            m.setdefault("notes", "")
            m.setdefault("created", _now_iso())
            m.setdefault("updated", m.get("created"))

        await self._save()

    async def _save(self) -> None:
        await self.store.async_save(self.data)

    def list_maps(self) -> list[dict[str, Any]]:
        return list(self.data.get("maps", []))

    def get_map(self, map_id: str) -> dict[str, Any] | None:
        for m in self.data.get("maps", []):
            if m.get("id") == map_id:
                return m
        return None

    async def async_add_map(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = str(payload.get("name") or "Untitled Map").strip()[:120]
        mime_orig = str(payload.get("mime") or "image/png")
        filename_orig = str(payload.get("filename") or "map").strip()[:180]
        width = int(payload.get("width") or 0)
        height = int(payload.get("height") or 0)
        data_b64 = str(payload.get("data_base64") or "")

        if not data_b64:
            raise ValueError("Missing data_base64")

        raw = base64.b64decode(data_b64)

        map_id = str(payload.get("id") or os.urandom(8).hex())
        file_name = f"{map_id}.png"
        file_path = self.maps_dir / file_name
        await asyncio.to_thread(file_path.write_bytes, raw)

        info = {
            "id": map_id,
            "name": name,
            "created": _now_iso(),
            "updated": _now_iso(),
            "image": {
                "filename": file_name,
                "original_filename": filename_orig,
                "mime": "image/png",
                "original_mime": mime_orig,
                "width": width,
                "height": height,
                "size_bytes": len(raw),
                "sha256": _sha256(raw),
            },
            "calibration": {
                "mode": "none",
                "px_per_meter": None,
                "reference_points": [],
            },
            "receivers": [],
            "notes": "",
        }

        self.data.setdefault("maps", [])
        self.data["maps"].append(info)
        await self._save()
        return info

    async def async_update_meta(self, map_id: str, meta: dict[str, Any]) -> dict[str, Any]:
        m = self.get_map(map_id)
        if not m:
            raise KeyError("Map not found")

        if "name" in meta:
            m["name"] = str(meta["name"])[:120]
        if "notes" in meta:
            m["notes"] = str(meta["notes"])[:10000]

        if "receivers" in meta and isinstance(meta["receivers"], list):
            recs: list[dict[str, Any]] = []
            for r in meta["receivers"]:
                if not isinstance(r, dict):
                    continue
                rx = {
                    "id": str(r.get("id") or "").strip()[:80],
                    "label": str(r.get("label") or "").strip()[:120],
                    "x": float(r.get("x") or 0.0),
                    "y": float(r.get("y") or 0.0),
                }
                rx["x"] = max(0.0, min(1.0, rx["x"]))
                rx["y"] = max(0.0, min(1.0, rx["y"]))
                if rx["id"] or rx["label"]:
                    recs.append(rx)
            m["receivers"] = recs

        if "calibration" in meta and isinstance(meta["calibration"], dict):
            cal = meta["calibration"]
            m["calibration"] = {
                "mode": str(cal.get("mode") or "none"),
                "px_per_meter": cal.get("px_per_meter"),
                "reference_points": cal.get("reference_points") or [],
            }

        m["updated"] = _now_iso()
        await self._save()
        return m

    async def async_delete_map(self, map_id: str) -> None:
        maps = self.data.get("maps", [])
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

        self.data["maps"] = [x for x in maps if x.get("id") != map_id]
        await self._save()

    async def async_read_file(self, map_id: str) -> tuple[bytes, str]:
        m = self.get_map(map_id)
        if not m:
            raise KeyError("Map not found")
        fn = m.get("image", {}).get("filename")
        if not fn:
            raise FileNotFoundError("Missing filename")
        fp = self.maps_dir / str(fn)
        raw = await asyncio.to_thread(fp.read_bytes)
        return raw, "image/png"
