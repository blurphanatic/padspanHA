from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from homeassistant.components import frontend

from .const import DOMAIN, PLATFORMS, PANEL_URL_PATH, STATIC_URL
from .map_store import MapStore
from .coordinator import PadSpanCoordinator
from .services import async_register_services, async_remove_services
from .api import PadSpanStatusView, PadSpanMapUploadView, PadSpanCommandView

_LOGGER = logging.getLogger(__name__)


async def _ensure_global_setup(hass: HomeAssistant) -> None:
    hass.data.setdefault(DOMAIN, {})

    if hass.data[DOMAIN].get("_global_ready"):
        return

    www_path = Path(__file__).parent / "www"
    try:
        hass.http.register_static_path(STATIC_URL, str(www_path), cache_headers=False)
    except Exception as err:
        _LOGGER.debug("Static path already registered or unavailable: %s", err)

    hass.http.register_view(PadSpanStatusView)
    hass.http.register_view(PadSpanMapUploadView)
    hass.http.register_view(PadSpanCommandView)

    # Advanced sidebar tooling UI
    frontend.async_register_built_in_panel(
        hass,
        component_name="iframe",
        sidebar_title="PadSpan HA",
        sidebar_icon="mdi:map-marker-radius",
        frontend_url_path=PANEL_URL_PATH,
        config={"url": f"{STATIC_URL}/panel.html"},
        require_admin=True,
    )

    await async_register_services(hass)
    hass.data[DOMAIN]["_global_ready"] = True


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    await _ensure_global_setup(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    await _ensure_global_setup(hass)

    map_store = MapStore(hass, entry.entry_id)
    await map_store.async_load()

    coordinator = PadSpanCoordinator(hass, entry, map_store)
    await coordinator.async_start()

    hass.data[DOMAIN][entry.entry_id] = {
        "entry": entry,
        "coordinator": coordinator,
        "map_store": map_store,
    }

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    ctx = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if ctx:
        await ctx["coordinator"].async_stop()

    # if no entries left, remove services/panel
    remaining_entries = [k for k in hass.data.get(DOMAIN, {}).keys() if not k.startswith("_")]
    if not remaining_entries:
        await async_remove_services(hass)
        remove_panel = getattr(frontend, "async_remove_panel", None)
        if remove_panel:
            try:
                remove_panel(hass, PANEL_URL_PATH)
            except Exception:
                pass
        hass.data[DOMAIN]["_global_ready"] = False

    return unload_ok


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)
