from __future__ import annotations

"""
REPO LOGIC NOTES

Registers exactly one HA panel. The panel does internal nav; do not register per-view panels.
"""


import inspect
import logging
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DOMAIN, VERSION, DATA_PANEL_REGISTERED

_LOGGER = logging.getLogger(__name__)

STATIC_URL = "/padspan_ha_static"
WEB_COMPONENT = "padspan-ha-app"

async def _register_static(hass: HomeAssistant, static_dir: Path) -> None:
    try:
        from homeassistant.components.http import StaticPathConfig  # type: ignore
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(static_dir), False)]
        )
        return
    except Exception:
        pass

    try:
        await hass.http.async_register_static_path(STATIC_URL, str(static_dir), False)
        return
    except Exception:
        pass

    try:
        hass.http.register_static_path(STATIC_URL, str(static_dir), False)
    except Exception:
        _LOGGER.debug("Static register fallback failed")

async def async_setup_panel(hass: HomeAssistant) -> None:
    hass.data.setdefault(DOMAIN, {})
    if hass.data[DOMAIN].get(DATA_PANEL_REGISTERED):
        return

    await _register_static(hass, Path(__file__).parent / "www")

    from homeassistant.components import panel_custom

    async def _register_panel(**kwargs: Any) -> None:
        ret = panel_custom.async_register_panel(**kwargs)
        if inspect.isawaitable(ret):
            await ret

    await _register_panel(
        hass=hass,
        webcomponent_name=WEB_COMPONENT,
        frontend_url_path="padspan-ha",
        sidebar_title="PadSpan",
        sidebar_icon="mdi:radar",
        require_admin=False,
        module_url=f"{STATIC_URL}/padspan-ha/panel.js?v={VERSION}&cb=full",
        config={
            "title": "PadSpan HA",
            "icon": f"{STATIC_URL}/padspan-ha/assets/padspan-mark.svg",
            "logo": f"{STATIC_URL}/padspan-ha/assets/padspan-logo.svg",
            "version": VERSION,
        },
    )

    hass.data[DOMAIN][DATA_PANEL_REGISTERED] = True
    _LOGGER.info("PadSpan HA panel registered v%s", VERSION)
