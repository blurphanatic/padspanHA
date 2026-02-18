
from __future__ import annotations
import logging
from pathlib import Path
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)
STATIC = "/padspan_ha_static"

async def async_setup_panel(hass: HomeAssistant):
    www = Path(__file__).parent / "www"
    try:
        await hass.http.async_register_static_path(STATIC, str(www), False)
    except Exception:
        pass

    from homeassistant.components import panel_custom

    panel_custom.async_register_panel(
        hass=hass,
        webcomponent_name="padspan-ha-app",
        frontend_url_path="padspan-ha",
        sidebar_title="PadSpan",
        sidebar_icon="mdi:radar",
        module_url=f"{STATIC}/padspan-ha/panel.js?v=0.3.22",
        require_admin=False,
    )
    _LOGGER.warning("PadSpan panel registered")
