from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: ConfigEntry) -> dict:
    bucket = hass.data[DOMAIN][entry.entry_id]
    coordinator = bucket["coordinator"]
    data = dict(coordinator.data or {})
    redacted = dict(entry.data)
    if "api_key" in redacted and redacted["api_key"]:
        redacted["api_key"] = "***redacted***"
    return {"entry_data": redacted, "coordinator_data": data}
