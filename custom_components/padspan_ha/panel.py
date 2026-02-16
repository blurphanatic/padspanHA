from pathlib import Path

from homeassistant.components import panel_custom
from homeassistant.components.http import StaticPathConfig

STATIC_URL_BASE = "/padspan_ha_static"

async def async_register_panel(hass, entry_id: str) -> None:
    root = Path(__file__).parent / "www" / "padspan-ha"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_URL_BASE, str(root), False)]
    )

    panel_custom.async_register_panel(
        hass,
        webcomponent_name="padspan-ha-panel",
        frontend_url_path="padspan-ha",
        module_url=f"{STATIC_URL_BASE}/panel.js",
        sidebar_title="PadSpan",
        sidebar_icon="mdi:map-marker-radius",
        require_admin=False,
        config={"entry_id": entry_id},
    )
