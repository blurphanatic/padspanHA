# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
REPO LOGIC NOTES

Defines the websocket surface consumed by the panel. This is the preferred integration point because hass.callWS is stable across HA releases.
"""


import logging

import voluptuous as vol
from typing import Any
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, State, callback
from homeassistant.helpers import area_registry, device_registry, entity_registry
from homeassistant.util import dt as dt_util

from .const import DOMAIN, VERSION, DATA_SETTINGS, DATA_MAPS, DATA_MODEL, DATA_OBJECTS, DEFAULT_FLOOR_ID, DATA_COORDINATOR, DATA_CALIBRATION
from .calibration_store import CalibrationStore
from .build_info import BUILD_ID, BUILD_VERSION
from .bluetooth_live import get_bluetooth_live
from .vendor_lookup import async_lookup_vendor
from .private_ble_resolver import get_resolver as _get_ble_resolver

_LOGGER = logging.getLogger(__name__)

@callback
def async_register_websockets(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_status)
    websocket_api.async_register_command(hass, ws_room_tags)
    websocket_api.async_register_command(hass, ws_auto_diagnostics)
    websocket_api.async_register_command(hass, ws_version)
    websocket_api.async_register_command(hass, ws_settings_get)
    websocket_api.async_register_command(hass, ws_settings_set)
    websocket_api.async_register_command(hass, ws_scanner_offset_set)
    websocket_api.async_register_command(hass, ws_live_snapshot)
    websocket_api.async_register_command(hass, ws_vendor_lookup)
    websocket_api.async_register_command(hass, ws_maps_list)
    websocket_api.async_register_command(hass, ws_maps_upload)
    websocket_api.async_register_command(hass, ws_maps_update)
    websocket_api.async_register_command(hass, ws_maps_replace_image)
    websocket_api.async_register_command(hass, ws_maps_delete)
    websocket_api.async_register_command(hass, ws_model_get)
    websocket_api.async_register_command(hass, ws_model_update)
    websocket_api.async_register_command(hass, ws_object_label_set)
    websocket_api.async_register_command(hass, ws_object_label_delete)
    websocket_api.async_register_command(hass, ws_radio_area_set)
    websocket_api.async_register_command(hass, ws_radio_lost_set)
    websocket_api.async_register_command(hass, ws_radio_disabled_set)
    websocket_api.async_register_command(hass, ws_follow_alert_get)
    websocket_api.async_register_command(hass, ws_follow_alert_save)
    websocket_api.async_register_command(hass, ws_area_delete)
    websocket_api.async_register_command(hass, ws_entity_delete)
    websocket_api.async_register_command(hass, ws_room_tag_purge_missing)
    websocket_api.async_register_command(hass, ws_integration_reload)
    websocket_api.async_register_command(hass, ws_calibration_get)
    websocket_api.async_register_command(hass, ws_calibration_save_point)
    websocket_api.async_register_command(hass, ws_calibration_delete_point)
    websocket_api.async_register_command(hass, ws_calibration_clear)
    websocket_api.async_register_command(hass, ws_calibration_compute_model)
    websocket_api.async_register_command(hass, ws_calibration_swap_radio)
    websocket_api.async_register_command(hass, ws_calibration_health_check)
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
    """
    Return the room→object map used by the UI.

    Important behavior:
      - Always prefer the saved/coordinator room_tag_map when it exists (this is the user's curated model).
      - In live mode, also return the best-effort *derived* map from HA Areas/entities for debugging,
        but do not let it collapse the UI to a single room if Areas aren't set up.
    """
    settings = _get_settings(hass)

    coord = hass.data.get(DOMAIN, {}).get("coordinator")
    saved_map = coord.room_tag_map if coord else {}

    if settings.get("data_mode") == "live":
        snap = await _live_snapshot(hass)
        live_map = snap.get("room_tag_map", {}) or {}
        # If the user has a saved map, keep UI stable by using it.
        effective = saved_map if saved_map else live_map
        connection.send_result(
            msg["id"],
            {
                "room_tag_map": effective,
                "room_tag_map_saved": saved_map,
                "room_tag_map_live": live_map,
                "live": True,
                "sources": snap.get("sources", {}) or {},
                "raw_counts": snap.get("raw_counts", {}) or {},
            },
        )
        return

    connection.send_result(msg["id"], {"room_tag_map": saved_map, "live": False})


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


@websocket_api.websocket_command({"type": "padspan_ha/model_get"})
@websocket_api.async_response
async def ws_model_get(hass: HomeAssistant, connection, msg) -> None:
    """Return floors from HA floor registry, areas from HA area registry, and per-room metadata."""
    # --- Floors: prefer HA floor registry (HA 2024.1+), fall back to ModelStore ---
    floors: list[dict[str, Any]] = []
    try:
        from homeassistant.helpers import floor_registry as fr_helper
        fr = fr_helper.async_get(hass)
        floors = [
            {"id": f.floor_id, "name": f.name}
            for f in sorted(fr.async_list_floors(), key=lambda x: (getattr(x, "level", 0) or 0, x.name))
        ]
    except Exception:
        pass
    if not floors:
        mdl_fb = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        floors = mdl_fb.floors() if mdl_fb else [{"id": DEFAULT_FLOOR_ID, "name": "Main Floor"}]

    # --- Areas: from HA area registry ---
    areas: list[dict[str, Any]] = []
    try:
        ar_r = area_registry.async_get(hass)
        areas = [
            {"id": a.id, "name": a.name, "floor_id": getattr(a, "floor_id", None) or DEFAULT_FLOOR_ID}
            for a in sorted(ar_r.async_list_areas(), key=lambda x: x.name)
        ]
    except Exception:
        pass

    # --- Room meta: from ModelStore ---
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    room_meta = mdl.room_meta() if mdl else {}

    connection.send_result(msg["id"], {"floors": floors, "areas": areas, "room_meta": room_meta})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/model_update",
        vol.Optional("floors"): list,  # accepted for schema compat; ignored — floors come from HA
        vol.Optional("room_meta"): dict,
    }
)
@websocket_api.async_response
async def ws_model_update(hass: HomeAssistant, connection, msg) -> None:
    """Update room_meta (color, floor assignment). Floors are read-only from HA floor registry."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model_store", "Model store not initialized")
        return
    updated = await mdl.async_update(room_meta=msg.get("room_meta"))
    connection.send_result(msg["id"], updated)


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
        "room_tag_map_live": {},
        "room_tag_map_missing": {},
        "room_tag_map_saved": {},
        "raw_counts": {},
    }

    # --- Bluetooth (scanners + advertisements) ---
    try:
        bl = get_bluetooth_live(hass)
        if bl is not None:
            # Read configurable BLE advertisement timeout from settings (default 300s)
            _ble_age = 300
            try:
                _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
                _v = ((_st.data if _st else {}).get("ble_max_age_s"))
                if _v is not None:
                    _ble_age = max(30, min(600, int(_v)))
            except Exception:
                pass
            snapshot["ble"] = bl.get_snapshot(max_age_s=_ble_age)
        else:
            snapshot["ble"] = {"radios": [], "advertisements": [], "diag": {"ok": False, "errors": ["no_bluetooth_live"]}}
    except Exception as e:
        snapshot["ble"] = {"radios": [], "advertisements": [], "diag": {"ok": False, "errors": ["ble_snapshot_error"]}}


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

        dom = entity_id.split('.', 1)[0]
        if dom not in ('device_tracker', 'sensor', 'binary_sensor', 'tag', 'text_sensor'):
            return False

        n = _norm(getattr(st, 'name', '') or st.attributes.get('friendly_name', ''))
        eidn = _norm(entity_id)

        # Strong patterns for 'current room/area' entities (Bermuda-style and similar).
        if any(p in eidn for p in ('_area_last_seen', 'area_last_seen', '_room_last_seen', 'room_last_seen', 'nearest_area', 'nearest_room')):
            return True
        if 'last_seen' in eidn and ('area' in eidn or 'room' in eidn):
            return True

        # Attribute hints (many BLE/RTLS integrations expose receiver/rssi fields).
        for k in ('nearest_receiver', 'receiver', 'receivers', 'rssi', 'distance', 'gateway', 'bermuda'):
            if k in (st.attributes or {}):
                return True

        # Bluetooth-ish heuristics (fallback).
        return any(k in eidn for k in ('ble', 'bluetooth', 'bermuda', 'tag', 'beacon')) or any(
            k in n for k in ('ble', 'bluetooth', 'bermuda', 'tag', 'beacon')
        )

    def _looks_like_room_tracker(entity_id: str, st: State) -> bool:
        """Safety net for live mode: accept entities whose id/attrs look like location trackers."""
        eidn = _norm(entity_id)
        if any(p in eidn for p in ('_area_last_seen', 'area_last_seen', '_room_last_seen', 'room_last_seen', 'nearest_area', 'nearest_room')):
            return True
        if 'last_seen' in eidn and ('area' in eidn or 'room' in eidn):
            return True
        for k in ('nearest_receiver', 'receiver', 'receivers', 'rssi', 'distance', 'gateway'):
            if k in (st.attributes or {}):
                return True
        return False

    tags: list[dict[str, Any]] = []
    room_tag_map_live: dict[str, list[str]] = {r: [] for r in (snapshot.get('rooms_discovered') or [])}
    room_tag_map_missing: dict[str, list[str]] = {r: [] for r in (snapshot.get('rooms_discovered') or [])}

    # --- Saved (configured) room→tag map (from coordinator) ---
    # In many setups, you curate your rooms/tags here. We keep this separately
    # from live-discovered tags so 'live' views don't get polluted by placeholders.
    saved_room_tag_map: dict[str, list[str]] = {r: [] for r in (snapshot.get('rooms_discovered') or [])}
    try:
        coord = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
        if coord and getattr(coord, 'room_tag_map', None):
            saved_room_tag_map = {str(k): list(v) for k, v in (coord.room_tag_map or {}).items() if isinstance(v, (list, tuple))}
    except Exception:
        saved_room_tag_map = {}
    def _resolve_saved_entity_id(tag_id: str) -> str:
        """If coordinator uses tag.* placeholders, try to find a real HA entity."""
        if hass.states.get(tag_id):
            return tag_id
        if "." not in tag_id:
            return tag_id
        dom, obj = tag_id.split(".", 1)
        if dom != "tag":
            return tag_id

        # Common Bermuda / presence naming patterns
        guesses = [
            f"sensor.{obj}_area_last_seen",
            f"sensor.{obj}_area",
            f"sensor.{obj}_room",
            f"device_tracker.{obj}",
            f"text_sensor.{obj}_area_last_seen",
            f"text_sensor.{obj}_area",
        ]
        for g in guesses:
            if hass.states.get(g):
                return g

        # Fuzzy fallback: find an entity id containing the object id
        objn = _norm(obj)
        for st in hass.states.async_all():
            eidn = _norm(st.entity_id)
            if objn and objn in eidn and any(k in eidn for k in ("area", "room", "bermuda", "ble", "beacon", "tag")):
                return st.entity_id

        return tag_id

    cand = 0
    mapped = 0

    try:
        for st in hass.states.async_all():
            entity_id = st.entity_id

            # Skip our own derived sensor/tracker entities (area, distance) — they are
            # characteristics of BLE objects already in section B/C of the objects list.
            # Including them would show "Dog Distance" and "Dog Area" as separate "objects".
            try:
                _ent_entry = er.async_get(entity_id)
                if _ent_entry and _ent_entry.platform == DOMAIN:
                    continue
            except Exception:
                pass

            # Determine room/area first (state often contains the room name).
            room = _room_from_state(entity_id, st)
            if not room:
                continue

            # Candidate filter: accept Bermuda (by config_entry), common '*_area_last_seen' patterns, or receiver/rssi hints.
            if not (_is_candidate(entity_id, st) or _looks_like_room_tracker(entity_id, st)):
                continue
            cand += 1

            tag_label = st.attributes.get('friendly_name') or entity_id.split('.', 1)[-1]

            extra: dict[str, Any] = {}
            for k in ('nearest_receiver', 'receiver', 'rssi', 'distance', 'gateway'):
                if k in (st.attributes or {}):
                    extra[k] = st.attributes.get(k)

            tags.append({
                'entity_id': entity_id,
                'name': str(tag_label),
                'room': room,
                'state': st.state,
                **extra,
            })

            room_tag_map_live.setdefault(room, []).append(entity_id)
            mapped += 1
    except Exception:
        # If anything weird happens, keep the UI alive with whatever we collected.
        pass

    # --- Merge in configured tags (even if heuristics didn't find them) ---
    saved_total = 0
    saved_found = 0
    saved_missing = 0
    try:
        for room, ids in (saved_room_tag_map or {}).items():
            if not isinstance(ids, (list, tuple)):
                continue
            for tag_id in ids:
                if not isinstance(tag_id, str):
                    continue
                saved_total += 1
                resolved = _resolve_saved_entity_id(tag_id)
                st = hass.states.get(resolved)
                if st is None:
                    saved_missing += 1
                    tags.append(
                        {
                            "entity_id": resolved,
                            "name": tag_id,
                            "room": room,
                            "state": "unavailable",
                            "missing": True,
                            "source": "saved_map",
                        }
                    )
                    room_tag_map_missing.setdefault(room, []).append(resolved)
                    mapped += 1
                    continue

                saved_found += 1
                label = st.attributes.get("friendly_name") or getattr(st, "name", None) or tag_id
                tags.append(
                    {
                        "entity_id": resolved,
                        "name": str(label),
                        "room": room,
                        "state": st.state,
                        "source": "saved_map",
                    }
                )
                room_tag_map_live.setdefault(room, []).append(resolved)
                mapped += 1
    except Exception:
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
    snapshot["room_tag_map_saved"] = saved_room_tag_map
    snapshot["room_tag_map_missing"] = room_tag_map_missing
    snapshot["room_tag_map_live"] = room_tag_map_live
    snapshot["room_tag_map"] = room_tag_map_live
    snapshot["raw_counts"] = {
        "areas": len(snapshot.get("rooms_discovered") or []),
        "receivers": len(snapshot.get("receivers") or []),
        "candidate_entities": cand,
        "mapped_entities": mapped,
        "saved_entities_total": saved_total if 'saved_total' in locals() else 0,
        "saved_entities_found": saved_found if 'saved_found' in locals() else 0,
        "saved_entities_missing": saved_missing if 'saved_missing' in locals() else 0,
    }


    # NOTE: snapshot["ble"] was already set at the top of this function.
    # Do NOT overwrite it here — a second bl.get_snapshot() call could return
    # empty data if get_bluetooth_live() returns None, wiping all BLE ads.

    # Attach area_name and device_id to radios (best-effort, from HA device_registry)
    try:
        dr_ar = device_registry.async_get(hass)
        ar_reg = area_registry.async_get(hass)
        area_names = {a.id: a.name for a in ar_reg.async_list_areas()}
        # Build name → area and name → device_id lookup from all HA devices
        name_to_area: dict[str, str] = {}
        name_to_dev_id: dict[str, str] = {}
        for dev in dr_ar.devices.values():
            for cand in [dev.name_by_user, dev.name]:
                if not cand:
                    continue
                key = cand.lower()
                name_to_dev_id[key] = dev.id
                if dev.area_id:
                    area = area_names.get(dev.area_id, "")
                    if area:
                        name_to_area[key] = area
        # Match each radio source/name against HA devices
        for radio in ((snapshot.get("ble") or {}).get("radios") or []):
            src = str(radio.get("source") or "").lower()
            rname = str(radio.get("name") or "").lower()
            for key in name_to_dev_id:
                if key and (key in src or src in key or key in rname or rname in key):
                    if not radio.get("device_id"):
                        radio["device_id"] = name_to_dev_id[key]
                    if not radio.get("area_name") and key in name_to_area:
                        radio["area_name"] = name_to_area[key]
                    break
    except Exception:
        pass

    # Mark radios flagged as "lost" or "disabled" in PadSpan settings
    try:
        _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS, None)
        lost_set     = (_st.data.get("lost_radios",     {}) if _st else {})
        disabled_set = (_st.data.get("disabled_radios", {}) if _st else {})
        for radio in ((snapshot.get("ble") or {}).get("radios") or []):
            src = str(radio.get("source") or "")
            if src in lost_set:
                radio["lost"] = True
                radio["lost_since"] = lost_set[src].get("marked_at", "")
            if src in disabled_set:
                radio["disabled"] = True
                radio["disabled_since"] = disabled_set[src].get("marked_at", "")
    except Exception:
        pass

    # ---- Backwards-compatible aliases for the frontend ----
    # Some UI modules (overview, legacy panels) expect these keys.
    if "rooms" not in snapshot:
        snapshot["rooms"] = [{"name": r} for r in (snapshot.get("rooms_discovered") or [])]

    # Preserve the older "receivers" device list under a clearer name too.
    if "bermuda_devices" not in snapshot:
        snapshot["bermuda_devices"] = snapshot.get("receivers") or []

    # --- Derived "objects" list (entities + BLE addresses) ---
    # This is what drives the Overview → Objects / Unidentified modals.
    try:
        dr2 = device_registry.async_get(hass)
        er2 = entity_registry.async_get(hass)

        # Build a quick map of Bluetooth address -> HA device (device_registry)
        addr_to_device: dict[str, dict[str, Any]] = {}
        for dev in dr2.devices.values():
            try:
                for (ctype, cid) in (dev.connections or set()):
                    if str(ctype) == "bluetooth" and isinstance(cid, str):
                        addr_to_device[cid.upper()] = {
                            "device_id": dev.id,
                            "name": dev.name_by_user or dev.name or dev.model or "",
                            "manufacturer": dev.manufacturer or "",
                            "model": dev.model or "",
                        }
            except Exception:
                continue

        # Map Bluetooth address -> tag entities that belong to the same HA device.
        addr_to_entities: dict[str, list[str]] = {}
        for t in (snapshot.get("tags") or []):
            eid = t.get("entity_id")
            if not eid:
                continue
            ent = er2.async_get(eid)
            if not ent or not ent.device_id:
                continue
            dev = dr2.devices.get(ent.device_id)
            if not dev:
                continue
            for (ctype, cid) in (dev.connections or set()):
                if str(ctype) == "bluetooth" and isinstance(cid, str):
                    addr_to_entities.setdefault(cid.upper(), []).append(eid)

        # Deduplicate advertisements by address (HA often reports same address via multiple scanners).
        ads = ((snapshot.get("ble") or {}).get("advertisements") or [])
        ble_by_addr: dict[str, dict[str, Any]] = {}
        for a in ads:
            addr = str(a.get("address") or "").upper()
            if not addr:
                continue
            rec = ble_by_addr.get(addr)
            if not rec:
                rec = {
                    "address": addr,
                    "name": a.get("name") or "",
                    "rssi": a.get("rssi"),
                    "last_seen": a.get("last_seen"),
                    "age_s": a.get("age_s"),
                    "sources": set(),
                    # Extra fields for identification hints (mirrors HA advertisement monitor)
                    "manufacturer_data": a.get("manufacturer_data") or {},
                    "service_data": a.get("service_data") or {},
                    "service_uuids": a.get("service_uuids") or [],
                }
                ble_by_addr[addr] = rec

            src = a.get("source")
            if src:
                rec["sources"].add(str(src))

            # Merge identification hints (keep the richest set we have)
            try:
                md = a.get("manufacturer_data") or {}
                sd = a.get("service_data") or {}
                su = a.get("service_uuids") or []
                if md and (not rec.get("manufacturer_data")):
                    rec["manufacturer_data"] = md
                if sd and (not rec.get("service_data")):
                    rec["service_data"] = sd
                if su and (not rec.get("service_uuids")):
                    rec["service_uuids"] = su
            except Exception:
                pass

            # Keep the most "useful" RSSI (largest / closest to 0).
            try:
                rssi = a.get("rssi")
                if rssi is not None and (rec.get("rssi") is None or rssi > rec.get("rssi")):
                    rec["rssi"] = rssi
            except Exception:
                pass

            # Keep newest last_seen (ISO8601 string; lexicographic compare works for same-format UTC stamps)
            try:
                ls = a.get("last_seen")
                if ls and (not rec.get("last_seen") or str(ls) > str(rec.get("last_seen"))):
                    rec["last_seen"] = ls
            except Exception:
                pass

            # Keep minimum age_s (lower == newer)
            try:
                age = a.get("age_s")
                if isinstance(age, (int, float)):
                    if rec.get("age_s") is None or age < rec.get("age_s"):
                        rec["age_s"] = age
            except Exception:
                pass

        # Count how often each OUI/prefix appears (useful heuristic: repeated prefixes often mean "a bunch of the same device type").
        prefix_counts: dict[str, int] = {}
        for addr in ble_by_addr.keys():
            parts = addr.split(":")
            if len(parts) >= 3:
                pfx = ":".join(parts[:3])
                prefix_counts[pfx] = prefix_counts.get(pfx, 0) + 1

        # --- Private BLE Device / IRK resolution ---
        # Resolve Resolvable Private Addresses (RPAs) from modern phones to canonical
        # identities registered in HA's built-in 'private_ble_device' component.
        # Also parse Apple iBeacon UUIDs from manufacturer data for HA Companion App.
        canonical_by_addr: dict[str, dict[str, Any]] = {}   # addr → {canonical_id, name, kind}
        ibeacon_groups: dict[str, dict[str, Any]] = {}       # "ibeacon:uuid:major:minor" → merged group
        ibeacon_addrs: set[str] = set()                      # MAC addresses absorbed into an iBeacon group
        try:
            resolver = await _get_ble_resolver(hass)
            if resolver.has_devices():
                for addr, rec in ble_by_addr.items():
                    resolved = resolver.resolve_address(addr)
                    if resolved:
                        canonical_by_addr[addr] = resolved
            # Parse iBeacon from every advertisement; group by stable UUID/major/minor key
            for addr, rec in ble_by_addr.items():
                ib = resolver.parse_ibeacon(rec.get("manufacturer_data") or {})
                if ib:
                    uuid_key = f"ibeacon:{ib['uuid']}:{ib['major']}:{ib['minor']}"
                    ibeacon_addrs.add(addr)
                    if uuid_key not in ibeacon_groups:
                        ibeacon_groups[uuid_key] = {
                            "uuid": ib["uuid"],
                            "major": ib["major"],
                            "minor": ib["minor"],
                            "tx_power": ib.get("tx_power"),  # factory-calibrated TX power from iBeacon payload
                            "addrs": set(),
                            "sources": [],
                            "_rssi_list": [],
                        }
                    g = ibeacon_groups[uuid_key]
                    g["addrs"].add(addr)
                    for s in (rec.get("sources") or []):
                        g["sources"].append(s)
                    rssi = rec.get("rssi")
                    if rssi is not None:
                        g["_rssi_list"].append((rssi, rec.get("age_s")))
            # Finalise each group: pick best RSSI, sort addrs, deduplicate sources
            for uuid_key, g in ibeacon_groups.items():
                rssi_list = g.pop("_rssi_list")
                if rssi_list:
                    best = max(rssi_list, key=lambda x: x[0])
                    g["rssi"] = best[0]; g["age_s"] = best[1]
                else:
                    g["rssi"] = None; g["age_s"] = None
                g["addrs"] = sorted(g["addrs"])
                seen_srcs: set[str] = set()
                dedup: list[Any] = []
                for s in g["sources"]:
                    sk = s.get("source") if isinstance(s, dict) else str(s)
                    if sk not in seen_srcs:
                        seen_srcs.add(sk); dedup.append(s)
                g["sources"] = dedup
        except Exception:
            pass

        objects: list[dict[str, Any]] = []

        # (A) Entity-based objects (bermuda tags, device_trackers, etc.)
        for t in (snapshot.get("tags") or []):
            eid = t.get("entity_id") or ""
            addr = ""
            try:
                ent = er2.async_get(eid)
                if ent and ent.device_id:
                    dev = dr2.devices.get(ent.device_id)
                    if dev:
                        for (ctype, cid) in (dev.connections or set()):
                            if str(ctype) == "bluetooth" and isinstance(cid, str):
                                addr = cid.upper()
                                break
            except Exception:
                addr = ""

            prefix = ":".join(addr.split(":")[:3]) if addr else ""
            objects.append({
                "key": f"entity:{eid}",
                "kind": "entity",
                "entity_id": eid,
                "name": t.get("name") or eid,
                "state": t.get("state"),
                "room": t.get("room"),
                "missing": bool(t.get("missing")),
                "address": addr or None,
                "prefix": prefix or None,
                "prefix_count": prefix_counts.get(prefix, 0) if prefix else 0,
                "identified": True,
            })

        # (B) BLE advertisement objects (what HA Bluetooth "Advertisement monitor" shows)
        for addr, rec in ble_by_addr.items():
            if addr in ibeacon_addrs:
                continue  # absorbed into a merged iBeacon group (section C)
            parts = addr.split(":")
            prefix = ":".join(parts[:3]) if len(parts) >= 3 else ""
            identified = (addr in addr_to_device) or (addr in addr_to_entities)

            canonical = canonical_by_addr.get(addr)

            # If this address resolved to a Private BLE Device identity, promote it.
            if canonical:
                identified = True

            obj: dict[str, Any] = {
                "key": f"ble:{addr}",
                "kind": "private_ble" if canonical else "ble",
                "address": addr,
                "name": (canonical or {}).get("name") or rec.get("name") or addr,
                "rssi": rec.get("rssi"),
                "last_seen": rec.get("last_seen"),
                "age_s": rec.get("age_s"),
                "sources": sorted(list(rec.get("sources") or [])),
                "manufacturer_data": rec.get("manufacturer_data") or {},
                "service_data": rec.get("service_data") or {},
                "service_uuids": rec.get("service_uuids") or [],
                "prefix": prefix or None,
                "prefix_count": prefix_counts.get(prefix, 0),
                "identified": bool(identified),
                "linked_entities": sorted(list(set(addr_to_entities.get(addr, [])))),
                "device": addr_to_device.get(addr),
            }
            if canonical:
                obj["canonical_id"]   = canonical["canonical_id"]
                obj["private_ble_name"] = canonical["name"]
            objects.append(obj)

        # (C) iBeacon objects — one per UUID/major/minor key, merged from all rotating MACs
        for uuid_key, g in ibeacon_groups.items():
            all_linked: list[str] = sorted({
                e for a in g["addrs"] for e in addr_to_entities.get(a, [])
            })
            identified_ib = any(a in addr_to_device for a in g["addrs"]) or bool(all_linked)
            obj_ib: dict[str, Any] = {
                "key": uuid_key,
                "kind": "ibeacon",
                "address": uuid_key,           # stable key — used by label store & tagging
                "all_addresses": g["addrs"],   # rotating MACs this beacon was seen from
                "name": f"iBeacon {g['uuid'][:8]}",
                "rssi": g.get("rssi"),
                "age_s": g.get("age_s"),
                "sources": g.get("sources") or [],
                "ibeacon_uuid": g["uuid"],
                "ibeacon_major": g["major"],
                "ibeacon_minor": g["minor"],
                "tx_power": g.get("tx_power"),  # factory TX power dBm at 1m (from iBeacon payload)
                "identified": bool(identified_ib),
                "linked_entities": all_linked,
            }
            objects.append(obj_ib)

        # Attach user labels from ObjectStore (labels make BLE objects "identified")
        try:
            obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
            if obj_store:
                for obj in objects:
                    addr = obj.get("address", "") or ""
                    # private_ble objects are tagged by canonical_id in the UI (not the
                    # rotating MAC address), so try canonical_id first, fall back to MAC.
                    if obj.get("kind") == "private_ble":
                        lookup_key = obj.get("canonical_id") or addr
                    else:
                        lookup_key = addr
                    if not lookup_key:
                        continue
                    entry = obj_store.get(lookup_key)
                    if not entry and lookup_key != addr:
                        entry = obj_store.get(addr)  # fallback to MAC
                    if entry:
                        obj["user_label"] = entry.get("label", "")
                        if obj.get("kind") in ("ble", "ibeacon", "private_ble"):
                            obj["identified"] = True
        except Exception:
            pass

        unidentified = [o for o in objects if o.get("kind") == "ble" and not o.get("identified")]
        identified = [o for o in objects if not (o.get("kind") == "ble" and not o.get("identified"))]
        common_prefixes = {p: c for p, c in prefix_counts.items() if c >= 3}

        snapshot["objects"] = {
            "list": objects,
            "summary": {
                "total": len(objects),
                "identified": len(identified),
                "unidentified": len(unidentified),
                "entities": len([o for o in objects if o.get("kind") == "entity"]),
                "ble": len([o for o in objects if o.get("kind") in ("ble", "private_ble")]),
                "private_ble": len([o for o in objects if o.get("kind") == "private_ble"]),
                "ibeacon": len([o for o in objects if o.get("kind") == "ibeacon"]),
                "common_prefixes": common_prefixes,  # prefix -> count (>=3)
            },
        }
    except Exception:
        snapshot["objects"] = {"list": [], "summary": {"total": 0, "identified": 0, "unidentified": 0, "entities": 0, "ble": 0, "common_prefixes": {}}}

    snapshot["bermuda_devices"] = snapshot.get("receivers") or []

    # Frontend "radios" should reflect actual Bluetooth scanners/adapters (not Bermuda tag devices).
    if "radios" not in snapshot:
        snapshot["radios"] = (snapshot.get("ble") or {}).get("radios") or []

    # --- BLE room assignment ---
    # BLE objects don't get a room from entity state.  Assign it here: the room is
    # the HA area of whichever scanner hears the device with the strongest RSSI.
    try:
        radios = (snapshot.get("ble") or {}).get("radios") or []
        source_to_area: dict[str, str] = {}
        for r in radios:
            src = r.get("source")
            area = r.get("area_name") or r.get("area")
            if src and area:
                source_to_area[str(src)] = str(area)

        if source_to_area:
            ads_raw = (snapshot.get("ble") or {}).get("advertisements") or []
            # Build {addr: {source: rssi}} from raw advertisements
            addr_src_rssi: dict[str, dict[str, float]] = {}
            for ad in ads_raw:
                addr = str(ad.get("address") or "").upper()
                src  = ad.get("source")
                rssi = ad.get("rssi")
                if addr and src and rssi is not None:
                    addr_src_rssi.setdefault(addr, {})[str(src)] = float(rssi)

            # Apply per-scanner RSSI offsets (corrects scanners that read consistently high/low)
            _scanner_offsets: dict[str, float] = {}
            try:
                _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
                _scanner_offsets = ((_st.data if _st else {}).get("scanner_offsets") or {})
                if _scanner_offsets:
                    for _am in addr_src_rssi.values():
                        for _src in _am:
                            _off = _scanner_offsets.get(_src)
                            if _off:
                                _am[_src] = _am[_src] + float(_off)
            except Exception:
                pass
            snapshot["scanner_offsets"] = _scanner_offsets

            objects_list = (snapshot.get("objects") or {}).get("list") or []
            for obj in objects_list:
                if obj.get("room"):
                    continue
                kind = obj.get("kind")
                if kind == "ibeacon":
                    # Merge RSSI from all rotating MACs for this iBeacon group
                    best_rssi_ib: float | None = None
                    best_area_ib: str | None = None
                    for a in (obj.get("all_addresses") or []):
                        for src, rssi in addr_src_rssi.get(str(a).upper(), {}).items():
                            area = source_to_area.get(src)
                            if area and (best_rssi_ib is None or rssi > best_rssi_ib):
                                best_rssi_ib = rssi
                                best_area_ib = area
                    if best_area_ib:
                        obj["room"] = best_area_ib
                elif kind in ("ble", "private_ble"):
                    addr = str(obj.get("address") or "").upper()
                    if not addr:
                        continue
                    src_map = addr_src_rssi.get(addr, {})
                    # Pick source with highest RSSI that has an area mapping
                    best_rssi: float | None = None
                    best_area: str | None = None
                    for src, rssi in src_map.items():
                        area = source_to_area.get(src)
                        if area and (best_rssi is None or rssi > best_rssi):
                            best_rssi = rssi
                            best_area = area
                    if best_area:
                        obj["room"] = best_area
    except Exception:
        pass

    return snapshot

@websocket_api.websocket_command({"type": "padspan_ha/settings_get"})

@websocket_api.async_response
async def ws_settings_get(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], {"settings": _get_settings(hass)})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/settings_set",
        "data_mode": str,
        vol.Optional("vendor_lookup_enabled"): bool,
        vol.Optional("room_change_delay_s"): vol.Coerce(float),
        vol.Optional("away_timeout_m"): vol.Coerce(float),
        vol.Optional("ref_power"): vol.Coerce(float),
        vol.Optional("path_loss_exp"): vol.Coerce(float),
        vol.Optional("kalman_q"): vol.Coerce(float),
        vol.Optional("kalman_r"): vol.Coerce(float),
        vol.Optional("room_sigma_m"): vol.Coerce(float),
        vol.Optional("hidden_map_ids"): list,
        vol.Optional("health_reminder_enabled"): bool,
        vol.Optional("health_reminder_last_ts"): vol.Any(float, int, None),
        vol.Optional("maps_iso_floor_gap"): vol.Coerce(int),
        vol.Optional("maps_iso_horiz_gap"): vol.Coerce(int),
        vol.Optional("maps_iso_focus"): vol.Any(int, None),
        vol.Optional("overview_iso_floor_gap"): vol.Coerce(int),
        vol.Optional("overview_iso_horiz_gap"): vol.Coerce(int),
        vol.Optional("overview_iso_focus"): vol.Any(int, None),
        vol.Optional("lights_hidden"): list,
    }
)
@websocket_api.async_response
async def ws_settings_set(hass: HomeAssistant, connection, msg) -> None:
    mode = (msg.get("data_mode") or "sample").strip().lower()
    if mode not in ("sample", "live"):
        mode = "sample"
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if st:
        payload: dict[str, Any] = {"data_mode": mode}
        if "vendor_lookup_enabled" in msg:
            payload["vendor_lookup_enabled"] = bool(msg.get("vendor_lookup_enabled"))
        if "room_change_delay_s" in msg:
            payload["room_change_delay_s"] = max(0.0, min(300.0, float(msg["room_change_delay_s"])))
        if "away_timeout_m" in msg:
            payload["away_timeout_m"] = max(1.0, min(1440.0, float(msg["away_timeout_m"])))
        if "ref_power" in msg:
            payload["ref_power"] = max(-100.0, min(0.0, float(msg["ref_power"])))
        if "path_loss_exp" in msg:
            payload["path_loss_exp"] = max(1.0, min(4.0, float(msg["path_loss_exp"])))
        if "kalman_q" in msg:
            payload["kalman_q"] = max(0.01, min(1.0, float(msg["kalman_q"])))
        if "kalman_r" in msg:
            payload["kalman_r"] = max(0.5, min(50.0, float(msg["kalman_r"])))
        if "room_sigma_m" in msg:
            payload["room_sigma_m"] = max(1.0, min(20.0, float(msg["room_sigma_m"])))
        if "hidden_map_ids" in msg:
            ids = msg["hidden_map_ids"]
            payload["hidden_map_ids"] = [str(x) for x in ids if isinstance(x, str)] if isinstance(ids, list) else []
        if "health_reminder_enabled" in msg:
            payload["health_reminder_enabled"] = bool(msg["health_reminder_enabled"])
        if "health_reminder_last_ts" in msg:
            ts = msg["health_reminder_last_ts"]
            payload["health_reminder_last_ts"] = float(ts) if ts is not None else None
        if "maps_iso_floor_gap" in msg:
            payload["maps_iso_floor_gap"] = max(60, min(340, int(msg["maps_iso_floor_gap"])))
        if "maps_iso_horiz_gap" in msg:
            payload["maps_iso_horiz_gap"] = max(-120, min(120, int(msg["maps_iso_horiz_gap"])))
        if "maps_iso_focus" in msg:
            v = msg["maps_iso_focus"]
            payload["maps_iso_focus"] = int(v) if v is not None else None
        if "overview_iso_floor_gap" in msg:
            payload["overview_iso_floor_gap"] = max(60, min(340, int(msg["overview_iso_floor_gap"])))
        if "overview_iso_horiz_gap" in msg:
            payload["overview_iso_horiz_gap"] = max(-120, min(120, int(msg["overview_iso_horiz_gap"])))
        if "overview_iso_focus" in msg:
            v = msg["overview_iso_focus"]
            payload["overview_iso_focus"] = int(v) if v is not None else None
        if "lights_hidden" in msg:
            ids = msg["lights_hidden"]
            payload["lights_hidden"] = [str(x) for x in ids if isinstance(x, str)] if isinstance(ids, list) else []
        if "ble_max_age_s" in msg:
            payload["ble_max_age_s"] = max(30, min(600, int(msg["ble_max_age_s"])))
        if "scanner_offsets" in msg:
            raw = msg["scanner_offsets"]
            if isinstance(raw, dict):
                payload["scanner_offsets"] = {str(k): float(v) for k, v in raw.items()}
        await st.async_set(**payload)
    connection.send_result(msg["id"], {"settings": _get_settings(hass)})


@websocket_api.websocket_command({"type": "padspan_ha/calibration_health_check"})
@websocket_api.async_response
async def ws_calibration_health_check(hass: HomeAssistant, connection, msg) -> None:
    """Analyse calibration data quality. Returns scanner anomalies and recommended re-scan spots."""
    from datetime import datetime, timezone as _tz  # noqa: PLC0415

    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    settings: dict[str, Any] = (st.data or {}) if st else {}
    enabled = bool(settings.get("health_reminder_enabled", False))

    cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
    points: list[dict[str, Any]] = (cal.data.get("points") or []) if cal else []

    now_ts = datetime.now(_tz.utc).timestamp()

    # ── Staleness ──────────────────────────────────────────────────────────────
    stale_days: float | None = None
    if points:
        isos = [p.get("collected_at") or "" for p in points]
        latest_iso = max((s for s in isos if s), default="")
        if latest_iso:
            try:
                latest_ts = datetime.fromisoformat(latest_iso).timestamp()
                stale_days = round((now_ts - latest_ts) / 86400)
            except Exception:
                pass

    # ── Per-scanner mean-RSSI anomalies ───────────────────────────────────────
    scanner_sum: dict[str, float] = {}
    scanner_cnt: dict[str, int] = {}
    for p in points:
        for r in (p.get("scanner_readings") or []):
            src = r.get("source")
            mean_rssi = r.get("mean_rssi")
            if src and mean_rssi is not None:
                scanner_sum[src] = scanner_sum.get(src, 0.0) + float(mean_rssi)
                scanner_cnt[src] = scanner_cnt.get(src, 0) + 1

    scanner_anomalies: list[dict[str, Any]] = []
    if scanner_sum:
        means = {s: scanner_sum[s] / scanner_cnt[s] for s in scanner_sum}
        grand_mean = sum(means.values()) / len(means)
        for src, mean in means.items():
            if scanner_cnt[src] < 3:
                continue
            dev = mean - grand_mean
            if abs(dev) > 12:
                direction = "above" if dev > 0 else "below"
                scanner_anomalies.append({
                    "scanner": src,
                    "deviation_db": round(dev, 1),
                    "message": (
                        f"'{src}' reads {abs(dev):.0f} dBm {direction} the fleet average "
                        f"({scanner_cnt[src]} calibration point(s)). "
                        "Consider re-running the walk-around near this scanner."
                    ),
                    "severity": "warning",
                })

    # ── Sparse coverage spots — top 3 least-covered positions per map ─────────
    maps_store = hass.data.get(DOMAIN, {}).get("maps")
    map_ids: list[str] = []
    if maps_store:
        try:
            map_ids = [m["id"] for m in (maps_store.data.get("maps") or [])]
        except Exception:
            pass

    recommended_spots: list[dict[str, Any]] = []
    if cal and map_ids:
        for mid in map_ids:
            cov = cal.compute_coverage(mid)
            if cov["point_count"] == 0:
                continue  # no calibration data for this map yet
            grid = cov["grid"]
            n = cov["grid_n"]
            # Collect cells below 0.8 coverage, sorted worst-first; return up to 3
            cells = sorted(
                ((grid[cy * n + cx], cx, cy) for cy in range(n) for cx in range(n)),
                key=lambda t: t[0],
            )
            count = 0
            for score, cx, cy in cells:
                if score >= 0.8 or count >= 3:
                    break
                recommended_spots.append({
                    "map_id": mid,
                    "x_frac": round((cx + 0.5) / n, 3),
                    "y_frac": round((cy + 0.5) / n, 3),
                    "coverage_score": round(score, 3),
                })
                count += 1

    has_issues = bool(scanner_anomalies) or bool(recommended_spots) or (
        stale_days is not None and stale_days > 60
    )

    connection.send_result(msg["id"], {
        "enabled": enabled,
        "point_count": len(points),
        "stale_days": stale_days,
        "scanner_anomalies": scanner_anomalies,
        "recommended_spots": recommended_spots,
        "has_issues": has_issues,
    })


@websocket_api.websocket_command({"type": "padspan_ha/live_snapshot"})
@websocket_api.async_response
async def ws_live_snapshot(hass: HomeAssistant, connection, msg) -> None:
    snap = await _live_snapshot(hass)
    connection.send_result(msg["id"], {"snapshot": snap})


@websocket_api.websocket_command({
    "type": "padspan_ha/scanner_offset_set",
    "source": str,
    vol.Optional("offset_db", default=0.0): vol.Coerce(float),
})
@websocket_api.async_response
async def ws_scanner_offset_set(hass: HomeAssistant, connection, msg) -> None:
    """Set (or clear) the RSSI calibration offset for a single Bluetooth scanner."""
    source = str(msg.get("source", "")).strip()
    if not source:
        connection.send_error(msg["id"], "invalid_source", "source required")
        return
    offset = float(msg.get("offset_db", 0.0))
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if st:
        offsets: dict[str, float] = dict(st.data.get("scanner_offsets") or {})
        if offset == 0.0:
            offsets.pop(source, None)   # zero = no offset, clean up
        else:
            offsets[source] = round(offset, 1)
        await st.async_set(scanner_offsets=offsets)
    connection.send_result(msg["id"], {"source": source, "offset_db": offset})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/vendor_lookup",
        "mac": str,
        vol.Optional("force_refresh"): bool,
    }
)
@websocket_api.async_response
async def ws_vendor_lookup(hass: HomeAssistant, connection, msg) -> None:
    """Vendor lookup for a MAC address.

    Used by the Overview → Objects/Unidentified modal.
    """
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    enabled = True
    try:
        if st:
            enabled = bool(st.get("vendor_lookup_enabled", True))
    except Exception:
        enabled = True

    if not enabled:
        connection.send_result(msg["id"], {"enabled": False})
        return

    mac = msg.get("mac") or ""
    force = bool(msg.get("force_refresh", False))
    res = await async_lookup_vendor(hass, mac, force_refresh=force)
    res["enabled"] = True
    connection.send_result(msg["id"], res)


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
        vol.Optional("floor_id"): str,
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
        msg.get("floor_id") or DEFAULT_FLOOR_ID,
    )
    connection.send_result(msg["id"], {"map": info})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/maps_update",
        "map_id": str,
        "receivers": list,
        "calibration": dict,
        "notes": str,
        vol.Optional("floor_id"): str,
        vol.Optional("room_bounds"): dict,
        vol.Optional("stack"): dict,
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
            floor_id=msg.get("floor_id"),
            room_bounds=msg.get("room_bounds"),
            stack=msg.get("stack"),
        )
    except KeyError:
        connection.send_error(msg["id"], "not_found", "Map not found")
        return
    connection.send_result(msg["id"], {"map": updated})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/maps_replace_image",
        "map_id": str,
        "width": int,
        "height": int,
        "png_base64": str,
        vol.Optional("crop"): dict,   # {fx0, fy0, fx1, fy1} in 0-1 image fractions
    }
)
@websocket_api.async_response
async def ws_maps_replace_image(hass: HomeAssistant, connection, msg) -> None:
    """Replace the stored PNG for an existing map and renormalize coordinates."""
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_error(msg["id"], "no_maps_store", "Maps store not initialized")
        return
    try:
        updated = await ms.async_replace_image(
            msg.get("map_id") or "",
            msg.get("png_base64") or "",
            msg.get("width") or 0,
            msg.get("height") or 0,
            msg.get("crop"),
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


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/object_label_set",
        "address": str,
        "label": str,
    }
)
@websocket_api.async_response
async def ws_object_label_set(hass: HomeAssistant, connection, msg) -> None:
    """Assign a user label to a BLE MAC address."""
    obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
    if not obj_store:
        connection.send_error(msg["id"], "no_object_store", "Object store not initialized")
        return
    addr = str(msg.get("address") or "").strip().upper()
    label = str(msg.get("label") or "").strip()
    if not addr:
        connection.send_error(msg["id"], "invalid_address", "Address is required")
        return
    if not label:
        connection.send_error(msg["id"], "invalid_label", "Label is required")
        return
    await obj_store.async_set(addr, label)
    connection.send_result(msg["id"], {"ok": True, "address": addr, "label": label})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/object_label_delete",
        "address": str,
    }
)
@websocket_api.async_response
async def ws_object_label_delete(hass: HomeAssistant, connection, msg) -> None:
    """Remove the user label for a BLE MAC address."""
    obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
    if not obj_store:
        connection.send_error(msg["id"], "no_object_store", "Object store not initialized")
        return
    addr = str(msg.get("address") or "").strip().upper()
    if addr:
        await obj_store.async_delete(addr)
    connection.send_result(msg["id"], {"ok": True, "address": addr})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/radio_area_set",
        vol.Optional("device_id"): str,
        vol.Optional("source"): str,
        vol.Optional("area_name"): str,
    }
)
@websocket_api.async_response
async def ws_radio_area_set(hass: HomeAssistant, connection, msg) -> None:
    """Assign a BLE radio/scanner to an HA area (updates HA device registry). area_name='' to clear."""
    dev_id = (msg.get("device_id") or "").strip()
    source = (msg.get("source") or "").strip()
    area_name = (msg.get("area_name") or "").strip()

    # Resolve device_id from source string if not provided directly
    if not dev_id and source:
        try:
            dr_r = device_registry.async_get(hass)
            src_l = source.lower()
            for dev in dr_r.devices.values():
                for nm in [dev.name_by_user, dev.name]:
                    if nm and (nm.lower() in src_l or src_l in nm.lower()):
                        dev_id = dev.id
                        break
                if dev_id:
                    break
        except Exception:
            pass

    if not dev_id:
        connection.send_error(msg["id"], "device_not_found", "Could not find HA device for this radio source")
        return

    # Resolve area_id from area_name (blank → clear area assignment)
    area_id: str | None = None
    if area_name:
        try:
            ar_r = area_registry.async_get(hass)
            for a in ar_r.async_list_areas():
                if a.name.casefold() == area_name.casefold():
                    area_id = a.id
                    break
        except Exception:
            pass
        if not area_id:
            connection.send_error(msg["id"], "area_not_found", f"Area '{area_name}' not found in HA area registry")
            return

    try:
        dr_u = device_registry.async_get(hass)
        dr_u.async_update_device(dev_id, area_id=area_id)
        connection.send_result(msg["id"], {"ok": True, "device_id": dev_id, "area_id": area_id, "area_name": area_name or None})
    except Exception as e:
        connection.send_error(msg["id"], "update_failed", str(e))


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/radio_lost_set",
        "source": str,
        "lost": bool,
    }
)
@websocket_api.async_response
async def ws_radio_lost_set(hass: HomeAssistant, connection, msg) -> None:
    """Mark or unmark a BLE radio as 'lost' (excluded from location math)."""
    source = str(msg.get("source") or "").strip()
    lost = bool(msg.get("lost", True))
    if not source:
        connection.send_error(msg["id"], "invalid_source", "source is required")
        return
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        connection.send_error(msg["id"], "no_settings", "Settings store not initialized")
        return
    lost_radios = dict(st.data.get("lost_radios", {}))
    if lost:
        lost_radios[source] = {"marked_at": dt_util.utcnow().isoformat()}
    else:
        lost_radios.pop(source, None)
    await st.async_set(lost_radios=lost_radios)
    connection.send_result(msg["id"], {"ok": True, "source": source, "lost": lost})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/radio_disabled_set",
        "source": str,
        "disabled": bool,
    }
)
@websocket_api.async_response
async def ws_radio_disabled_set(hass: HomeAssistant, connection, msg) -> None:
    """Mark or unmark a BLE radio as 'disabled' (intentionally excluded from location math)."""
    source = str(msg.get("source") or "").strip()
    disabled = bool(msg.get("disabled", True))
    if not source:
        connection.send_error(msg["id"], "invalid_source", "source is required")
        return
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        connection.send_error(msg["id"], "no_settings", "Settings store not initialized")
        return
    disabled_radios = dict(st.data.get("disabled_radios", {}))
    if disabled:
        disabled_radios[source] = {"marked_at": dt_util.utcnow().isoformat()}
    else:
        disabled_radios.pop(source, None)
    await st.async_set(disabled_radios=disabled_radios)
    connection.send_result(msg["id"], {"ok": True, "source": source, "disabled": disabled})


@websocket_api.websocket_command({"type": "padspan_ha/follow_alert_get"})
@websocket_api.async_response
async def ws_follow_alert_get(hass: HomeAssistant, connection, msg) -> None:
    """Return all saved follow-alert configurations."""
    from .const import DATA_ALERTS
    alert_store = hass.data.get(DOMAIN, {}).get(DATA_ALERTS)
    configs = alert_store.all() if alert_store else {}
    connection.send_result(msg["id"], {"configs": configs})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/follow_alert_save",
        vol.Optional("addr"): str,
        vol.Optional("config"): dict,
    }
)
@websocket_api.async_response
async def ws_follow_alert_save(hass: HomeAssistant, connection, msg) -> None:
    """Save follow/alert configuration for a tracked object.

    Persists to AlertStore so configs survive HA restarts.
    """
    addr = str(msg.get("addr") or "").strip()
    config = msg.get("config") or {}
    # Persist to AlertStore (disk-backed)
    from .const import DATA_ALERTS
    alert_store = hass.data.get(DOMAIN, {}).get(DATA_ALERTS)
    if alert_store:
        await alert_store.async_save_config(addr, config)
    else:
        # Fallback: session-only (shouldn't happen if stores loaded)
        hass.data.setdefault(DOMAIN, {}).setdefault("follow_alerts", {})[addr] = config
    _LOGGER.debug("PadSpan HA follow_alert_save: addr=%s config=%s", addr, config)
    connection.send_result(msg["id"], {"ok": True, "addr": addr})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/area_delete",
        "area_id": str,
    }
)
@websocket_api.async_response
async def ws_area_delete(hass: HomeAssistant, connection, msg) -> None:
    """Delete an HA area and clean up PadSpan room_meta."""
    area_id = (msg.get("area_id") or "").strip()
    if not area_id:
        connection.send_error(msg["id"], "invalid_area_id", "area_id required")
        return
    ar = area_registry.async_get(hass)
    area = ar.async_get_area(area_id)
    if not area:
        connection.send_error(msg["id"], "not_found", "Area not found")
        return
    area_name = area.name
    ar.async_delete(area_id)
    # Clean up PadSpan room_meta for this area name
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if mdl:
        try:
            room_meta = mdl.room_meta() or {}
            if area_name in room_meta:
                updated_meta = {k: v for k, v in room_meta.items() if k != area_name}
                await mdl.async_update(room_meta=updated_meta)
        except Exception:
            pass
    connection.send_result(msg["id"], {"deleted": area_id, "name": area_name})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/entity_delete",
        "entity_id": str,
    }
)
@websocket_api.async_response
async def ws_entity_delete(hass: HomeAssistant, connection, msg) -> None:
    """Remove an entity from the HA entity registry."""
    entity_id = (msg.get("entity_id") or "").strip()
    if not entity_id:
        connection.send_error(msg["id"], "invalid_entity_id", "entity_id required")
        return
    er = entity_registry.async_get(hass)
    entry = er.async_get(entity_id)
    if not entry:
        connection.send_error(msg["id"], "not_found", f"Entity '{entity_id}' not found in registry")
        return
    er.async_remove(entity_id)
    connection.send_result(msg["id"], {"deleted": entity_id})


@websocket_api.websocket_command({"type": "padspan_ha/room_tag_purge_missing"})
@websocket_api.async_response
async def ws_room_tag_purge_missing(hass: HomeAssistant, connection, msg) -> None:
    """Remove entity_ids from room_tag_map that have no current HA state (phantom/sample entities)."""
    coord = hass.data.get(DOMAIN, {}).get("coordinator")
    if not coord:
        connection.send_result(msg["id"], {"removed": 0, "rooms": 0})
        return
    removed = 0
    new_map: dict = {}
    for room, ids in (coord.room_tag_map or {}).items():
        valid = [eid for eid in (ids or []) if hass.states.get(str(eid)) is not None]
        removed += len(ids or []) - len(valid)
        if valid:
            new_map[room] = valid
    coord.room_tag_map = new_map
    connection.send_result(msg["id"], {"removed": removed, "rooms": len(new_map)})


@websocket_api.websocket_command({"type": "padspan_ha/integration_reload"})
@websocket_api.async_response
async def ws_integration_reload(hass: HomeAssistant, connection, msg) -> None:
    """Reload the PadSpan HA config entry."""
    reloaded = 0
    for entry in hass.config_entries.async_entries(DOMAIN):
        try:
            await hass.config_entries.async_reload(entry.entry_id)
            reloaded += 1
        except Exception as e:
            _LOGGER.warning("PadSpan HA reload failed for %s: %s", entry.entry_id, e)
    connection.send_result(msg["id"], {"ok": True, "reloaded": reloaded})


# ── Calibration WebSocket Handlers ────────────────────────────────────────────

async def _get_cal_store(hass: HomeAssistant) -> CalibrationStore:
    """Lazily initialize and return the CalibrationStore."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if DATA_CALIBRATION not in domain_data:
        store = CalibrationStore(hass)
        await store.async_setup()
        domain_data[DATA_CALIBRATION] = store
    return domain_data[DATA_CALIBRATION]


@websocket_api.websocket_command({"type": "padspan_ha/calibration_get"})
@websocket_api.async_response
async def ws_calibration_get(hass: HomeAssistant, connection, msg) -> None:
    """Return all calibration points and the cached model stats."""
    cal = await _get_cal_store(hass)
    connection.send_result(msg["id"], {
        "points": cal.list_points(),
        "model": cal.data.get("model") or {},
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/calibration_save_point",
        vol.Required("point"): dict,
    }
)
@websocket_api.async_response
async def ws_calibration_save_point(hass: HomeAssistant, connection, msg) -> None:
    """Save one calibration point (position + per-scanner RSSI readings)."""
    cal = await _get_cal_store(hass)
    try:
        saved = await cal.async_add_point(msg["point"])
        connection.send_result(msg["id"], {"ok": True, "point": saved})
    except Exception as e:
        connection.send_error(msg["id"], "save_failed", str(e))


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/calibration_delete_point",
        "point_id": str,
    }
)
@websocket_api.async_response
async def ws_calibration_delete_point(hass: HomeAssistant, connection, msg) -> None:
    """Delete a single calibration point by ID."""
    cal = await _get_cal_store(hass)
    point_id = (msg.get("point_id") or "").strip()
    if not point_id:
        connection.send_error(msg["id"], "invalid_id", "point_id required")
        return
    deleted = await cal.async_delete_point(point_id)
    connection.send_result(msg["id"], {"ok": deleted, "point_id": point_id})


@websocket_api.websocket_command({"type": "padspan_ha/calibration_clear"})
@websocket_api.async_response
async def ws_calibration_clear(hass: HomeAssistant, connection, msg) -> None:
    """Delete all calibration points and reset the model."""
    cal = await _get_cal_store(hass)
    count = await cal.async_clear_all()
    connection.send_result(msg["id"], {"ok": True, "deleted": count})


@websocket_api.websocket_command({"type": "padspan_ha/calibration_compute_model"})
@websocket_api.async_response
async def ws_calibration_compute_model(hass: HomeAssistant, connection, msg) -> None:
    """
    Trigger full model computation: coverage grids, path-loss fits (if scanner
    positions available from MapsStore), and LOO cross-validation accuracy.
    """
    cal = await _get_cal_store(hass)
    maps_store = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    maps_data = maps_store.list_maps() if maps_store else None
    try:
        model = cal.compute_model(maps_data=maps_data)
        await cal.store.async_save(cal.data)
        connection.send_result(msg["id"], {"ok": True, "model": model})
    except Exception as e:
        _LOGGER.error("PadSpan HA calibration_compute_model failed: %s", e)
        connection.send_error(msg["id"], "compute_failed", str(e))


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/calibration_swap_radio",
        vol.Required("old_source"): str,
        vol.Required("new_source"): str,
    }
)
@websocket_api.async_response
async def ws_calibration_swap_radio(hass: HomeAssistant, connection, msg) -> None:
    """Replace every occurrence of old_source with new_source in calibration data.

    Useful when a physical scanner is replaced — all fingerprint readings recorded
    under the old source ID are re-attributed to the new source ID.
    """
    old_source = str(msg.get("old_source") or "").strip()
    new_source = str(msg.get("new_source") or "").strip()

    if not old_source or not new_source:
        connection.send_error(msg["id"], "invalid", "old_source and new_source are required")
        return
    if old_source == new_source:
        connection.send_error(msg["id"], "invalid", "old_source and new_source must be different")
        return

    cal = await _get_cal_store(hass)
    updated_readings = 0

    for pt in cal.data.get("points", []):
        for sr in pt.get("scanner_readings", []):
            if sr.get("source") == old_source:
                sr["source"] = new_source
                updated_readings += 1

    # Re-key model sub-dicts that are keyed by source
    model = cal.data.get("model", {})
    for section in ("path_loss", "scanner_stats"):
        sec = model.get(section, {})
        if old_source in sec:
            sec[new_source] = sec.pop(old_source)

    await cal.store.async_save(cal.data)
    connection.send_result(msg["id"], {
        "ok": True,
        "old_source": old_source,
        "new_source": new_source,
        "updated_readings": updated_readings,
    })