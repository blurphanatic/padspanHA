from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)
STATIC_URL = "/padspan_ha_static"


async def _register_static(hass: HomeAssistant, static_dir: Path) -> None:
    # Modern HA
    try:
        from homeassistant.components.http import StaticPathConfig  # type: ignore
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(static_dir), False)]
        )
        return
    except Exception:
        pass

    # Fallbacks
    try:
        await hass.http.async_register_static_path(STATIC_URL, str(static_dir), False)
        return
    except Exception:
        pass

    try:
        hass.http.register_static_path(STATIC_URL, str(static_dir), False)
        return
    except Exception as err:
        _LOGGER.debug("Static path registration failed: %s", err)


async def async_setup_panel(hass: HomeAssistant) -> None:
    hass.data.setdefault("padspan_ha", {})
    if hass.data["padspan_ha"].get("_panel_registered"):
        return

    static_dir = Path(__file__).parent / "www"
    await _register_static(hass, static_dir)

    from homeassistant.components import panel_custom

    # Primary panel
    panel_custom.async_register_panel(
        hass=hass,
        webcomponent_name="padspan-ha-panel",
        frontend_url_path="padspan-ha",
        module_url=f"{STATIC_URL}/padspan-ha/panel.js?v=0.3.14",
        sidebar_title="PadSpan",
        sidebar_icon="mdi:radar",
        require_admin=False,
        config={
            "title": "PadSpan HA",
            "icon": f"{STATIC_URL}/padspan-ha/assets/padspan-mark.svg",
            "logo": f"{STATIC_URL}/padspan-ha/assets/padspan-logo.svg",
        },
    )

    # Extra sidebar variations for testing (requested)
    variations = [
        ("padspan-ha-overview", "PadSpan Overview", "mdi:view-dashboard"),
        ("padspan-ha-live-map", "PadSpan Live Map", "mdi:map-marker-radius"),
        ("padspan-ha-objects", "PadSpan Objects", "mdi:tag-multiple"),
        ("padspan-ha-rooms", "PadSpan Rooms", "mdi:floor-plan"),
        ("padspan-ha-zones", "PadSpan Zones", "mdi:map"),
        ("padspan-ha-diagnostics", "PadSpan Diagnostics", "mdi:stethoscope"),
        ("padspan-ha-health", "PadSpan Health", "mdi:heart-pulse"),
        ("padspan-ha-debug", "PadSpan Debug", "mdi:bug"),
        ("padspan-ha-events", "PadSpan Events", "mdi:timeline-clock"),
        ("padspan-ha-settings", "PadSpan Settings", "mdi:cog"),
        ("padspan-ha-lab", "PadSpan Lab", "mdi:flask"),
        ("padspan-ha-devtools", "PadSpan DevTools", "mdi:wrench"),
        ("padspan-ha-qa", "PadSpan QA", "mdi:check-decagram"),
        ("padspan-ha-sandbox", "PadSpan Sandbox", "mdi:beaker-outline"),
        ("padspan-ha-monitor", "PadSpan Monitor", "mdi:monitor-dashboard"),
    ]
    for path, title, icon in variations:
        panel_custom.async_register_panel(
            hass=hass,
            webcomponent_name="padspan-ha-panel",
            frontend_url_path=path,
            module_url=f"{STATIC_URL}/padspan-ha/panel.js?v=0.3.14",
            sidebar_title=title,
            sidebar_icon=icon,
            require_admin=False,
            config={
                "title": title,
                "icon": f"{STATIC_URL}/padspan-ha/assets/padspan-mark.svg",
                "logo": f"{STATIC_URL}/padspan-ha/assets/padspan-logo.svg",
                "view": path,
            },
        )

    hass.data["padspan_ha"]["_panel_registered"] = True
