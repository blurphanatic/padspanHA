from __future__ import annotations

import asyncio
from datetime import UTC, datetime
import logging
from pathlib import Path
import re
import shutil
from typing import Any

from aiohttp import web
import voluptuous as vol

from homeassistant.components import panel_custom
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ConfigEntryNotReady, HomeAssistantError
from homeassistant.helpers import config_validation as cv

from .const import (
    ATTR_ACTIVATE,
    ATTR_ENTRY_ID,
    ATTR_LABEL,
    ATTR_MAP_ID,
    ATTR_NAME,
    ATTR_SOURCE_ID,
    ATTR_SOURCE_PATH,
    ATTR_WEIGHT,
    ATTR_X,
    ATTR_Y,
    ATTR_Z,
    CONF_ENABLE_SIDEBAR,
    DATA_COORDINATOR,
    DATA_PANEL_REGISTERED,
    DATA_SERVICES_REGISTERED,
    DATA_STORE,
    DATA_VIEWS_REGISTERED,
    DOMAIN,
    FRONTEND_COMPONENT_NAME,
    FRONTEND_ICON,
    FRONTEND_MODULE_URL_PATH,
    FRONTEND_TITLE,
    FRONTEND_URL_PATH,
    PLATFORMS,
    SERVICE_DELETE_MAP_ANCHOR,
    SERVICE_IMPORT_MAP_IMAGE,
    SERVICE_RELOAD_BLE_CACHE,
    SERVICE_SET_ACTIVE_MAP,
    SERVICE_SET_MAP_ANCHOR,
)
from .coordinator import PadSpanCoordinator
from .map_store import MapStore

_LOGGER = logging.getLogger(__name__)
MAP_ID_RE = re.compile(r"^[a-z0-9_\-]+$")


def _sanitize_map_id(value: str) -> str:
    map_id = value.strip().lower().replace(" ", "_")
    if not MAP_ID_RE.match(map_id):
        raise HomeAssistantError("map_id may only include a-z, 0-9, _ and -")
    return map_id


def _entry_data(hass: HomeAssistant, entry_id: str) -> dict[str, Any]:
    if DOMAIN not in hass.data or entry_id not in hass.data[DOMAIN]:
        raise HomeAssistantError(f"PadSpan entry not loaded: {entry_id}")
    return hass.data[DOMAIN][entry_id]


def _pick_entry_id(hass: HomeAssistant, call_data: dict[str, Any]) -> str:
    if not hass.data.get(DOMAIN):
        raise HomeAssistantError("No PadSpan entries are loaded")
    entry_id = call_data.get(ATTR_ENTRY_ID)
    if entry_id:
        if entry_id not in hass.data[DOMAIN]:
            raise HomeAssistantError(f"Unknown entry_id: {entry_id}")
        return entry_id
    return next(iter(hass.data[DOMAIN].keys()))


def _map_assets_dir(hass: HomeAssistant, entry_id: str) -> Path:
    return Path(hass.config.path("www", DOMAIN, entry_id, "maps"))


async def _async_copy_file(src: Path, dst: Path) -> None:
    await asyncio.to_thread(dst.parent.mkdir, True, True)
    await asyncio.to_thread(shutil.copy2, src, dst)


async def _async_write_bytes(dst: Path, data: bytes) -> None:
    await asyncio.to_thread(dst.parent.mkdir, True, True)
    await asyncio.to_thread(dst.write_bytes, data)


def _entry_payload(entry: ConfigEntry, coordinator: PadSpanCoordinator, store: MapStore) -> dict[str, Any]:
    exported = store.async_export()
    maps = list(exported.get("maps", {}).values())
    maps.sort(key=lambda r: r.get("id", ""))
    return {
        "entry_id": entry.entry_id,
        "title": entry.title,
        "active_map": exported.get("active_map"),
        "maps": maps,
        "anchors": exported.get("anchors", {}),
        "coordinator": coordinator.data or {},
        "sources": sorted((coordinator.data or {}).get("scanner_sources", [])),
        "devices": coordinator.get_device_snapshot(limit=300),
    }


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    hass.data.setdefault(DOMAIN, {})
    await _async_register_views(hass)
    await _async_register_services(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    try:
        store = MapStore(hass, entry.entry_id)
        await store.async_load()
        coordinator = PadSpanCoordinator(hass, entry, store)
        await coordinator.async_config_entry_first_refresh()
    except Exception as err:
        raise ConfigEntryNotReady(f"Unable to setup PadSpan HA: {err}") from err

    hass.data[DOMAIN][entry.entry_id] = {
        DATA_COORDINATOR: coordinator,
        DATA_STORE: store,
    }

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    enable_sidebar = bool(entry.options.get(CONF_ENABLE_SIDEBAR, entry.data.get(CONF_ENABLE_SIDEBAR, True)))
    if enable_sidebar:
        await _async_register_panel(hass)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok and DOMAIN in hass.data:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unload_ok


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def _async_register_panel(hass: HomeAssistant) -> None:
    domain_state = hass.data.setdefault(DOMAIN, {})
    if domain_state.get(DATA_PANEL_REGISTERED):
        return

    integration_dir = Path(__file__).resolve().parent
    frontend_dir = integration_dir / "frontend"
    if not frontend_dir.exists():
        _LOGGER.warning("Frontend directory missing; skipping sidebar panel")
        return

    await hass.http.async_register_static_paths(
        [StaticPathConfig(FRONTEND_MODULE_URL_PATH, str(frontend_dir), cache_headers=False)]
    )

    await panel_custom.async_register_panel(
        hass,
        webcomponent_name=FRONTEND_COMPONENT_NAME,
        frontend_url_path=FRONTEND_URL_PATH,
        module_url=f"{FRONTEND_MODULE_URL_PATH}/padspan-panel.js",
        sidebar_title=FRONTEND_TITLE,
        sidebar_icon=FRONTEND_ICON,
        require_admin=False,
        config={},
    )

    domain_state[DATA_PANEL_REGISTERED] = True


class PadSpanStatusView(HomeAssistantView):
    requires_auth = True
    url = "/api/padspan_ha/status"
    name = "api:padspan_ha:status"

    async def get(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        result = {"generated_at": datetime.now(UTC).isoformat(), "entries": []}
        domain_data = hass.data.get(DOMAIN, {})
        for entry in hass.config_entries.async_entries(DOMAIN):
            if entry.entry_id not in domain_data:
                continue
            data = domain_data[entry.entry_id]
            coordinator: PadSpanCoordinator = data[DATA_COORDINATOR]
            store: MapStore = data[DATA_STORE]
            result["entries"].append(_entry_payload(entry, coordinator, store))
        return web.json_response(result)


class PadSpanUploadMapView(HomeAssistantView):
    requires_auth = True
    url = "/api/padspan_ha/map/upload"
    name = "api:padspan_ha:map_upload"

    async def post(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]

        reader = await request.multipart()
        field = await reader.next()
        if field is None or field.name != "file":
            return web.json_response({"error": "Expected multipart field 'file'"}, status=400)

        data = await field.read(decode=False)

        entry_id = None
        map_id = None
        map_name = None
        activate = True

        while True:
            fld = await reader.next()
            if fld is None:
                break
            val = (await fld.text()).strip()
            if fld.name == ATTR_ENTRY_ID:
                entry_id = val
            elif fld.name == ATTR_MAP_ID:
                map_id = val
            elif fld.name == ATTR_NAME:
                map_name = val
            elif fld.name == ATTR_ACTIVATE:
                activate = val.lower() not in ("0", "false", "no")

        if not map_id:
            return web.json_response({"error": "map_id is required"}, status=400)

        try:
            map_id = _sanitize_map_id(map_id)
            call_data = {ATTR_ENTRY_ID: entry_id} if entry_id else {}
            resolved_entry_id = _pick_entry_id(hass, call_data)
            edata = _entry_data(hass, resolved_entry_id)
            store: MapStore = edata[DATA_STORE]
            coordinator: PadSpanCoordinator = edata[DATA_COORDINATOR]

            ext = ".png"
            if field.filename and "." in field.filename:
                ext = "." + field.filename.split(".")[-1].lower()

            dst_dir = _map_assets_dir(hass, resolved_entry_id)
            dst = dst_dir / f"{map_id}{ext}"
            await _async_write_bytes(dst, data)

            image_url = f"/local/{DOMAIN}/{resolved_entry_id}/maps/{dst.name}"
            await store.async_add_map(map_id, map_name or map_id, image_url)
            if activate:
                await store.async_set_active_map(map_id)
            await coordinator.async_reload_cache()

            return web.json_response(
                {"ok": True, "entry_id": resolved_entry_id, "map_id": map_id, "image_url": image_url}
            )
        except HomeAssistantError as err:
            return web.json_response({"error": str(err)}, status=400)
        except Exception as err:
            _LOGGER.exception("Map upload failed: %s", err)
            return web.json_response({"error": f"Upload failed: {err}"}, status=500)


async def _async_register_views(hass: HomeAssistant) -> None:
    domain_state = hass.data.setdefault(DOMAIN, {})
    if domain_state.get(DATA_VIEWS_REGISTERED):
        return
    hass.http.register_view(PadSpanStatusView)
    hass.http.register_view(PadSpanUploadMapView)
    domain_state[DATA_VIEWS_REGISTERED] = True


SERVICE_IMPORT_MAP_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_ENTRY_ID): cv.string,
        vol.Required(ATTR_MAP_ID): cv.string,
        vol.Required(ATTR_SOURCE_PATH): cv.string,
        vol.Optional(ATTR_NAME): cv.string,
        vol.Optional(ATTR_ACTIVATE, default=True): cv.boolean,
    }
)
SERVICE_SET_ANCHOR_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_ENTRY_ID): cv.string,
        vol.Required(ATTR_MAP_ID): cv.string,
        vol.Required(ATTR_SOURCE_ID): cv.string,
        vol.Required(ATTR_X): vol.Coerce(float),
        vol.Required(ATTR_Y): vol.Coerce(float),
        vol.Optional(ATTR_Z, default=0.0): vol.Coerce(float),
        vol.Optional(ATTR_WEIGHT, default=1.0): vol.Coerce(float),
        vol.Optional(ATTR_LABEL): cv.string,
    }
)
SERVICE_DELETE_ANCHOR_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_ENTRY_ID): cv.string,
        vol.Required(ATTR_MAP_ID): cv.string,
        vol.Required(ATTR_SOURCE_ID): cv.string,
    }
)
SERVICE_SET_ACTIVE_MAP_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_ENTRY_ID): cv.string,
        vol.Required(ATTR_MAP_ID): cv.string,
    }
)
SERVICE_RELOAD_SCHEMA = vol.Schema({vol.Optional(ATTR_ENTRY_ID): cv.string})


async def _async_register_services(hass: HomeAssistant) -> None:
    domain_state = hass.data.setdefault(DOMAIN, {})
    if domain_state.get(DATA_SERVICES_REGISTERED):
        return

    async def _handle_import_map_image(call: ServiceCall) -> None:
        entry_id = _pick_entry_id(hass, call.data)
        map_id = _sanitize_map_id(call.data[ATTR_MAP_ID])
        source_path = call.data[ATTR_SOURCE_PATH]
        name = call.data.get(ATTR_NAME, map_id)
        activate = bool(call.data.get(ATTR_ACTIVATE, True))

        edata = _entry_data(hass, entry_id)
        store: MapStore = edata[DATA_STORE]
        coordinator: PadSpanCoordinator = edata[DATA_COORDINATOR]

        src = Path(source_path)
        if not src.is_absolute():
            src = Path(hass.config.path(source_path))
        if not src.exists() or not src.is_file():
            raise HomeAssistantError(f"source_path not found: {src}")

        ext = src.suffix.lower() if src.suffix else ".png"
        dst = _map_assets_dir(hass, entry_id) / f"{map_id}{ext}"
        await _async_copy_file(src, dst)

        image_url = f"/local/{DOMAIN}/{entry_id}/maps/{dst.name}"
        await store.async_add_map(map_id, name, image_url)
        if activate:
            await store.async_set_active_map(map_id)

        await coordinator.async_reload_cache()

    async def _handle_set_anchor(call: ServiceCall) -> None:
        entry_id = _pick_entry_id(hass, call.data)
        map_id = _sanitize_map_id(call.data[ATTR_MAP_ID])
        source_id = call.data[ATTR_SOURCE_ID].strip()
        x = float(call.data[ATTR_X])
        y = float(call.data[ATTR_Y])
        z = float(call.data.get(ATTR_Z, 0.0))
        weight = float(call.data.get(ATTR_WEIGHT, 1.0))
        label = call.data.get(ATTR_LABEL)

        edata = _entry_data(hass, entry_id)
        store: MapStore = edata[DATA_STORE]
        coordinator: PadSpanCoordinator = edata[DATA_COORDINATOR]

        await store.async_set_anchor(map_id, source_id, x, y, z, weight, label)
        await coordinator.async_reload_cache()

    async def _handle_delete_anchor(call: ServiceCall) -> None:
        entry_id = _pick_entry_id(hass, call.data)
        map_id = _sanitize_map_id(call.data[ATTR_MAP_ID])
        source_id = call.data[ATTR_SOURCE_ID].strip()

        edata = _entry_data(hass, entry_id)
        store: MapStore = edata[DATA_STORE]
        coordinator: PadSpanCoordinator = edata[DATA_COORDINATOR]

        await store.async_delete_anchor(map_id, source_id)
        await coordinator.async_reload_cache()

    async def _handle_set_active_map(call: ServiceCall) -> None:
        entry_id = _pick_entry_id(hass, call.data)
        map_id = _sanitize_map_id(call.data[ATTR_MAP_ID])

        edata = _entry_data(hass, entry_id)
        store: MapStore = edata[DATA_STORE]
        coordinator: PadSpanCoordinator = edata[DATA_COORDINATOR]

        await store.async_set_active_map(map_id)
        await coordinator.async_reload_cache()

    async def _handle_reload_ble_cache(call: ServiceCall) -> None:
        entry_id = _pick_entry_id(hass, call.data)
        edata = _entry_data(hass, entry_id)
        coordinator: PadSpanCoordinator = edata[DATA_COORDINATOR]
        await coordinator.async_reload_cache()

    hass.services.async_register(
        DOMAIN,
        SERVICE_IMPORT_MAP_IMAGE,
        _handle_import_map_image,
        schema=SERVICE_IMPORT_MAP_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_MAP_ANCHOR,
        _handle_set_anchor,
        schema=SERVICE_SET_ANCHOR_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_DELETE_MAP_ANCHOR,
        _handle_delete_anchor,
        schema=SERVICE_DELETE_ANCHOR_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_ACTIVE_MAP,
        _handle_set_active_map,
        schema=SERVICE_SET_ACTIVE_MAP_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_RELOAD_BLE_CACHE,
        _handle_reload_ble_cache,
        schema=SERVICE_RELOAD_SCHEMA,
    )

    domain_state[DATA_SERVICES_REGISTERED] = True
