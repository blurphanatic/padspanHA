from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)
STATIC_URL = "/padspan_ha_static"


async def _register_static_compat(hass: HomeAssistant, static_dir: Path) -> None:
    # Newer HA
    try:
        from homeassistant.components.http import StaticPathConfig  # type: ignore
        await hass.http.async_register_static_paths([StaticPathConfig(STATIC_URL, str(static_dir), False)])
        return
    except Exception:
        pass

    # Older HA async
    try:
        await hass.http.async_register_static_path(STATIC_URL, str(static_dir), False)
        return
    except Exception:
        pass

    # Older HA sync
    try:
        hass.http.register_static_path(STATIC_URL, str(static_dir), False)
        return
    except Exception as err:
        _LOGGER.debug("Static path registration skipped/failed: %s", err)


async def async_setup_panel(hass: HomeAssistant) -> None:
    static_dir = Path(__file__).parent / "www"

    try:
        await _register_static_compat(hass, static_dir)
    except Exception as err:
        _LOGGER.debug("Static registration error: %s", err)

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
    except Exception as err:
        _LOGGER.debug("Panel registration skipped/failed: %s", err)
