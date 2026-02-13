"""Service handlers for PadSpan HA."""
from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError

from .const import (
    DATA_COORDINATOR,
    DATA_STORE,
    DOMAIN,
    SERVICE_IMPORT_MAP_IMAGE,
    SERVICE_RELOAD_BLE_CACHE,
    SERVICE_SET_MAP_ANCHOR,
)

SERVICE_FIELD_ENTRY_ID = "entry_id"


def _resolve_entry_data(hass: HomeAssistant, call: ServiceCall) -> dict[str, Any]:
    entries: dict[str, dict[str, Any]] = hass.data.get(DOMAIN, {})
    if not entries:
        raise HomeAssistantError("No PadSpan HA config entry is loaded")

    entry_id = call.data.get(SERVICE_FIELD_ENTRY_ID)
    if entry_id:
        if entry_id not in entries:
            raise HomeAssistantError(f"Unknown entry_id: {entry_id}")
        return entries[entry_id]

    return next(iter(entries.values()))


async def async_register_services(hass: HomeAssistant) -> None:
    """Register integration services."""
    if hass.services.has_service(DOMAIN, SERVICE_RELOAD_BLE_CACHE):
        return

    async def handle_reload_ble_cache(call: ServiceCall) -> None:
        entry_data = _resolve_entry_data(hass, call)
        coordinator = entry_data[DATA_COORDINATOR]
        await coordinator.async_reload_cache()

    async def handle_import_map_image(call: ServiceCall) -> None:
        entry_data = _resolve_entry_data(hass, call)
        store = entry_data[DATA_STORE]
        await store.async_import_image(
            map_id=call.data["map_id"],
            source_path=call.data["source_path"],
            overwrite=call.data.get("overwrite", False),
        )

    async def handle_set_map_anchor(call: ServiceCall) -> None:
        entry_data = _resolve_entry_data(hass, call)
        store = entry_data[DATA_STORE]
        await store.async_set_anchor(
            map_id=call.data["map_id"],
            anchor_id=call.data["anchor_id"],
            x=call.data["x"],
            y=call.data["y"],
            z=call.data.get("z", 0.0),
            weight=call.data.get("weight", 1.0),
        )

    hass.services.async_register(
        DOMAIN,
        SERVICE_RELOAD_BLE_CACHE,
        handle_reload_ble_cache,
        schema=vol.Schema({vol.Optional(SERVICE_FIELD_ENTRY_ID): str}),
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_IMPORT_MAP_IMAGE,
        handle_import_map_image,
        schema=vol.Schema(
            {
                vol.Required("map_id"): str,
                vol.Required("source_path"): str,
                vol.Optional("overwrite", default=False): bool,
                vol.Optional(SERVICE_FIELD_ENTRY_ID): str,
            }
        ),
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_MAP_ANCHOR,
        handle_set_map_anchor,
        schema=vol.Schema(
            {
                vol.Required("map_id"): str,
                vol.Required("anchor_id"): str,
                vol.Required("x"): vol.Coerce(float),
                vol.Required("y"): vol.Coerce(float),
                vol.Optional("z", default=0.0): vol.Coerce(float),
                vol.Optional("weight", default=1.0): vol.Coerce(float),
                vol.Optional(SERVICE_FIELD_ENTRY_ID): str,
            }
        ),
    )


async def async_unregister_services(hass: HomeAssistant) -> None:
    """Unregister integration services."""
    for service in (SERVICE_RELOAD_BLE_CACHE, SERVICE_IMPORT_MAP_IMAGE, SERVICE_SET_MAP_ANCHOR):
        if hass.services.has_service(DOMAIN, service):
            hass.services.async_remove(DOMAIN, service)
