from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import async_entries_for_config_entry, async_get as async_get_device_registry
from homeassistant.components.diagnostics import async_redact_data

from .const import DOMAIN

TO_REDACT = {"entry_id"}


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict:
    domain_data = hass.data.get(DOMAIN, {}).get(entry.entry_id, {})
    coordinator = domain_data.get("coordinator")
    map_store = domain_data.get("map_store")

    device_registry = async_get_device_registry(hass)
    devices = async_entries_for_config_entry(device_registry, entry.entry_id)

    payload = {
        "entry": {
            "title": entry.title,
            "data": dict(entry.data),
            "options": dict(entry.options),
        },
        "stats": (coordinator.data or {}).get("stats") if coordinator else {},
        "maps": map_store.get_maps() if map_store else {},
        "devices_count": len((coordinator.data or {}).get("devices", {})) if coordinator and coordinator.data else 0,
        "device_registry_count": len(devices),
    }
    return async_redact_data(payload, TO_REDACT)
