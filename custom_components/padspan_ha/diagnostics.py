from __future__ import annotations

from typing import Any
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN, VERSION

async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict[str, Any]:
    coord = hass.data.get(DOMAIN, {}).get("coordinator")
    return {
        "version": VERSION,
        "entry": {
            "entry_id": entry.entry_id,
            "title": entry.title,
            "data": dict(entry.data),
            "options": dict(entry.options),
        },
        "coordinator": coord.as_dict() if coord else None,
        "note": "Share this diagnostics blob + traceback if any flows fail.",
    }
