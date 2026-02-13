from __future__ import annotations

from copy import deepcopy
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DATA_COORDINATOR, DATA_STORE, DOMAIN


async def async_get_config_entry_diagnostics(hass: HomeAssistant, config_entry: ConfigEntry) -> dict[str, Any]:
    data = hass.data[DOMAIN][config_entry.entry_id]
    coordinator = data[DATA_COORDINATOR]
    store = data[DATA_STORE]

    payload = {
        "entry": {
            "entry_id": config_entry.entry_id,
            "title": config_entry.title,
            "data": dict(config_entry.data),
            "options": dict(config_entry.options),
        },
        "store": store.async_export(),
        "coordinator_data": deepcopy(coordinator.data or {}),
        "devices_sample": coordinator.get_device_snapshot(limit=50),
    }
    return payload
