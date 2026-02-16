from __future__ import annotations

from homeassistant.config_entries import ConfigEntry

from .api import PadSpanApiClient
from .const import (
    CONF_API_BASE,
    CONF_API_KEY,
    CONF_DEMO_MODE,
    DEFAULT_API_BASE,
    DEFAULT_DEMO_MODE,
    DEFAULT_ENABLE_SIDEBAR,
    DOMAIN,
    OPTION_ENABLE_SIDEBAR,
    PLATFORMS,
)
from .coordinator import PadSpanCoordinator
from .panel import async_register_panel
from .services import async_register_services
from .websocket_api import async_setup as async_setup_ws

async def async_setup(hass, config):
    hass.data.setdefault(DOMAIN, {})
    await async_register_services(hass)
    await async_setup_ws(hass)
    return True

async def async_setup_entry(hass, entry: ConfigEntry):
    merged = dict(entry.data)
    merged.update(entry.options)

    api = PadSpanApiClient(
        hass,
        str(merged.get(CONF_API_BASE, DEFAULT_API_BASE)),
        str(merged.get(CONF_API_KEY, "")),
        bool(merged.get(CONF_DEMO_MODE, DEFAULT_DEMO_MODE)),
    )
    coordinator = PadSpanCoordinator(hass, entry, api)
    await coordinator.async_config_entry_first_refresh()

    hass.data[DOMAIN][entry.entry_id] = {"api": api, "coordinator": coordinator}

    enable_sidebar = bool(
        entry.options.get(
            OPTION_ENABLE_SIDEBAR,
            entry.data.get(OPTION_ENABLE_SIDEBAR, DEFAULT_ENABLE_SIDEBAR),
        )
    )
    if enable_sidebar:
        await async_register_panel(hass, entry.entry_id)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))
    return True

async def async_unload_entry(hass, entry: ConfigEntry):
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return ok

async def async_reload_entry(hass, entry: ConfigEntry):
    await async_unload_entry(hass, entry)
    await async_setup_entry(hass, entry)
