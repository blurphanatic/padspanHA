from __future__ import annotations

"""
REPO LOGIC NOTES

Global "model" store:
- floors (aka map owners)
- per-room metadata (floor assignment + color)

This is intentionally separate from MapsStore:
- floors + room_meta are shared across ALL maps
- maps are per-image resources

We keep defaults simple and safe. The UI can later expand this schema without breaking.
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
        else:
            self.data = dict(DEFAULT_DATA)

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
        }

    def floors(self) -> list[dict[str, Any]]:
        return list(self.data.get("floors", []))

    def room_meta(self) -> dict[str, dict[str, Any]]:
        return dict(self.data.get("room_meta", {}))

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
