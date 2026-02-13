from __future__ import annotations

from copy import deepcopy
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN

STORAGE_VERSION = 1

DEFAULT_DATA: dict[str, Any] = {
    "maps": {},
    "anchors": {},
    "active_map": None,
}


class MapStore:
    """Storage wrapper for map and anchor data."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self._store = Store(hass, STORAGE_VERSION, f"{DOMAIN}_{entry_id}_maps")
        self._data: dict[str, Any] = deepcopy(DEFAULT_DATA)

    @property
    def data(self) -> dict[str, Any]:
        return self._data

    @property
    def maps(self) -> dict[str, dict[str, Any]]:
        return self._data["maps"]

    @property
    def anchors(self) -> dict[str, dict[str, dict[str, Any]]]:
        return self._data["anchors"]

    @property
    def active_map(self) -> str | None:
        return self._data.get("active_map")

    async def async_load(self) -> None:
        raw = await self._store.async_load()
        if not isinstance(raw, dict):
            self._data = deepcopy(DEFAULT_DATA)
            return
        self._data = deepcopy(DEFAULT_DATA)
        self._data.update(raw)
        self._data.setdefault("maps", {})
        self._data.setdefault("anchors", {})
        self._data.setdefault("active_map", None)

    async def async_save(self) -> None:
        await self._store.async_save(self._data)

    async def async_add_map(
        self,
        map_id: str,
        name: str | None,
        image_url: str,
        width: int | None = None,
        height: int | None = None,
    ) -> None:
        self._data["maps"][map_id] = {
            "id": map_id,
            "name": name or map_id,
            "image_url": image_url,
            "width": width,
            "height": height,
        }
        self._data["anchors"].setdefault(map_id, {})
        if not self._data.get("active_map"):
            self._data["active_map"] = map_id
        await self.async_save()

    async def async_remove_map(self, map_id: str) -> None:
        self._data["maps"].pop(map_id, None)
        self._data["anchors"].pop(map_id, None)
        if self._data.get("active_map") == map_id:
            self._data["active_map"] = next(iter(self._data["maps"].keys()), None)
        await self.async_save()

    async def async_set_active_map(self, map_id: str) -> None:
        if map_id not in self._data["maps"]:
            raise ValueError(f"Unknown map_id: {map_id}")
        self._data["active_map"] = map_id
        await self.async_save()

    async def async_set_anchor(
        self,
        map_id: str,
        source_id: str,
        x: float,
        y: float,
        z: float = 0.0,
        weight: float = 1.0,
        label: str | None = None,
    ) -> None:
        if map_id not in self._data["maps"]:
            raise ValueError(f"Unknown map_id: {map_id}")
        self._data["anchors"].setdefault(map_id, {})
        self._data["anchors"][map_id][source_id] = {
            "source_id": source_id,
            "x": x,
            "y": y,
            "z": z,
            "weight": weight,
            "label": label or source_id,
        }
        await self.async_save()

    async def async_delete_anchor(self, map_id: str, source_id: str) -> None:
        if map_id in self._data["anchors"]:
            self._data["anchors"][map_id].pop(source_id, None)
            await self.async_save()

    def async_export(self) -> dict[str, Any]:
        return deepcopy(self._data)
