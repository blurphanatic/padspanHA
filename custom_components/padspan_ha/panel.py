from __future__ import annotations

import inspect
import logging
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)
STATIC_URL = "/padspan_ha_static"


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
        return
    except Exception as err:
        _LOGGER.debug("Static path registration failed: %s", err)


async def _call_register(panel_custom, kwargs: dict[str, Any]) -> None:
    sig = inspect.signature(panel_custom.async_register_panel)
    params = set(sig.parameters.keys())

    attempts = []
    # main attempt with module_url
    attempts.append(dict(kwargs))
    # fallback for APIs that use js_url
    if "module_url" in kwargs:
        alt = dict(kwargs)
        alt["js_url"] = alt.pop("module_url")
        attempts.append(alt)

    last_err: Exception | None = None
    for payload in attempts:
        # strip unknown kwargs for this HA version
        safe = {k: v for k, v in payload.items() if k in params}
        try:
            ret = panel_custom.async_register_panel(**safe)
            if inspect.isawaitable(ret):
                await ret
            return
        except Exception as err:  # try next variant
            last_err = err

    if last_err:
        raise last_err


async def async_setup_panel(hass: HomeAssistant) -> None:
    hass.data.setdefault("padspan_ha", {})
    if hass.data["padspan_ha"].get("_panel_registered"):
        return

    static_dir = Path(__file__).parent / "www"
    await _register_static(hass, static_dir)

    from homeassistant.components import panel_custom

    panel_base_kwargs = {
        "hass": hass,
        "webcomponent_name": "padspan-ha-panel",
        "module_url": f"{STATIC_URL}/padspan-ha/panel.js?v=0.3.19",
        "require_admin": False,
    }

    await _call_register(
        panel_custom,
        {
            **panel_base_kwargs,
            "frontend_url_path": "padspan-ha",
            "sidebar_title": "PadSpan HA",
            "sidebar_icon": "mdi:radar",
            "config": {
                "title": "PadSpan HA",
                "icon": f"{STATIC_URL}/padspan-ha/assets/padspan-mark.svg",
                "logo": f"{STATIC_URL}/padspan-ha/assets/padspan-logo.svg",
                "view": "padspan-ha",
            },
        },
    )

    variations = [
        ("padspan-ha-overview", "PadSpan Overview", "mdi:view-dashboard"),
        ("padspan-ha-live-map", "PadSpan Live Map", "mdi:map-marker-radius"),
        ("padspan-ha-room-tags", "PadSpan Room Tags", "mdi:tag-multiple"),
        ("padspan-ha-objects", "PadSpan Objects", "mdi:cube-outline"),
        ("padspan-ha-presence", "PadSpan Presence", "mdi:motion-sensor"),
        ("padspan-ha-devices", "PadSpan Devices", "mdi:bluetooth"),
        ("padspan-ha-zones", "PadSpan Zones", "mdi:home-map-marker"),
        ("padspan-ha-insights", "PadSpan Insights", "mdi:chart-line"),
        ("padspan-ha-history", "PadSpan History", "mdi:history"),
        ("padspan-ha-diagnostics", "PadSpan Diagnostics", "mdi:stethoscope"),
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
        await _call_register(
            panel_custom,
            {
                **panel_base_kwargs,
                "frontend_url_path": path,
                "sidebar_title": title,
                "sidebar_icon": icon,
                "config": {
                    "title": title,
                    "icon": f"{STATIC_URL}/padspan-ha/assets/padspan-mark.svg",
                    "logo": f"{STATIC_URL}/padspan-ha/assets/padspan-logo.svg",
                    "view": path,
                },
            },
        )

    hass.data["padspan_ha"]["_panel_registered"] = True
