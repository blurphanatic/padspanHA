from __future__ import annotations

"""
REPO LOGIC NOTES

Entry point. Initializes coordinator + persistent stores, registers websocket API, and
registers a SINGLE HA panel (internal navigation happens inside the panel).

Key rule: NEVER "revert" features by accident. Treat the repo as additive — only remove
features when the user explicitly requests it.
"""

import logging

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers.typing import ConfigType

from .build_info import BUILD_ID, BUILD_VERSION
from .const import (
    DOMAIN,
    CONF_ENABLE_CLOUD,
    CONF_HUB_URL,
    CONF_API_KEY,
    CONF_SCAN_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
    DATA_SETTINGS,
    DATA_MAPS,
)
from .coordinator import PadSpanCoordinator
from .maps_store import MapsStore
from .panel import async_setup_panel
from .settings_store import SettingsStore
from .websocket import async_register_websockets

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[str] = ["sensor", "binary_sensor", "device_tracker"]

SERVICE_SET_MAP = "set_room_tag_map"
SERVICE_SCHEMA = vol.Schema({vol.Required("room_tag_map"): dict})


async def _ensure_stores(hass: HomeAssistant) -> None:
    """Create/load persistent stores exactly once per HA runtime."""
    hass.data.setdefault(DOMAIN, {})

    if DATA_SETTINGS not in hass.data[DOMAIN]:
        st = SettingsStore(hass)
        await st.async_load()
        hass.data[DOMAIN][DATA_SETTINGS] = st
        _LOGGER.debug("SettingsStore ready")

    if DATA_MAPS not in hass.data[DOMAIN]:
        ms = MapsStore(hass)
        await ms.async_setup()
        hass.data[DOMAIN][DATA_MAPS] = ms
        _LOGGER.debug("MapsStore ready (%s)", ms.maps_dir)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    hass.data.setdefault(DOMAIN, {})

    _LOGGER.info("PadSpan HA starting v%s (build %s)", BUILD_VERSION, BUILD_ID)

    # Persistent stores used by panel + websocket API
    try:
        await _ensure_stores(hass)
    except Exception as err:  # defensive: do not break HA startup
        _LOGGER.exception("Store init failed: %s", err)

    # Websockets for the panel (must be registered even if entry isn't created yet)
    try:
        async_register_websockets(hass)
    except Exception as err:
        _LOGGER.exception("Websocket registration failed: %s", err)

    # Panel (single sidebar entry)
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

    # Ensure stores are present (reload-safe)
    try:
        await _ensure_stores(hass)
    except Exception as err:
        _LOGGER.exception("Store init failed during setup_entry: %s", err)

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

    # Forward platforms (safe even if they don't create entities yet)
    try:
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    except Exception as err:
        _LOGGER.exception("Forward entry setups failed: %s", err)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    try:
        return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    except Exception:
        return True
