from __future__ import annotations

"""
REPO LOGIC NOTES

Defines the websocket surface consumed by the panel. This is the preferred integration point because hass.callWS is stable across HA releases.
"""


import logging
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import area_registry, device_registry, entity_registry

from .const import DOMAIN, VERSION, DATA_SETTINGS, DATA_MAPS
from .build_info import BUILD_ID, BUILD_VERSION

_LOGGER = logging.getLogger(__name__)

@callback
def async_register_websockets(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_status)
    websocket_api.async_register_command(hass, ws_room_tags)
    websocket_api.async_register_command(hass, ws_auto_diagnostics)
    websocket_api.async_register_command(hass, ws_version)
    websocket_api.async_register_command(hass, ws_settings_get)
    websocket_api.async_register_command(hass, ws_settings_set)
    websocket_api.async_register_command(hass, ws_live_snapshot)
    websocket_api.async_register_command(hass, ws_maps_list)
    websocket_api.async_register_command(hass, ws_maps_upload)
    websocket_api.async_register_command(hass, ws_maps_update)
    websocket_api.async_register_command(hass, ws_maps_delete)
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
    settings = _get_settings(hass)
    if settings.get("data_mode") == "live":
        snap = await _live_snapshot(hass)
        connection.send_result(msg["id"], {"room_tag_map": snap.get("room_tag_map", {}), "live": True, "sources": snap.get("sources", {})})
        return

    coord = hass.data.get(DOMAIN, {}).get("coordinator")
    room_tag_map = coord.room_tag_map if coord else {}
    connection.send_result(msg["id"], {"room_tag_map": room_tag_map, "live": False})

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
    connection.send_result(msg["id"], {"version": VERSION, "build_version": BUILD_VERSION, "build_id": BUILD_ID})


@callback
def _get_settings(hass: HomeAssistant) -> dict:
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if st:
        return dict(st.data)
    return {"data_mode": "sample"}

async def _live_snapshot(hass: HomeAssistant) -> dict:
    """Best-effort live discovery of rooms, radios, and tags.

    Strategy (industry-style "progressive enhancement"):
      1) Prefer Bermuda when present (it is receiver-centric and already maintains tag->area info).
      2) Fall back to generic HA registries and state heuristics (never crash if Bermuda isn't installed).
      3) Always return a structured snapshot so the UI can render even with partial data.

    IMPORTANT: We do not assume a specific Bermuda entity naming scheme; we look at:
      - config entry ownership (entity_registry.config_entry_id)
      - current entity state matching an HA Area name
      - device metadata (names containing proxy/receiver/ble/bluetooth)
    """
    ar = area_registry.async_get(hass)
    dr = device_registry.async_get(hass)
    er = entity_registry.async_get(hass)

    # Rooms (areas)
    rooms: list[dict] = []
    area_name_by_id: dict[str, str] = {}
    for a in ar.async_list_areas():
        rooms.append({"id": a.id, "name": a.name})
        area_name_by_id[a.id] = a.name
    room_names = set(r["name"] for r in rooms)

    # Bermuda config entries (if installed)
    bermuda_entry_ids: set[str] = set()
    try:
        for ce in hass.config_entries.async_entries("bermuda"):
            bermuda_entry_ids.add(ce.entry_id)
    except Exception:
        bermuda_entry_ids = set()

    # Radios: Bermuda-owned devices first; else proxy-ish devices by heuristic
    radios: list[dict] = []
    seen_radio_ids: set[str] = set()

    # Bermuda devices
    if bermuda_entry_ids:
        for eid in bermuda_entry_ids:
            for dev in dr.async_entries_for_config_entry(eid):
                if dev.id in seen_radio_ids:
                    continue
                seen_radio_ids.add(dev.id)
                name = (dev.name_by_user or dev.name or dev.id).strip()
                radios.append({
                    "id": dev.id,
                    "name": name,
                    "model": (dev.model or "").strip(),
                    "manufacturer": (dev.manufacturer or "").strip(),
                    "area": area_name_by_id.get(dev.area_id) if dev.area_id else None,
                    "source": "bermuda",
                })

    # Heuristic devices (ESPHOME proxies, BLE receivers)
    for dev in dr.devices.values():
        if dev.id in seen_radio_ids:
            continue
        name = (dev.name_by_user or dev.name or "").strip()
        model = (dev.model or "").strip()
        mfg = (dev.manufacturer or "").strip()
        area = area_name_by_id.get(dev.area_id) if dev.area_id else None
        hay = f"{name} {model} {mfg}".lower()
        is_proxyish = any(k in hay for k in ["proxy", "bluetooth", "ble", "receiver", "scanner", "bermuda"])
        if is_proxyish:
            seen_radio_ids.add(dev.id)
            radios.append({
                "id": dev.id,
                "name": name or dev.id,
                "model": model,
                "manufacturer": mfg,
                "area": area,
                "source": "heuristic",
            })

    # Tags: entities whose state matches a room name
    tags: list[dict] = []
    room_tag_map: dict[str, list[str]] = {}

    def add(room: str, tag_id: str):
        room_tag_map.setdefault(room, [])
        if tag_id not in room_tag_map[room]:
            room_tag_map[room].append(tag_id)

    # Determine Bermuda entities by ownership (most reliable)
    bermuda_entities: set[str] = set()
    if bermuda_entry_ids:
        for ent in er.entities.values():
            if ent.config_entry_id in bermuda_entry_ids:
                bermuda_entities.add(ent.entity_id)

    # Walk current states (fast; no IO)
    for st in hass.states.async_all():
        eid = st.entity_id
        dom = eid.split(".", 1)[0]
        s = (st.state or "").strip()
        if s in ("unknown", "unavailable", ""):
            continue
        if s not in room_names:
            continue

        # Identify likely "tag presence" publishers
        is_bermuda = eid in bermuda_entities
        fname = str(st.attributes.get("friendly_name", "")).lower()
        looks_like_tag = (
            dom in ("device_tracker", "sensor", "binary_sensor")
            and any(k in (eid.lower() + " " + fname) for k in ["tag", "tracker", "ble", "beacon", "phone", "keys", "wallet"])
        )

        if is_bermuda or looks_like_tag:
            tag_id = eid  # keep REAL entity_id for live mode
            add(s, tag_id)
            tags.append({
                "id": tag_id,
                "entity_id": eid,
                "room": s,
                "friendly_name": st.attributes.get("friendly_name"),
                "source": "bermuda" if is_bermuda else "heuristic",
            })

    # Stable sorting
    for r in list(room_tag_map.keys()):
        room_tag_map[r] = sorted(room_tag_map[r])
    radios = sorted(radios, key=lambda x: ((x.get("area") or ""), (x.get("name") or "")))
    rooms = sorted(rooms, key=lambda x: x["name"].lower())
    tags = sorted(tags, key=lambda x: ((x.get("room") or ""), (x.get("id") or "")))

    return {
        "rooms": rooms,
        "radios": radios,
        "tags": tags,
        "room_tag_map": room_tag_map,
        "sources": {
            "areas": len(rooms),
            "radios": len(radios),
            "tags": len(tags),
            "bermuda_entry_ids": len(bermuda_entry_ids),
            "bermuda_entities_seen": len(bermuda_entities),
        },
    }


@websocket_api.websocket_command({"type": "padspan_ha/settings_get"})

@websocket_api.async_response
async def ws_settings_get(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], {"settings": _get_settings(hass)})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/settings_set",
        "data_mode": str,
    }
)
@websocket_api.async_response
async def ws_settings_set(hass: HomeAssistant, connection, msg) -> None:
    mode = (msg.get("data_mode") or "sample").strip().lower()
    if mode not in ("sample", "live"):
        mode = "sample"
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if st:
        await st.async_set(data_mode=mode)
    connection.send_result(msg["id"], {"settings": _get_settings(hass)})


@websocket_api.websocket_command({"type": "padspan_ha/live_snapshot"})
@websocket_api.async_response
async def ws_live_snapshot(hass: HomeAssistant, connection, msg) -> None:
    snap = await _live_snapshot(hass)
    connection.send_result(msg["id"], {"snapshot": snap})


@websocket_api.websocket_command({"type": "padspan_ha/maps_list"})
@websocket_api.async_response
async def ws_maps_list(hass: HomeAssistant, connection, msg) -> None:
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    maps = ms.list_maps() if ms else []
    connection.send_result(msg["id"], {"maps": maps})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/maps_upload",
        "name": str,
        "filename": str,
        "mime": str,
        "width": int,
        "height": int,
        "png_base64": str,
    }
)
@websocket_api.async_response
async def ws_maps_upload(hass: HomeAssistant, connection, msg) -> None:
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_error(msg["id"], "no_maps_store", "Maps store not initialized")
        return
    info = await ms.async_add_map(
        msg.get("name") or "Untitled Map",
        msg.get("filename") or "map",
        msg.get("mime") or "image/*",
        msg.get("width") or 0,
        msg.get("height") or 0,
        msg.get("png_base64") or "",
    )
    connection.send_result(msg["id"], {"map": info})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/maps_update",
        "map_id": str,
        "receivers": list,
        "calibration": dict,
        "notes": str,
    }
)
@websocket_api.async_response
async def ws_maps_update(hass: HomeAssistant, connection, msg) -> None:
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_error(msg["id"], "no_maps_store", "Maps store not initialized")
        return
    map_id = msg.get("map_id")
    try:
        updated = await ms.async_update_map(
            map_id,
            receivers=msg.get("receivers"),
            calibration=msg.get("calibration"),
            notes=msg.get("notes"),
        )
    except KeyError:
        connection.send_error(msg["id"], "not_found", "Map not found")
        return
    connection.send_result(msg["id"], {"map": updated})


@websocket_api.websocket_command({"type": "padspan_ha/maps_delete", "map_id": str})
@websocket_api.async_response
async def ws_maps_delete(hass: HomeAssistant, connection, msg) -> None:
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_error(msg["id"], "no_maps_store", "Maps store not initialized")
        return
    await ms.async_delete_map(msg.get("map_id"))
    connection.send_result(msg["id"], {"ok": True})
