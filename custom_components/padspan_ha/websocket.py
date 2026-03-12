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

from .const import (
    DOMAIN, VERSION, DATA_SETTINGS, DATA_MAPS, DATA_MODEL, DATA_OBJECTS,
    DATA_OBJECTS_CACHE, DATA_OBJECT_HISTORY, OBJECT_HISTORY_STORE_KEY,
    DEFAULT_FLOOR_ID, OUTSIDE_FLOOR_ID, DATA_COORDINATOR, DATA_CALIBRATION, DATA_ADAPTIVE,
    DATA_ALERTS, DATA_MOVEMENT, BACKUPS_STORE_KEY,
    SETTINGS_STORE_KEY, CALIBRATION_STORE_KEY, ADAPTIVE_STORE_KEY,
    OBJECT_STORE_KEY, MAPS_STORE_KEY, MODEL_STORE_KEY,
    ALERTS_STORE_KEY, MOVEMENT_STORE_KEY,
    DATA_TRACEBACK, TRACEBACK_STORE_KEY,
)
from .calibration_store import CalibrationStore
from .build_info import BUILD_ID, BUILD_VERSION
from .bluetooth_live import get_bluetooth_live
from .vendor_lookup import async_lookup_vendor
from .private_ble_resolver import get_resolver as _get_ble_resolver
from .ble_enrichment import enrich_object as _enrich_ble_object

_LOGGER = logging.getLogger(__name__)

# ── In-memory ring buffer for PadSpan logs ────────────────────────────────────
# Captures WARNING+ from all padspan_ha loggers so the UI can show them.
_LOG_BUFFER_SIZE = 500

class _RingLogHandler(logging.Handler):
    """Captures log records into a bounded list for UI display."""
    def __init__(self, maxlen: int = _LOG_BUFFER_SIZE) -> None:
        super().__init__(level=logging.DEBUG)
        self._maxlen = maxlen
        self.records: list[dict[str, Any]] = []

    def emit(self, record: logging.LogRecord) -> None:
        entry = {
            "ts": record.created,
            "level": record.levelname,
            "logger": record.name.replace("custom_components.padspan_ha.", ""),
            "message": self.format(record),
        }
        self.records.append(entry)
        if len(self.records) > self._maxlen:
            self.records = self.records[-self._maxlen:]

_log_handler: _RingLogHandler | None = None

def _ensure_log_handler() -> _RingLogHandler:
    global _log_handler
    if _log_handler is None:
        _log_handler = _RingLogHandler()
        _log_handler.setFormatter(logging.Formatter("%(message)s"))
        # Attach to the padspan_ha root logger to capture all sub-modules
        root = logging.getLogger("custom_components.padspan_ha")
        root.addHandler(_log_handler)
    return _log_handler


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
    websocket_api.async_register_command(hass, ws_maps_delete_migrate)
    websocket_api.async_register_command(hass, ws_maps_revert_extend)
    websocket_api.async_register_command(hass, ws_model_get)
    websocket_api.async_register_command(hass, ws_model_update)
    websocket_api.async_register_command(hass, ws_object_label_set)
    websocket_api.async_register_command(hass, ws_object_label_delete)
    websocket_api.async_register_command(hass, ws_object_label_list)
    websocket_api.async_register_command(hass, ws_radio_area_set)
    websocket_api.async_register_command(hass, ws_radio_lost_set)
    websocket_api.async_register_command(hass, ws_radio_disabled_set)
    websocket_api.async_register_command(hass, ws_radio_reset)
    websocket_api.async_register_command(hass, ws_follow_alert_get)
    websocket_api.async_register_command(hass, ws_follow_alert_save)
    websocket_api.async_register_command(hass, ws_follow_alert_delete)
    websocket_api.async_register_command(hass, ws_area_delete)
    websocket_api.async_register_command(hass, ws_entity_delete)
    websocket_api.async_register_command(hass, ws_room_tag_purge_missing)
    websocket_api.async_register_command(hass, ws_integration_reload)
    websocket_api.async_register_command(hass, ws_calibration_get)
    websocket_api.async_register_command(hass, ws_calibration_save_point)
    websocket_api.async_register_command(hass, ws_calibration_delete_point)
    websocket_api.async_register_command(hass, ws_calibration_clear)
    websocket_api.async_register_command(hass, ws_calibration_clear_map)
    websocket_api.async_register_command(hass, ws_object_evict)
    websocket_api.async_register_command(hass, ws_calibration_compute_model)
    websocket_api.async_register_command(hass, ws_calibration_swap_radio)
    websocket_api.async_register_command(hass, ws_calibration_health_check)
    websocket_api.async_register_command(hass, ws_movement_history_get)
    websocket_api.async_register_command(hass, ws_traceback_get)
    websocket_api.async_register_command(hass, ws_traceback_objects)
    websocket_api.async_register_command(hass, ws_notify_services_list)
    websocket_api.async_register_command(hass, ws_notify_test)
    websocket_api.async_register_command(hass, ws_adaptive_status_get)
    websocket_api.async_register_command(hass, ws_adaptive_reset)
    websocket_api.async_register_command(hass, ws_propagation_health)
    websocket_api.async_register_command(hass, ws_store_backup_create)
    websocket_api.async_register_command(hass, ws_store_backup_list)
    websocket_api.async_register_command(hass, ws_store_backup_restore)
    websocket_api.async_register_command(hass, ws_store_backup_delete)
    websocket_api.async_register_command(hass, ws_beacon_positions_get)
    websocket_api.async_register_command(hass, ws_ha_entities_audit)
    websocket_api.async_register_command(hass, ws_logs_get)
    websocket_api.async_register_command(hass, ws_private_ble_status)
    websocket_api.async_register_command(hass, ws_private_ble_add_irk)
    websocket_api.async_register_command(hass, ws_private_ble_delete_irk)
    websocket_api.async_register_command(hass, ws_objects_clear_history)
    websocket_api.async_register_command(hass, ws_companion_discover)
    websocket_api.async_register_command(hass, ws_companion_follow)
    websocket_api.async_register_command(hass, ws_companion_unfollow)
    websocket_api.async_register_command(hass, ws_tags_status)
    websocket_api.async_register_command(hass, ws_factory_reset)
    _ensure_log_handler()
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
            # Read configurable BLE advertisement timeout from settings (default 3600s / 1 hour)
            _ble_age = 14400
            try:
                _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
                _v = ((_st.data if _st else {}).get("ble_max_age_s"))
                if _v is not None:
                    _ble_age = max(60, min(14400, int(_v)))
            except Exception:
                pass
            snapshot["ble"] = bl.get_snapshot(max_ads=5000, max_age_s=_ble_age)
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
    _bermuda_ignore = False
    try:
        _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if _st and _st.get("bermuda_ignore"):
            _bermuda_ignore = True
    except Exception:
        pass
    # Always discover Bermuda entry IDs (needed for both include and exclude logic)
    _all_bermuda_entry_ids: set[str] = set()
    try:
        for ent in hass.config_entries.async_entries():
            if ent.domain == "bermuda":
                _all_bermuda_entry_ids.add(ent.entry_id)
    except Exception:
        pass
    if not _bermuda_ignore:
        bermuda_entry_ids = set(_all_bermuda_entry_ids)

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
        # When bermuda_ignore is on, reject any entity from a Bermuda config entry
        if _bermuda_ignore and ent and ent.config_entry_id in _all_bermuda_entry_ids:
            return False
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
            for k in ('nearest_receiver', 'receiver', 'rssi', 'distance', 'gateway',
                       'mac_address', 'address', 'mac', 'scanner', 'scanners'):
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

    # Attach network info (IP, WiFi SSID) from entity states for each radio's device
    try:
        import re as _re
        er_net = entity_registry.async_get(hass)

        # Strategy 1: device_id based lookup (most reliable when device_id is set)
        dev_entities: dict[str, list] = {}
        for ent in er_net.entities.values():
            if ent.device_id:
                dev_entities.setdefault(ent.device_id, []).append(ent)

        # Strategy 2: entity slug prefix lookup (works even without device_id)
        # ESPHome entities follow the pattern: sensor.<slug>_ip_address, etc.
        # Build a map from slug prefix → list of entity entries
        # Radio name "Office Proxy" → slug "office_proxy"
        def _name_to_slug(name: str) -> str:
            return _re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")

        def _find_net_entities(radio: dict) -> list:
            """Find network-related entities for a radio via device_id or name/source slug."""
            candidates: list = []
            # Try device_id first
            did = radio.get("device_id")
            if did and did in dev_entities:
                candidates = dev_entities[did]
            # Fallback: search by entity slug prefix matching radio name or source
            if not candidates:
                slugs_to_try = set()
                rname = radio.get("name") or ""
                rsource = radio.get("source") or ""
                if rname:
                    slugs_to_try.add(_name_to_slug(rname))
                if rsource:
                    slugs_to_try.add(_name_to_slug(rsource))
                for slug in slugs_to_try:
                    if slug and len(slug) >= 3:
                        prefix_sensor = f"sensor.{slug}_"
                        prefix_text = f"text_sensor.{slug}_"
                        for ent in er_net.entities.values():
                            eid = ent.entity_id or ""
                            if eid.startswith(prefix_sensor) or eid.startswith(prefix_text):
                                candidates.append(ent)
                    if candidates:
                        break
            return candidates

        def _apply_net_info(radio: dict, entities: list) -> None:
            for ent in entities:
                eid = ent.entity_id or ""
                eid_lower = eid.lower()
                st = hass.states.get(eid)
                if not st or st.state in ("unknown", "unavailable", ""):
                    continue
                val = st.state
                # IP address sensor
                if not radio.get("ip") and ("ip_address" in eid_lower or eid_lower.endswith("_ip")):
                    radio["ip"] = val
                # WiFi SSID sensor
                elif not radio.get("ssid") and ("ssid" in eid_lower):
                    radio["ssid"] = val
                # WiFi signal strength
                elif not radio.get("wifi_signal") and ("wifi_signal" in eid_lower or "signal_strength" in eid_lower):
                    try:
                        radio["wifi_signal"] = int(float(val))
                    except (ValueError, TypeError):
                        pass
                # Connection type (wired/wireless)
                elif not radio.get("connection_type") and ("connection_type" in eid_lower or "network_type" in eid_lower):
                    radio["connection_type"] = val

        for radio in ((snapshot.get("ble") or {}).get("radios") or []):
            ents = _find_net_entities(radio)
            if ents:
                _apply_net_info(radio, ents)
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
                    "sources": {},  # source_name → {"rssi": ..., "age_s": ...}
                    "connectable": a.get("connectable"),
                    # Extra fields for identification hints (mirrors HA advertisement monitor)
                    "manufacturer_data": a.get("manufacturer_data") or {},
                    "service_data": a.get("service_data") or {},
                    "service_uuids": a.get("service_uuids") or [],
                }
                ble_by_addr[addr] = rec

            src = a.get("source")
            if src:
                src_key = str(src)
                a_rssi = a.get("rssi")
                a_age = a.get("age_s")
                prev = rec["sources"].get(src_key)
                if prev is None or (a_rssi is not None and (prev.get("rssi") is None or a_rssi > prev["rssi"])):
                    rec["sources"][src_key] = {"rssi": a_rssi, "age_s": a_age}

            # Merge identification hints (keep the richest set we have)
            try:
                # Name: prefer a real name over the MAC address
                ad_name = a.get("name") or ""
                cur_name = rec.get("name") or ""
                if ad_name and ad_name != addr and (not cur_name or cur_name == addr):
                    rec["name"] = ad_name

                md = a.get("manufacturer_data") or {}
                sd = a.get("service_data") or {}
                su = a.get("service_uuids") or []
                # Merge (not replace) so multi-protocol devices keep all data
                # e.g. same MAC broadcasting iBeacon + Eddystone
                if md:
                    rec.setdefault("manufacturer_data", {}).update(md)
                if sd:
                    rec.setdefault("service_data", {}).update(sd)
                if su:
                    existing = rec.setdefault("service_uuids", [])
                    for _u in su:
                        if _u not in existing:
                            existing.append(_u)
                # Connectable: prefer True over None
                ac = a.get("connectable")
                if ac is True or rec.get("connectable") is None:
                    rec["connectable"] = ac
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
        _resolver_diag: dict[str, Any] = {"irk_devices": 0, "resolved": 0, "ibeacon_groups": 0, "rpa_count": 0, "errors": []}
        try:
            resolver = await _get_ble_resolver(hass)
            _resolver_diag["irk_devices"] = resolver.device_count
            _resolver_diag["rpa_count"] = resolver.count_rpas(ble_by_addr.keys())
            if resolver.has_devices():
                for addr, rec in ble_by_addr.items():
                    resolved = resolver.resolve_address(addr)
                    if resolved:
                        canonical_by_addr[addr] = resolved
                _resolver_diag["resolved"] = len(canonical_by_addr)
        except Exception as _res_err:
            _resolver_diag["errors"].append(f"resolver: {_res_err}")
            _LOGGER.warning("Private BLE resolver error: %s", _res_err)

        # Parse iBeacon from every advertisement; group by stable UUID/major/minor key.
        # This is deliberately OUTSIDE the resolver try/except so iBeacon detection
        # never gets silently skipped if the private BLE resolver has issues.
        # IMPORTANT: MACs that resolve to a private_ble device (via IRK) are NOT
        # absorbed into iBeacon groups — the IRK identity is authoritative.  The
        # iBeacon metadata (UUID/major/minor) is attached to the private_ble object
        # later instead.  This prevents the phone from existing as two separate
        # objects (one iBeacon, one private_ble) and getting "lost" on MAC rotation.
        _ibeacon_meta_for_private: dict[str, dict[str, Any]] = {}  # canonical_id → iBeacon info
        try:
            _ib_resolver = await _get_ble_resolver(hass)
            for addr, rec in ble_by_addr.items():
                ib = _ib_resolver.parse_ibeacon(rec.get("manufacturer_data") or {})
                if ib:
                    # If this MAC also resolves to a private_ble device, DON'T absorb
                    # it into the iBeacon group — let private_ble grouping handle it.
                    canonical = canonical_by_addr.get(addr)
                    if canonical:
                        cid = canonical["canonical_id"]
                        _ibeacon_meta_for_private[cid] = ib
                        continue
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
                    for src_key, src_info in (rec.get("sources") or {}).items():
                        g["sources"].append({"source": src_key, **(src_info if isinstance(src_info, dict) else {})})
                    rssi = rec.get("rssi")
                    if rssi is not None:
                        g["_rssi_list"].append((rssi, rec.get("age_s")))
            # Finalise each group: pick best RSSI, sort addrs, deduplicate sources
            # Split groups where multiple MACs are simultaneously active (separate
            # physical devices sharing factory-default UUID:major:minor, e.g. CP27).
            _split_groups: dict[str, dict] = {}
            for uuid_key, g in list(ibeacon_groups.items()):
                rssi_list = g.pop("_rssi_list")
                if rssi_list:
                    best = max(rssi_list, key=lambda x: x[0])
                    g["rssi"] = best[0]; g["age_s"] = best[1]
                else:
                    g["rssi"] = None; g["age_s"] = None
                g["addrs"] = sorted(g["addrs"])
                dedup_map: dict[str, dict] = {}
                for s in g["sources"]:
                    sk = s.get("source") if isinstance(s, dict) else str(s)
                    prev = dedup_map.get(sk)
                    s_rssi = s.get("rssi") if isinstance(s, dict) else None
                    if prev is None or (s_rssi is not None and (prev.get("rssi") is None or s_rssi > prev["rssi"])):
                        dedup_map[sk] = s if isinstance(s, dict) else {"source": sk}
                g["sources"] = sorted(dedup_map.values(), key=lambda x: x.get("source", ""))

                # Detect simultaneous MACs → split into per-MAC objects.
                # If multiple MACs are all recently seen (age < 60s), they are
                # distinct physical devices, not MAC rotation on a single device.
                if len(g["addrs"]) > 1:
                    recent_macs = [
                        a for a in g["addrs"]
                        if (ble_by_addr.get(a, {}).get("age_s") or 9999) < 60
                    ]
                    if len(recent_macs) > 1:
                        # Multiple distinct devices — split each MAC into its own object
                        for idx, mac in enumerate(recent_macs):
                            rec = ble_by_addr.get(mac, {})
                            split_key = f"{uuid_key}:{mac}"
                            # Use the sources from this specific MAC's advertisement
                            mac_src_dict = rec.get("sources") or {}
                            mac_sources = [{"source": k, **(v if isinstance(v, dict) else {})} for k, v in mac_src_dict.items()]
                            _split_groups[split_key] = {
                                "uuid": g["uuid"],
                                "major": g["major"],
                                "minor": g["minor"],
                                "tx_power": g.get("tx_power"),
                                "addrs": [mac],
                                "sources": mac_sources,
                                "rssi": rec.get("rssi"),
                                "age_s": rec.get("age_s"),
                                "_split_from": uuid_key,
                            }
                        # Also keep stale MACs (age >= 60s) in the original group
                        stale = [a for a in g["addrs"] if a not in recent_macs]
                        if stale:
                            g["addrs"] = stale
                        else:
                            # All MACs split out — remove original group
                            del ibeacon_groups[uuid_key]
                        continue
            # Merge split groups into main dict
            ibeacon_groups.update(_split_groups)
            _resolver_diag["ibeacon_groups"] = len(ibeacon_groups)
        except Exception as _ib_err:
            _resolver_diag["errors"].append(f"ibeacon: {_ib_err}")

        # (B) BLE advertisement objects (what HA Bluetooth "Advertisement monitor" shows)
        # Group private_ble addresses by canonical_id so rotating MACs merge
        # into ONE object per physical device (like iBeacon merging above).
        # NOTE: _private_groups MUST be initialized before section A because
        # section A references it to link entity objects to private_ble devices.
        _private_groups: dict[str, dict[str, Any]] = {}  # canonical_id → merged info
        for addr, rec in ble_by_addr.items():
            if addr in ibeacon_addrs:
                continue  # absorbed into a merged iBeacon group (section C)
            canonical = canonical_by_addr.get(addr)
            if canonical:
                cid = canonical["canonical_id"]
                if cid not in _private_groups:
                    _private_groups[cid] = {
                        "canonical": canonical,
                        "addrs": [],
                        "all_sources": {},  # source_name → {"rssi": ..., "age_s": ...}
                        "all_linked": set(),
                        "best_rssi": -999,
                        "best_rec": rec,
                        "best_addr": addr,
                        "freshest_age": None,   # minimum age_s across all rotating MACs
                        "freshest_rec": None,    # record with the freshest observation
                        "device": None,
                        "manufacturer_data": {},
                        "service_data": {},
                        "service_uuids": [],
                    }
                pg = _private_groups[cid]
                pg["addrs"].append(addr)
                # Per-source merge: prefer the FRESHEST (lowest age_s) reading
                # per scanner source across all rotating MACs — not the strongest
                # RSSI, which may come from a stale MAC the phone stopped using.
                for src_key, src_info in (rec.get("sources") or {}).items():
                    prev = pg["all_sources"].get(src_key)
                    si = src_info if isinstance(src_info, dict) else {"rssi": None, "age_s": None}
                    if prev is None:
                        pg["all_sources"][src_key] = si
                    else:
                        s_age = si.get("age_s")
                        p_age = prev.get("age_s")
                        # Prefer lower age (fresher); fall back to stronger RSSI if ages equal/missing
                        if s_age is not None and (p_age is None or s_age < p_age):
                            pg["all_sources"][src_key] = si
                        elif s_age == p_age:
                            s_rssi = si.get("rssi")
                            if s_rssi is not None and (prev.get("rssi") is None or s_rssi > prev["rssi"]):
                                pg["all_sources"][src_key] = si
                for e in addr_to_entities.get(addr, []):
                    pg["all_linked"].add(e)
                # Track best RSSI for address/signal display
                rssi = rec.get("rssi")
                if rssi is not None and rssi > pg["best_rssi"]:
                    pg["best_rssi"] = rssi
                    pg["best_rec"] = rec
                    pg["best_addr"] = addr
                # Track freshest record (minimum age_s) for last_seen/age reporting.
                # This is the critical fix: a phone's newest rotating MAC has age≈0
                # even if an older MAC with stronger RSSI has age>>0.
                age = rec.get("age_s")
                if age is not None and (pg["freshest_age"] is None or age < pg["freshest_age"]):
                    pg["freshest_age"] = age
                    pg["freshest_rec"] = rec
                if not pg["device"] and addr in addr_to_device:
                    pg["device"] = addr_to_device[addr]
                # Merge BLE metadata
                pg["manufacturer_data"].update(rec.get("manufacturer_data") or {})
                pg["service_data"].update(rec.get("service_data") or {})
                for u in (rec.get("service_uuids") or []):
                    if u not in pg["service_uuids"]:
                        pg["service_uuids"].append(u)

        objects: list[dict[str, Any]] = []

        # (A) Entity-based objects (bermuda tags, device_trackers, etc.)
        _MAC_RE = __import__("re").compile(r"^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")
        for t in (snapshot.get("tags") or []):
            eid = t.get("entity_id") or ""
            addr = ""
            all_addrs: list[str] = []
            canonical_id = ""
            try:
                ent = er2.async_get(eid)
                if ent and ent.device_id:
                    dev = dr2.devices.get(ent.device_id)
                    if dev:
                        # 1) Check device connections for a static BLE MAC
                        for (ctype, cid) in (dev.connections or set()):
                            if str(ctype) == "bluetooth" and isinstance(cid, str):
                                addr = cid.upper()
                                break

                        # 2) Check device identifiers — Bermuda stores MAC as
                        #    ("bermuda", "AA:BB:CC:DD:EE:FF") identifier
                        if not addr:
                            for (domain, ident) in (dev.identifiers or set()):
                                ident_s = str(ident)
                                if _MAC_RE.match(ident_s):
                                    addr = ident_s.upper()
                                    break

                        # 3) Match to private_ble objects by device_id
                        if not addr:
                            for _cid, pg in _private_groups.items():
                                _pg_dev = pg.get("device")
                                if _pg_dev and _pg_dev.get("id") == ent.device_id:
                                    canonical_id = _cid
                                    addr = pg["best_addr"].upper() if pg.get("best_addr") else ""
                                    all_addrs = sorted(pg.get("addrs") or [])
                                    break

                        # 4) Match to regular BLE objects by device_id
                        if not addr and ent.device_id:
                            for _ba, _bd in addr_to_device.items():
                                if isinstance(_bd, dict) and _bd.get("id") == ent.device_id:
                                    addr = _ba.upper()
                                    break

                # 5) Check entity state attributes for MAC address hints
                #    Bermuda entities often expose mac_address/address in attributes
                if not addr:
                    _st = hass.states.get(eid)
                    if _st:
                        for _attr_key in ("mac_address", "address", "mac"):
                            _attr_val = (_st.attributes or {}).get(_attr_key)
                            if isinstance(_attr_val, str) and _MAC_RE.match(_attr_val):
                                addr = _attr_val.upper()
                                break
            except Exception:
                addr = ""

            prefix = ":".join(addr.split(":")[:3]) if addr else ""
            _ent_obj: dict[str, Any] = {
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
            }
            if canonical_id:
                _ent_obj["canonical_id"] = canonical_id
            if all_addrs:
                _ent_obj["all_addresses"] = all_addrs
            objects.append(_ent_obj)

        # (B-cont) Regular (non-rotating, non-iBeacon) BLE advertisement objects
        for addr, rec in ble_by_addr.items():
            if addr in ibeacon_addrs:
                continue  # absorbed into a merged iBeacon group (section C)
            if canonical_by_addr.get(addr):
                continue  # handled by _private_groups (section B2)

            # Regular (non-rotating) BLE object
            parts = addr.split(":")
            prefix = ":".join(parts[:3]) if len(parts) >= 3 else ""
            identified = (addr in addr_to_device) or (addr in addr_to_entities)

            obj: dict[str, Any] = {
                "key": f"ble:{addr}",
                "kind": "ble",
                "address": addr,
                "name": rec.get("name") or addr,
                "rssi": rec.get("rssi"),
                "last_seen": rec.get("last_seen"),
                "age_s": rec.get("age_s"),
                "sources": sorted(
                    [{"source": k, "rssi": v.get("rssi"), "age_s": v.get("age_s")} for k, v in (rec.get("sources") or {}).items()],
                    key=lambda x: x["source"],
                ),
                "manufacturer_data": rec.get("manufacturer_data") or {},
                "service_data": rec.get("service_data") or {},
                "service_uuids": rec.get("service_uuids") or [],
                "connectable": rec.get("connectable"),
                "prefix": prefix or None,
                "prefix_count": prefix_counts.get(prefix, 0),
                "identified": bool(identified),
                "linked_entities": sorted(list(set(addr_to_entities.get(addr, [])))),
                "device": addr_to_device.get(addr),
            }
            objects.append(obj)

        # (B2) Merged private_ble objects — one per canonical_id (phone identity)
        for cid, pg in _private_groups.items():
            canonical = pg["canonical"]
            # Use the freshest record for age/last_seen (not the strongest RSSI record)
            # — a phone's newest rotating MAC has age≈0 but may have weaker RSSI.
            freshest = pg.get("freshest_rec")
            rec = freshest if freshest else pg["best_rec"]
            addr = pg["best_addr"]
            parts = addr.split(":")
            prefix = ":".join(parts[:3]) if len(parts) >= 3 else ""
            obj_pb: dict[str, Any] = {
                "key": cid,  # STABLE key — survives address rotation
                "kind": "private_ble",
                "address": addr,  # current best (strongest signal) rotating MAC
                "canonical_id": cid,
                "private_ble_name": canonical["name"],
                "all_addresses": sorted(pg["addrs"]),  # all rotating MACs seen this cycle
                "name": canonical.get("name") or rec.get("name") or addr,
                "rssi": pg["best_rssi"] if pg["best_rssi"] > -999 else rec.get("rssi"),
                "last_seen": rec.get("last_seen"),
                "age_s": pg["freshest_age"] if pg["freshest_age"] is not None else rec.get("age_s"),
                "sources": sorted(
                    [{"source": k, "rssi": v.get("rssi"), "age_s": v.get("age_s")} for k, v in pg["all_sources"].items()],
                    key=lambda x: x["source"],
                ),
                "manufacturer_data": pg["manufacturer_data"],
                "service_data": pg["service_data"],
                "service_uuids": pg["service_uuids"],
                "connectable": rec.get("connectable"),
                "prefix": prefix or None,
                "prefix_count": prefix_counts.get(prefix, 0),
                "identified": bool(pg["device"] or pg["all_linked"]),
                "linked_entities": sorted(pg["all_linked"]),
                "device": pg["device"],
            }
            # Attach iBeacon metadata if this private_ble device also broadcasts
            # as an iBeacon (e.g. HA Companion App "Track Phone").
            _ib_meta = _ibeacon_meta_for_private.get(cid)
            if _ib_meta:
                obj_pb["ibeacon_uuid"] = _ib_meta["uuid"]
                obj_pb["ibeacon_major"] = _ib_meta["major"]
                obj_pb["ibeacon_minor"] = _ib_meta["minor"]
                if _ib_meta.get("tx_power") is not None:
                    obj_pb["tx_power"] = _ib_meta["tx_power"]
            objects.append(obj_pb)

        # (C) iBeacon objects — one per UUID/major/minor key, merged from all rotating MACs
        _obj_store_c = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
        for uuid_key, g in ibeacon_groups.items():
            all_linked: list[str] = sorted({
                e for a in g["addrs"] for e in addr_to_entities.get(a, [])
            })
            identified_ib = any(a in addr_to_device for a in g["addrs"]) or bool(all_linked)
            # Use persisted user label as display name if available (prevents flickering)
            _ib_label = None
            if _obj_store_c:
                _ib_entry = _obj_store_c.get(uuid_key)
                if _ib_entry:
                    _ib_label = _ib_entry.get("label") or None
            # Merge BLE metadata from all underlying MAC addresses so that
            # service_data (e.g. Eddystone), manufacturer_data, and service_uuids
            # are preserved on the merged iBeacon object instead of being lost.
            _ib_ble_name = None
            _ib_manuf: dict[str, Any] = {}
            _ib_svcdata: dict[str, Any] = {}
            _ib_svcuuids: list[str] = []
            _ib_connectable = None
            _ib_device = None
            for _ib_mac in (g.get("addrs") or []):
                _ib_rec = ble_by_addr.get(_ib_mac)
                if not _ib_rec:
                    continue
                _n = _ib_rec.get("name") or ""
                if _n and _n != _ib_mac and not _ib_ble_name:
                    _ib_ble_name = _n
                _ib_manuf.update(_ib_rec.get("manufacturer_data") or {})
                _ib_svcdata.update(_ib_rec.get("service_data") or {})
                for _u in (_ib_rec.get("service_uuids") or []):
                    if _u not in _ib_svcuuids:
                        _ib_svcuuids.append(_u)
                if _ib_rec.get("connectable") is True:
                    _ib_connectable = True
                elif _ib_connectable is None:
                    _ib_connectable = _ib_rec.get("connectable")
                if not _ib_device and _ib_mac in addr_to_device:
                    _ib_device = addr_to_device[_ib_mac]
            # For split groups (multiple physical devices sharing same UUID:major:minor),
            # append the MAC suffix so the user can distinguish them.
            _is_split = "_split_from" in g
            _default_name = _ib_ble_name or f"iBeacon {g['uuid'][:8]}"
            if _is_split and g["addrs"]:
                _mac_short = g["addrs"][0][-8:]  # last 8 chars of MAC (XX:XX:XX)
                _default_name = f"{_default_name} ({_mac_short})"
            obj_ib: dict[str, Any] = {
                "key": uuid_key,
                "kind": "ibeacon",
                "address": uuid_key,           # stable key — used by label store & tagging
                "all_addresses": g["addrs"],   # rotating MACs this beacon was seen from
                "name": _ib_label or _default_name,
                "ble_name": _ib_ble_name,      # original BLE broadcast name for display
                "rssi": g.get("rssi"),
                "age_s": g.get("age_s"),
                "sources": g.get("sources") or [],
                "ibeacon_uuid": g["uuid"],
                "ibeacon_major": g["major"],
                "ibeacon_minor": g["minor"],
                "tx_power": g.get("tx_power"),  # factory TX power dBm at 1m (from iBeacon payload)
                "manufacturer_data": _ib_manuf,
                "service_data": _ib_svcdata,
                "service_uuids": _ib_svcuuids,
                "connectable": _ib_connectable,
                "identified": bool(identified_ib) or bool(_ib_label),
                "linked_entities": all_linked,
                "device": _ib_device,
            }
            if _ib_label:
                obj_ib["user_label"] = _ib_label
            objects.append(obj_ib)

        # ── Cross-link MAC ↔ iBeacon ↔ entity for the same physical device ──
        # Build lookup maps so labels/tags propagate across all representations.
        _mac_to_ibeacon_key: dict[str, str] = {}   # MAC → ibeacon:uuid:major:minor
        _ibeacon_to_macs: dict[str, list[str]] = {}  # ibeacon key → [MAC, ...]
        for uuid_key, g in ibeacon_groups.items():
            macs = list(g.get("addrs") or [])
            _ibeacon_to_macs[uuid_key] = macs
            for mac in macs:
                _mac_to_ibeacon_key[mac] = uuid_key

        # Tag entity objects with their iBeacon key if their MAC matches
        for obj in objects:
            if obj.get("kind") == "entity":
                eaddr = (obj.get("address") or "").upper()
                ib_key = _mac_to_ibeacon_key.get(eaddr)
                if ib_key:
                    obj["ibeacon_key"] = ib_key

        # ── Merge duplicate objects that represent the same physical device ──
        # A device can broadcast multiple BLE protocols (iBeacon + Eddystone,
        # iBeacon + regular BLE, etc.) on different MACs. When they share the
        # same HA device_id, merge the secondary into the primary (iBeacon wins).
        try:
            # Index iBeacon objects by device_id and by all their MAC addresses
            _ib_by_devid: dict[str, dict[str, Any]] = {}
            _ib_by_mac: dict[str, dict[str, Any]] = {}
            for obj in objects:
                if obj.get("kind") != "ibeacon":
                    continue
                dev = obj.get("device")
                if isinstance(dev, dict) and dev.get("id"):
                    _ib_by_devid[dev["id"]] = obj
                for mac in (obj.get("all_addresses") or []):
                    _ib_by_mac[mac.upper()] = obj

            _absorbed_keys: set[str] = set()  # keys of objects merged into an iBeacon
            for obj in objects:
                if obj.get("kind") not in ("ble", "private_ble"):
                    continue
                # Match by HA device_id
                target_ib = None
                dev = obj.get("device")
                if isinstance(dev, dict) and dev.get("id"):
                    target_ib = _ib_by_devid.get(dev["id"])
                # Match by MAC address overlap
                if not target_ib:
                    obj_addr = (obj.get("address") or "").upper()
                    if obj_addr:
                        target_ib = _ib_by_mac.get(obj_addr)
                    if not target_ib:
                        for mac in (obj.get("all_addresses") or []):
                            target_ib = _ib_by_mac.get(mac.upper())
                            if target_ib:
                                break
                if not target_ib:
                    continue
                # Merge: fold BLE/private_ble data into the iBeacon object
                _absorbed_keys.add(obj.get("key", ""))
                # Merge metadata (don't overwrite existing non-empty fields)
                for _mf in ("manufacturer_data", "service_data"):
                    src_d = obj.get(_mf) or {}
                    if src_d:
                        target_ib.setdefault(_mf, {}).update(src_d)
                for _u in (obj.get("service_uuids") or []):
                    target_uuids = target_ib.setdefault("service_uuids", [])
                    if _u not in target_uuids:
                        target_uuids.append(_u)
                # Merge MAC addresses
                for _ma in (obj.get("all_addresses") or [obj.get("address")]):
                    if _ma:
                        existing_addrs = list(target_ib.get("all_addresses") or [])
                        if _ma not in existing_addrs:
                            existing_addrs.append(_ma)
                        target_ib["all_addresses"] = sorted(existing_addrs)
                # Merge linked entities
                for _le in (obj.get("linked_entities") or []):
                    existing_le = target_ib.setdefault("linked_entities", [])
                    if _le not in existing_le:
                        existing_le.append(_le)
                # Merge sources
                existing_srcs = target_ib.get("sources") or []
                for _s in (obj.get("sources") or []):
                    sk = _s.get("source") if isinstance(_s, dict) else str(_s)
                    if sk not in {(s.get("source") if isinstance(s, dict) else str(s)) for s in existing_srcs}:
                        existing_srcs.append(_s)
                target_ib["sources"] = existing_srcs
                # Prefer better RSSI
                if obj.get("rssi") is not None:
                    if target_ib.get("rssi") is None or obj["rssi"] > target_ib["rssi"]:
                        target_ib["rssi"] = obj["rssi"]
                        target_ib["age_s"] = obj.get("age_s")
                # Connectable
                if obj.get("connectable") is True:
                    target_ib["connectable"] = True
                # Device info
                if not target_ib.get("device") and obj.get("device"):
                    target_ib["device"] = obj["device"]
                # BLE name
                obj_name = obj.get("name") or ""
                if obj_name and obj_name != obj.get("address") and not target_ib.get("ble_name"):
                    target_ib["ble_name"] = obj_name
                # Mark iBeacon as identified if the absorbed object was
                if obj.get("identified"):
                    target_ib["identified"] = True
                # Track merged protocols
                _merged = target_ib.setdefault("merged_protocols", ["ibeacon"])
                obj_kind = obj.get("kind", "ble")
                if obj_kind not in _merged:
                    _merged.append(obj_kind)

            # Remove absorbed objects from the list
            if _absorbed_keys:
                objects = [o for o in objects if o.get("key", "") not in _absorbed_keys]
        except Exception as _merge_err:
            _LOGGER.debug("Object merge error: %s", _merge_err)

        # ── Aggressive beacon deduplication ──────────────────────────────────
        # Reduces ~700 beacons down by merging devices that are clearly the
        # same physical device broadcasting under different MACs or protocols.
        # Runs twice: once on current-cycle objects (to purge ghosts from cache),
        # and again after cache reintroduction (to dedup cached objects too).
        _dedup_absorbed: set[str] = set()

        # Helper: merge obj_src into obj_dst (like the iBeacon merge above)
        def _merge_into(dst: dict, src: dict) -> None:
            for _mf in ("manufacturer_data", "service_data"):
                sd = src.get(_mf) or {}
                if sd:
                    dst.setdefault(_mf, {}).update(sd)
            for _u in (src.get("service_uuids") or []):
                tl = dst.setdefault("service_uuids", [])
                if _u not in tl:
                    tl.append(_u)
            ea = dst.setdefault("all_addresses", [])
            if dst.get("address") and dst["address"] not in ea:
                ea.append(dst["address"])
            for _ma in (src.get("all_addresses") or [src.get("address")]):
                if _ma and _ma not in ea:
                    ea.append(_ma)
            dst["all_addresses"] = sorted(ea)
            for _le in (src.get("linked_entities") or []):
                el2 = dst.setdefault("linked_entities", [])
                if _le not in el2:
                    el2.append(_le)
            es = dst.setdefault("sources", [])
            es_set = {(s.get("source") if isinstance(s, dict) else str(s)) for s in es}
            for _s in (src.get("sources") or []):
                sk = _s.get("source") if isinstance(_s, dict) else str(_s)
                if sk not in es_set:
                    es.append(_s)
                    es_set.add(sk)
            if src.get("rssi") is not None:
                if dst.get("rssi") is None or src["rssi"] > dst["rssi"]:
                    dst["rssi"] = src["rssi"]
                    dst["age_s"] = src.get("age_s")
            if src.get("connectable") is True:
                dst["connectable"] = True
            if not dst.get("device") and src.get("device"):
                dst["device"] = src["device"]
            sn = src.get("name") or ""
            if sn and sn != src.get("address") and not dst.get("ble_name"):
                dst["ble_name"] = sn
            if src.get("identified"):
                dst["identified"] = True
            _mp = dst.setdefault("merged_protocols", [dst.get("kind", "ble")])
            sk2 = src.get("kind", "ble")
            if sk2 not in _mp:
                _mp.append(sk2)

        def _run_dedup(objects: list, absorbed: set) -> list:
            """Run D1-D7 dedup strategies. Mutates absorbed set, returns filtered list."""
            # --- (D1) Entity absorbs its BLE counterpart ─────────────────────
            # Entity objects that share a MAC with a ble/private_ble/ibeacon
            # object → absorb the raw BLE object (entity is the richer representation)
            _ent_macs: dict[str, dict[str, Any]] = {}  # MAC → entity obj
            for obj in objects:
                if obj.get("kind") == "entity" and obj.get("address"):
                    _ent_macs[obj["address"].upper()] = obj
            for obj in objects:
                if obj.get("kind") not in ("ble",):
                    continue
                obj_addr = (obj.get("address") or "").upper()
                ent_obj = _ent_macs.get(obj_addr) if obj_addr else None
                if ent_obj:
                    absorbed.add(obj.get("key", ""))
                    # Copy BLE metadata into the entity object
                    for _mf in ("manufacturer_data", "service_data", "service_uuids",
                                "company_name", "device_type", "service_names"):
                        v = obj.get(_mf)
                        if v and not ent_obj.get(_mf):
                            ent_obj[_mf] = v
                    if obj.get("rssi") is not None and ent_obj.get("rssi") is None:
                        ent_obj["rssi"] = obj["rssi"]
                    if obj.get("sources"):
                        ent_obj.setdefault("sources", [])
                        for _s in obj["sources"]:
                            if _s not in ent_obj["sources"]:
                                ent_obj["sources"].append(_s)

            # --- (D2) Eddystone-UID namespace grouping ───────────────────────
            # Eddystone-UID beacons broadcast service_data under UUID 0xFEAA.
            # Frame type 0x00 = UID frame: 10-byte namespace + 6-byte instance.
            # Group by namespace+instance (like iBeacon UUID/major/minor).
            _eddystone_groups: dict[str, list[dict[str, Any]]] = {}  # "eddy:ns:inst" → [objs]
            for obj in objects:
                if obj.get("key", "") in absorbed:
                    continue
                if obj.get("kind") not in ("ble", "private_ble"):
                    continue
                sd = obj.get("service_data") or {}
                for sdk in ("0000feaa-0000-1000-8000-00805f9b34fb", "feaa", "0xFEAA"):
                    raw = sd.get(sdk)
                    if not raw:
                        continue
                    try:
                        if isinstance(raw, str):
                            payload = bytes(int(x, 16) for x in raw.split())
                        elif isinstance(raw, (bytes, bytearray)):
                            payload = bytes(raw)
                        else:
                            continue
                        if len(payload) >= 18 and payload[0] == 0x00:
                            # UID frame: byte 0 = frame type, byte 1 = tx power,
                            # bytes 2-11 = namespace (10 bytes), bytes 12-17 = instance (6 bytes)
                            ns = payload[2:12].hex()
                            inst = payload[12:18].hex()
                            eddy_key = f"eddy:{ns}:{inst}"
                            _eddystone_groups.setdefault(eddy_key, []).append(obj)
                    except Exception:
                        pass

            for eddy_key, group in _eddystone_groups.items():
                if len(group) <= 1:
                    continue
                # Keep the one with best RSSI as primary
                group.sort(key=lambda o: o.get("rssi") or -999, reverse=True)
                primary = group[0]
                primary["eddystone_uid"] = eddy_key
                for secondary in group[1:]:
                    absorbed.add(secondary.get("key", ""))
                    _merge_into(primary, secondary)

            # --- (D3) Same BLE name merging ──────────────────────────────────
            # Devices with identical non-generic broadcast names and random MACs
            # are very likely the same device with rotating addresses.
            # Generic names (empty, MAC-like, short hex) are excluded.
            _GENERIC_NAME_RE = __import__("re").compile(
                r"^$|^([0-9A-Fa-f]{2}[:\-]){2,}|^[0-9A-Fa-f]{4,}$|^BLE$|^Unknown$"
            )
            _name_groups: dict[str, list[dict[str, Any]]] = {}
            for obj in objects:
                if obj.get("key", "") in absorbed:
                    continue
                if obj.get("kind") not in ("ble",):
                    continue
                name = (obj.get("name") or "").strip()
                addr = (obj.get("address") or "").upper()
                # Skip if name is generic or IS the MAC address
                if not name or name.upper() == addr or _GENERIC_NAME_RE.match(name):
                    continue
                # Only merge random-address MACs (bit 1 of first octet set = random)
                try:
                    first_octet = int(addr.split(":")[0], 16)
                    is_random = bool(first_octet & 0x02)  # locally administered bit
                except Exception:
                    is_random = False
                if not is_random:
                    continue
                _name_groups.setdefault(name, []).append(obj)

            for name, group in _name_groups.items():
                if len(group) <= 1:
                    continue
                # All share the same broadcast name + have random MACs → likely same device
                group.sort(key=lambda o: o.get("rssi") or -999, reverse=True)
                primary = group[0]
                for secondary in group[1:]:
                    absorbed.add(secondary.get("key", ""))
                    _merge_into(primary, secondary)
                primary.setdefault("merged_protocols", [primary.get("kind", "ble")])
                primary["_dedup_reason"] = f"same_name:{name}"

            # --- (D4) Manufacturer data fingerprint dedup ────────────────────
            # Devices with identical manufacturer_data payloads on different
            # random MACs are the same rotating device.  Only for random MACs.
            # Exclude Apple (76) continuity data which changes frequently.
            _manuf_groups: dict[str, list[dict[str, Any]]] = {}
            for obj in objects:
                if obj.get("key", "") in absorbed:
                    continue
                if obj.get("kind") not in ("ble",):
                    continue
                md = obj.get("manufacturer_data") or {}
                if not md:
                    continue
                addr = (obj.get("address") or "").upper()
                try:
                    first_octet = int(addr.split(":")[0], 16)
                    is_random = bool(first_octet & 0x02)
                except Exception:
                    is_random = False
                if not is_random:
                    continue
                # Build a fingerprint from manufacturer_data, excluding Apple
                # continuity (company 76) which rotates frequently
                fp_parts = []
                for k, v in sorted(md.items()):
                    if str(k) in ("76", "0x004c", "0x004C"):
                        continue  # skip Apple continuity — too variable
                    fp_parts.append(f"{k}={v}")
                if not fp_parts:
                    continue
                fp = "|".join(fp_parts)
                _manuf_groups.setdefault(fp, []).append(obj)

            for fp, group in _manuf_groups.items():
                if len(group) <= 1:
                    continue
                group.sort(key=lambda o: o.get("rssi") or -999, reverse=True)
                primary = group[0]
                for secondary in group[1:]:
                    absorbed.add(secondary.get("key", ""))
                    _merge_into(primary, secondary)
                primary["_dedup_reason"] = "same_manuf_data"

            # --- (D5) Apple continuity dedup ─────────────────────────────────
            # Apple devices rotate MACs but broadcast company 76 with a
            # consistent subtype byte (byte 0 after company ID).  Devices
            # from the same scanners with the same subtype are grouped.
            _apple_groups: dict[str, list[dict[str, Any]]] = {}
            for obj in objects:
                if obj.get("key", "") in absorbed:
                    continue
                if obj.get("kind") not in ("ble",):
                    continue
                md = obj.get("manufacturer_data") or {}
                apple_raw = None
                for k in ("76", "0x004c", "0x004C"):
                    if k in md:
                        apple_raw = md[k]
                        break
                if not apple_raw:
                    continue
                addr = (obj.get("address") or "").upper()
                try:
                    first_octet = int(addr.split(":")[0], 16)
                    is_random = bool(first_octet & 0x02)
                except Exception:
                    is_random = False
                if not is_random:
                    continue
                # Parse subtype from Apple continuity data
                try:
                    if isinstance(apple_raw, str):
                        raw_bytes = [int(x, 16) for x in apple_raw.split()]
                    elif isinstance(apple_raw, (bytes, bytearray)):
                        raw_bytes = list(apple_raw)
                    else:
                        continue
                    if len(raw_bytes) < 2:
                        continue
                    subtype = raw_bytes[0]
                    data_len = raw_bytes[1]
                except Exception:
                    continue
                # Skip iBeacon subtype (already handled)
                if subtype == 0x02 and data_len == 0x15:
                    continue
                # Group by subtype + data length + scanner set
                srcs = obj.get("sources") or []
                src_key = ",".join(sorted(str(s) for s in srcs)) if srcs else "_"
                apple_key = f"apple:{subtype:02x}:{data_len:02x}:{src_key}"
                _apple_groups.setdefault(apple_key, []).append(obj)

            for apple_key, group in _apple_groups.items():
                if len(group) <= 1:
                    continue
                # Same Apple subtype + same scanners → likely same device rotating MACs
                group.sort(key=lambda o: o.get("rssi") or -999, reverse=True)
                primary = group[0]
                for secondary in group[1:]:
                    absorbed.add(secondary.get("key", ""))
                    _merge_into(primary, secondary)
                primary["_dedup_reason"] = f"apple_continuity:{apple_key}"

            # --- (D6) Identical service_uuids + same scanners dedup ──────────
            # Random-MAC devices advertising identical service_uuids from the
            # same set of scanners are very likely the same rotating device.
            _svcuuid_groups: dict[str, list[dict[str, Any]]] = {}
            for obj in objects:
                if obj.get("key", "") in absorbed:
                    continue
                if obj.get("kind") not in ("ble",):
                    continue
                su = obj.get("service_uuids") or []
                if not su:
                    continue
                addr = (obj.get("address") or "").upper()
                try:
                    first_octet = int(addr.split(":")[0], 16)
                    is_random = bool(first_octet & 0x02)
                except Exception:
                    is_random = False
                if not is_random:
                    continue
                name = (obj.get("name") or "").strip()
                # Only group unnamed or generic-named devices
                if name and name.upper() != addr and not _GENERIC_NAME_RE.match(name):
                    continue  # named devices already handled by D3
                srcs = obj.get("sources") or []
                src_key = ",".join(sorted(str(s) for s in srcs)) if srcs else "_"
                uuid_key = "+".join(sorted(su)) + "@" + src_key
                _svcuuid_groups.setdefault(uuid_key, []).append(obj)

            for uuid_key, group in _svcuuid_groups.items():
                if len(group) <= 1:
                    continue
                group.sort(key=lambda o: o.get("rssi") or -999, reverse=True)
                primary = group[0]
                for secondary in group[1:]:
                    absorbed.add(secondary.get("key", ""))
                    _merge_into(primary, secondary)
                primary["_dedup_reason"] = "same_svc_uuids_scanners"

            # --- (D7) Bare random MACs with no data ──────────────────────────
            # Random-address devices with no name, no manufacturer_data, no
            # service_data, no service_uuids → group by scanner set.
            # These are typically the same device rotating its address.
            _bare_groups: dict[str, list[dict[str, Any]]] = {}
            for obj in objects:
                if obj.get("key", "") in absorbed:
                    continue
                if obj.get("kind") not in ("ble",):
                    continue
                addr = (obj.get("address") or "").upper()
                try:
                    first_octet = int(addr.split(":")[0], 16)
                    is_random = bool(first_octet & 0x02)
                except Exception:
                    is_random = False
                if not is_random:
                    continue
                name = (obj.get("name") or "").strip()
                if name and name.upper() != addr:
                    continue  # has a real name
                md = obj.get("manufacturer_data") or {}
                sd = obj.get("service_data") or {}
                su = obj.get("service_uuids") or []
                if md or sd or su:
                    continue  # has some distinguishing data
                srcs = obj.get("sources") or []
                src_key = ",".join(sorted(str(s) for s in srcs)) if srcs else "_"
                _bare_groups.setdefault(src_key, []).append(obj)

            for src_key, group in _bare_groups.items():
                if len(group) <= 1:
                    continue
                # Group all bare random-MAC devices per scanner set into one
                group.sort(key=lambda o: o.get("rssi") or -999, reverse=True)
                primary = group[0]
                primary["name"] = f"Unknown BLE ({len(group)} rotations)"
                for secondary in group[1:]:
                    absorbed.add(secondary.get("key", ""))
                    _merge_into(primary, secondary)
                primary["_dedup_reason"] = "bare_random_mac"

            # Remove all absorbed objects
            if absorbed:
                _pre = len(objects)
                objects = [o for o in objects if o.get("key", "") not in absorbed]
                _LOGGER.debug(
                    "Aggressive dedup: %d → %d objects (-%d)",
                    _pre, len(objects), _pre - len(objects),
                )
            return objects

        try:
            objects = _run_dedup(objects, _dedup_absorbed)
        except Exception as _dedup_err:
            _LOGGER.debug("Aggressive dedup error: %s", _dedup_err)

        # Attach user labels from ObjectStore (labels make BLE objects "identified")
        # Labels propagate: iBeacon label → entity with same MAC; MAC label → iBeacon
        try:
            obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
            if obj_store:
                # First pass: find the best label for each physical device
                # (could be stored under iBeacon key, MAC address, or canonical_id)
                _device_labels: dict[str, str] = {}  # any key → label

                for obj in objects:
                    addr = obj.get("address", "") or ""
                    kind = obj.get("kind", "")

                    if kind == "private_ble":
                        lookup_key = obj.get("canonical_id") or addr
                    elif kind == "ibeacon":
                        lookup_key = obj.get("key") or addr
                    else:
                        lookup_key = addr

                    if not lookup_key:
                        continue

                    entry = obj_store.get(lookup_key)
                    if not entry and lookup_key != addr:
                        entry = obj_store.get(addr)

                    # Entity objects linked to private BLE — also check canonical_id
                    if not entry and kind == "entity":
                        _ent_cid = obj.get("canonical_id")
                        if _ent_cid:
                            entry = obj_store.get(_ent_cid)

                    # Also check via iBeacon cross-reference
                    if not entry and kind == "entity":
                        ib_key = obj.get("ibeacon_key")
                        if ib_key:
                            entry = obj_store.get(ib_key)

                    # For private_ble with iBeacon metadata, also check the iBeacon key
                    # (companion_follow stores labels under ibeacon:uuid:major:minor)
                    if not entry and kind == "private_ble":
                        _ib_uuid = obj.get("ibeacon_uuid")
                        _ib_major = obj.get("ibeacon_major")
                        _ib_minor = obj.get("ibeacon_minor")
                        if _ib_uuid is not None:
                            _ib_key = f"ibeacon:{_ib_uuid}:{_ib_major}:{_ib_minor}"
                            entry = obj_store.get(_ib_key)
                            if entry:
                                # Migrate: persist under canonical_id for faster future lookups
                                _cid = obj.get("canonical_id")
                                if _cid:
                                    _migrate_label = entry.get("label", "")
                                    if _migrate_label and not obj_store.get(_cid):
                                        _LOGGER.info(
                                            "Migrating label '%s' from ibeacon key %s → canonical %s",
                                            _migrate_label, _ib_key, _cid,
                                        )
                                        hass.async_create_task(
                                            obj_store.async_set(_cid, _migrate_label)
                                        )

                    # For private_ble, also check all rotating MACs (handles labels
                    # stored under an old rotating MAC before canonical_id fix)
                    if not entry and kind == "private_ble":
                        for mac in (obj.get("all_addresses") or []):
                            entry = obj_store.get(mac)
                            if entry:
                                # Migrate: persist under canonical_id so future lookups work
                                _cid = obj.get("canonical_id")
                                _mac_label = entry.get("label", "")
                                if _cid and _cid != mac and _mac_label and not obj_store.get(_cid):
                                    _LOGGER.info(
                                        "Migrating label '%s' from rotating MAC %s → canonical %s",
                                        _mac_label, mac, _cid,
                                    )
                                    hass.async_create_task(
                                        obj_store.async_set(_cid, _mac_label)
                                    )
                                break

                    # For iBeacon objects, also check if any of their MACs have a label
                    if not entry and kind == "ibeacon":
                        for mac in _ibeacon_to_macs.get(lookup_key, []):
                            entry = obj_store.get(mac)
                            if entry:
                                break

                    if entry:
                        label = entry.get("label", "")
                        if label:
                            _device_labels[lookup_key] = label
                            # Propagate to STABLE keys only — never to rotating MACs.
                            # Propagating to individual MACs causes labels to bleed
                            # to unrelated objects that share a coincidental MAC.
                            if kind == "private_ble":
                                _cid = obj.get("canonical_id")
                                if _cid:
                                    _device_labels[_cid] = label
                                # Also register under iBeacon key if this device has one
                                _ib_uuid = obj.get("ibeacon_uuid")
                                if _ib_uuid is not None:
                                    _ib_k = f"ibeacon:{_ib_uuid}:{obj.get('ibeacon_major')}:{obj.get('ibeacon_minor')}"
                                    _device_labels[_ib_k] = label
                                    _device_labels[_ib_k.upper()] = label
                            elif kind == "ibeacon":
                                # iBeacon label → also register under uppercase variant
                                _device_labels[lookup_key.upper()] = label
                            elif kind == "ble" and addr in _mac_to_ibeacon_key:
                                _device_labels[_mac_to_ibeacon_key[addr]] = label
                            # Propagate to canonical_id for entity→private_ble cross-ref
                            _ent_cid = obj.get("canonical_id")
                            if _ent_cid and _ent_cid not in _device_labels:
                                _device_labels[_ent_cid] = label

                # Second pass: apply labels to all objects
                for obj in objects:
                    addr = obj.get("address", "") or ""
                    kind = obj.get("kind", "")

                    if kind == "private_ble":
                        lookup_key = obj.get("canonical_id") or addr
                    elif kind == "ibeacon":
                        lookup_key = obj.get("key") or addr
                    else:
                        lookup_key = addr

                    label = _device_labels.get(lookup_key)
                    if not label and addr:
                        label = _device_labels.get(addr)
                    # Entity objects linked to private BLE — check canonical_id
                    if not label and kind == "entity":
                        _ent_cid = obj.get("canonical_id")
                        if _ent_cid:
                            label = _device_labels.get(_ent_cid)
                    if not label and kind == "entity":
                        ib_key = obj.get("ibeacon_key")
                        if ib_key:
                            label = _device_labels.get(ib_key)
                    # For iBeacon: check if any of its MACs belong to a labelled
                    # regular BLE device (non-rotating MAC with a label)
                    if not label and kind == "ibeacon":
                        for mac in _ibeacon_to_macs.get(lookup_key, []):
                            mac_entry = obj_store.get(mac) if obj_store else None
                            if mac_entry and mac_entry.get("label"):
                                label = mac_entry["label"]
                                break

                    if label:
                        obj["user_label"] = label
                        if kind in ("ble", "ibeacon", "private_ble"):
                            obj["identified"] = True
        except Exception:
            pass

        # BLE enrichment: decode company names, device types, service names
        for obj in objects:
            if obj.get("kind") in ("ble", "private_ble", "ibeacon"):
                try:
                    _enrich_ble_object(obj)
                except Exception:
                    pass

        # ── Persistent object history (7-day rolling, disk-backed) ─────────
        # Every object we see is recorded here with all metadata.  Tagged/
        # identified objects never expire; unidentified expire after 7 days.
        # The cache is loaded from disk on first access and saved every 60 s.
        import time as _time
        _HISTORY_TTL = 604800       # 7 days for unidentified objects
        _SAVE_INTERVAL = 15         # save to disk at most every 15 s
        _now_ts = _time.time()      # real wall-clock time (survives restarts)

        _dom = hass.data.setdefault(DOMAIN, {})
        _cache: dict[str, dict[str, Any]] = _dom.get(DATA_OBJECT_HISTORY)

        # First access: load from disk
        if _cache is None:
            from homeassistant.helpers.storage import Store as _Store
            _hist_store = _dom.setdefault("_obj_hist_store", _Store(hass, 1, OBJECT_HISTORY_STORE_KEY))
            _loaded = await _hist_store.async_load()
            _cache = _loaded if isinstance(_loaded, dict) else {}
            _dom[DATA_OBJECT_HISTORY] = _cache
            _dom["_obj_hist_last_save"] = _now_ts
            _LOGGER.debug("Object history loaded from disk: %d entries", len(_cache))

        # Fields to merge (never overwrite good data with empty values)
        _MERGE_FIELDS = (
            "company_name", "device_type", "service_names", "service_uuid_map",
            "name", "private_ble_name", "ibeacon_uuid", "ibeacon_major",
            "ibeacon_minor", "tx_power", "manufacturer_data", "service_data",
            "service_uuids", "all_addresses", "linked_entities", "device",
            "prefix", "prefix_count",
        )

        # Index current objects by key for fast lookup
        _current_keys: set[str] = set()
        for obj in objects:
            key = obj.get("key") or ""
            if not key:
                continue
            _current_keys.add(key)

            # Merge: keep previously-discovered metadata if current is empty
            prev = _cache.get(key)
            if prev:
                for fld in _MERGE_FIELDS:
                    cur_val = obj.get(fld)
                    prev_val = prev.get(fld)
                    if not cur_val and prev_val:
                        obj[fld] = prev_val
                # Preserve first_seen from history
                obj["_first_seen"] = prev.get("_first_seen") or _now_ts
                # Merge all_addresses (accumulate over time)
                if prev.get("all_addresses") and obj.get("all_addresses"):
                    merged = list(dict.fromkeys(
                        list(obj["all_addresses"]) + list(prev["all_addresses"])
                    ))
                    obj["all_addresses"] = merged
            else:
                obj["_first_seen"] = _now_ts

            # Update cache entry
            obj["_last_seen_ts"] = _now_ts
            obj["_cache_age_s"] = obj.get("age_s") or 0
            _cache[key] = dict(obj)  # snapshot copy

        # Merge cached objects not seen this cycle back into the list
        # Skip keys absorbed by deduplication — they are ghosts of merged objects
        _cached_added = 0
        for key, cached_obj in list(_cache.items()):
            if key in _current_keys:
                continue  # already in this cycle's list
            if key in _dedup_absorbed:
                del _cache[key]  # purge absorbed ghost from cache
                continue
            # When bermuda_ignore is on, purge cached entity objects from Bermuda
            # so they don't keep resurrecting after being filtered out
            if _bermuda_ignore and _all_bermuda_entry_ids and cached_obj.get("kind") == "entity":
                _cached_eid = cached_obj.get("entity_id") or ""
                if _cached_eid:
                    try:
                        _cached_ent = er.async_get(_cached_eid)
                        if _cached_ent and _cached_ent.config_entry_id in _all_bermuda_entry_ids:
                            del _cache[key]
                            continue
                    except Exception:
                        pass
            stale_s = _now_ts - (cached_obj.get("_last_seen_ts") or _now_ts)
            is_identified = cached_obj.get("identified") or cached_obj.get("user_label")
            # Tagged/identified objects never expire from history
            if not is_identified and stale_s > _HISTORY_TTL:
                del _cache[key]
                continue
            # Bring it back — compute age_s = original age + time since last seen
            obj_copy = dict(cached_obj)
            base_age = cached_obj.get("_cache_age_s") or 0
            obj_copy["age_s"] = base_age + stale_s
            # Update per-source age_s values too (they were frozen at cache time)
            if obj_copy.get("sources"):
                obj_copy["sources"] = [
                    {**s, "age_s": (s.get("age_s") or 0) + stale_s}
                    if isinstance(s, dict) else s
                    for s in obj_copy["sources"]
                ]
            objects.append(obj_copy)
            _cached_added += 1

        # Second dedup pass: catch cached objects that were reintroduced
        if _cached_added > 0:
            try:
                objects = _run_dedup(objects, _dedup_absorbed)
            except Exception as _dedup2_err:
                _LOGGER.debug("Post-cache dedup error: %s", _dedup2_err)

        # Re-apply user labels to any cached objects that were merged back
        # without labels (e.g. labelled via companion_follow after initial cache)
        try:
            _obj_store2 = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
            if _obj_store2:
                for obj in objects:
                    if obj.get("user_label"):
                        continue  # already labelled
                    kind = obj.get("kind", "")
                    if kind not in ("ble", "private_ble", "ibeacon"):
                        continue
                    # Try the object's key, address, canonical_id
                    _lbl = None
                    for _try_key in (obj.get("key"), obj.get("address"), obj.get("canonical_id")):
                        if _try_key:
                            _e = _obj_store2.get(_try_key)
                            if _e and _e.get("label"):
                                _lbl = _e["label"]
                                break
                    if _lbl:
                        obj["user_label"] = _lbl
                        obj["identified"] = True
        except Exception:
            pass

        # Periodic disk save (at most every 60 s)
        _last_save = _dom.get("_obj_hist_last_save") or 0
        if _now_ts - _last_save >= _SAVE_INTERVAL:
            _hist_store = _dom.get("_obj_hist_store")
            if _hist_store is None:
                from homeassistant.helpers.storage import Store as _Store
                _hist_store = _Store(hass, 1, OBJECT_HISTORY_STORE_KEY)
                _dom["_obj_hist_store"] = _hist_store
            # Strip non-serializable fields before saving
            _save_data = {}
            for _k, _v in _cache.items():
                _sv = dict(_v)
                # Remove any fields that might not be JSON-serializable
                _sv.pop("_smoothed", None)
                _sv.pop("_stale", None)
                _save_data[_k] = _sv
            await _hist_store.async_save(_save_data)
            _dom["_obj_hist_last_save"] = _now_ts

        # Send first_seen to frontend, strip internal cache fields
        for obj in objects:
            # Convert _first_seen to ISO string for frontend
            fs = obj.pop("_first_seen", None)
            if fs:
                from datetime import datetime, timezone
                obj["first_seen"] = datetime.fromtimestamp(fs, tz=timezone.utc).isoformat()
            obj.pop("_last_seen_ts", None)
            obj.pop("_cache_age_s", None)

        # Create placeholder objects for followed keys that have no real
        # advertisement yet. This ensures followed objects show up in the
        # objects list even when their BLE address has rotated or the
        # transmitter hasn't been seen by scanners yet.
        try:
            _st_ghost = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _obj_store_ghost = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
            if _st_ghost and _obj_store_ghost:
                _followed = _st_ghost.data.get("followed_addrs") or []
                _existing_keys = {(o.get("key") or "").upper() for o in objects}
                _existing_keys |= {(o.get("address") or "").upper() for o in objects}
                # Also index by all_addresses so we don't create duplicates
                for _eo in objects:
                    for _ea in (_eo.get("all_addresses") or []):
                        _existing_keys.add(str(_ea).upper())
                # Also check object history cache for names of non-labeled objects
                _obj_hist_cache = hass.data.get(DOMAIN, {}).get(DATA_OBJECT_HISTORY) or {}
                for _fk in _followed:
                    _fku = str(_fk).upper()
                    if _fku in _existing_keys:
                        continue  # already have a real object
                    _ghost_entry = _obj_store_ghost.get(_fk)
                    _ghost_label = (_ghost_entry or {}).get("label", "")
                    # Fall back to name from object history cache or the key itself
                    if not _ghost_label:
                        _hist = _obj_hist_cache.get(_fku) or _obj_hist_cache.get(_fk) or {}
                        _ghost_label = _hist.get("user_label") or _hist.get("name") or ""
                    if not _ghost_label:
                        _ghost_label = _fk  # last resort: use the key as the name
                    # Determine kind from key format
                    if _fku.startswith("IBEACON:"):
                        _ghost_kind = "ibeacon"
                    elif ":" in _fku and len(_fku) == 17:
                        _ghost_kind = "ble"
                    else:
                        _ghost_kind = "private_ble"
                    _ghost_all_addrs = list((_ghost_entry or {}).get("all_addresses", []))
                    if not _ghost_all_addrs:
                        _ghost_all_addrs = list((_obj_hist_cache.get(_fku) or _obj_hist_cache.get(_fk) or {}).get("all_addresses", []))
                    objects.append({
                        "key": _fk,
                        "kind": _ghost_kind,
                        "address": _fk,
                        "all_addresses": _ghost_all_addrs,
                        "name": _ghost_label,
                        "user_label": (_ghost_entry or {}).get("label", ""),
                        "rssi": None,
                        "age_s": None,
                        "sources": [],
                        "identified": bool((_ghost_entry or {}).get("label")),
                        "linked_entities": [],
                        "device": None,
                        "room": None,
                        "_ghost": True,  # indicates no live advertisement
                    })
        except Exception:
            pass

        unidentified = [o for o in objects if o.get("kind") in ("ble", "private_ble", "ibeacon") and not o.get("identified")]
        identified = [o for o in objects if not (o.get("kind") in ("ble", "private_ble", "ibeacon") and not o.get("identified"))]
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
                "resolver": _resolver_diag,
                "cached_objects": _cached_added,
                "dedup_absorbed": len(_dedup_absorbed),
            },
        }
    except Exception as _obj_err:
        _LOGGER.warning("Objects list build failed: %s", _obj_err, exc_info=True)
        snapshot["objects"] = {"list": [], "summary": {"total": 0, "identified": 0, "unidentified": 0, "entities": 0, "ble": 0, "common_prefixes": {}}}

    # ── Enrich raw advertisements with decoded metadata + object cross-reference ──
    try:
        from .ble_enrichment import enrich_object as _enrich_ad
        _obj_by_addr: dict[str, dict[str, Any]] = {}
        for _o in (snapshot.get("objects") or {}).get("list") or []:
            for _a in ([_o.get("address")] + (_o.get("all_addresses") or [])):
                if _a:
                    _obj_by_addr[str(_a).upper()] = _o
        _raw_ads = (snapshot.get("ble") or {}).get("advertisements") or []
        for _ad in _raw_ads:
            _enrich_ad(_ad)  # adds company_name, device_type, service_names, service_uuid_map
            _ad_addr = str(_ad.get("address") or "").upper()
            _xobj = _obj_by_addr.get(_ad_addr)
            if _xobj:
                _ad["_xref"] = {
                    "key": _xobj.get("key"),
                    "kind": _xobj.get("kind"),
                    "label": _xobj.get("user_label") or _xobj.get("name"),
                    "identified": _xobj.get("identified", False),
                    "room": _xobj.get("room"),
                }
                if _xobj.get("canonical_id"):
                    _ad["_xref"]["canonical_id"] = _xobj["canonical_id"]
                if _xobj.get("all_addresses"):
                    _ad["_xref"]["all_addresses"] = _xobj["all_addresses"]
                if _xobj.get("ibeacon_uuid"):
                    _ad["_xref"]["ibeacon_uuid"] = _xobj["ibeacon_uuid"]
                    _ad["_xref"]["ibeacon_major"] = _xobj.get("ibeacon_major")
                    _ad["_xref"]["ibeacon_minor"] = _xobj.get("ibeacon_minor")
                if _xobj.get("entity_id"):
                    _ad["_xref"]["entity_id"] = _xobj["entity_id"]
            else:
                _ad["_xref"] = None
    except Exception:
        pass

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
                elif kind == "private_ble":
                    # Check ALL rotating MACs for strongest signal (like iBeacon)
                    best_rssi_pb: float | None = None
                    best_area_pb: str | None = None
                    _pb_addrs = (obj.get("all_addresses") or [])
                    if not _pb_addrs:
                        _pb_addr = str(obj.get("address") or "").upper()
                        if _pb_addr:
                            _pb_addrs = [_pb_addr]
                    for a in _pb_addrs:
                        for src, rssi in addr_src_rssi.get(str(a).upper(), {}).items():
                            area = source_to_area.get(src)
                            if area and (best_rssi_pb is None or rssi > best_rssi_pb):
                                best_rssi_pb = rssi
                                best_area_pb = area
                    if best_area_pb:
                        obj["room"] = best_area_pb
                elif kind == "ble":
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

    # ── Traceback: record object positions for playback ──────────────────────
    try:
        from .const import DATA_TRACEBACK
        tb_store = hass.data.get(DOMAIN, {}).get(DATA_TRACEBACK)
        if tb_store:
            _tb_objs = (snapshot.get("objects") or {}).get("list") or []
            _tb_followed = set(_get_settings(hass).get("followed_addrs") or [])
            tb_store.record_frame(_tb_objs, followed_set=_tb_followed)
            await tb_store.async_maybe_save()
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
        vol.Optional("followed_addrs"): list,
        vol.Optional("health_reminder_enabled"): bool,
        vol.Optional("health_reminder_last_ts"): vol.Any(float, int, None),
        vol.Optional("maps_iso_floor_gap"): vol.Coerce(int),
        vol.Optional("maps_iso_horiz_gap"): vol.Coerce(int),
        vol.Optional("maps_iso_focus"): vol.Any(int, None),
        vol.Optional("overview_iso_floor_gap"): vol.Coerce(int),
        vol.Optional("overview_iso_horiz_gap"): vol.Coerce(int),
        vol.Optional("overview_iso_focus"): vol.Any(int, None),
        vol.Optional("lights_hidden"): list,
        vol.Optional("adaptive_learning_enabled"): bool,
        vol.Optional("adaptive_floor_detection"): bool,
        vol.Optional("signal_loss_linger_s"): vol.Coerce(int),
        vol.Optional("advanced_extra_tabs"): list,
        vol.Optional("ha_entity_tracker_enabled"): bool,
        vol.Optional("ha_entity_area_enabled"): bool,
        vol.Optional("ha_entity_distance_enabled"): bool,
        vol.Optional("ha_entity_scanner_distance_enabled"): bool,
        vol.Optional("mqtt_publish_enabled"): bool,
        vol.Optional("lights_panel_enabled"): bool,
        vol.Optional("bermuda_ignore"): bool,
        vol.Optional("tags_room_events_enabled"): bool,
        vol.Optional("tags_nfc_identify_enabled"): bool,
        vol.Optional("tags_phone_autolink_enabled"): bool,
        vol.Optional("quiet_mode"): bool,
        vol.Optional("overview_2d_mode"): bool,
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
        if "followed_addrs" in msg:
            addrs = msg["followed_addrs"]
            _new_followed = [str(x).upper() for x in addrs if isinstance(x, str)] if isinstance(addrs, list) else []
            payload["followed_addrs"] = _new_followed
            # Clear coordinator state for unfollowed objects so they don't
            # linger on the overview 3D map as stale ghosts.
            try:
                _old_followed = set(str(x).upper() for x in (st.data.get("followed_addrs") or []))
                _removed_f = _old_followed - set(x.upper() for x in _new_followed)
                if _removed_f:
                    _coord_f = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
                    if _coord_f:
                        for _rf in _removed_f:
                            _coord_f.clear_object_state(_rf)
            except Exception:
                pass
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
            payload["ble_max_age_s"] = max(30, min(14400, int(msg["ble_max_age_s"])))
        if "scanner_offsets" in msg:
            raw = msg["scanner_offsets"]
            if isinstance(raw, dict):
                payload["scanner_offsets"] = {str(k): float(v) for k, v in raw.items()}
        if "adaptive_learning_enabled" in msg:
            payload["adaptive_learning_enabled"] = bool(msg["adaptive_learning_enabled"])
        if "adaptive_floor_detection" in msg:
            payload["adaptive_floor_detection"] = bool(msg["adaptive_floor_detection"])
        if "signal_loss_linger_s" in msg:
            payload["signal_loss_linger_s"] = max(10, min(300, int(msg["signal_loss_linger_s"])))
        if "advanced_extra_tabs" in msg:
            valid = {"objects","devices","bluetooth","presence","monitor","qa","sandbox"}
            payload["advanced_extra_tabs"] = [t for t in msg["advanced_extra_tabs"] if t in valid]
        for key in ("ha_entity_tracker_enabled", "ha_entity_area_enabled",
                    "ha_entity_distance_enabled", "ha_entity_scanner_distance_enabled",
                    "mqtt_publish_enabled", "lights_panel_enabled", "bermuda_ignore",
                    "tags_room_events_enabled", "tags_nfc_identify_enabled",
                    "tags_phone_autolink_enabled", "quiet_mode",
                    "overview_2d_mode"):
            if key in msg:
                payload[key] = bool(msg[key])
        await st.async_set(**payload)
        # ── Toggle existing PadSpan entities in HA registry ──────────────────
        _entity_keys = {
            "ha_entity_tracker_enabled": "__tracker",
            "ha_entity_area_enabled": "__area",
            "ha_entity_distance_enabled": "__distance",
            "ha_entity_scanner_distance_enabled": "__dist__",
        }
        _toggled_any = False
        for _skey, _suffix in _entity_keys.items():
            if _skey not in msg:
                continue
            _enabled = bool(msg[_skey])
            try:
                _er = entity_registry.async_get(hass)
                _disabler = entity_registry.RegistryEntryDisabler.INTEGRATION
                for _entry in list(_er.entities.values()):
                    if _entry.platform != DOMAIN:
                        continue
                    _uid = _entry.unique_id or ""
                    # __dist__ matches scanner-distance; __distance matches global distance
                    # Make sure __distance doesn't match __dist__ entries
                    if _suffix == "__distance" and "__dist__" in _uid:
                        continue
                    if _suffix not in _uid:
                        continue
                    if _enabled and _entry.disabled_by == _disabler:
                        _er.async_update_entity(_entry.entity_id, disabled_by=None)
                        _toggled_any = True
                    elif not _enabled and _entry.disabled_by is None:
                        _er.async_update_entity(_entry.entity_id, disabled_by=_disabler)
                        _toggled_any = True
            except Exception:
                _LOGGER.debug("Failed to toggle entities for %s", _skey, exc_info=True)
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

    # Overlay presence-coordinator smoothed data (x_frac, y_frac,
    # knn_confidence, room, room_confidence) onto snapshot objects so the
    # UI has access to calibration-derived positions and stable rooms.
    try:
        pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")
        if pc and pc.data:
            _MERGE_KEYS = ("x_frac", "y_frac", "knn_confidence", "knn_map_id",
                           "room", "room_confidence", "rssi_margin_confidence",
                           "_smoothed", "_stale")
            obj_list = (snap.get("objects") or {}).get("list") or []
            for obj in obj_list:
                key = obj.get("key", "")
                if not key:
                    continue
                smoothed = pc.data.get(key)
                if not smoothed:
                    continue
                for mk in _MERGE_KEYS:
                    val = smoothed.get(mk)
                    if val is not None:
                        obj[mk] = val
    except Exception:
        pass  # non-fatal — UI still works without smoothed data

    # Inject stale presence-coordinator objects for followed keys that are
    # missing from the snapshot. The presence coordinator carries forward
    # objects after they vanish from BLE, but the overlay above only updates
    # EXISTING objects — it doesn't add new ones. This ensures followed
    # objects remain visible even after MAC rotation or temporary signal loss.
    try:
        _pc2 = hass.data.get(DOMAIN, {}).get("presence_coordinator")
        _st2 = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        _os2 = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
        if _pc2 and _pc2.data and _st2:
            _obj_list2 = (snap.get("objects") or {}).get("list") or []
            _existing2 = {(o.get("key") or "").upper() for o in _obj_list2}
            _followed2 = {str(f).upper() for f in (_st2.data.get("followed_addrs") or [])}
            for _pk, _pv in _pc2.data.items():
                _pku = str(_pk).upper()
                if _pku not in _followed2 or _pku in _existing2:
                    continue
                # This is a followed object with presence data but missing from snapshot
                _oe = _os2.get(_pk) if _os2 else None
                _olabel = (_oe or {}).get("label", "")
                _oname = _olabel or _pv.get("user_label") or _pv.get("name") or _pk
                _inj = {
                    "key": _pk,
                    "kind": "ibeacon" if _pku.startswith("IBEACON:") else "ble",
                    "address": _pk,
                    "all_addresses": list((_oe or {}).get("all_addresses", [])) if _oe else list(_pv.get("all_addresses") or []),
                    "name": _oname,
                    "user_label": _olabel,
                    "rssi": None,
                    "age_s": None,
                    "sources": [],
                    "identified": bool(_olabel),
                    "linked_entities": [],
                    "device": None,
                    "room": _pv.get("room"),
                    "_ghost": True,
                    "_stale": True,
                }
                # Also overlay presence data
                for _mk2 in ("x_frac", "y_frac", "knn_map_id",
                              "knn_confidence",
                              "room_confidence", "rssi_margin_confidence"):
                    _v2 = _pv.get(_mk2)
                    if _v2 is not None:
                        _inj[_mk2] = _v2
                _obj_list2.append(_inj)
                _existing2.add(_pku)
    except Exception:
        pass

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
    offset = max(-50.0, min(50.0, float(msg.get("offset_db", 0.0))))
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


import time as _time
# Delay first prune until 10 minutes after module load (HA boot). This gives
# ESPHome scanners time to reconnect — without this grace period, the prune
# runs before all radios have reported in and deletes legitimate receivers.
_last_receiver_prune: float = _time.monotonic() + 900  # first prune eligible after boot + 15 min

@websocket_api.websocket_command({"type": "padspan_ha/maps_list"})
@websocket_api.async_response
async def ws_maps_list(hass: HomeAssistant, connection, msg) -> None:
    global _last_receiver_prune
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)

    # Auto-prune disabled — receivers are only removed via explicit user action
    # (Delete button or Remove-from-map in the Tune tab).  The previous auto-prune
    # caused receivers to silently disappear after reboots or scanner reconnects.

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
    floor_id = msg.get("floor_id") or DEFAULT_FLOOR_ID
    # Enforce single Outside map
    if floor_id == OUTSIDE_FLOOR_ID:
        existing = ms.list_maps()
        if any(m.get("floor_id") == OUTSIDE_FLOOR_ID for m in existing):
            connection.send_error(msg["id"], "duplicate_outside",
                                  "Only one Outside map is allowed. Delete the existing one first.")
            return
    try:
        info = await ms.async_add_map(
            msg.get("name") or "Untitled Map",
            msg.get("filename") or "map",
            msg.get("mime") or "image/*",
            msg.get("width") or 0,
            msg.get("height") or 0,
            msg.get("png_base64") or "",
            floor_id,
        )
    except ValueError as exc:
        connection.send_error(msg["id"], "upload_too_large", str(exc))
        return
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
        vol.Optional("beacons"): list,
    }
)
@websocket_api.async_response
async def ws_maps_update(hass: HomeAssistant, connection, msg) -> None:
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_error(msg["id"], "no_maps_store", "Maps store not initialized")
        return
    map_id = msg.get("map_id")

    # Enforce single Outside map when changing floor_id
    new_floor_id = msg.get("floor_id")
    if new_floor_id == OUTSIDE_FLOOR_ID:
        existing = [m for m in ms.list_maps()
                    if m.get("floor_id") == OUTSIDE_FLOOR_ID and m.get("id") != map_id]
        if existing:
            connection.send_error(msg["id"], "duplicate_outside",
                                  "Only one Outside map is allowed.")
            return

    # ── Capture old beacon keys BEFORE update (to detect removals) ────────
    _old_beacon_keys: set[str] = set()
    _beacons = msg.get("beacons")
    if _beacons is not None:
        try:
            _old_map = ms.get_map(map_id)
            if _old_map:
                for _bk in (_old_map.get("beacons") or []):
                    if _bk.get("key"):
                        _old_beacon_keys.add(_bk["key"])
        except Exception:
            pass

    try:
        updated = await ms.async_update_map(
            map_id,
            receivers=msg.get("receivers"),
            beacons=_beacons,
            calibration=msg.get("calibration"),
            notes=msg.get("notes"),
            floor_id=msg.get("floor_id"),
            room_bounds=msg.get("room_bounds"),
            stack=msg.get("stack"),
        )
    except KeyError:
        connection.send_error(msg["id"], "not_found", "Map not found")
        return

    # ── Clear coordinator state for removed beacons ───────────────────────
    # When beacons are removed from beacon tune, their stale coordinator
    # state (room lock, k-NN position, etc.) must be cleared so they don't
    # linger on the overview 3D map.
    if _beacons is not None and _old_beacon_keys:
        _new_beacon_keys = {bk.get("key", "") for bk in _beacons}
        _removed = _old_beacon_keys - _new_beacon_keys
        if _removed:
            try:
                _coord = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
                if _coord:
                    # Check if removed key still exists on another map
                    _all_map_keys: set[str] = set()
                    for _m in (ms.data.get("maps") or []):
                        for _bk in (_m.get("beacons") or []):
                            if _bk.get("key"):
                                _all_map_keys.add(_bk["key"])
                    for _rk in _removed:
                        if _rk not in _all_map_keys:
                            _coord.clear_object_state(_rk)
            except Exception:
                pass

    # ── Immediate calibration injection when beacons are saved ────────────
    if _beacons:
        try:
            _coord = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
            if _coord:
                _rb = updated.get("room_bounds") or {}
                _fid = updated.get("floor_id") or ""
                _injected = await _coord.inject_immediate_calibration(
                    _beacons, map_id, _fid, _rb
                )
                if _injected:
                    _LOGGER.debug(
                        "Immediate beacon calibration: %d points injected for map %s",
                        _injected, map_id,
                    )
        except Exception:
            pass  # best-effort; don't fail the save

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
@websocket_api.require_admin
@websocket_api.async_response
async def ws_maps_delete(hass: HomeAssistant, connection, msg) -> None:
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_error(msg["id"], "no_maps_store", "Maps store not initialized")
        return
    map_id = msg.get("map_id") or ""
    # Clean up calibration data for the deleted map
    try:
        cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
        if cal:
            await cal.async_clear_map(map_id)
    except Exception:
        pass
    await ms.async_delete_map(map_id)
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/maps_delete_migrate",
        "map_id": str,
        "target_map_id": str,
        vol.Optional("extend_canvas", default=False): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_maps_delete_migrate(hass: HomeAssistant, connection, msg) -> None:
    """Delete a map after migrating its data (receivers, beacons, room_bounds,
    calibration) to a target map on the same z-level.

    Coordinates are transformed from source map space → world → target map
    space using stack alignment.  If migrated data falls outside the target's
    [0,1] bounds the target canvas is extended automatically.
    """
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_error(msg["id"], "no_maps_store", "Maps store not initialized")
        return

    src_id = str(msg.get("map_id") or "").strip()
    tgt_id = str(msg.get("target_map_id") or "").strip()
    src_map = ms.get_map(src_id)
    tgt_map = ms.get_map(tgt_id)
    if not src_map:
        connection.send_error(msg["id"], "not_found", "Source map not found")
        return
    if not tgt_map:
        connection.send_error(msg["id"], "not_found", "Target map not found")
        return

    src_stk = src_map.get("stack") or {}
    tgt_stk = tgt_map.get("stack") or {}

    def _xform(px: float, py: float) -> tuple[float, float]:
        """Source map 0-1 → target map 0-1 via world coords."""
        wx, wy = ms.map_to_world(px, py, src_stk)
        return ms.world_to_map(wx, wy, tgt_stk)

    def _xform_bounds(bounds: dict) -> dict:
        """Transform a room_bounds entry from source → target space."""
        b = dict(bounds)
        if b.get("type") == "poly" and isinstance(b.get("points"), list):
            b["points"] = [list(_xform(p[0], p[1])) for p in b["points"] if len(p) >= 2]
        elif b.get("type") == "circle":
            cx, cy = _xform(b.get("cx", 0.5), b.get("cy", 0.5))
            b["cx"] = cx
            b["cy"] = cy
            # Scale radius: transform a point at (cx+r, cy) and measure distance
            r = float(b.get("r", 0.12))
            rx, ry = _xform(b.get("cx", 0.5) + r, b.get("cy", 0.5))
            b["r"] = max(0.01, ((rx - cx) ** 2 + (ry - cy) ** 2) ** 0.5)
        return b

    tgt_receivers = list(tgt_map.get("receivers") or [])
    tgt_beacons = list(tgt_map.get("beacons") or [])
    tgt_bounds = dict(tgt_map.get("room_bounds") or {})

    tgt_rx_sources = {r.get("source") for r in tgt_receivers if r.get("source")}
    tgt_bk_keys = {b.get("key") for b in tgt_beacons if b.get("key")}

    moved_receivers: list[str] = []
    moved_beacons: list[str] = []
    moved_rooms: list[str] = []
    skipped_receivers: list[str] = []
    skipped_beacons: list[str] = []
    skipped_rooms: list[str] = []

    # Collect all migrated target-space coords to detect canvas extension need
    all_migrated_pts: list[tuple[float, float]] = []

    # --- Migrate receivers ---
    for rx in (src_map.get("receivers") or []):
        src_key = rx.get("source") or rx.get("id") or ""
        label = rx.get("label") or src_key
        if src_key and src_key in tgt_rx_sources:
            skipped_receivers.append(f"{label} (already on target)")
            continue
        new_rx = dict(rx)
        tx, ty = _xform(float(rx.get("x", 0.5)), float(rx.get("y", 0.5)))
        new_rx["x"] = tx
        new_rx["y"] = ty
        new_rx["_migrated"] = True
        all_migrated_pts.append((tx, ty))
        tgt_receivers.append(new_rx)
        moved_receivers.append(label)
        if src_key:
            tgt_rx_sources.add(src_key)

    # --- Migrate beacons ---
    for bk in (src_map.get("beacons") or []):
        bk_key = bk.get("key") or ""
        label = bk.get("label") or bk_key
        if bk_key and bk_key in tgt_bk_keys:
            skipped_beacons.append(f"{label} (already on target)")
            continue
        new_bk = dict(bk)
        tx, ty = _xform(float(bk.get("x", 0.5)), float(bk.get("y", 0.5)))
        new_bk["x"] = tx
        new_bk["y"] = ty
        new_bk["_migrated"] = True
        all_migrated_pts.append((tx, ty))
        tgt_beacons.append(new_bk)
        moved_beacons.append(label)
        if bk_key:
            tgt_bk_keys.add(bk_key)

    # --- Migrate room_bounds ---
    for room_name, bounds in (src_map.get("room_bounds") or {}).items():
        if room_name in tgt_bounds:
            skipped_rooms.append(f"{room_name} (already drawn on target)")
            continue
        new_b = _xform_bounds(bounds)
        # Collect all points for canvas extension check
        if new_b.get("type") == "poly":
            for p in (new_b.get("points") or []):
                all_migrated_pts.append((p[0], p[1]))
        elif new_b.get("type") == "circle":
            cx, cy, r = new_b.get("cx", 0.5), new_b.get("cy", 0.5), new_b.get("r", 0.12)
            all_migrated_pts.extend([(cx - r, cy - r), (cx + r, cy + r)])
        tgt_bounds[room_name] = new_b
        moved_rooms.append(room_name)

    # --- Check if canvas extension is needed ---
    canvas_extended = False
    needs_extend = False
    _renorm_x = lambda px: px  # noqa: E731 — identity unless canvas is extended
    _renorm_y = lambda py: py  # noqa: E731
    if all_migrated_pts:
        min_x = min(p[0] for p in all_migrated_pts)
        max_x = max(p[0] for p in all_migrated_pts)
        min_y = min(p[1] for p in all_migrated_pts)
        max_y = max(p[1] for p in all_migrated_pts)

        margin = 0.03  # 3% padding
        pad_left = max(0.0, -min_x + margin)
        pad_right = max(0.0, max_x - 1.0 + margin)
        pad_top = max(0.0, -min_y + margin)
        pad_bottom = max(0.0, max_y - 1.0 + margin)

        needs_extend = pad_left > 0 or pad_right > 0 or pad_top > 0 or pad_bottom > 0

        if needs_extend and msg.get("extend_canvas"):
            try:
                await ms.async_extend_canvas(tgt_id, pad_left, pad_right, pad_top, pad_bottom)
                canvas_extended = True
                tgt_map = ms.get_map(tgt_id)
                old_w_ratio = 1.0 / (1.0 + pad_left + pad_right)
                old_h_ratio = 1.0 / (1.0 + pad_top + pad_bottom)
                ox_off = pad_left / (1.0 + pad_left + pad_right)
                oy_off = pad_top / (1.0 + pad_top + pad_bottom)

                _renorm_x = lambda px: ox_off + float(px) * old_w_ratio  # noqa: E731
                _renorm_y = lambda py: oy_off + float(py) * old_h_ratio  # noqa: E731

                for rx in tgt_receivers:
                    if rx.get("_migrated"):
                        rx["x"] = _renorm_x(rx["x"])
                        rx["y"] = _renorm_y(rx["y"])
                for bk in tgt_beacons:
                    if bk.get("_migrated"):
                        bk["x"] = _renorm_x(bk["x"])
                        bk["y"] = _renorm_y(bk["y"])
                for rm_name in moved_rooms:
                    b = tgt_bounds.get(rm_name)
                    if not b:
                        continue
                    if b.get("type") == "poly":
                        b["points"] = [[_renorm_x(p[0]), _renorm_y(p[1])] for p in b.get("points", [])]
                    elif b.get("type") == "circle":
                        b["cx"] = _renorm_x(b.get("cx", 0.5))
                        b["cy"] = _renorm_y(b.get("cy", 0.5))
                        b["r"] = float(b.get("r", 0.12)) * min(old_w_ratio, old_h_ratio)
            except Exception as _ext_err:
                _LOGGER.debug("Canvas extension failed: %s", _ext_err)
        elif needs_extend and not msg.get("extend_canvas"):
            # Data needs extending but user hasn't approved — report overflow
            # Items outside [0,1] will be clamped to the edge (not ideal but safe)
            pass

    # Clean up migration markers before save
    for rx in tgt_receivers:
        rx.pop("_migrated", None)
    for bk in tgt_beacons:
        bk.pop("_migrated", None)

    # --- Save merged data to target map ---
    await ms.async_update_map(
        tgt_id,
        receivers=tgt_receivers,
        calibration=(tgt_map or {}).get("calibration") or {},
        notes=(tgt_map or {}).get("notes") or "",
        floor_id=(tgt_map or {}).get("floor_id") or "",
        room_bounds=tgt_bounds,
        stack=(tgt_map or {}).get("stack") or {},
        beacons=tgt_beacons,
    )

    # --- Migrate calibration points (transform coords too) ---
    cal_moved = 0
    try:
        cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
        if cal:
            points = cal.data.get("points", [])
            changed = False
            for pt in points:
                if pt.get("map_id") == src_id:
                    # Transform calibration point coordinates
                    px = float(pt.get("x", 0.5))
                    py = float(pt.get("y", 0.5))
                    tx, ty = _xform(px, py)
                    if canvas_extended:
                        tx = _renorm_x(tx)
                        ty = _renorm_y(ty)
                    pt["x"] = tx
                    pt["y"] = ty
                    pt["map_id"] = tgt_id
                    cal_moved += 1
                    changed = True
            if changed:
                cov = (cal.data.get("model") or {}).get("coverage_by_map")
                if isinstance(cov, dict):
                    cov.pop(src_id, None)
                    cov.pop(tgt_id, None)
                await cal.store.async_save(cal.data)
    except Exception:
        pass

    # --- Delete the source map ---
    await ms.async_delete_map(src_id)

    connection.send_result(msg["id"], {
        "ok": True,
        "canvas_extended": canvas_extended,
        "needs_extend": needs_extend and not canvas_extended,
        "migrated": {
            "receivers": moved_receivers,
            "beacons": moved_beacons,
            "rooms": moved_rooms,
            "calibration_points": cal_moved,
        },
        "skipped": {
            "receivers": skipped_receivers,
            "beacons": skipped_beacons,
            "rooms": skipped_rooms,
        },
    })


@websocket_api.websocket_command({"type": "padspan_ha/maps_revert_extend", "map_id": str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_maps_revert_extend(hass: HomeAssistant, connection, msg) -> None:
    """Revert a canvas extension on a map (undo the image padding + coord shift)."""
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_error(msg["id"], "no_maps_store", "Maps store not initialized")
        return
    result = await ms.async_revert_extend(msg.get("map_id") or "")
    if result:
        connection.send_result(msg["id"], {"ok": True})
    else:
        connection.send_result(msg["id"], {"ok": False, "reason": "no_extend_snapshot"})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/object_label_set",
        "address": str,
        "label": str,
    }
)
@websocket_api.async_response
async def ws_object_label_set(hass: HomeAssistant, connection, msg) -> None:
    """Assign a user label to a BLE MAC address (or canonical_id / ibeacon key)."""
    obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
    if not obj_store:
        connection.send_error(msg["id"], "no_object_store", "Object store not initialized")
        return
    addr = str(msg.get("address") or "").strip()
    # Only uppercase plain MAC addresses; leave ibeacon/irk keys as-is
    if len(addr) == 17 and addr.count(":") == 5:
        addr = addr.upper()
    label = str(msg.get("label") or "").strip()[:48]
    if not addr:
        connection.send_error(msg["id"], "invalid_address", "Address is required")
        return
    if not label:
        connection.send_error(msg["id"], "invalid_label", "Label is required")
        return

    # If the address is a rotating MAC (RPA), resolve to canonical_id so the
    # label survives BLE address rotation (iPhones, Android phones).
    store_addr = addr
    if len(addr) == 17 and addr.count(":") == 5 and not addr.startswith("irk:"):
        try:
            from .private_ble_resolver import get_resolver  # noqa: PLC0415
            resolver = await get_resolver(hass)
            resolved = resolver.resolve_address(addr)
            if resolved and resolved.get("canonical_id"):
                store_addr = resolved["canonical_id"]
                _LOGGER.debug(
                    "object_label_set: resolved rotating MAC %s → %s",
                    addr, store_addr,
                )
        except Exception:
            pass

    await obj_store.async_set(store_addr, label)
    connection.send_result(msg["id"], {"ok": True, "address": store_addr, "label": label})


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
    addr = str(msg.get("address") or "").strip()
    # Only uppercase plain MAC addresses; leave ibeacon/irk keys as-is
    if len(addr) == 17 and addr.count(":") == 5:
        addr = addr.upper()
    # Resolve rotating MAC → canonical_id (same as label_set)
    if addr and len(addr) == 17 and addr.count(":") == 5 and not addr.startswith("irk:"):
        try:
            from .private_ble_resolver import get_resolver  # noqa: PLC0415
            resolver = await get_resolver(hass)
            resolved = resolver.resolve_address(addr)
            if resolved and resolved.get("canonical_id"):
                addr = resolved["canonical_id"]
        except Exception:
            pass
    if addr:
        await obj_store.async_delete(addr)
    connection.send_result(msg["id"], {"ok": True, "address": addr})


@websocket_api.websocket_command({"type": "padspan_ha/object_label_list"})
@websocket_api.async_response
async def ws_object_label_list(hass: HomeAssistant, connection, msg) -> None:
    """Return all stored object labels from the persistent ObjectStore."""
    obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
    if not obj_store:
        connection.send_result(msg["id"], {"labels": {}})
        return
    connection.send_result(msg["id"], {"labels": obj_store.all()})


@websocket_api.websocket_command({"type": "padspan_ha/objects_clear_history"})
@websocket_api.async_response
async def ws_objects_clear_history(hass: HomeAssistant, connection, msg) -> None:
    """Clear untagged/unfollowed objects from the history cache.

    Preserves objects that have a user_label (tagged) or are identified.
    This lets the user start fresh without losing their labelled devices.
    """
    _dom = hass.data.get(DOMAIN, {})
    _cache: dict | None = _dom.get(DATA_OBJECT_HISTORY)
    if not _cache:
        connection.send_result(msg["id"], {"ok": True, "removed": 0, "kept": 0})
        return

    obj_store = _dom.get(DATA_OBJECTS)
    labelled_keys: set[str] = set()
    if obj_store:
        for addr, entry in (obj_store.all() or {}).items():
            if entry.get("label"):
                labelled_keys.add(addr)

    # Also preserve followed objects
    followed_set: set[str] = set()
    st = _dom.get(DATA_SETTINGS)
    if st:
        for fa in (st.data.get("followed_addrs") or []):
            followed_set.add(str(fa).upper())

    removed = 0
    kept = 0
    for key in list(_cache.keys()):
        cached = _cache[key]
        has_label = cached.get("user_label") or key in labelled_keys
        addr = (cached.get("address") or "").upper()
        if addr and addr in labelled_keys:
            has_label = True
        # Also keep if followed
        if not has_label:
            ck = key.upper()
            if ck in followed_set or addr in followed_set:
                has_label = True
        if has_label:
            kept += 1
        else:
            del _cache[key]
            removed += 1

    # Force immediate save
    from homeassistant.helpers.storage import Store as _Store
    _hist_store = _dom.get("_obj_hist_store")
    if _hist_store is None:
        _hist_store = _Store(hass, 1, OBJECT_HISTORY_STORE_KEY)
        _dom["_obj_hist_store"] = _hist_store
    _save_data = {}
    for _k, _v in _cache.items():
        _sv = dict(_v)
        _sv.pop("_smoothed", None)
        _sv.pop("_stale", None)
        _save_data[_k] = _sv
    await _hist_store.async_save(_save_data)

    _LOGGER.info("Object history cleared: removed %d, kept %d tagged", removed, kept)
    connection.send_result(msg["id"], {"ok": True, "removed": removed, "kept": kept})


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
        connection.send_error(msg["id"], "update_failed", str(e)[:500])


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


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/radio_reset",
        "source": str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_radio_reset(hass: HomeAssistant, connection, msg) -> None:
    """Reset ALL data for a specific BLE scanner/radio.

    Clears: settings (offset/lost/disabled), map placements, calibration
    readings, adaptive fingerprints, Kalman smoothing, and BLE cache.
    """
    source = str(msg.get("source") or "").strip()
    if not source:
        connection.send_error(msg["id"], "invalid_source", "source is required")
        return

    summary: dict = {}

    # 1. Settings — pop from scanner_offsets, lost_radios, disabled_radios
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if st:
        offsets = dict(st.data.get("scanner_offsets") or {})
        lost = dict(st.data.get("lost_radios") or {})
        disabled = dict(st.data.get("disabled_radios") or {})
        had_offset = source in offsets
        had_lost = source in lost
        had_disabled = source in disabled
        offsets.pop(source, None)
        lost.pop(source, None)
        disabled.pop(source, None)
        await st.async_set(
            scanner_offsets=offsets,
            lost_radios=lost,
            disabled_radios=disabled,
        )
        summary["settings"] = {
            "offset_cleared": had_offset,
            "lost_cleared": had_lost,
            "disabled_cleared": had_disabled,
        }

    # 2. Maps — remove receiver placements
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if ms:
        receivers_removed = await ms.async_remove_receiver_by_source(source)
        summary["maps"] = {"receivers_removed": receivers_removed}

    # 3. Calibration — remove scanner readings + prune empty points
    try:
        cal = await _get_cal_store(hass)
        cal_result = await cal.async_remove_scanner(source)
        summary["calibration"] = cal_result
    except Exception as err:
        _LOGGER.warning("Radio reset: calibration cleanup failed: %s", err)

    # 4. Adaptive — remove room fingerprints
    ad = hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
    if ad:
        ad_removed = await ad.async_remove_scanner(source)
        summary["adaptive"] = {"room_pairs_removed": ad_removed}

    # 5. Presence coordinator — clear Kalman smoothing state
    coord = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
    if coord and hasattr(coord, "clear_scanner"):
        pc_cleared = coord.clear_scanner(source)
        summary["presence"] = {"devices_cleared": pc_cleared}

    # 6. Bluetooth live — clear advertisement cache
    bl = get_bluetooth_live(hass)
    if bl:
        bl_cleared = bl.clear_scanner(source)
        summary["bluetooth"] = {"addresses_cleared": bl_cleared}

    _LOGGER.info("Radio reset complete for source=%s: %s", source, summary)
    connection.send_result(msg["id"], {"ok": True, "source": source, "summary": summary})


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
    if len(str(config)) > 50000:
        connection.send_error(msg["id"], "config_too_large", "Alert config exceeds size limit")
        return
    # Persist to AlertStore (disk-backed)
    from .const import DATA_ALERTS
    alert_store = hass.data.get(DOMAIN, {}).get(DATA_ALERTS)
    if alert_store:
        await alert_store.async_save_config(addr, config)
    else:
        # Fallback: session-only (shouldn't happen if stores loaded)
        hass.data.setdefault(DOMAIN, {}).setdefault("follow_alerts", {})[addr] = config
    _LOGGER.debug("PadSpan HA follow_alert_save: addr=%s keys=%s", addr, list(config.keys()) if isinstance(config, dict) else "?")
    connection.send_result(msg["id"], {"ok": True, "addr": addr})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/follow_alert_delete",
        vol.Required("addr"): str,
    }
)
@websocket_api.async_response
async def ws_follow_alert_delete(hass: HomeAssistant, connection, msg) -> None:
    """Delete a follow-alert configuration for a tracked object."""
    addr = str(msg.get("addr") or "").strip()
    if not addr:
        connection.send_error(msg["id"], "missing_addr", "addr is required")
        return
    from .const import DATA_ALERTS
    alert_store = hass.data.get(DOMAIN, {}).get(DATA_ALERTS)
    deleted = False
    if alert_store:
        deleted = await alert_store.async_delete_config(addr)
    else:
        alerts = hass.data.get(DOMAIN, {}).get("follow_alerts", {})
        if addr in alerts:
            del alerts[addr]
            deleted = True
    _LOGGER.debug("PadSpan HA follow_alert_delete: addr=%s deleted=%s", addr, deleted)
    connection.send_result(msg["id"], {"ok": True, "addr": addr, "deleted": deleted})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/area_delete",
        "area_id": str,
    }
)
@websocket_api.require_admin
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
@websocket_api.require_admin
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
@websocket_api.require_admin
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
@websocket_api.require_admin
@websocket_api.async_response
async def ws_calibration_clear(hass: HomeAssistant, connection, msg) -> None:
    """Delete all calibration points and reset the model."""
    cal = await _get_cal_store(hass)
    count = await cal.async_clear_all()
    connection.send_result(msg["id"], {"ok": True, "deleted": count})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/calibration_clear_map",
        "map_id": str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_calibration_clear_map(hass: HomeAssistant, connection, msg) -> None:
    """Delete all calibration points collected on a specific map."""
    map_id = str(msg.get("map_id") or "").strip()
    if not map_id:
        connection.send_error(msg["id"], "invalid_map_id", "map_id is required")
        return
    cal = await _get_cal_store(hass)
    count = await cal.async_clear_map(map_id)
    connection.send_result(msg["id"], {"ok": True, "map_id": map_id, "deleted": count})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/object_evict",
        "key": str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_object_evict(hass: HomeAssistant, connection, msg) -> None:
    """Clear coordinator cached state for a single object key.

    Used after hard relocation to force immediate k-NN recalculation
    instead of waiting for the next poll cycle.
    """
    key = str(msg.get("key") or "").strip()
    if not key:
        connection.send_error(msg["id"], "invalid_key", "key is required")
        return
    _coord = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
    if _coord:
        _coord.clear_object_state(key)
    connection.send_result(msg["id"], {"ok": True, "key": key})


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


# ═══════════════════════════════════════════════════════════════════════════════
# Movement history
# ═══════════════════════════════════════════════════════════════════════════════

@websocket_api.websocket_command({
    "type": "padspan_ha/movement_history_get",
    vol.Optional("device"): str,
    vol.Optional("limit", default=100): int,
})
@websocket_api.async_response
async def ws_movement_history_get(hass: HomeAssistant, connection, msg) -> None:
    """Return recent movement history entries."""
    from .const import DATA_MOVEMENT
    mv = hass.data.get(DOMAIN, {}).get(DATA_MOVEMENT)
    if not mv:
        connection.send_result(msg["id"], {"entries": []})
        return
    device = msg.get("device")
    limit = msg.get("limit", 100)
    entries = mv.get_history(device=device, limit=limit)
    connection.send_result(msg["id"], {"entries": entries})


# Traceback playback
# ═══════════════════════════════════════════════════════════════════════════════

@websocket_api.websocket_command({
    "type": "padspan_ha/traceback_get",
    vol.Optional("start_ts"): vol.Coerce(float),
    vol.Optional("end_ts"): vol.Coerce(float),
    vol.Optional("obj_key"): str,
    vol.Optional("max_frames", default=4000): int,
})
@websocket_api.async_response
async def ws_traceback_get(hass: HomeAssistant, connection, msg) -> None:
    """Return traceback position frames for playback."""
    from .const import DATA_TRACEBACK
    tb = hass.data.get(DOMAIN, {}).get(DATA_TRACEBACK)
    if not tb:
        connection.send_result(msg["id"], {"frames": [], "range": {"start": 0, "end": 0, "count": 0}})
        return
    frames = tb.get_frames(
        start_ts=msg.get("start_ts"),
        end_ts=msg.get("end_ts"),
        obj_key=msg.get("obj_key"),
        max_frames=msg.get("max_frames", 4000),
    )
    connection.send_result(msg["id"], {
        "frames": frames,
        "range": tb.get_time_range(),
    })


@websocket_api.websocket_command({"type": "padspan_ha/traceback_objects"})
@websocket_api.async_response
async def ws_traceback_objects(hass: HomeAssistant, connection, msg) -> None:
    """Return all object keys seen in traceback history."""
    from .const import DATA_TRACEBACK
    tb = hass.data.get(DOMAIN, {}).get(DATA_TRACEBACK)
    if not tb:
        connection.send_result(msg["id"], {"objects": [], "range": {"start": 0, "end": 0, "count": 0}})
        return
    connection.send_result(msg["id"], {
        "objects": tb.get_object_keys(),
        "range": tb.get_time_range(),
    })


# ═══════════════════════════════════════════════════════════════════════════════
# Notify services list
# ═══════════════════════════════════════════════════════════════════════════════

@websocket_api.websocket_command({"type": "padspan_ha/notify_services_list"})
@websocket_api.async_response
async def ws_notify_services_list(hass: HomeAssistant, connection, msg) -> None:
    """Return all available HA notify service/entity names.

    Supports both the legacy notify.{name} services and the newer HA 2024+
    entity-based notify platform (notify.send_message + entity_id targeting).
    Uses three discovery methods to be as thorough as possible.
    """
    services = hass.services.async_services().get("notify", {})
    # Legacy services (exclude 'send_message' — that's the new generic dispatcher)
    legacy = [k for k in services if k != "send_message"]

    # Method 1: notify entities from state machine
    entity_ids: list[str] = []
    try:
        entity_ids = [s.entity_id for s in hass.states.async_all("notify")]
    except Exception:
        pass

    # Method 2: entity registry — catches entities that might not have a state yet
    try:
        from homeassistant.helpers import entity_registry as er
        ent_reg = er.async_get(hass)
        for entry in ent_reg.entities.values():
            if entry.domain == "notify" and entry.entity_id not in entity_ids:
                if not entry.disabled_by:
                    entity_ids.append(entry.entity_id)
    except Exception:
        pass

    # Method 3: also scan for any integration platforms that expose notify
    # (catches SMTP etc. that register via the legacy platform adapter)
    try:
        from homeassistant.helpers import entity_platform
        for platform in entity_platform.async_get_platforms(hass, "notify"):
            for entity in platform.entities.values():
                if hasattr(entity, "entity_id") and entity.entity_id not in entity_ids:
                    entity_ids.append(entity.entity_id)
    except Exception:
        pass

    # Method 4: check config entries for known notification integrations
    # and see if they registered any services we missed
    try:
        for entry in hass.config_entries.async_entries():
            if entry.domain in ("smtp", "email", "pushover", "telegram_bot",
                                "slack", "discord", "mobile_app"):
                # Check if there's a corresponding notify service or entity
                slug = entry.title.lower().replace(" ", "_") if entry.title else entry.domain
                possible_eid = f"notify.{slug}"
                if possible_eid not in entity_ids:
                    # Check if entity actually exists in state
                    state = hass.states.get(possible_eid)
                    if state:
                        entity_ids.append(possible_eid)
                # Also check domain-based entity
                possible_eid2 = f"notify.{entry.domain}"
                if possible_eid2 not in entity_ids:
                    state = hass.states.get(possible_eid2)
                    if state:
                        entity_ids.append(possible_eid2)
    except Exception:
        pass

    # Combine: entity IDs first (preferred), then legacy service names
    # Deduplicate: if a legacy service matches an entity slug, skip the legacy one
    entity_slugs = {eid.split(".", 1)[1] for eid in entity_ids if "." in eid}
    legacy_unique = [s for s in legacy if s not in entity_slugs]
    result = sorted(set(entity_ids)) + sorted(legacy_unique)
    has_send_message = "send_message" in services
    _LOGGER.debug(
        "notify_services_list: entities=%s legacy=%s has_send_message=%s",
        entity_ids, legacy_unique, has_send_message,
    )
    connection.send_result(msg["id"], {
        "services": result,
        "has_send_message": has_send_message,
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/notify_test",
        vol.Optional("email"): str,
        vol.Optional("service"): str,
    }
)
@websocket_api.async_response
async def ws_notify_test(hass: HomeAssistant, connection, msg) -> None:
    """Send a test notification via HA notify to verify the pipeline works.

    Supports both legacy notify.{name} services and the newer HA 2024+
    entity-based notify platform (notify.send_message + entity_id).
    """
    email = str(msg.get("email") or "").strip()
    chosen = str(msg.get("service") or "").strip()
    services = hass.services.async_services().get("notify", {})
    has_send_message = "send_message" in services
    # Gather all notify entities (new platform)
    entity_ids = [s.entity_id for s in hass.states.async_all("notify")]
    legacy = [k for k in services if k != "send_message"]

    if not services and not entity_ids:
        connection.send_error(
            msg["id"], "no_notify",
            "No notify services found in HA. You need to set up a notification "
            "integration first (e.g. SMTP email, Mobile App, Pushover). "
            "Go to HA Settings → Devices & Services → Add Integration → search for your notification provider."
        )
        return

    base_data: dict[str, Any] = {
        "title": "PadSpan HA — Test Notification",
        "message": "This is a test from PadSpan HA. If you see this, your notification pipeline is working correctly.",
    }

    # Determine if the chosen value is an entity_id (e.g. "notify.smtp")
    is_entity = chosen.startswith("notify.")
    attempts: list[tuple[str, str, dict[str, Any]]] = []  # (description, svc_name, payload)

    if is_entity and has_send_message:
        # New HA platform: use notify.send_message with entity_id targeting
        payload_eid = {**base_data, "entity_id": chosen}
        if email:
            attempts.append(("send_message+entity+target", "send_message", {**payload_eid, "target": email}))
            attempts.append(("send_message+entity+data.target", "send_message", {**payload_eid, "data": {"target": email}}))
        attempts.append(("send_message+entity", "send_message", payload_eid))
        # Also try legacy call with the slug (e.g. notify.smtp → service "smtp")
        slug = chosen.split(".", 1)[1] if "." in chosen else chosen
        if slug in services:
            if email:
                attempts.append(("legacy+target", slug, {**base_data, "target": email}))
            attempts.append(("legacy", slug, base_data))
    elif chosen and chosen in services:
        # Legacy service chosen directly
        if email:
            attempts.append(("legacy+target", chosen, {**base_data, "target": email}))
            attempts.append(("legacy+data.target", chosen, {**base_data, "data": {"target": email}}))
        attempts.append(("legacy", chosen, base_data))
    else:
        # Nothing chosen or invalid — auto-pick
        # Prefer entity_ids with mail/smtp, then legacy with mail/smtp, then first available
        pick_entity = None
        pick_legacy = None
        for eid in entity_ids:
            if "mail" in eid.lower() or "smtp" in eid.lower():
                pick_entity = eid
                break
        for svc in legacy:
            if "mail" in svc.lower() or "smtp" in svc.lower():
                pick_legacy = svc
                break
        if pick_entity and has_send_message:
            payload_eid = {**base_data, "entity_id": pick_entity}
            if email:
                attempts.append(("auto-entity+target", "send_message", {**payload_eid, "target": email}))
            attempts.append(("auto-entity", "send_message", payload_eid))
        if pick_legacy:
            if email:
                attempts.append(("auto-legacy+target", pick_legacy, {**base_data, "target": email}))
            attempts.append(("auto-legacy", pick_legacy, base_data))
        # Last resort: first entity or first legacy
        if not attempts:
            if entity_ids and has_send_message:
                eid = entity_ids[0]
                attempts.append(("fallback-entity", "send_message", {**base_data, "entity_id": eid}))
            elif legacy:
                attempts.append(("fallback-legacy", legacy[0], base_data))

    if not attempts:
        connection.send_error(
            msg["id"], "no_notify",
            "Could not find a usable notify service or entity. "
            "Go to HA Settings → Devices & Services → Add Integration → add a notification provider."
        )
        return

    last_err = None
    for desc, svc_name, payload in attempts:
        try:
            await hass.services.async_call("notify", svc_name, payload)
            used = svc_name if svc_name != "send_message" else payload.get("entity_id", svc_name)
            _LOGGER.info("PadSpan test notification sent via notify.%s (%s)", used, desc)
            connection.send_result(msg["id"], {
                "ok": True, "service": used,
                "available_services": sorted(set(entity_ids + legacy)),
            })
            return
        except Exception as err:
            last_err = err
            _LOGGER.debug("PadSpan test notify (%s) failed: %s", desc, err)
            continue

    detail = str(last_err) if last_err else "Unknown error"
    all_avail = sorted(set(entity_ids + legacy))
    connection.send_error(
        msg["id"], "send_failed",
        f"All send attempts failed: {detail}. "
        f"Available: {', '.join(all_avail) or 'none'}. "
        "Check HA Settings → Devices & Services for your notification provider's configuration."
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Adaptive learning
# ═══════════════════════════════════════════════════════════════════════════════

@websocket_api.websocket_command({"type": "padspan_ha/adaptive_status_get"})
@websocket_api.async_response
async def ws_adaptive_status_get(hass: HomeAssistant, connection, msg) -> None:
    """Return adaptive learning summary stats."""
    ad = hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
    if ad:
        connection.send_result(msg["id"], {"adaptive": ad.summary()})
    else:
        connection.send_result(msg["id"], {"adaptive": {}})


@websocket_api.websocket_command({"type": "padspan_ha/adaptive_reset"})
@websocket_api.async_response
async def ws_adaptive_reset(hass: HomeAssistant, connection, msg) -> None:
    """Clear all adaptive learning data."""
    ad = hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
    if ad:
        await ad.async_reset()
    connection.send_result(msg["id"], {"ok": True})


# ═══════════════════════════════════════════════════════════════════════════════
# Propagation health analysis
# ═══════════════════════════════════════════════════════════════════════════════

@websocket_api.websocket_command({"type": "padspan_ha/propagation_health"})
@websocket_api.async_response
async def ws_propagation_health(hass: HomeAssistant, connection, msg) -> None:
    """Compute comprehensive propagation model health analysis."""
    import math as _math

    domain = hass.data.get(DOMAIN, {})
    ad = domain.get(DATA_ADAPTIVE)
    calib = domain.get(DATA_CALIBRATION)
    st = domain.get(DATA_SETTINGS)
    settings = (st.data if st else {}) or {}

    rooms_discovered: list[str] = []
    try:
        from homeassistant.helpers import area_registry as _ar
        rooms_discovered = [a.name for a in _ar.async_get(hass).async_list_areas()]
    except Exception:
        pass
    total_rooms = max(len(rooms_discovered), 1)

    # ── Fingerprint data from adaptive store ──
    fp_data = (ad.data if ad else {}).get("room_fingerprints", {})
    floor_pairs = (ad.data if ad else {}).get("floor_pairs", {})
    ad_stats = (ad.data if ad else {}).get("stats", {})

    # Per-room analysis
    per_room: list[dict[str, Any]] = []
    total_var = 0.0
    var_count = 0
    rooms_with_data = 0
    for room_name in rooms_discovered:
        room_fp = fp_data.get(room_name, {})
        scanners = len(room_fp)
        total_obs = sum(s.get("n", 0) for s in room_fp.values())
        avg_var = 0.0
        if room_fp:
            vars_list = [s.get("var", 0) for s in room_fp.values() if s.get("n", 0) >= 10]
            avg_var = sum(vars_list) / len(vars_list) if vars_list else 0.0
            total_var += avg_var
            var_count += 1
        status = "no data"
        if total_obs >= 100 and avg_var < 15:
            status = "stable"
        elif total_obs >= 30:
            status = "building"
        elif total_obs > 0:
            status = "sparse"
        if total_obs > 0:
            rooms_with_data += 1
        per_room.append({
            "room": room_name,
            "scanners": scanners,
            "observations": total_obs,
            "avg_var": round(avg_var, 1),
            "status": status,
        })
    per_room.sort(key=lambda r: r["observations"], reverse=True)

    # Coverage percentage (rooms with any fingerprint data)
    coverage_pct = round(rooms_with_data / total_rooms, 3) if total_rooms else 0.0

    # Fingerprint stability
    avg_variance = round(total_var / var_count, 1) if var_count else 0.0
    rooms_stable = sum(1 for r in per_room if r["status"] == "stable")
    rooms_unstable = sum(1 for r in per_room if r["status"] in ("sparse", "no data"))

    # ── Calibration model data ──
    accuracy: dict[str, Any] = {}
    per_scanner_pl: list[dict[str, Any]] = []
    if calib:
        try:
            maps_store = domain.get(DATA_MAPS)
            maps_data = maps_store.list_maps() if maps_store else []
            model = calib.compute_model(maps_data)
            loo = model.get("loo_accuracy")
            if loo:
                accuracy = {
                    "mean_error_frac": loo.get("mean_error_frac", 0),
                    "mean_error_m_est": loo.get("mean_error_m_est", 0),
                }
            for src, pl in model.get("path_loss", {}).items():
                r_sq = pl.get("r_squared", 0)
                quality = "good" if r_sq >= 0.7 else "fair" if r_sq >= 0.4 else "poor"
                per_scanner_pl.append({
                    "source": src,
                    "name": pl.get("scanner_name", src),
                    "n": pl.get("n", 0),
                    "rssi_1m": pl.get("rssi_1m", 0),
                    "r_sq": r_sq,
                    "quality": quality,
                })
        except Exception:
            pass

    # ── Floor separation ──
    floor_sep: dict[str, Any] = {"mean_delta": 0, "pairs": 0, "sufficient": False}
    if floor_pairs:
        deltas = [v.get("mean", 0) for v in floor_pairs.values() if v.get("n", 0) >= 5]
        if deltas:
            floor_sep = {
                "mean_delta": round(sum(deltas) / len(deltas), 1),
                "pairs": len(deltas),
                "sufficient": abs(sum(deltas) / len(deltas)) >= 8,
            }

    # ── Recommendations ──
    recs: list[dict[str, str]] = []
    for r in per_room:
        if r["status"] == "no data":
            recs.append({"text": f"No data for {r['room']} — enable adaptive learning or add calibration points", "priority": "high"})
        elif r["status"] == "sparse":
            recs.append({"text": f"Only {r['observations']} observations for {r['room']} — needs more time to stabilize", "priority": "medium"})
        elif r["avg_var"] > 20:
            recs.append({"text": f"{r['room']} fingerprint is unstable (variance {r['avg_var']}) — nearby interference or obstructions?", "priority": "medium"})
    for pl in per_scanner_pl:
        if pl["quality"] == "poor":
            recs.append({"text": f"Scanner {pl['name']} has poor path-loss fit (R\u00b2={pl['r_sq']}) — consider repositioning or adding calibration points near it", "priority": "medium"})
    if not settings.get("adaptive_learning_enabled"):
        recs.append({"text": "Enable adaptive learning in Settings \u2192 Presence to automatically improve accuracy over time", "priority": "low"})
    if floor_sep["pairs"] == 0 and total_rooms > 3:
        recs.append({"text": "No cross-floor data yet — enable floor detection enhancement in Settings \u2192 Presence", "priority": "low"})
    recs = recs[:10]  # cap at 10

    # ── Grade computation ──
    acc_val = accuracy.get("mean_error_frac", 1.0)
    grade = "F"
    if coverage_pct >= 0.8 and acc_val < 0.05 and avg_variance < 15 and (floor_sep["sufficient"] or floor_sep["pairs"] == 0):
        grade = "A"
    elif coverage_pct >= 0.6 and acc_val < 0.08:
        grade = "B"
    elif coverage_pct >= 0.4 and acc_val < 0.12:
        grade = "C"
    elif coverage_pct >= 0.2 or rooms_with_data > 0:
        grade = "D"
    # If no calibration data at all, use adaptive data alone for grade
    if not accuracy and rooms_with_data > 0:
        if coverage_pct >= 0.8 and avg_variance < 15:
            grade = "B"
        elif coverage_pct >= 0.5:
            grade = "C"
        else:
            grade = "D"

    connection.send_result(msg["id"], {
        "grade": grade,
        "coverage_pct": coverage_pct,
        "accuracy": accuracy,
        "fingerprint_stability": {
            "avg_variance": avg_variance,
            "rooms_stable": rooms_stable,
            "rooms_unstable": rooms_unstable,
        },
        "floor_separation": floor_sep,
        "per_room": per_room,
        "per_scanner_pl": per_scanner_pl,
        "recommendations": recs,
        "settings": {
            "ref_power": settings.get("ref_power", -59.0),
            "path_loss_exp": settings.get("path_loss_exp", 2.5),
            "room_sigma_m": settings.get("room_sigma_m", 4.0),
            "kalman_q": settings.get("kalman_q", 0.125),
            "kalman_r": settings.get("kalman_r", 8.0),
            "adaptive_enabled": bool(settings.get("adaptive_learning_enabled")),
            "adaptive_maturity": ad.maturity() if ad else 0,
        },
    })


# ═══════════════════════════════════════════════════════════════════════════════
# Store backup / restore
# ═══════════════════════════════════════════════════════════════════════════════

_ALL_STORE_KEYS = [
    SETTINGS_STORE_KEY,
    CALIBRATION_STORE_KEY,
    ADAPTIVE_STORE_KEY,
    OBJECT_STORE_KEY,
    MAPS_STORE_KEY,
    MODEL_STORE_KEY,
    ALERTS_STORE_KEY,
    MOVEMENT_STORE_KEY,
]

_DATA_KEY_MAP = {
    SETTINGS_STORE_KEY: DATA_SETTINGS,
    CALIBRATION_STORE_KEY: DATA_CALIBRATION,
    ADAPTIVE_STORE_KEY: DATA_ADAPTIVE,
    OBJECT_STORE_KEY: DATA_OBJECTS,
    MAPS_STORE_KEY: DATA_MAPS,
    MODEL_STORE_KEY: DATA_MODEL,
    ALERTS_STORE_KEY: DATA_ALERTS,
    MOVEMENT_STORE_KEY: DATA_MOVEMENT,
}

_MAX_BACKUPS = 3


async def _load_backups(hass: HomeAssistant) -> dict[str, Any]:
    from homeassistant.helpers.storage import Store as _St
    st = _St(hass, 1, BACKUPS_STORE_KEY)
    loaded = await st.async_load()
    return loaded if isinstance(loaded, dict) else {"backups": []}


async def _save_backups(hass: HomeAssistant, data: dict[str, Any]) -> None:
    from homeassistant.helpers.storage import Store as _St
    st = _St(hass, 1, BACKUPS_STORE_KEY)
    await st.async_save(data)


@websocket_api.websocket_command({
    "type": "padspan_ha/store_backup_create",
    vol.Optional("note"): str,
})
@websocket_api.async_response
async def ws_store_backup_create(hass: HomeAssistant, connection, msg) -> None:
    """Create a backup snapshot of all persistent stores."""
    import os
    from datetime import datetime, timezone as _tz

    domain = hass.data.get(DOMAIN, {})
    stores_data: dict[str, Any] = {}

    for store_key, data_key in _DATA_KEY_MAP.items():
        store_obj = domain.get(data_key)
        if store_obj and hasattr(store_obj, "data"):
            stores_data[store_key] = store_obj.data
        else:
            stores_data[store_key] = {}

    backup_id = f"bk_{os.urandom(6).hex()}"
    backup = {
        "id": backup_id,
        "created_at": datetime.now(_tz.utc).replace(microsecond=0).isoformat(),
        "version": BUILD_VERSION,
        "note": str(msg.get("note") or "")[:200],
        "stores": stores_data,
    }

    bk_data = await _load_backups(hass)
    bk_data.setdefault("backups", []).append(backup)
    # Trim to max
    while len(bk_data["backups"]) > _MAX_BACKUPS:
        bk_data["backups"].pop(0)
    await _save_backups(hass, bk_data)

    connection.send_result(msg["id"], {
        "backup_id": backup_id,
        "created_at": backup["created_at"],
        "store_count": len(stores_data),
    })


@websocket_api.websocket_command({"type": "padspan_ha/store_backup_list"})
@websocket_api.async_response
async def ws_store_backup_list(hass: HomeAssistant, connection, msg) -> None:
    """List all available backups."""
    bk_data = await _load_backups(hass)
    items = []
    for bk in bk_data.get("backups", []):
        items.append({
            "id": bk.get("id", ""),
            "created_at": bk.get("created_at", ""),
            "version": bk.get("version", ""),
            "note": bk.get("note", ""),
            "store_count": len(bk.get("stores", {})),
        })
    connection.send_result(msg["id"], {"backups": items})


@websocket_api.websocket_command({
    "type": "padspan_ha/store_backup_restore",
    vol.Required("backup_id"): str,
})
@websocket_api.async_response
async def ws_store_backup_restore(hass: HomeAssistant, connection, msg) -> None:
    """Restore all stores from a backup snapshot."""
    from homeassistant.helpers.storage import Store as _St

    backup_id = msg["backup_id"]
    bk_data = await _load_backups(hass)
    backup = None
    for bk in bk_data.get("backups", []):
        if bk.get("id") == backup_id:
            backup = bk
            break
    if not backup:
        connection.send_error(msg["id"], "not_found", f"Backup {backup_id} not found")
        return

    stores_data = backup.get("stores", {})
    restored = 0
    for store_key, data in stores_data.items():
        if not isinstance(data, dict):
            continue
        try:
            st = _St(hass, 1, store_key)
            await st.async_save(data)
            restored += 1
            # Reload in-memory store
            data_key = _DATA_KEY_MAP.get(store_key)
            if data_key:
                store_obj = hass.data.get(DOMAIN, {}).get(data_key)
                if store_obj and hasattr(store_obj, "data"):
                    store_obj.data = data
        except Exception as e:
            _LOGGER.warning("Failed to restore %s: %s", store_key, e)

    connection.send_result(msg["id"], {"restored": restored, "total": len(stores_data)})


@websocket_api.websocket_command({
    "type": "padspan_ha/store_backup_delete",
    vol.Required("backup_id"): str,
})
@websocket_api.async_response
async def ws_store_backup_delete(hass: HomeAssistant, connection, msg) -> None:
    """Delete a specific backup."""
    backup_id = msg["backup_id"]
    bk_data = await _load_backups(hass)
    before = len(bk_data.get("backups", []))
    bk_data["backups"] = [b for b in bk_data.get("backups", []) if b.get("id") != backup_id]
    deleted = before - len(bk_data["backups"])
    if deleted > 0:
        await _save_backups(hass, bk_data)
    connection.send_result(msg["id"], {"deleted": deleted > 0})


@websocket_api.websocket_command({"type": "padspan_ha/beacon_positions_get"})
@websocket_api.async_response
async def ws_beacon_positions_get(hass: HomeAssistant, connection, msg) -> None:
    """Return all pinned beacon positions across all maps with computed room."""
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_result(msg["id"], {"positions": []})
        return
    positions: list[dict[str, Any]] = []
    for m in ms.list_maps():
        map_id = m.get("id", "")
        floor_id = m.get("floor_id", "")
        room_bounds = m.get("room_bounds") or {}
        for bk in m.get("beacons") or []:
            room = _room_from_bounds(room_bounds, float(bk.get("x", 0)), float(bk.get("y", 0)))
            positions.append({
                "key": bk.get("key", ""),
                "map_id": map_id,
                "x": bk.get("x", 0),
                "y": bk.get("y", 0),
                "label": bk.get("label", ""),
                "floor_id": floor_id,
                "room": room,
                "kind": bk.get("kind", ""),
            })
    connection.send_result(msg["id"], {"positions": positions})


@websocket_api.websocket_command({
    "type": "padspan_ha/logs_get",
    vol.Optional("level", default="DEBUG"): str,
    vol.Optional("limit", default=200): int,
})
@websocket_api.async_response
async def ws_logs_get(hass: HomeAssistant, connection, msg) -> None:
    """Return recent PadSpan log entries from the in-memory ring buffer."""
    handler = _ensure_log_handler()
    min_level = getattr(logging, str(msg.get("level", "DEBUG")).upper(), logging.DEBUG)
    limit = min(500, max(1, int(msg.get("limit", 200))))
    filtered = [e for e in handler.records if getattr(logging, e["level"], 0) >= min_level]
    # Most recent first
    entries = list(reversed(filtered[-limit:]))
    connection.send_result(msg["id"], {"entries": entries, "total": len(handler.records)})


@websocket_api.websocket_command({"type": "padspan_ha/ha_entities_audit"})
@websocket_api.async_response
async def ws_ha_entities_audit(hass: HomeAssistant, connection, msg) -> None:
    """Return every PadSpan entity with live state, health, and automation usage."""
    er = entity_registry.async_get(hass)
    now = dt_util.utcnow()
    entities: list[dict[str, Any]] = []

    # Collect automation/script entity_id references via HA helpers (2023.1+)
    _auto_users: dict[str, list[str]] = {}  # padspan_entity_id → [automation.xxx]
    _script_users: dict[str, list[str]] = {}
    _padspan_eids: list[str] = []
    for entry in er.entities.values():
        if entry.platform == DOMAIN:
            _padspan_eids.append(entry.entity_id)

    try:
        from homeassistant.components.automation import automations_with_entity  # noqa: PLC0415
        for eid in _padspan_eids:
            refs = automations_with_entity(hass, eid)
            if refs:
                _auto_users[eid] = list(refs)
    except Exception:
        pass
    try:
        from homeassistant.components.script import scripts_with_entity  # noqa: PLC0415
        for eid in _padspan_eids:
            refs = scripts_with_entity(hass, eid)
            if refs:
                _script_users[eid] = list(refs)
    except Exception:
        pass

    # Classify entity type from unique_id suffix
    def _etype(uid: str) -> str:
        if "__tracker" in uid:
            return "tracker"
        if "__dist__" in uid:
            return "scanner_distance"
        if "__distance" in uid:
            return "distance"
        if "__area" in uid:
            return "area"
        return "unknown"

    # Suggestions per type for entities with no automation usage
    _suggestions: dict[str, str] = {
        "tracker": "Link to a Person entity (Settings → People) for zone-based presence.",
        "area": "Add a confidence-gated automation — trigger on room change with room_confidence > 0.75.",
        "distance": "Create a proximity trigger — e.g. wake a device when distance < 1.5 m.",
        "scanner_distance": "Build micro-zones — trigger per-scanner when distance < 1.2 m for room-within-room control.",
    }

    for entry in er.entities.values():
        if entry.platform != DOMAIN:
            continue

        eid = entry.entity_id
        uid = entry.unique_id or ""
        etype = _etype(uid)

        # Live state from hass.states
        state_obj: State | None = hass.states.get(eid)
        state_val: str | None = None
        last_changed: str | None = None
        last_updated: str | None = None
        attrs: dict[str, Any] = {}
        if state_obj:
            state_val = state_obj.state
            last_changed = state_obj.last_changed.isoformat() if state_obj.last_changed else None
            last_updated = state_obj.last_updated.isoformat() if state_obj.last_updated else None
            attrs = dict(state_obj.attributes)

        # Health classification
        health = "good"
        health_detail = ""
        if entry.disabled_by is not None:
            health = "disabled"
            health_detail = f"Disabled by {entry.disabled_by}"
        elif state_val == "unavailable":
            health = "unavailable"
            health_detail = "Entity is unavailable — integration may need reload."
        elif state_val == "unknown":
            health = "unknown"
            health_detail = "State is unknown — device may not have reported yet."
        elif state_obj and state_obj.last_changed:
            age_h = (now - state_obj.last_changed).total_seconds() / 3600
            if age_h > 24:
                health = "stale"
                health_detail = f"No state change in {int(age_h)}h — device may be away or out of range."

        # Automation / script usage
        autos = _auto_users.get(eid, [])
        scripts = _script_users.get(eid, [])
        used_count = len(autos) + len(scripts)

        # Suggestion hint (only for unused entities)
        suggestion = ""
        if used_count == 0 and health not in ("disabled",):
            suggestion = _suggestions.get(etype, "")

        # Friendly label: try to extract from device name
        dev_label = ""
        if entry.device_id:
            try:
                dr = device_registry.async_get(hass)
                dev = dr.async_get(entry.device_id)
                if dev and dev.name:
                    dev_label = dev.name
            except Exception:
                pass

        entities.append({
            "entity_id": eid,
            "unique_id": uid,
            "type": etype,
            "device_label": dev_label,
            "state": state_val,
            "last_changed": last_changed,
            "last_updated": last_updated,
            "disabled_by": str(entry.disabled_by) if entry.disabled_by else None,
            "health": health,
            "health_detail": health_detail,
            "automations": autos,
            "scripts": scripts,
            "used_count": used_count,
            "suggestion": suggestion,
            "room_confidence": attrs.get("room_confidence"),
            "home": attrs.get("home"),
        })

    # Sort: active first, then by type, then entity_id
    _type_order = {"tracker": 0, "area": 1, "distance": 2, "scanner_distance": 3, "unknown": 4}
    entities.sort(key=lambda e: (
        0 if e["health"] == "good" else (1 if e["health"] == "stale" else 2),
        _type_order.get(e["type"], 9),
        e["entity_id"],
    ))

    # Summary stats
    by_health = {}
    by_type = {}
    for e in entities:
        by_health[e["health"]] = by_health.get(e["health"], 0) + 1
        by_type[e["type"]] = by_type.get(e["type"], 0) + 1
    total_used = sum(1 for e in entities if e["used_count"] > 0)

    connection.send_result(msg["id"], {
        "entities": entities,
        "total": len(entities),
        "by_health": by_health,
        "by_type": by_type,
        "total_used_in_automations": total_used,
    })


def _room_from_bounds(room_bounds: dict, x: float, y: float) -> str:
    """Point-in-polygon / point-in-circle test against room_bounds. Returns room name or ''."""
    for room_name, b in room_bounds.items():
        if not isinstance(b, dict):
            continue
        btype = b.get("type", "poly")
        if btype == "circle":
            cx = float(b.get("cx", 0.5))
            cy = float(b.get("cy", 0.5))
            r = float(b.get("r", 0.12))
            if (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2:
                return str(room_name)
        elif btype == "poly":
            pts = b.get("points") or []
            if len(pts) < 3:
                continue
            # Ray-casting point-in-polygon test
            inside = False
            n = len(pts)
            j = n - 1
            for i in range(n):
                xi, yi = float(pts[i][0]), float(pts[i][1])
                xj, yj = float(pts[j][0]), float(pts[j][1])
                if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
                    inside = not inside
                j = i
            if inside:
                return str(room_name)
    return ""


@websocket_api.websocket_command({"type": "padspan_ha/private_ble_status"})
@websocket_api.async_response
async def ws_private_ble_status(hass: HomeAssistant, connection, msg) -> None:
    """Return Private BLE Device resolver status for UI setup guidance."""
    try:
        resolver = await _get_ble_resolver(hass)
        status = resolver.get_status()

        # Count RPAs in live BLE cache
        ble_live = get_bluetooth_live(hass)
        snap = ble_live.get_snapshot(max_ads=2000, max_age_s=3600)
        all_addrs = set()
        for ad in (snap.get("advertisements") or []):
            addr = ad.get("address")
            if addr:
                all_addrs.add(addr)
        status["rpa_count"] = resolver.count_rpas(all_addrs)
        status["total_ble_addresses"] = len(all_addrs)

        connection.send_result(msg["id"], status)
    except Exception as err:
        _LOGGER.warning("private_ble_status failed: %s", err)
        connection.send_result(msg["id"], {
            "irk_count": 0, "devices": [], "source_info": [],
            "has_private_ble_integration": False, "mobile_apps": [],
            "rpa_count": 0, "total_ble_addresses": 0,
            "error": str(err),
        })


@websocket_api.websocket_command({
    "type": "padspan_ha/private_ble_add_irk",
    vol.Required("irk"): str,
    vol.Optional("name", default=""): str,
})
@websocket_api.async_response
async def ws_private_ble_add_irk(hass: HomeAssistant, connection, msg) -> None:
    """Add a Private BLE Device IRK via PadSpan UI (creates HA config entry)."""
    import re as _re
    import base64 as _b64

    irk_input = str(msg.get("irk", "")).strip()
    device_name = str(msg.get("name", "")).strip() or "PadSpan Device"

    if not irk_input:
        connection.send_error(msg["id"], "invalid_irk", "IRK is required")
        return

    # Normalise IRK: accept hex (with/without colons/spaces), base64, or irk:-prefixed base64
    irk_hex = ""
    irk_stripped = irk_input
    # Strip "irk:" prefix if present (HA format)
    if irk_stripped.lower().startswith("irk:"):
        irk_stripped = irk_stripped[4:]
    try:
        # Try hex first — strip separators
        cleaned = _re.sub(r"[:\-\s]", "", irk_stripped)
        if _re.fullmatch(r"[0-9a-fA-F]{32}", cleaned):
            irk_hex = cleaned.lower()
        else:
            # Try base64
            decoded = _b64.b64decode(irk_stripped)
            if len(decoded) == 16:
                irk_hex = decoded.hex()
    except Exception:
        pass

    if not irk_hex or len(irk_hex) != 32:
        connection.send_error(msg["id"], "invalid_irk",
            "IRK must be 32 hex characters, 24-char base64 (16 bytes), or irk:-prefixed base64")
        return

    # Check for duplicates (HA stores IRK as plain hex in config entry data)
    for entry in hass.config_entries.async_entries("private_ble_device"):
        existing_irk = (entry.data or {}).get("irk", "")
        existing_clean = _re.sub(r"[:\-\s]", "", str(existing_irk)).lower()
        if existing_clean == irk_hex:
            connection.send_result(msg["id"], {
                "ok": True, "duplicate": True,
                "message": f"IRK already registered as '{entry.title}'",
            })
            return

    # HA's private_ble_device config flow accepts:
    #   1) Plain hex: "aabbccdd..." (32 chars)
    #   2) "irk:"-prefixed base64: "irk:AAAA...==" (bytes are REVERSED by HA)
    # The flow also requires the device to be actively broadcasting in range.
    irk_bytes = bytes.fromhex(irk_hex)
    irk_bytes_reversed = irk_bytes[::-1]
    irk_formats = [
        irk_hex,                                                         # plain hex
        "irk:" + _b64.b64encode(irk_bytes_reversed).decode(),           # irk:-prefixed base64 (HA reverses)
        "irk:" + _b64.b64encode(irk_bytes).decode(),                    # irk:-prefixed base64 (no reversal)
        irk_bytes_reversed.hex(),                                        # reversed hex
    ]

    async def _try_create_entry(irk_value: str) -> tuple[dict | None, str]:
        """Attempt to create a private_ble_device config entry with the given IRK format.
        Returns (flow_result, error_detail) tuple."""
        try:
            result = await hass.config_entries.flow.async_init(
                "private_ble_device",
                context={"source": "user"},
            )
            rtype = str(result.get("type", ""))

            if "create_entry" in rtype:
                return result, ""

            if "form" not in rtype:
                return None, f"flow init returned {rtype}"

            flow_id = result.get("flow_id")
            if not flow_id:
                return None, "no flow_id"

            # Submit the IRK to the form
            result2 = await hass.config_entries.flow.async_configure(
                flow_id, user_input={"irk": irk_value}
            )
            rtype2 = str(result2.get("type", ""))

            if "create_entry" in rtype2:
                return result2, ""

            errors = result2.get("errors") or {}
            if errors:
                err_detail = ", ".join(f"{k}: {v}" for k, v in errors.items())
                _LOGGER.debug("private_ble flow errors for format %s: %s",
                              irk_value[:20], err_detail)
                return None, err_detail

            return None, f"flow returned {rtype2}"
        except Exception as e:
            return None, str(e)

    try:
        created = None
        all_errors: list[str] = []
        for fmt in irk_formats:
            result, err_detail = await _try_create_entry(fmt)
            if result:
                created = result
                break
            if err_detail:
                all_errors.append(err_detail)

        if created:
            entry = created.get("result")
            if entry and device_name:
                hass.config_entries.async_update_entry(entry, title=device_name)
            # Force resolver refresh
            try:
                resolver = await _get_ble_resolver(hass)
                await resolver.async_load()
            except Exception:
                pass
            connection.send_result(msg["id"], {
                "ok": True, "duplicate": False,
                "message": f"IRK registered as '{device_name}'",
                "entry_id": entry.entry_id if entry else None,
            })
        else:
            # Determine the most helpful error message
            unique_errors = list(dict.fromkeys(all_errors))  # deduplicate preserving order
            if any("irk_not_found" in e for e in unique_errors):
                connection.send_error(msg["id"], "irk_not_found",
                    "IRK is valid but no matching device was detected. "
                    "The device must be actively broadcasting nearby (Bluetooth on, in range of a scanner). "
                    "Make sure the device is awake and near a scanner, then try again.")
            elif any("irk_not_valid" in e for e in unique_errors):
                connection.send_error(msg["id"], "irk_not_valid",
                    "IRK format not recognised by HA. Try plain hex (32 chars), "
                    "base64, or irk:-prefixed base64 from Apple Keychain.")
            else:
                detail = "; ".join(unique_errors) if unique_errors else "unknown"
                connection.send_error(msg["id"], "flow_failed",
                    f"Could not create Private BLE Device entry ({detail}). "
                    "Make sure the 'Private BLE Device' integration is available in HA "
                    "(Settings → Devices & Services → Add Integration → search 'Private BLE').")
    except Exception as err:
        _LOGGER.warning("private_ble_add_irk failed: %s", err, exc_info=True)
        connection.send_error(msg["id"], "add_failed",
            f"Failed to add IRK: {err}. Make sure 'Private BLE Device' integration is available in HA.")


@websocket_api.websocket_command({
    "type": "padspan_ha/private_ble_delete_irk",
    vol.Required("entry_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_private_ble_delete_irk(hass: HomeAssistant, connection, msg) -> None:
    """Delete a Private BLE Device config entry by entry_id."""
    entry_id = str(msg.get("entry_id", "")).strip()
    if not entry_id:
        connection.send_error(msg["id"], "invalid_entry", "entry_id is required")
        return
    entry = hass.config_entries.async_get_entry(entry_id)
    if not entry or entry.domain != "private_ble_device":
        connection.send_error(msg["id"], "not_found", "Config entry not found")
        return
    try:
        await hass.config_entries.async_remove(entry_id)
        # Refresh resolver so status reflects the deletion
        try:
            resolver = await _get_ble_resolver(hass)
            await resolver.async_load()
        except Exception:
            pass
        connection.send_result(msg["id"], {"ok": True, "removed": entry.title or entry_id})
    except Exception as err:
        connection.send_error(msg["id"], "remove_failed", str(err))


# ── Auto-discover Companion App phones via BLE Transmitter ───────────────────

@websocket_api.websocket_command({"type": "padspan_ha/companion_discover"})
@websocket_api.async_response
async def ws_companion_discover(hass: HomeAssistant, connection, msg) -> None:
    """Discover HA Companion App phones that have BLE Transmitter enabled.

    Scans for sensor.*_ble_transmitter entities, reads their transmitting UUID,
    and matches against detected iBeacon objects in the current snapshot.
    Returns a list of phones that can be auto-followed.
    """
    try:
        from homeassistant.helpers import entity_registry as er

        ent_reg = er.async_get(hass)
        phones: list[dict[str, Any]] = []

        # Find all BLE transmitter sensor entities from mobile_app
        for entity in ent_reg.entities.values():
            if entity.platform != "mobile_app":
                continue
            eid = entity.entity_id
            if "ble_transmitter" not in eid:
                continue

            # Read entity state — the state or attributes contain the transmitting UUID
            state_obj = hass.states.get(eid)
            is_disabled = entity.disabled_by is not None

            # Disabled entities have no state in HA.  Still show them in the
            # discovery list so the UI can prompt the user to enable them
            # (common on iOS where BLE Transmitter is disabled by default).
            if not state_obj and not is_disabled:
                continue

            attrs = (state_obj.attributes or {}) if state_obj else {}
            _LOGGER.debug(
                "companion_discover: %s state=%r disabled=%s attrs=%s",
                eid, state_obj.state if state_obj else "(no state)", is_disabled,
                {k: str(v)[:80] for k, v in attrs.items()},
            )

            # Companion App stores UUID, Major, Minor in separate attributes
            # or as a combined "transmitting_id" / "id" / the state itself.
            uuid_attr = ""
            major = 0
            minor = 0
            transmitting_id = ""

            # Try separate UUID / Major / Minor attributes first (most reliable)
            if attrs.get("UUID") or attrs.get("uuid"):
                uuid_attr = str(attrs.get("UUID") or attrs.get("uuid") or "")
                major = int(attrs.get("Major", attrs.get("major", 0)))
                minor = int(attrs.get("Minor", attrs.get("minor", 0)))
            else:
                # Fall back to combined transmitting_id / id attribute or state
                transmitting_id = (
                    attrs.get("transmitting_id")
                    or attrs.get("id")
                    or ""
                )
                # Also check if the state itself is a UUID-like string
                if not transmitting_id and state_obj.state and len(state_obj.state) > 30:
                    transmitting_id = state_obj.state

                if transmitting_id:
                    # Parse UUID, Major, Minor from transmitting_id.
                    # Formats seen in the wild:
                    #   Dashes:      "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX-Major-Minor"
                    #   Underscores: "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX_Major_Minor"
                    # A standard UUID is exactly 36 chars (8-4-4-4-12).
                    # If the string is longer, the suffix holds Major/Minor.
                    import re as _re
                    _tid = transmitting_id.strip()
                    if len(_tid) > 36:
                        _uuid_part = _tid[:36]
                        _suffix = _tid[36:]  # e.g. "_100_40004" or "-100-40004"
                        _nums = _re.findall(r"\d+", _suffix)
                        if len(_nums) >= 2:
                            try:
                                major = int(_nums[0])
                                minor = int(_nums[1])
                                uuid_attr = _uuid_part
                            except (ValueError, IndexError):
                                uuid_attr = _tid
                        elif len(_nums) == 1:
                            try:
                                major = int(_nums[0])
                                uuid_attr = _uuid_part
                            except (ValueError, IndexError):
                                uuid_attr = _tid
                        else:
                            uuid_attr = _tid
                    else:
                        uuid_attr = _tid

            # Disabled entities (common on iOS) — show in list so user can enable
            if is_disabled:
                device_name = ""
                if entity.device_id:
                    from homeassistant.helpers import device_registry as dr
                    dev_reg = dr.async_get(hass)
                    device = dev_reg.async_get(entity.device_id)
                    if device:
                        device_name = device.name or device.name_by_user or ""
                if not device_name:
                    device_name = eid.replace("sensor.", "").replace("_ble_transmitter", "").replace("_", " ").title()
                phones.append({
                    "entity_id": eid,
                    "device_name": device_name,
                    "uuid": "",
                    "major": 0,
                    "minor": 0,
                    "ibeacon_key": "",
                    "transmitting_id": "",
                    "is_transmitting": False,
                    "is_visible": False,
                    "is_followed": False,
                    "is_disabled": True,
                    "existing_label": "",
                    "state": "disabled",
                    "attributes": {},
                })
                continue

            if not uuid_attr:
                _LOGGER.debug("companion_discover: %s — no UUID found, skipping", eid)
                continue

            # Normalise UUID to lowercase with dashes
            uuid_clean = uuid_attr.lower().strip().replace(" ", "")
            if len(uuid_clean) == 32:
                uuid_clean = f"{uuid_clean[:8]}-{uuid_clean[8:12]}-{uuid_clean[12:16]}-{uuid_clean[16:20]}-{uuid_clean[20:]}"

            # Get device name from the parent device
            device_name = ""
            if entity.device_id:
                from homeassistant.helpers import device_registry as dr
                dev_reg = dr.async_get(hass)
                device = dev_reg.async_get(entity.device_id)
                if device:
                    device_name = device.name or device.name_by_user or ""

            if not device_name:
                device_name = eid.replace("sensor.", "").replace("_ble_transmitter", "").replace("_", " ").title()

            # Build the iBeacon key that PadspanHA would use
            ibeacon_key = f"ibeacon:{uuid_clean}:{major}:{minor}"

            # Check if this phone is already labelled/followed
            obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
            existing_label = ""
            if obj_store:
                entry = obj_store.get(ibeacon_key)
                if entry:
                    existing_label = entry.get("label", "")

            settings = _get_settings(hass)
            followed = settings.get("followed_addrs") or []
            is_followed = ibeacon_key in followed or ibeacon_key.upper() in [f.upper() for f in followed]

            # Check if the iBeacon is currently visible in BLE
            is_visible = False
            try:
                ble_live = get_bluetooth_live(hass)
                ble_snap = ble_live.get_snapshot(max_ads=2000, max_age_s=600)
                for ad in (ble_snap.get("advertisements") or []):
                    mfr = ad.get("manufacturer_data") or {}
                    from .private_ble_resolver import PrivateBLEResolver
                    parsed = PrivateBLEResolver.parse_ibeacon(mfr)
                    if parsed and parsed["uuid"].lower() == uuid_clean and parsed["major"] == major and parsed["minor"] == minor:
                        is_visible = True
                        break
            except Exception:
                pass

            phones.append({
                "entity_id": eid,
                "device_name": device_name,
                "uuid": uuid_clean,
                "major": major,
                "minor": minor,
                "ibeacon_key": ibeacon_key,
                "transmitting_id": transmitting_id,
                "is_transmitting": state_obj.state not in ("unavailable", "unknown", "off", ""),
                "is_visible": is_visible,
                "is_followed": is_followed,
                "is_disabled": False,
                "existing_label": existing_label,
                "state": state_obj.state,
                "attributes": {k: str(v) for k, v in attrs.items()},
            })

        connection.send_result(msg["id"], {"phones": phones})
    except Exception as err:
        _LOGGER.warning("companion_discover failed: %s", err)
        connection.send_result(msg["id"], {"phones": [], "error": str(err)})


@websocket_api.websocket_command({
    "type": "padspan_ha/companion_follow",
    vol.Required("ibeacon_key"): str,
    vol.Required("device_name"): str,
    vol.Optional("entity_id"): str,
})
@websocket_api.async_response
async def ws_companion_follow(hass: HomeAssistant, connection, msg) -> None:
    """Auto-label and auto-follow a Companion App phone by its iBeacon key.

    This is the one-click action: labels the iBeacon object with the phone name,
    adds it to the followed list, and enables the BLE Transmitter sensor so the
    Companion App starts broadcasting.  Returns verification of what was done.
    """
    try:
        ibeacon_key = str(msg["ibeacon_key"])
        follow_key = ibeacon_key.upper()  # followed_addrs are always uppercase
        device_name = str(msg["device_name"]).strip()
        transmitter_eid = str(msg.get("entity_id") or "").strip()

        if not device_name:
            device_name = "Phone"

        results: list[str] = []
        labelled = False
        followed = False
        transmitter_enabled = False

        # 1) Label the object in ObjectStore (tagged)
        obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
        if obj_store:
            await obj_store.async_set(ibeacon_key, device_name)
            # Also label the uppercase variant so lookups always match
            await obj_store.async_set(follow_key, device_name)

            # If this phone also resolves via IRK (private_ble), store the label
            # under the canonical_id too — otherwise the private_ble object won't
            # find it (private_ble looks up by canonical_id, not ibeacon key).
            try:
                resolver = await _get_ble_resolver(hass)
                ble_live = get_bluetooth_live(hass)
                ble_snap = ble_live.get_snapshot(max_ads=2000, max_age_s=600)
                for ad in (ble_snap.get("advertisements") or []):
                    ib = resolver.parse_ibeacon(ad.get("manufacturer_data") or {})
                    if not ib:
                        continue
                    ad_ib_key = f"ibeacon:{ib['uuid']}:{ib['major']}:{ib['minor']}"
                    if ad_ib_key.upper() != follow_key:
                        continue
                    ad_addr = (ad.get("address") or "").upper()
                    resolved = resolver.resolve_address(ad_addr)
                    if resolved and resolved.get("canonical_id"):
                        cid = resolved["canonical_id"]
                        await obj_store.async_set(cid, device_name)
                        _LOGGER.info(
                            "companion_follow: also labelled canonical_id %s for %s",
                            cid, device_name,
                        )
                    break
            except Exception as _cid_err:
                _LOGGER.debug("companion_follow: canonical_id cross-label: %s", _cid_err)

            labelled = True
            results.append(f"Labelled as '{device_name}'")

        # 2) Add to followed_addrs in settings (always uppercase)
        st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if st:
            followed_list = list(st.data.get("followed_addrs") or [])
            existing_upper = {f.upper() for f in followed_list}
            if follow_key not in existing_upper:
                followed_list.append(follow_key)
                await st.async_set(followed_addrs=followed_list)
                followed = True
                results.append("Added to followed list")
            else:
                followed = True
                results.append("Already followed")

        # 3) Enable BLE Transmitter: entity registry + notify command to app.
        if transmitter_eid:
            # 3a) Enable in entity registry (un-disable if disabled)
            try:
                from homeassistant.helpers import entity_registry as er

                ent_reg = er.async_get(hass)
                ent_entry = ent_reg.async_get(transmitter_eid)
                if ent_entry and ent_entry.disabled_by is not None:
                    ent_reg.async_update_entity(
                        transmitter_eid, disabled_by=None
                    )
                    transmitter_enabled = True
                    results.append("BLE Transmitter entity enabled")
            except Exception as te:
                _LOGGER.debug("Entity registry enable for %s: %s", transmitter_eid, te)

            # 3b) Send notification command to Companion App to turn on the
            #     BLE transmitter sensor.  The Companion App (Android + iOS)
            #     supports command_ble_transmitter via the notify service.
            try:
                from homeassistant.helpers import entity_registry as er, device_registry as dr

                ent_reg = er.async_get(hass)
                ent_entry = ent_reg.async_get(transmitter_eid)
                if ent_entry and ent_entry.device_id:
                    dev_reg = dr.async_get(hass)
                    device = dev_reg.async_get(ent_entry.device_id)
                    if device:
                        # Find the notify service for this mobile_app device.
                        # Convention: notify.mobile_app_<device_name_slug>
                        notify_target = None
                        for ident in device.identifiers:
                            if ident[0] == "mobile_app":
                                notify_target = f"mobile_app_{ident[1]}"
                                break
                        if not notify_target:
                            # Fallback: derive from device name
                            dname = (device.name or "").lower().replace(" ", "_").replace("-", "_")
                            if dname:
                                notify_target = f"mobile_app_{dname}"
                        if notify_target:
                            await hass.services.async_call(
                                "notify",
                                notify_target,
                                {
                                    "message": "command_ble_transmitter",
                                    "data": {"command": "turn_on"},
                                },
                                blocking=True,
                            )
                            transmitter_enabled = True
                            results.append("BLE Transmitter command sent to phone")
                            _LOGGER.info(
                                "Sent command_ble_transmitter turn_on via notify.%s",
                                notify_target,
                            )
            except Exception as te:
                _LOGGER.warning(
                    "Failed to send BLE Transmitter command for %s: %s",
                    transmitter_eid,
                    te,
                )
                results.append(f"BLE command send failed: {te}")

        # 4) Verify: re-read to confirm persistence
        verify_label = ""
        verify_followed = False
        if obj_store:
            entry = obj_store.get(ibeacon_key) or obj_store.get(follow_key)
            verify_label = (entry or {}).get("label", "")
        if st:
            verify_followed = follow_key in {f.upper() for f in (st.data.get("followed_addrs") or [])}

        connection.send_result(msg["id"], {
            "ok": True,
            "ibeacon_key": ibeacon_key,
            "follow_key": follow_key,
            "device_name": device_name,
            "labelled": labelled,
            "followed": followed,
            "transmitter_enabled": transmitter_enabled,
            "verified_label": verify_label,
            "verified_followed": verify_followed,
            "actions": results,
        })
    except Exception as err:
        _LOGGER.warning("companion_follow failed: %s", err)
        connection.send_error(msg["id"], "follow_failed", str(err))


@websocket_api.websocket_command({
    "type": "padspan_ha/companion_unfollow",
    vol.Required("ibeacon_key"): str,
})
@websocket_api.async_response
async def ws_companion_unfollow(hass: HomeAssistant, connection, msg) -> None:
    """Remove a Companion App phone from followed list and delete its label."""
    try:
        ibeacon_key = str(msg["ibeacon_key"])
        follow_key = ibeacon_key.upper()
        results: list[str] = []

        # 1) Remove label from ObjectStore
        obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
        if obj_store:
            await obj_store.async_delete(ibeacon_key)
            await obj_store.async_delete(follow_key)
            results.append("Label removed")

        # 2) Remove from followed_addrs
        st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if st:
            followed_list = list(st.data.get("followed_addrs") or [])
            new_list = [f for f in followed_list if f.upper() != follow_key]
            if len(new_list) < len(followed_list):
                await st.async_set(followed_addrs=new_list)
                results.append("Removed from followed list")

        # 3) Clear coordinator state so object doesn't linger as stale
        try:
            _coord_uf = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
            if _coord_uf:
                _coord_uf.clear_object_state(ibeacon_key)
        except Exception:
            pass

        connection.send_result(msg["id"], {
            "ok": True,
            "ibeacon_key": ibeacon_key,
            "actions": results,
        })
    except Exception as err:
        _LOGGER.warning("companion_unfollow failed: %s", err)
        connection.send_error(msg["id"], "unfollow_failed", str(err))


# ── HA Tags integration status ──────────────────────────────────────────────

@websocket_api.websocket_command({"type": "padspan_ha/tags_status"})
@websocket_api.async_response
async def ws_tags_status(hass: HomeAssistant, connection, msg) -> None:
    """Return HA Tags integration status and followed object tag mappings."""
    try:
        settings = _get_settings(hass)
        room_events = settings.get("tags_room_events_enabled", False)
        nfc_identify = settings.get("tags_nfc_identify_enabled", False)
        phone_autolink = settings.get("tags_phone_autolink_enabled", False)

        # Build tag_id mappings for followed objects
        import re
        followed = settings.get("followed_addrs") or []
        obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
        mappings: list[dict[str, str]] = []
        for addr in followed:
            tag_id = "padspan_" + re.sub(r"[^a-z0-9_]", "_", addr.lower().strip())
            label = addr
            if obj_store:
                entry = obj_store.get(addr)
                if entry:
                    label = entry.get("label", addr)
            mappings.append({
                "object_key": addr,
                "tag_id": tag_id,
                "label": label,
            })

        # Check if HA tag component is loaded
        tag_available = "tag" in hass.config.components

        connection.send_result(msg["id"], {
            "tag_available": tag_available,
            "room_events_enabled": room_events,
            "nfc_identify_enabled": nfc_identify,
            "phone_autolink_enabled": phone_autolink,
            "followed_tag_mappings": mappings,
        })
    except Exception as err:
        _LOGGER.warning("tags_status failed: %s", err)
        connection.send_result(msg["id"], {
            "tag_available": False,
            "room_events_enabled": False,
            "nfc_identify_enabled": False,
            "phone_autolink_enabled": False,
            "followed_tag_mappings": [],
            "error": str(err),
        })


# ═══════════════════════════════════════════════════════════════════════════════
# Factory Reset — wipe ALL persistent data
# ═══════════════════════════════════════════════════════════════════════════════

@websocket_api.websocket_command({
    "type": "padspan_ha/factory_reset",
    vol.Required("confirm"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_factory_reset(hass: HomeAssistant, connection, msg) -> None:
    """Erase every PadSpan HA persistent store and reset to factory defaults.

    Requires confirm="FACTORY RESET" to execute.  Admin-only.
    Clears: settings, calibration, adaptive, objects, maps, model,
    alerts, movement, traceback, object_history, and backups.

    Each store type is reset to its correct default state — not blindly to {}.
    bluetooth_live is intentionally left intact so BLE radios keep working.
    """
    if msg["confirm"] != "FACTORY RESET":
        connection.send_error(
            msg["id"], "confirmation_failed",
            'You must pass confirm="FACTORY RESET" to proceed.'
        )
        return

    import asyncio as _aio
    from pathlib import Path as _Path
    from homeassistant.helpers.storage import Store as _St
    from .settings_store import DEFAULT_SETTINGS
    from .model_store import DEFAULT_DATA as _model_defaults

    def _adaptive_empty():
        return {
            "room_fingerprints": {},
            "transition_counts": {},
            "floor_pairs": {},
            "stats": {"total_observations": 0, "learning_since": None, "days_active": 0},
        }

    domain = hass.data.get(DOMAIN, {})
    cleared = 0
    errors = []

    # ── 1. SettingsStore — reset to DEFAULT_SETTINGS, NOT {} ─────────────
    try:
        st = _St(hass, 1, SETTINGS_STORE_KEY)
        await st.async_save(dict(DEFAULT_SETTINGS))
        cleared += 1
        store_obj = domain.get(DATA_SETTINGS)
        if store_obj and hasattr(store_obj, "data"):
            store_obj.data = dict(DEFAULT_SETTINGS)
    except Exception as e:
        _LOGGER.warning("Factory reset: settings — %s", e)
        errors.append(SETTINGS_STORE_KEY)

    # ── 2. MapsStore — reset to {"maps": []} and delete map image files ──
    try:
        st = _St(hass, 1, MAPS_STORE_KEY)
        await st.async_save({"maps": []})
        cleared += 1
        maps_obj = domain.get(DATA_MAPS)
        if maps_obj and hasattr(maps_obj, "data"):
            maps_obj.data = {"maps": []}
        # Delete uploaded map images
        if maps_obj and hasattr(maps_obj, "maps_dir"):
            _mdir = maps_obj.maps_dir
        else:
            _mdir = _Path(hass.config.path("www")) / "padspan_ha" / "maps"
        if _mdir.is_dir():
            for f in _mdir.iterdir():
                if f.is_file() and f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
                    try:
                        await _aio.to_thread(f.unlink)
                    except Exception:
                        pass
    except Exception as e:
        _LOGGER.warning("Factory reset: maps — %s", e)
        errors.append(MAPS_STORE_KEY)

    # ── 3. CalibrationStore — reset to {"points": [], "model": {}} ───────
    try:
        st = _St(hass, 1, CALIBRATION_STORE_KEY)
        await st.async_save({"points": [], "model": {}})
        cleared += 1
        cal_obj = domain.get(DATA_CALIBRATION)
        if cal_obj and hasattr(cal_obj, "data"):
            cal_obj.data = {"points": [], "model": {}}
    except Exception as e:
        _LOGGER.warning("Factory reset: calibration — %s", e)
        errors.append(CALIBRATION_STORE_KEY)

    # ── 4. AdaptiveStore — reset to _empty_data() ────────────────────────
    try:
        st = _St(hass, 1, ADAPTIVE_STORE_KEY)
        await st.async_save(_adaptive_empty())
        cleared += 1
        ada_obj = domain.get(DATA_ADAPTIVE)
        if ada_obj and hasattr(ada_obj, "data"):
            ada_obj.data = _adaptive_empty()
    except Exception as e:
        _LOGGER.warning("Factory reset: adaptive — %s", e)
        errors.append(ADAPTIVE_STORE_KEY)

    # ── 5. ModelStore — reset to DEFAULT_DATA ─────────────────────────────
    try:
        st = _St(hass, 1, MODEL_STORE_KEY)
        await st.async_save(dict(_model_defaults))
        cleared += 1
        mod_obj = domain.get(DATA_MODEL)
        if mod_obj and hasattr(mod_obj, "data"):
            mod_obj.data = dict(_model_defaults)
    except Exception as e:
        _LOGGER.warning("Factory reset: model — %s", e)
        errors.append(MODEL_STORE_KEY)

    # ── 6. ObjectStore — reset ._data to {} ───────────────────────────────
    try:
        st = _St(hass, 1, OBJECT_STORE_KEY)
        await st.async_save({})
        cleared += 1
        obj_obj = domain.get(DATA_OBJECTS)
        if obj_obj:
            if hasattr(obj_obj, "_data"):
                obj_obj._data = {}
            elif hasattr(obj_obj, "data"):
                obj_obj.data = {}
    except Exception as e:
        _LOGGER.warning("Factory reset: objects — %s", e)
        errors.append(OBJECT_STORE_KEY)

    # ── 7. AlertStore — reset to {} ───────────────────────────────────────
    try:
        st = _St(hass, 1, ALERTS_STORE_KEY)
        await st.async_save({})
        cleared += 1
        alert_obj = domain.get(DATA_ALERTS)
        if alert_obj and hasattr(alert_obj, "data"):
            alert_obj.data = {}
    except Exception as e:
        _LOGGER.warning("Factory reset: alerts — %s", e)
        errors.append(ALERTS_STORE_KEY)

    # ── 8. MovementStore — reset .entries to [] ───────────────────────────
    try:
        st = _St(hass, 1, MOVEMENT_STORE_KEY)
        await st.async_save([])
        cleared += 1
        mov_obj = domain.get(DATA_MOVEMENT)
        if mov_obj and hasattr(mov_obj, "entries"):
            mov_obj.entries = []
        elif mov_obj and hasattr(mov_obj, "data"):
            mov_obj.data = []
    except Exception as e:
        _LOGGER.warning("Factory reset: movement — %s", e)
        errors.append(MOVEMENT_STORE_KEY)

    # ── 9. TracebackStore — reset .frames to [] ──────────────────────────
    try:
        st = _St(hass, 1, TRACEBACK_STORE_KEY)
        await st.async_save({"frames": []})
        cleared += 1
        tb_obj = domain.get(DATA_TRACEBACK)
        if tb_obj and hasattr(tb_obj, "frames"):
            tb_obj.frames = []
        elif tb_obj and hasattr(tb_obj, "data"):
            tb_obj.data = {"frames": []}
    except Exception as e:
        _LOGGER.warning("Factory reset: traceback — %s", e)
        errors.append(TRACEBACK_STORE_KEY)

    # ── 10. Object history (plain dict, not a store class) ────────────────
    try:
        st = _St(hass, 1, OBJECT_HISTORY_STORE_KEY)
        await st.async_save({})
        cleared += 1
    except Exception as e:
        _LOGGER.warning("Factory reset: object_history — %s", e)
        errors.append(OBJECT_HISTORY_STORE_KEY)

    # ── 11. Backups store ─────────────────────────────────────────────────
    try:
        st = _St(hass, 1, BACKUPS_STORE_KEY)
        await st.async_save({})
        cleared += 1
    except Exception as e:
        _LOGGER.warning("Factory reset: backups — %s", e)
        errors.append(BACKUPS_STORE_KEY)

    # ── Clear ALL in-memory caches ────────────────────────────────────────

    # Object snapshot cache (used for fast re-renders)
    domain.pop(DATA_OBJECTS_CACHE, None)

    # Object history — set to None so the reload condition triggers fresh load
    domain.pop(DATA_OBJECT_HISTORY, None)
    domain.pop("_obj_hist_last_save", None)
    domain.pop("_obj_hist_store", None)

    # Presence coordinator caches
    try:
        _coord = domain.get("presence_coordinator")
        if _coord:
            for attr in ("_known_objs", "_last_seen", "_room_votes",
                         "_room_confidence", "_device_labels"):
                if hasattr(_coord, attr):
                    getattr(_coord, attr).clear()
    except Exception:
        pass

    # Main coordinator caches
    try:
        _main_coord = domain.get(DATA_COORDINATOR)
        if _main_coord:
            for attr in ("_known_objs", "_last_seen"):
                if hasattr(_main_coord, attr):
                    getattr(_main_coord, attr).clear()
    except Exception:
        pass

    _LOGGER.warning(
        "FACTORY RESET executed by %s — cleared %d stores",
        connection.user.name if connection.user else "unknown",
        cleared,
    )

    connection.send_result(msg["id"], {
        "ok": len(errors) == 0,
        "cleared": cleared,
        "total": 11,
        "errors": errors,
    })