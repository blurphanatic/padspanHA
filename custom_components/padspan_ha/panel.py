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
from .build_info import BUILD_ID

_LOGGER = logging.getLogger(__name__)

STATIC_URL = "/padspan_ha_static"
ICON_STATIC_URL = "/padspan_ha_int"
WEB_COMPONENT       = "padspan-ha-app"
CALIB_WEB_COMPONENT = "padspan-calib-app"

async def _register_static(hass: HomeAssistant, static_dir: Path, url: str = STATIC_URL) -> None:
    try:
        from homeassistant.components.http import StaticPathConfig  # type: ignore
        await hass.http.async_register_static_paths(
            [StaticPathConfig(url, str(static_dir), False)]
        )
        return
    except Exception:
        pass

    try:
        await hass.http.async_register_static_path(url, str(static_dir), False)
        return
    except Exception:
        pass

    try:
        hass.http.register_static_path(url, str(static_dir), False)
    except Exception:
        _LOGGER.debug("Static register fallback failed (url=%s)", url)

async def async_setup_panel(hass: HomeAssistant) -> None:
    hass.data.setdefault(DOMAIN, {})
    if hass.data[DOMAIN].get(DATA_PANEL_REGISTERED):
        return

    await _register_static(hass, Path(__file__).parent / "www")
    # Also serve the integration root so icon.png is accessible at /padspan_ha_int/icon.png
    await _register_static(hass, Path(__file__).parent, url=ICON_STATIC_URL)

    from homeassistant.components import panel_custom

    async def _register_panel(**kwargs: Any) -> None:
        ret = panel_custom.async_register_panel(**kwargs)
        if inspect.isawaitable(ret):
            await ret

    await _register_panel(
        hass=hass,
        webcomponent_name=WEB_COMPONENT,
        frontend_url_path="padspan-ha",
        sidebar_title="PadSpan HA",
        sidebar_icon="mdi:radar",
        require_admin=False,
        module_url=f"{STATIC_URL}/padspan-ha/panel.js?v={VERSION}&b={BUILD_ID}&cb=full",
        config={
            "title": "PadSpan HA",
            "icon": f"{STATIC_URL}/padspan-ha/assets/padspan-mark.svg",
            "logo": f"{STATIC_URL}/padspan-ha/assets/padspan-logo.svg",
            "version": VERSION,
        },
    )

    await _register_panel(
        hass=hass,
        webcomponent_name=CALIB_WEB_COMPONENT,
        frontend_url_path="padspan-calibration",
        sidebar_title="PadSpan Calib",
        sidebar_icon="mdi:crosshairs-gps",
        require_admin=False,
        module_url=f"{STATIC_URL}/padspan-ha/calibration_panel.js?v={VERSION}&b={BUILD_ID}",
        config={
            "title": "PadSpan Calibration",
            "version": VERSION,
        },
    )

    hass.data[DOMAIN][DATA_PANEL_REGISTERED] = True
    _LOGGER.info("PadSpan HA panel registered v%s", VERSION)
