# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
PadSpan HA — Model Store
==========================
Global spatial model: floors and per-room metadata (floor assignment + color).

Deliberately separate from MapsStore because:
- Floors and room_meta are shared across ALL maps (a room exists independently
  of which map it appears on).
- Maps are per-image resources with their own metadata.

Data layout in .storage/padspan_ha.model:
  {
    "floors": [{"id": "main", "name": "Main Floor"}, ...],
    "room_meta": {"Kitchen": {"floor_id": "main", "color": "#7a9b5c"}, ...}
  }

Room colours are deterministically generated from the room name (SHA-256 hash →
pastel RGB) so they're stable across sessions without needing explicit assignment.
"""

import asyncio
import hashlib
import re
from dataclasses import dataclass, field
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import MODEL_STORE_KEY, DEFAULT_FLOOR_ID


def _slug(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "floor"


def _hash_color_hex(name: str) -> str:
    # Stable, pleasant-ish pastel palette from hash (not too dark).
    h = hashlib.sha256(name.encode("utf-8")).hexdigest()
    # Use first bytes to pick hue-ish RGB.
    r = 64 + (int(h[0:2], 16) % 160)
    g = 64 + (int(h[2:4], 16) % 160)
    b = 64 + (int(h[4:6], 16) % 160)
    return f"#{r:02x}{g:02x}{b:02x}"


DEFAULT_DATA: dict[str, Any] = {
    "floors": [
        {"id": DEFAULT_FLOOR_ID, "name": "Main Floor"},
    ],
    "room_meta": {
        # roomName: { floor_id, color }
    },
    # ── Positioning fabric (Phase 1 decoupling) ──────────────────────────────
    "scanners": {
        # source_name: { room, floor_id, source_type }
        # source_type: "ha_sync" (auto-populated from HA) | "manual" (user-set)
    },
    "room_adjacency": {
        # room_name: [neighbor_room_name, ...]
    },
    "fabric_sync_mode": "auto",  # "auto" = sync from HA, "manual" = standalone
}


@dataclass
class ModelStore:
    hass: HomeAssistant
    store: Store
    data: dict[str, Any] = field(default_factory=lambda: dict(DEFAULT_DATA))

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = Store(hass, 1, MODEL_STORE_KEY)
        self.data = dict(DEFAULT_DATA)

    async def async_setup(self) -> None:
        loaded = await self.store.async_load()
        if isinstance(loaded, dict):
            # Merge with defaults
            floors = loaded.get("floors") if isinstance(loaded.get("floors"), list) else DEFAULT_DATA["floors"]
            room_meta = loaded.get("room_meta") if isinstance(loaded.get("room_meta"), dict) else {}
            self.data = {"floors": floors, "room_meta": room_meta}
            # ── Migration: add fabric keys if absent (pre-Phase-1 stores) ────
            if "scanners" not in self.data or not isinstance(self.data.get("scanners"), dict):
                self.data["scanners"] = {}
            if "room_adjacency" not in self.data or not isinstance(self.data.get("room_adjacency"), dict):
                self.data["room_adjacency"] = {}
            if "fabric_sync_mode" not in self.data or self.data.get("fabric_sync_mode") not in ("auto", "manual"):
                self.data["fabric_sync_mode"] = "auto"
        else:
            self.data = {k: (list(v) if isinstance(v, list) else dict(v) if isinstance(v, dict) else v) for k, v in DEFAULT_DATA.items()}

        # Normalize floors
        norm_floors: list[dict[str, Any]] = []
        seen: set[str] = set()
        for f in self.data.get("floors", []):
            if not isinstance(f, dict):
                continue
            fid = str(f.get("id") or "").strip() or DEFAULT_FLOOR_ID
            if fid in seen:
                continue
            seen.add(fid)
            norm_floors.append({"id": fid[:40], "name": str(f.get("name") or fid)[:80]})
        if not norm_floors:
            norm_floors = list(DEFAULT_DATA["floors"])
        self.data["floors"] = norm_floors

        # Normalize room_meta
        rm: dict[str, Any] = {}
        for k, v in (self.data.get("room_meta") or {}).items():
            if not isinstance(k, str) or not isinstance(v, dict):
                continue
            room = k[:120]
            floor_id = str(v.get("floor_id") or DEFAULT_FLOOR_ID)[:40]
            color = str(v.get("color") or _hash_color_hex(room))[:20]
            rm[room] = {"floor_id": floor_id, "color": color}
        self.data["room_meta"] = rm

        await self.store.async_save(self.data)

    def snapshot(self) -> dict[str, Any]:
        return {
            "floors": list(self.data.get("floors", [])),
            "room_meta": dict(self.data.get("room_meta", {})),
            "scanners": dict(self.data.get("scanners", {})),
            "room_adjacency": dict(self.data.get("room_adjacency", {})),
            "fabric_sync_mode": self.data.get("fabric_sync_mode", "auto"),
        }

    def floors(self) -> list[dict[str, Any]]:
        return list(self.data.get("floors", []))

    def room_meta(self) -> dict[str, dict[str, Any]]:
        return dict(self.data.get("room_meta", {}))

    # ── Fabric accessors ────────────────────────────────────────────────────

    def get_scanner_mappings(self) -> tuple[dict[str, str], dict[str, str]]:
        """Return (source_to_area, source_to_floor) from the scanners dict."""
        source_to_area: dict[str, str] = {}
        source_to_floor: dict[str, str] = {}
        for src, info in (self.data.get("scanners") or {}).items():
            if not isinstance(info, dict):
                continue
            room = info.get("room")
            if room:
                source_to_area[src] = str(room)
            fl = info.get("floor_id")
            if fl:
                source_to_floor[src] = str(fl)
        return source_to_area, source_to_floor

    def adjacency(self) -> dict[str, list[str]]:
        """Return room adjacency map: {room: [neighbor, ...]}."""
        return dict(self.data.get("room_adjacency") or {})

    def sync_mode(self) -> str:
        """Return fabric sync mode: 'auto' or 'manual'."""
        return self.data.get("fabric_sync_mode", "auto")

    async def async_set_scanner(self, source: str, room: str, floor_id: str, source_type: str = "manual") -> None:
        """Add or update a scanner in the fabric."""
        scanners = self.data.setdefault("scanners", {})
        scanners[str(source)] = {
            "room": str(room),
            "floor_id": str(floor_id or DEFAULT_FLOOR_ID),
            "source_type": str(source_type),
        }
        await self.store.async_save(self.data)

    async def async_remove_scanner(self, source: str) -> None:
        """Remove a scanner from the fabric."""
        scanners = self.data.get("scanners") or {}
        scanners.pop(str(source), None)
        await self.store.async_save(self.data)

    async def async_set_adjacency(self, room: str, neighbors: list[str]) -> None:
        """Set room neighbors (replaces existing list for this room)."""
        adj = self.data.setdefault("room_adjacency", {})
        adj[str(room)] = [str(n) for n in neighbors]
        await self.store.async_save(self.data)

    async def async_remove_adjacency(self, room: str) -> None:
        """Remove a room from the adjacency map (and from all neighbor lists)."""
        adj = self.data.get("room_adjacency") or {}
        adj.pop(str(room), None)
        # Also remove from other rooms' neighbor lists
        for k in list(adj):
            if str(room) in adj[k]:
                adj[k] = [n for n in adj[k] if n != str(room)]
        await self.store.async_save(self.data)

    async def async_set_sync_mode(self, mode: str) -> None:
        """Switch fabric sync mode: 'auto' or 'manual'."""
        if mode not in ("auto", "manual"):
            mode = "auto"
        self.data["fabric_sync_mode"] = mode
        await self.store.async_save(self.data)

    async def async_sync_from_snapshot(self, radios: list[dict]) -> None:
        """Compare BLE snapshot radios with stored scanners; update ha_sync entries.

        Only modifies entries with source_type='ha_sync'. Manual entries are preserved.
        Debounced internally — call freely from the poll loop.
        """
        scanners = self.data.setdefault("scanners", {})
        changed = False

        # Build set of sources seen in this snapshot
        seen_sources: set[str] = set()
        for r in (radios or []):
            src = r.get("source")
            area = r.get("area_name") or r.get("area")
            if not src or not area:
                continue
            src = str(src)
            area = str(area)
            seen_sources.add(src)
            existing = scanners.get(src)
            if existing and existing.get("source_type") == "manual":
                continue  # never overwrite manual entries
            if not existing or existing.get("room") != area:
                scanners[src] = {
                    "room": area,
                    "floor_id": existing.get("floor_id", DEFAULT_FLOOR_ID) if existing else DEFAULT_FLOOR_ID,
                    "source_type": "ha_sync",
                }
                changed = True

        if changed:
            await self.store.async_save(self.data)

    async def async_sync_from_ha(self) -> None:
        """Sync scanners from HA Area/Floor registries (startup path).

        Reads HA device registry to find BLE proxy devices with area assignments,
        then populates the scanners dict. Preserves manual entries.
        """
        try:
            from homeassistant.helpers import (
                area_registry as ar_mod,
                device_registry as dr_mod,
                floor_registry as fr_mod,
            )
        except ImportError:
            return

        dr = dr_mod.async_get(self.hass)
        ar = ar_mod.async_get(self.hass)

        # Build area_id→name and area_id→floor_id maps
        area_id_to_name: dict[str, str] = {}
        area_id_to_floor: dict[str, str] = {}
        for a in ar.async_list_areas():
            area_id_to_name[a.id] = a.name
            fl = getattr(a, "floor_id", None)
            if fl:
                area_id_to_floor[a.id] = str(fl)

        scanners = self.data.setdefault("scanners", {})
        changed = False

        # Find ESPHome BLE proxy devices with area assignments
        for dev in dr.devices.values():
            if not dev.area_id:
                continue
            area_name = area_id_to_name.get(dev.area_id)
            if not area_name:
                continue

            # Use device name as source identifier (matches snapshot radios)
            src = dev.name_by_user or dev.name
            if not src:
                continue

            existing = scanners.get(src)
            if existing and existing.get("source_type") == "manual":
                continue  # preserve manual entries

            floor_id = area_id_to_floor.get(dev.area_id, DEFAULT_FLOOR_ID)
            new_entry = {
                "room": area_name,
                "floor_id": floor_id,
                "source_type": "ha_sync",
            }
            if not existing or existing != new_entry:
                scanners[src] = new_entry
                changed = True

        if changed:
            await self.store.async_save(self.data)

    def has_floor(self, floor_id: str) -> bool:
        fid = str(floor_id or "")
        return any(f.get("id") == fid for f in self.data.get("floors", []))

    async def async_ensure_rooms(self, rooms: list[str]) -> None:
        changed = False
        rm: dict[str, Any] = self.data.get("room_meta", {}) or {}
        for r in rooms or []:
            if not r or not isinstance(r, str):
                continue
            if r not in rm:
                rm[r] = {"floor_id": DEFAULT_FLOOR_ID, "color": _hash_color_hex(r)}
                changed = True
            else:
                # Ensure keys exist
                if "floor_id" not in rm[r]:
                    rm[r]["floor_id"] = DEFAULT_FLOOR_ID
                    changed = True
                if "color" not in rm[r] or not rm[r]["color"]:
                    rm[r]["color"] = _hash_color_hex(r)
                    changed = True
        if changed:
            self.data["room_meta"] = rm
            await self.store.async_save(self.data)

    async def async_update(self, *, floors: list[dict[str, Any]] | None = None, room_meta: dict[str, Any] | None = None) -> dict[str, Any]:
        if isinstance(floors, list):
            norm_floors: list[dict[str, Any]] = []
            seen: set[str] = set()
            for f in floors:
                if not isinstance(f, dict):
                    continue
                fid = str(f.get("id") or "").strip()
                name = str(f.get("name") or "").strip()
                if not fid:
                    fid = _slug(name)[:40]
                fid = fid[:40]
                if not fid or fid in seen:
                    continue
                seen.add(fid)
                norm_floors.append({"id": fid, "name": (name or fid)[:80]})
            if not any(x["id"] == DEFAULT_FLOOR_ID for x in norm_floors):
                norm_floors.insert(0, {"id": DEFAULT_FLOOR_ID, "name": "Main Floor"})
            self.data["floors"] = norm_floors

        if isinstance(room_meta, dict):
            rm: dict[str, Any] = self.data.get("room_meta", {}) or {}
            for room, meta in room_meta.items():
                if not isinstance(room, str) or not isinstance(meta, dict):
                    continue
                r = room[:120]
                floor_id = str(meta.get("floor_id") or DEFAULT_FLOOR_ID)[:40]
                if not self.has_floor(floor_id):
                    floor_id = DEFAULT_FLOOR_ID
                color = str(meta.get("color") or _hash_color_hex(r))[:20]
                rm[r] = {"floor_id": floor_id, "color": color}
            self.data["room_meta"] = rm

        await self.store.async_save(self.data)
        return self.snapshot()
