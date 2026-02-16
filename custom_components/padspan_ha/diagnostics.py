from copy import deepcopy

from homeassistant.components.diagnostics import async_redact_data

TO_REDACT = {"api_key"}

async def async_get_config_entry_diagnostics(hass, entry):
    payload = hass.data["padspan_ha"].get(entry.entry_id, {})
    coordinator = payload.get("coordinator")
    return {
        "entry": async_redact_data(dict(entry.data), TO_REDACT),
        "options": dict(entry.options),
        "coordinator_data": deepcopy(coordinator.data if coordinator else {}),
    }
