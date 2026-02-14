from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: ConfigEntry):
    ctx = hass.data[DOMAIN][entry.entry_id]
    coordinator = ctx["coordinator"]
    data = coordinator.data or coordinator._build_snapshot()
    return {
        "entry_id": entry.entry_id,
        "snapshot": data,
        "map_store": ctx["map_store"].data,
    }
