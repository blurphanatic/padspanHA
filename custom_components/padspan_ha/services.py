from __future__ import annotations

from homeassistant.core import ServiceCall

from .const import DOMAIN, SERVICE_RESCAN

async def async_register_services(hass) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_RESCAN):
        return

    async def _handle_rescan(call: ServiceCall) -> None:
        for entry in hass.config_entries.async_entries(DOMAIN):
            payload = hass.data[DOMAIN].get(entry.entry_id)
            if not payload:
                continue
            await payload["api"].async_trigger_scan()
            await payload["coordinator"].async_request_refresh()

    hass.services.async_register(DOMAIN, SERVICE_RESCAN, _handle_rescan)
