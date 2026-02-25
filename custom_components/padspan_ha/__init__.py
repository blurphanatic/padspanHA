from __future__ import annotations

"""
REPO LOGIC NOTES

Entry point. Initializes coordinator + persistent stores, registers websocket API, and
registers a SINGLE HA panel (internal navigation happens inside the panel).

Key rule: NEVER "revert" features by accident. Treat the repo as additive — only remove
features when the user explicitly requests it.
"""

import logging
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers.typing import ConfigType

from .build_info import BUILD_ID, BUILD_VERSION
from .const import (
    DOMAIN,
    CONF_ENABLE_CLOUD,
    CONF_HUB_URL,
    CONF_API_KEY,
    CONF_SCAN_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
    DATA_SETTINGS,
    DATA_MAPS,
    DATA_MODEL,
    DATA_OBJECTS,
)
from .coordinator import PadSpanCoordinator
from .maps_store import MapsStore
from .model_store import ModelStore
from .object_store import ObjectStore
from .panel import async_setup_panel
from .presence_coordinator import PresenceCoordinator
from .settings_store import SettingsStore
from .websocket import async_register_websockets

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[str] = ["sensor", "binary_sensor", "device_tracker"]

SERVICE_SET_MAP = "set_room_tag_map"
SERVICE_SCHEMA = vol.Schema({vol.Required("room_tag_map"): dict})


async def _ensure_stores(hass: HomeAssistant) -> None:
    """Create/load persistent stores exactly once per HA runtime."""
    hass.data.setdefault(DOMAIN, {})

    if DATA_SETTINGS not in hass.data[DOMAIN]:
        st = SettingsStore(hass)
        await st.async_load()
        hass.data[DOMAIN][DATA_SETTINGS] = st
        _LOGGER.debug("SettingsStore ready")

    if DATA_MAPS not in hass.data[DOMAIN]:
        ms = MapsStore(hass)
        await ms.async_setup()
        hass.data[DOMAIN][DATA_MAPS] = ms
        _LOGGER.debug("MapsStore ready (%s)", ms.maps_dir)

    if DATA_MODEL not in hass.data[DOMAIN]:
        mdl = ModelStore(hass)
        await mdl.async_setup()
        hass.data[DOMAIN][DATA_MODEL] = mdl
        _LOGGER.debug("ModelStore ready (%d floors, %d rooms)", len(mdl.floors()), len(mdl.room_meta()))

    if DATA_OBJECTS not in hass.data[DOMAIN]:
        obj_store = ObjectStore(hass)
        await obj_store.async_load()
        hass.data[DOMAIN][DATA_OBJECTS] = obj_store
        _LOGGER.debug("ObjectStore ready (%d labels)", len(obj_store.all()))


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    hass.data.setdefault(DOMAIN, {})

    _LOGGER.info("PadSpan HA starting v%s (build %s)", BUILD_VERSION, BUILD_ID)

    # Persistent stores used by panel + websocket API
    try:
        await _ensure_stores(hass)
    except Exception as err:  # defensive: do not break HA startup
        _LOGGER.exception("Store init failed: %s", err)

    # Websockets for the panel (must be registered even if entry isn't created yet)
    try:
        async_register_websockets(hass)
    except Exception as err:
        _LOGGER.exception("Websocket registration failed: %s", err)

    # Panel (single sidebar entry)
    try:
        await async_setup_panel(hass)
    except Exception as err:
        _LOGGER.exception("Panel registration failed: %s", err)

    # Live Bluetooth feed (scanners + advertisements)
    try:
        from .bluetooth_live import async_setup_bluetooth_live
        await async_setup_bluetooth_live(hass)
    except Exception as err:
        _LOGGER.debug("Bluetooth live setup skipped: %s", err)

    async def _set_map(call: ServiceCall) -> None:
        coord: PadSpanCoordinator | None = hass.data.get(DOMAIN, {}).get("coordinator")
        if not coord:
            coord = PadSpanCoordinator()
            hass.data[DOMAIN]["coordinator"] = coord
        coord.room_tag_map = call.data.get("room_tag_map") or {}
        coord.mark_success()
        _LOGGER.info("room_tag_map replaced via service (%d rooms)", len(coord.room_tag_map))

    hass.services.async_register(DOMAIN, SERVICE_SET_MAP, _set_map, schema=SERVICE_SCHEMA)

    async def _dump_devices(call: ServiceCall) -> dict | None:
        """Return all tracked BLE devices — equivalent to Bermuda's dump_devices."""
        presence_coord = hass.data.get(DOMAIN, {}).get("presence_coordinator")
        data: dict[str, Any] = dict((presence_coord.data or {}) if presence_coord else {})

        from homeassistant.util import dt as dt_util  # noqa: PLC0415

        result = {
            "devices": data,
            "count": len(data),
            "version": BUILD_VERSION,
            "timestamp": dt_util.utcnow().isoformat(),
        }

        # Also create a persistent notification for easy human inspection
        try:
            from homeassistant.components.persistent_notification import async_create  # noqa: PLC0415
            lines = []
            for key, obj in data.items():
                if obj.get("user_label") or obj.get("kind") == "entity":
                    name = obj.get("user_label") or obj.get("name") or key
                    room = obj.get("room") or "unknown"
                    kind = obj.get("kind") or "?"
                    age = obj.get("age_s")
                    age_str = f"{round(age)}s ago" if isinstance(age, (int, float)) else ""
                    lines.append(f"- **{name}** → {room} ({kind}) {age_str}".strip())
            summary = "\n".join(lines) or "No identified devices tracked yet."
            async_create(
                hass,
                f"**PadSpan HA — {len(data)} device(s)** (v{BUILD_VERSION})\n\n{summary}",
                title="padspan_ha.dump_devices",
                notification_id="padspan_ha_dump_devices",
            )
        except Exception:
            pass

        return result

    # Register dump_devices with response support (HA 2023.7+)
    try:
        from homeassistant.core import SupportsResponse  # noqa: PLC0415
        hass.services.async_register(
            DOMAIN, "dump_devices", _dump_devices,
            schema=vol.Schema({vol.Optional("notify", default=True): bool}),
            supports_response=SupportsResponse.OPTIONAL,
        )
    except ImportError:
        hass.services.async_register(
            DOMAIN, "dump_devices", _dump_devices,
            schema=vol.Schema({vol.Optional("notify", default=True): bool}),
        )

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})

    # Ensure stores are present (reload-safe)
    try:
        await _ensure_stores(hass)
    except Exception as err:
        _LOGGER.exception("Store init failed during setup_entry: %s", err)

    coord: PadSpanCoordinator | None = hass.data[DOMAIN].get("coordinator")
    if coord is None:
        coord = PadSpanCoordinator()
        hass.data[DOMAIN]["coordinator"] = coord

    coord.enable_cloud = bool(entry.data.get(CONF_ENABLE_CLOUD, False))
    coord.hub_url = str(entry.data.get(CONF_HUB_URL, ""))
    coord.api_key = str(entry.data.get(CONF_API_KEY, ""))
    coord.scan_interval = int(entry.options.get(CONF_SCAN_INTERVAL, entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)))
    coord.ensure_defaults()

    # Ensure room metadata exists for all rooms
    try:
        mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        if mdl:
            await mdl.async_ensure_rooms(list(coord.room_tag_map.keys()))
    except Exception as err:
        _LOGGER.exception("ModelStore room ensure failed: %s", err)

    coord.mark_success()

    # Create and start the presence coordinator (drives sensor + device_tracker entities)
    presence_coord: PresenceCoordinator = hass.data[DOMAIN].get("presence_coordinator")  # type: ignore[assignment]
    if presence_coord is None:
        presence_coord = PresenceCoordinator(hass)
        hass.data[DOMAIN]["presence_coordinator"] = presence_coord
    # Attempt first refresh; if it fails (e.g. BLE not yet ready) entities will appear
    # on the next successful poll cycle (every 10 s) — not a fatal error.
    try:
        await presence_coord.async_config_entry_first_refresh()
    except Exception as err:
        _LOGGER.debug("Presence coordinator initial fetch deferred: %s", err)

    # Forward platforms (safe even if they don't create entities yet)
    try:
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    except Exception as err:
        _LOGGER.exception("Forward entry setups failed: %s", err)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = True
    try:
        unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    except Exception:
        unload_ok = True

    # Stop presence coordinator
    try:
        hass.data.get(DOMAIN, {}).pop("presence_coordinator", None)
    except Exception:
        pass

    # Stop BLE callbacks/cache
    try:
        from .bluetooth_live import get_bluetooth_live, DATA_KEY
        bl = get_bluetooth_live(hass)
        if bl:
            bl.unload()
        hass.data.get(DOMAIN, {}).pop(DATA_KEY, None)
    except Exception:
        pass

    return unload_ok
