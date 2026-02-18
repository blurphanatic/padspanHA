from __future__ import annotations

import logging
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN, VERSION, DATA_MAP_STORE

_LOGGER = logging.getLogger(__name__)

@callback
def async_register_websockets(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_status)
    websocket_api.async_register_command(hass, ws_room_tags)
    websocket_api.async_register_command(hass, ws_auto_diagnostics)
    websocket_api.async_register_command(hass, ws_version)
    websocket_api.async_register_command(hass, ws_maps_list)
    websocket_api.async_register_command(hass, ws_maps_get_meta)
    websocket_api.async_register_command(hass, ws_maps_update_meta)

    _LOGGER.debug("PadSpan HA websocket commands registered")

@websocket_api.websocket_command({"type": "padspan_ha/status"})
@websocket_api.async_response
async def ws_status(hass: HomeAssistant, connection, msg) -> None:
    coord = hass.data.get(DOMAIN, {}).get("coordinator")
    entries = []
    if coord:
        entries.append(coord.as_dict())
    connection.send_result(msg["id"], {"entries": entries})

@websocket_api.websocket_command({"type": "padspan_ha/room_tags"})
@websocket_api.async_response
async def ws_room_tags(hass: HomeAssistant, connection, msg) -> None:
    coord = hass.data.get(DOMAIN, {}).get("coordinator")
    room_tag_map = coord.room_tag_map if coord else {}
    connection.send_result(msg["id"], {"room_tag_map": room_tag_map})

@websocket_api.websocket_command({"type": "padspan_ha/auto_diagnostics"})
@websocket_api.async_response
async def ws_auto_diagnostics(hass: HomeAssistant, connection, msg) -> None:
    coord = hass.data.get(DOMAIN, {}).get("coordinator")
    checks = []
    recs = []
    ok = True

    if not coord:
        ok = False
        checks.append({"name": "coordinator", "ok": False, "detail": "Coordinator missing"})
        recs.append("Restart Home Assistant after installing the integration.")
    else:
        checks.append({"name": "coordinator", "ok": True, "detail": "Coordinator present"})
        if not coord.room_tag_map:
            checks.append({"name": "room_tag_map", "ok": False, "detail": "No room/tag data loaded"})
            recs.append("Add/restore your room_tag_map; UI will be sparse without it.")
            ok = False
        else:
            checks.append({"name": "room_tag_map", "ok": True, "detail": f"{len(coord.room_tag_map)} rooms loaded"})
        if coord.last_error:
            checks.append({"name": "last_error", "ok": False, "detail": coord.last_error})
            recs.append("Fix the last_error and re-run diagnostics.")
            ok = False
        else:
            checks.append({"name": "last_error", "ok": True, "detail": "No errors recorded"})
    # Map store checks
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAP_STORE)
    if not ms:
        ok = False
        checks.append({"name": "map_store", "ok": False, "detail": "MapStore not initialized"})
        recs.append("Restart HA after updating the integration so MapStore can initialize.")
    else:
        maps = ms.list_maps()
        checks.append({"name": "map_store", "ok": True, "detail": f"{len(maps)} map(s) loaded"})


    summary = {
        "total": len(checks),
        "passed": sum(1 for c in checks if c["ok"]),
        "failed": sum(1 for c in checks if not c["ok"]),
        "ok": ok,
    }

    connection.send_result(msg["id"], {
        "version": VERSION,
        "summary": summary,
        "checks": checks,
        "recommendations": recs,
    })

@websocket_api.websocket_command({"type": "padspan_ha/version"})
@websocket_api.async_response
async def ws_version(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], {"version": VERSION})

@websocket_api.websocket_command({"type": "padspan_ha/maps_list"})
@websocket_api.async_response
async def ws_maps_list(hass: HomeAssistant, connection, msg) -> None:
    store = hass.data.get(DOMAIN, {}).get(DATA_MAP_STORE)
    maps = store.list_maps() if store else []
    connection.send_result(msg["id"], {"maps": maps})

@websocket_api.websocket_command({"type": "padspan_ha/maps_get_meta", "map_id": str})
@websocket_api.async_response
async def ws_maps_get_meta(hass: HomeAssistant, connection, msg) -> None:
    store = hass.data.get(DOMAIN, {}).get(DATA_MAP_STORE)
    m = store.get_map(msg["map_id"]) if store else None
    if not m:
        connection.send_error(msg["id"], "not_found", "Map not found")
        return
    connection.send_result(msg["id"], {"map": m})

@websocket_api.websocket_command({"type": "padspan_ha/maps_update_meta", "map_id": str, "meta": dict})
@websocket_api.async_response
async def ws_maps_update_meta(hass: HomeAssistant, connection, msg) -> None:
    store = hass.data.get(DOMAIN, {}).get(DATA_MAP_STORE)
    if not store:
        connection.send_error(msg["id"], "store_missing", "MapStore not initialized")
        return
    try:
        m = await store.async_update_meta(msg["map_id"], msg.get("meta") or {})
        connection.send_result(msg["id"], {"map": m})
    except KeyError:
        connection.send_error(msg["id"], "not_found", "Map not found")
    except Exception as err:
        connection.send_error(msg["id"], "bad_request", str(err))
