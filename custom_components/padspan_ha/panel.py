from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

STATIC_URL = "/padspan_ha_static"


async def async_setup_panel(hass: HomeAssistant) -> None:
    """Register static files and panel in a fail-safe way."""
    static_dir = Path(__file__).parent / "www"

    try:
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(static_dir), False)]
        )
    except Exception as err:  # pragma: no cover
        _LOGGER.debug("Static path registration skipped/failed: %s", err)

    try:
        from homeassistant.components import panel_custom

        panel_custom.async_register_panel(
            hass=hass,
            webcomponent_name="padspan-ha-panel",
            frontend_url_path="padspan-ha",
            module_url=f"{STATIC_URL}/padspan-ha/panel.js",
            sidebar_title="PadSpan",
            sidebar_icon="mdi:radar",
            require_admin=False,
            config={
                "title": "PadSpan HA",
                "icon": f"{STATIC_URL}/padspan-ha/assets/padspan-mark.svg",
            },
        )
    except Exception as err:  # pragma: no cover
        _LOGGER.debug("Panel registration skipped/failed: %s", err)
