from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os
import shutil
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN


@dataclass
class MapImportResult:
    map_id: str
    image_path: str
    image_url: str


class MapStore:
    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self._store = Store(hass, 1, f"{DOMAIN}_{entry_id}_maps")
        self.data: dict[str, Any] = {
            "active_map_id": "default",
            "maps": {},
        }

    async def async_load(self) -> None:
        loaded = await self._store.async_load()
        if isinstance(loaded, dict):
            self.data = {
                "active_map_id": loaded.get("active_map_id", "default"),
                "maps": loaded.get("maps", {}),
            }

    async def async_save(self) -> None:
        await self._store.async_save(self.data)

    async def async_set_active_map(self, map_id: str) -> None:
        self.data["active_map_id"] = map_id
        self.data.setdefault("maps", {}).setdefault(map_id, {"anchors": {}})
        await self.async_save()

    def get_active_map_id(self) -> str:
        return self.data.get("active_map_id", "default")

    def get_maps(self) -> dict[str, Any]:
        return self.data.get("maps", {})

    def get_anchors(self, map_id: str | None = None) -> dict[str, dict]:
        active = map_id or self.get_active_map_id()
        maps = self.get_maps()
        return maps.get(active, {}).get("anchors", {})

    async def async_set_map_image(self, map_id: str, image_path: str, image_url: str) -> None:
        maps = self.data.setdefault("maps", {})
        map_obj = maps.setdefault(map_id, {})
        map_obj["image_path"] = image_path
        map_obj["image_url"] = image_url
        map_obj.setdefault("anchors", {})
        if not self.data.get("active_map_id"):
            self.data["active_map_id"] = map_id
        await self.async_save()

    async def async_set_anchor(
        self,
        map_id: str,
        anchor_id: str,
        source_id: str,
        x: float,
        y: float,
        z: float = 0.0,
        weight: float = 1.0,
        name: str | None = None,
    ) -> None:
        maps = self.data.setdefault("maps", {})
        map_obj = maps.setdefault(map_id, {})
        anchors = map_obj.setdefault("anchors", {})
        anchors[anchor_id] = {
            "anchor_id": anchor_id,
            "source_id": source_id,
            "x": x,
            "y": y,
            "z": z,
            "weight": weight,
            "name": name or anchor_id,
        }
        if not self.data.get("active_map_id"):
            self.data["active_map_id"] = map_id
        await self.async_save()

    async def async_remove_anchor(self, map_id: str, anchor_id: str) -> None:
        anchors = self.data.setdefault("maps", {}).setdefault(map_id, {}).setdefault("anchors", {})
        anchors.pop(anchor_id, None)
        await self.async_save()

    def find_anchor_by_source(self, source_id: str, map_id: str | None = None) -> dict[str, Any] | None:
        anchors = self.get_anchors(map_id=map_id)
        for anchor in anchors.values():
            if str(anchor.get("source_id", "")).upper() == str(source_id).upper():
                return anchor
        return None


def _resolve_source_path(hass: HomeAssistant, source_path: str) -> Path:
    p = Path(source_path)
    if p.is_absolute():
        return p
    # relative to config dir
    return Path(hass.config.path(source_path))


async def import_map_image_file(
    hass: HomeAssistant,
    entry_id: str,
    map_store: MapStore,
    map_id: str,
    source_path: str,
    overwrite: bool = False,
) -> dict[str, str]:
    src = _resolve_source_path(hass, source_path)
    if not await hass.async_add_executor_job(src.exists):
        raise FileNotFoundError(f"Map source file not found: {src}")

    file_name = src.name
    dest_dir = Path(hass.config.path("www", "padspan_ha", entry_id, map_id))
    await hass.async_add_executor_job(lambda: dest_dir.mkdir(parents=True, exist_ok=True))

    dest = dest_dir / file_name
    if (not overwrite) and await hass.async_add_executor_job(dest.exists):
        raise FileExistsError(f"Destination exists: {dest}")

    await hass.async_add_executor_job(shutil.copy2, src, dest)

    image_url = f"/local/padspan_ha/{entry_id}/{map_id}/{file_name}"
    await map_store.async_set_map_image(map_id=map_id, image_path=str(dest), image_url=image_url)
    await map_store.async_set_active_map(map_id)

    return {"map_id": map_id, "image_path": str(dest), "image_url": image_url}
