from __future__ import annotations

import inspect
import logging
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

STATIC_URL = "/padspan_ha_static"
WEB_COMPONENT = "padspan-ha-app"   # new name to bust frontend cache across versions


async def _register_static(hass: HomeAssistant, static_dir: Path) -> None:
    # Modern HA API
    try:
        from homeassistant.components.http import StaticPathConfig  # type: ignore
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(static_dir), False)]
        )
        return
    except Exception:
        pass

    # Fallback: older async method
    try:
        await hass.http.async_register_static_path(STATIC_URL, str(static_dir), False)
        return
    except Exception:
        pass

    # Legacy sync fallback
    try:
        hass.http.register_static_path(STATIC_URL, str(static_dir), False)
    except Exception as err:
        _LOGGER.debug("Static path registration failed: %s", err)


async def _remove_legacy_panels(hass: HomeAssistant) -> None:
    """Remove old per-view HA sidebar entries from previous builds."""
    try:
        from homeassistant.components import panel_custom
    except Exception:
        return

    legacy_paths = [
        # prior multi-panel experiments
        "padspan-ha-overview",
        "padspan-ha-objects",
        "padspan-ha-diagnostics",
        "padspan-ha-live",
        "padspan-ha-events",
        "padspan-ha-health",
        "padspan-ha-debug",
        "padspan-ha-qa",
        "padspan-ha-sandbox",
        "padspan-ha-settings",
        "padspan-ha-zones",
        "padspan-ha-presence",
        "padspan-ha-devices",
        "padspan-ha-insights",
        "padspan-ha-history",
        "padspan-ha-monitor",
        # older names
        "padspan",
        "padspan_ha",
    ]

    for p in legacy_paths:
        try:
            ret = panel_custom.async_remove_panel(hass, p)
            if inspect.isawaitable(ret):
                await ret
        except Exception:
            # ok if it didn't exist
            continue


async def async_setup_panel(hass: HomeAssistant) -> None:
    """Register a SINGLE sidebar entry in HA (PadSpan)."""
    hass.data.setdefault("padspan_ha", {})
    if hass.data["padspan_ha"].get("_panel_registered"):
        return

    static_dir = Path(__file__).parent / "www"
    await _register_static(hass, static_dir)

    # Remove old multi-panels so user sees ONE entry
    await _remove_legacy_panels(hass)

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
        module_url=f"{STATIC_URL}/padspan-ha/panel.js?v=0.3.21&cb=1",
        config={
            "title": "PadSpan HA",
            "icon": f"{STATIC_URL}/padspan-ha/assets/padspan-mark.svg",
            "logo": f"{STATIC_URL}/padspan-ha/assets/padspan-logo.svg",
        },
    )

    hass.data["padspan_ha"]["_panel_registered"] = True
    _LOGGER.info("PadSpan HA panel registered (single entry) v0.3.21")
