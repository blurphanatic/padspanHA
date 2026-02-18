from __future__ import annotations

"""
REPO LOGIC NOTES

Persistent UI settings store for sample/live toggle and active map selection.
"""


import logging
from dataclasses import dataclass
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import SETTINGS_STORE_KEY

_LOGGER = logging.getLogger(__name__)

DEFAULT_SETTINGS: dict[str, Any] = {
    "data_mode": "sample",  # "sample" | "live"
}

@dataclass
class SettingsStore:
    hass: HomeAssistant
    store: Store
    data: dict[str, Any]

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = Store(hass, 1, SETTINGS_STORE_KEY)
        self.data = dict(DEFAULT_SETTINGS)

    async def async_load(self) -> dict[str, Any]:
        loaded = await self.store.async_load()
        if isinstance(loaded, dict):
            self.data = {**DEFAULT_SETTINGS, **loaded}
        else:
            self.data = dict(DEFAULT_SETTINGS)
        await self.store.async_save(self.data)
        return self.data

    async def async_set(self, **kwargs: Any) -> dict[str, Any]:
        self.data = {**self.data, **kwargs}
        await self.store.async_save(self.data)
        return self.data

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)
