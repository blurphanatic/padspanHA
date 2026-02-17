from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

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

LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN]["logger"] = LOGGER

    # Services + WS + Sidebar registration should be non-fatal
    try:
        from .services import async_setup_services
        await async_setup_services(hass)
    except Exception:
        LOGGER.exception("PadSpan services setup failed")

    try:
        from .websocket_api import async_setup_websocket_api
        await async_setup_websocket_api(hass)
    except Exception:
        LOGGER.exception("PadSpan websocket API setup failed")

    # Sidebar registration early (before entry) so menu appears reliably
    try:
        from .panel import async_setup_panel
        await async_setup_panel(hass)
    except Exception:
        LOGGER.exception("PadSpan panel setup failed during async_setup")

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    from homeassistant.helpers.aiohttp_client import async_get_clientsession

    from .api import PadSpanApiClient
    from .coordinator import PadSpanCoordinator

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

    # Non-fatal first refresh keeps config entry alive
    try:
        await coordinator.async_config_entry_first_refresh()
    except Exception:
        LOGGER.exception("First refresh failed; continuing local-only")
        coordinator.async_set_updated_data(
            {
                "status": "local_only",
                "cloud_enabled": bool(data.get(CONF_ENABLE_CLOUD, False)),
                "cloud_reachable": False,
                "hub_url": data.get(CONF_HUB_URL, ""),
                "devices": [],
                "room_tag_map": {},
                "test_presence": False,
                "last_success": None,
                "last_error": "first_refresh_failed",
            }
        )

    hass.data[DOMAIN][entry.entry_id] = {
        DATA_CLIENT: client,
        DATA_COORDINATOR: coordinator,
        "coordinator": coordinator,
    }

    # Re-run panel registration (safe + helps after reload)
    try:
        from .panel import async_setup_panel
        await async_setup_panel(hass)
    except Exception:
        LOGGER.exception("PadSpan panel setup failed during entry setup")

    # Forward all full-feature platforms
    try:
        if hasattr(hass.config_entries, "async_forward_entry_setups"):
            await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
        else:
            for platform in PLATFORMS:
                await hass.config_entries.async_forward_entry_setup(entry, platform)
    except Exception:
        LOGGER.exception("Platform setup encountered errors")

    entry.async_on_unload(entry.add_update_listener(async_reload_entry))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    from .services import async_unload_services

    ok = True
    try:
        if hasattr(hass.config_entries, "async_unload_platforms"):
            ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
        else:
            for platform in PLATFORMS:
                ok = ok and await hass.config_entries.async_forward_entry_unload(entry, platform)
    except Exception:
        LOGGER.exception("Platform unload failed")
        ok = False

    if ok:
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
        # only remove services when no entries remain
        if len([k for k in hass.data.get(DOMAIN, {}).keys() if k not in ("logger", "_ws_registered", "_panel_registered")]) == 0:
            try:
                await async_unload_services(hass)
            except Exception:
                LOGGER.exception("Service unload failed")

    return ok


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await async_unload_entry(hass, entry)
    await async_setup_entry(hass, entry)
