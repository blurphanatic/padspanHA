from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)
STATIC_URL = "/padspan_ha_static"


async def _register_static_compat(hass: HomeAssistant, static_dir: Path) -> None:
    """Register static files with compatibility across HA versions."""
    # Newer HA style
    try:
        from homeassistant.components.http import StaticPathConfig  # type: ignore
        await hass.http.async_register_static_paths([StaticPathConfig(STATIC_URL, str(static_dir), False)])
        return
    except Exception:
        pass

    # Older async style
    try:
        await hass.http.async_register_static_path(STATIC_URL, str(static_dir), False)
        return
    except Exception:
        pass

    # Older sync style
    try:
        hass.http.register_static_path(STATIC_URL, str(static_dir), False)
        return
    except Exception as err:
        _LOGGER.debug("Static path registration skipped/failed: %s", err)


async def async_setup_panel(hass: HomeAssistant) -> None:
    """Register static files and panel in a fail-safe way."""
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
            module_url="%s/padspan-ha/panel.js" % STATIC_URL,
            sidebar_title="PadSpan",
            sidebar_icon="mdi:radar",
            require_admin=False,
            config={"title": "PadSpan", "icon": "%s/padspan-ha/assets/padspan-mark.svg" % STATIC_URL},
        )
    except Exception as err:
        _LOGGER.debug("Panel registration skipped/failed: %s", err)
