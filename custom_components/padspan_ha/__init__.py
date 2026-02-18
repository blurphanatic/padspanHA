from __future__ import annotations

import logging

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers.typing import ConfigType

from .const import (
    DOMAIN,
    CONF_ENABLE_CLOUD,
    CONF_HUB_URL,
    CONF_API_KEY,
    CONF_SCAN_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
)
from .coordinator import PadSpanCoordinator
from .panel import async_setup_panel
from .websocket import async_register_websockets

_LOGGER = logging.getLogger(__name__)

SERVICE_SET_MAP = "set_room_tag_map"
SERVICE_SCHEMA = vol.Schema({vol.Required("room_tag_map"): dict})

async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    hass.data.setdefault(DOMAIN, {})

    # Websockets for the panel
    try:
        async_register_websockets(hass)
    except Exception as err:
        _LOGGER.exception("Websocket registration failed: %s", err)

    # Panel
    try:
        await async_setup_panel(hass)
    except Exception as err:
        _LOGGER.exception("Panel registration failed: %s", err)

    async def _set_map(call: ServiceCall) -> None:
        coord: PadSpanCoordinator | None = hass.data.get(DOMAIN, {}).get("coordinator")
        if not coord:
            coord = PadSpanCoordinator()
            hass.data[DOMAIN]["coordinator"] = coord
        coord.room_tag_map = call.data.get("room_tag_map") or {}
        coord.mark_success()
        _LOGGER.info("room_tag_map replaced via service (%d rooms)", len(coord.room_tag_map))

    hass.services.async_register(DOMAIN, SERVICE_SET_MAP, _set_map, schema=SERVICE_SCHEMA)
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})

    coord: PadSpanCoordinator | None = hass.data[DOMAIN].get("coordinator")
    if coord is None:
        coord = PadSpanCoordinator()
        hass.data[DOMAIN]["coordinator"] = coord

    coord.enable_cloud = bool(entry.data.get(CONF_ENABLE_CLOUD, False))
    coord.hub_url = str(entry.data.get(CONF_HUB_URL, ""))
    coord.api_key = str(entry.data.get(CONF_API_KEY, ""))
    coord.scan_interval = int(entry.options.get(CONF_SCAN_INTERVAL, entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)))
    coord.ensure_defaults()
    coord.mark_success()

    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return True
