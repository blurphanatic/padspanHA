from __future__ import annotations

import inspect
import logging
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)
STATIC_URL = "/padspan_ha_static"


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
        return
    except Exception as err:
        _LOGGER.debug("Static path registration failed: %s", err)


async def async_setup_panel(hass: HomeAssistant) -> None:
    """Register ONE sidebar entry in HA, with an internal menu inside the panel."""
    hass.data.setdefault("padspan_ha", {})
    if hass.data["padspan_ha"].get("_panel_registered"):
        return

    static_dir = Path(__file__).parent / "www"
    await _register_static(hass, static_dir)

    from homeassistant.components import panel_custom

    async def _register_panel(**kwargs: Any) -> None:
        ret = panel_custom.async_register_panel(**kwargs)
        if inspect.isawaitable(ret):
            await ret

    base_kwargs = {
        "hass": hass,
        "webcomponent_name": "padspan-ha-panel",
        "module_url": f"{STATIC_URL}/padspan-ha/panel.js?v=0.3.20",
        "require_admin": False,
    }

    # ✅ One HA sidebar entry only
    await _register_panel(
        **base_kwargs,
        frontend_url_path="padspan-ha",
        sidebar_title="PadSpan",
        sidebar_icon="mdi:radar",
        config={
            "title": "PadSpan HA",
            "icon": f"{STATIC_URL}/padspan-ha/assets/padspan-mark.svg",
            "logo": f"{STATIC_URL}/padspan-ha/assets/padspan-logo.svg",
            "view": "padspan-ha",
        },
    )

    hass.data["padspan_ha"]["_panel_registered"] = True
