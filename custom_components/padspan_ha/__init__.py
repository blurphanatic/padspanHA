from __future__ import annotations

import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers.typing import ConfigType

from .const import (
    DOMAIN,
    PLATFORMS,
    SERVICE_IMPORT_MAP_IMAGE,
    SERVICE_RELOAD_BLE_CACHE,
    SERVICE_REMOVE_MAP_ANCHOR,
    SERVICE_SET_ACTIVE_MAP,
    SERVICE_SET_MAP_ANCHOR,
)
from .coordinator import PadSpanCoordinator
from .map_store import MapStore, import_map_image_file

_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    hass.data.setdefault(DOMAIN, {})
    _register_services(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    map_store = MapStore(hass, entry.entry_id)
    await map_store.async_load()

    coordinator = PadSpanCoordinator(hass, entry, map_store)
    await coordinator.async_setup()

    hass.data[DOMAIN][entry.entry_id] = {
        "coordinator": coordinator,
        "map_store": map_store,
        "entry": entry,
    }

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    data = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if data:
        coordinator: PadSpanCoordinator = data["coordinator"]
        await coordinator.async_shutdown()

    if not hass.data.get(DOMAIN):
        for service in (
            SERVICE_IMPORT_MAP_IMAGE,
            SERVICE_SET_MAP_ANCHOR,
            SERVICE_REMOVE_MAP_ANCHOR,
            SERVICE_SET_ACTIVE_MAP,
            SERVICE_RELOAD_BLE_CACHE,
        ):
            if hass.services.has_service(DOMAIN, service):
                hass.services.async_remove(DOMAIN, service)

    return unload_ok


def _get_target_entry(hass: HomeAssistant, call: ServiceCall):
    entry_id = call.data.get("entry_id")
    domain_data = hass.data.get(DOMAIN, {})
    if entry_id:
        return entry_id, domain_data.get(entry_id)
    if not domain_data:
        return None, None
    first_entry_id = next(iter(domain_data))
    return first_entry_id, domain_data[first_entry_id]


def _register_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_IMPORT_MAP_IMAGE):
        return

    async def async_import_map_image(call: ServiceCall) -> None:
        entry_id, target = _get_target_entry(hass, call)
        if not target:
            _LOGGER.error("No %s entries loaded", DOMAIN)
            return

        map_store: MapStore = target["map_store"]
        map_id = call.data["map_id"]
        source_path = call.data["source_path"]
        overwrite = bool(call.data.get("overwrite", False))

        result = await import_map_image_file(
            hass=hass,
            entry_id=entry_id,
            map_store=map_store,
            map_id=map_id,
            source_path=source_path,
            overwrite=overwrite,
        )
        _LOGGER.info("Imported map image '%s': %s", map_id, result["image_url"])

    async def async_set_map_anchor(call: ServiceCall) -> None:
        _, target = _get_target_entry(hass, call)
        if not target:
            _LOGGER.error("No %s entries loaded", DOMAIN)
            return

        map_store: MapStore = target["map_store"]
        await map_store.async_set_anchor(
            map_id=call.data["map_id"],
            anchor_id=call.data["anchor_id"],
            source_id=call.data["source_id"],
            x=float(call.data["x"]),
            y=float(call.data["y"]),
            z=float(call.data.get("z", 0.0)),
            weight=float(call.data.get("weight", 1.0)),
            name=call.data.get("name"),
        )

    async def async_remove_map_anchor(call: ServiceCall) -> None:
        _, target = _get_target_entry(hass, call)
        if not target:
            _LOGGER.error("No %s entries loaded", DOMAIN)
            return

        map_store: MapStore = target["map_store"]
        await map_store.async_remove_anchor(
            map_id=call.data["map_id"],
            anchor_id=call.data["anchor_id"],
        )

    async def async_set_active_map(call: ServiceCall) -> None:
        _, target = _get_target_entry(hass, call)
        if not target:
            _LOGGER.error("No %s entries loaded", DOMAIN)
            return
        map_store: MapStore = target["map_store"]
        await map_store.async_set_active_map(call.data["map_id"])

    async def async_reload_ble_cache(call: ServiceCall) -> None:
        _, target = _get_target_entry(hass, call)
        if not target:
            _LOGGER.error("No %s entries loaded", DOMAIN)
            return
        coordinator: PadSpanCoordinator = target["coordinator"]
        await coordinator.async_reload_cache()

    hass.services.async_register(DOMAIN, SERVICE_IMPORT_MAP_IMAGE, async_import_map_image)
    hass.services.async_register(DOMAIN, SERVICE_SET_MAP_ANCHOR, async_set_map_anchor)
    hass.services.async_register(DOMAIN, SERVICE_REMOVE_MAP_ANCHOR, async_remove_map_anchor)
    hass.services.async_register(DOMAIN, SERVICE_SET_ACTIVE_MAP, async_set_active_map)
    hass.services.async_register(DOMAIN, SERVICE_RELOAD_BLE_CACHE, async_reload_ble_cache)
