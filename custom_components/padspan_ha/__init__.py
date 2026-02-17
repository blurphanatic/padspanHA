from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType

from .api import PadSpanApiClient
from .const import (
    CONF_API_KEY,
    CONF_ENABLE_CLOUD,
    CONF_HUB_URL,
    CONF_SCAN_INTERVAL,
    DATA_CLIENT,
    DATA_COORDINATOR,
    DOMAIN,
    PLATFORMS,
)
from .coordinator import PadSpanCoordinator
from .panel import async_setup_panel
from .services import async_setup_services, async_unload_services
from .websocket_api import async_setup_websocket_api

LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN]["logger"] = LOGGER
    await async_setup_services(hass)
    await async_setup_websocket_api(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN]["logger"] = LOGGER

    data = dict(entry.data)
    if entry.options:
        data.update(entry.options)

    client = PadSpanApiClient(
        session=async_get_clientsession(hass),
        hub_url=data.get(CONF_HUB_URL),
        api_key=data.get(CONF_API_KEY),
        enabled=bool(data.get(CONF_ENABLE_CLOUD, False)),
    )

    coordinator = PadSpanCoordinator(
        hass=hass,
        client=client,
        scan_interval=int(data.get(CONF_SCAN_INTERVAL, 30)),
    )

    # Non-fatal first refresh
    await coordinator.async_config_entry_first_refresh()

    hass.data[DOMAIN][entry.entry_id] = {
        DATA_CLIENT: client,
        DATA_COORDINATOR: coordinator,
        "coordinator": coordinator,
    }

    # Sidebar panel best-effort
    try:
        await async_setup_panel(hass)
    except Exception as err:  # pragma: no cover
        LOGGER.debug("Panel setup skipped/failed: %s", err)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
        if len([k for k in hass.data.get(DOMAIN, {}).keys() if k != "logger"]) == 0:
            await async_unload_services(hass)
    return ok


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await async_unload_entry(hass, entry)
    await async_setup_entry(hass, entry)
