from __future__ import annotations

import voluptuous as vol
from homeassistant.core import HomeAssistant, ServiceCall

from .const import DOMAIN, SERVICE_SET_TEST_PRESENCE


async def async_setup_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_SET_TEST_PRESENCE):
        return

    schema = vol.Schema({vol.Required("is_home"): bool})

    async def _set_test_presence(call: ServiceCall) -> None:
        value = bool(call.data["is_home"])
        domain_data = hass.data.get(DOMAIN, {})
        for _entry_id, bucket in domain_data.items():
            if not isinstance(bucket, dict):
                continue
            coordinator = bucket.get("coordinator")
            if coordinator is not None:
                coordinator.set_test_presence(value)

    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_TEST_PRESENCE,
        _set_test_presence,
        schema=schema,
    )


async def async_unload_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_SET_TEST_PRESENCE):
        hass.services.async_remove(DOMAIN, SERVICE_SET_TEST_PRESENCE)
