from __future__ import annotations

"""
REPO LOGIC NOTES

Defines the websocket surface consumed by the panel. This is the preferred integration point because hass.callWS is stable across HA releases.
"""


import logging
from typing import Any
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, State, callback
from homeassistant.helpers import area_registry, device_registry, entity_registry
from homeassistant.util import dt as dt_util

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
    """Best-effort read of REAL data from Home Assistant.

    What we try to discover:
      - receivers/radios (typically Bermuda gateways / BLE receivers)
      - rooms (from Areas + entity registry area assignments)
      - tags (device_tracker/sensor/binary_sensor entities tied to Bermuda or bluetooth-ish)

    We stay defensive and never raise — the panel must keep rendering even if we can't
    find any live data.
    """
    snapshot: dict[str, Any] = {
        "source": "live",
        "generated_at": dt_util.utcnow().isoformat(),
        "rooms_discovered": [],
        "receivers": [],
        "tags": [],
        "room_tag_map": {},
        "raw_counts": {},
    }

    # --- Areas (rooms) ---
    area_by_id: dict[str, str] = {}
    try:
        ar = area_registry.async_get(hass)
        area_by_id = {a.id: a.name for a in ar.async_list_areas()}
        snapshot["rooms_discovered"] = sorted(area_by_id.values())
    except Exception:
        pass

    # --- Find Bermuda config entries (if installed) ---
    bermuda_entry_ids: set[str] = set()
    try:
        for ent in hass.config_entries.async_entries():
            if ent.domain == "bermuda":
                bermuda_entry_ids.add(ent.entry_id)
    except Exception:
        bermuda_entry_ids = set()

    # --- Receivers (devices belonging to Bermuda entries) ---
    try:
        dr = device_registry.async_get(hass)
        receivers: list[dict[str, Any]] = []
        for dev in dr.devices.values():
            if bermuda_entry_ids and any(entry_id in bermuda_entry_ids for entry_id in dev.config_entries):
                receivers.append(
                    {
                        "id": dev.id,
                        "name": dev.name_by_user or dev.name or dev.model or "Receiver",
                        "manufacturer": dev.manufacturer or "",
                        "model": dev.model or "",
                        "sw_version": dev.sw_version or "",
                    }
                )
        snapshot["receivers"] = sorted(receivers, key=lambda d: (d.get("name") or "").lower())
    except Exception:
        snapshot["receivers"] = []

    # --- Tag candidates + mapping ---
    er = entity_registry.async_get(hass)

    def _norm(s: str) -> str:
        return (s or "").strip().casefold()

    known_rooms = {_norm(r): r for r in snapshot.get("rooms_discovered", [])}

    def _room_from_state(entity_id: str, st: State) -> str | None:
        # 1) state string equals a room name
        room = known_rooms.get(_norm(st.state))
        if room:
            return room

        # 2) explicit attribute hints
        for key in ("room", "area", "area_name"):
            v = st.attributes.get(key)
            if isinstance(v, str):
                room = known_rooms.get(_norm(v))
                if room:
                    return room

        # 3) entity registry area assignment
        ent = er.async_get(entity_id)
        if ent and ent.area_id and ent.area_id in area_by_id:
            return area_by_id[ent.area_id]

        # 4) attribute area_id
        aid = st.attributes.get("area_id")
        if isinstance(aid, str) and aid in area_by_id:
            return area_by_id[aid]

        return None

    def _is_candidate(entity_id: str, st: State) -> bool:
        ent = er.async_get(entity_id)
        if ent and ent.config_entry_id in bermuda_entry_ids:
            return True

        dom = entity_id.split(".", 1)[0]
        if dom not in ("device_tracker", "sensor", "binary_sensor"):
            return False

        n = _norm(getattr(st, "name", "") or st.attributes.get("friendly_name", ""))
        eidn = _norm(entity_id)

        # bluetooth-ish heuristics
        return any(k in eidn for k in ("ble", "bluetooth", "bermuda", "tag", "beacon")) or any(
            k in n for k in ("ble", "bluetooth", "bermuda", "tag", "beacon")
        )

    tags: list[dict[str, Any]] = []
    room_tag_map: dict[str, list[str]] = {}

    cand = 0
    mapped = 0

    try:
        for st in hass.states.async_all():
            entity_id = st.entity_id
            if not _is_candidate(entity_id, st):
                continue
            cand += 1

            room = _room_from_state(entity_id, st)
            if not room:
                continue

            tag_label = st.attributes.get("friendly_name") or entity_id.split(".", 1)[-1]
            tags.append(
                {
                    "entity_id": entity_id,
                    "name": str(tag_label),
                    "room": room,
                    "state": st.state,
                }
            )

            room_tag_map.setdefault(room, []).append(entity_id)
            mapped += 1
    except Exception:
        # If anything weird happens, keep the UI alive with whatever we collected.
        pass

    # De-dupe tags by entity_id while keeping first occurrence
    seen = set()
    deduped: list[dict[str, Any]] = []
    for t in tags:
        eid = t.get("entity_id")
        if eid in seen:
            continue
        seen.add(eid)
        deduped.append(t)

    snapshot["tags"] = deduped
    snapshot["room_tag_map"] = room_tag_map
    snapshot["raw_counts"] = {
        "areas": len(snapshot.get("rooms_discovered") or []),
        "receivers": len(snapshot.get("receivers") or []),
        "candidate_entities": cand,
        "mapped_entities": mapped,
    }

    return snapshot

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
