from __future__ import annotations

import asyncio
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN


def _collect_entries(hass: HomeAssistant) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for entry_id, bucket in hass.data.get(DOMAIN, {}).items():
        if not isinstance(bucket, dict):
            continue
        coordinator = bucket.get("coordinator")
        if coordinator is None:
            continue
        data = coordinator.data or {}
        entries.append(
            {
                "entry_id": entry_id,
                "status": data.get("status", "unknown"),
                "cloud_enabled": bool(data.get("cloud_enabled", False)),
                "cloud_reachable": bool(data.get("cloud_reachable", False)),
                "devices": len(data.get("devices", [])) if isinstance(data.get("devices", []), list) else 0,
                "last_error": data.get("last_error"),
                "last_success": data.get("last_success"),
                "room_count": len(data.get("room_tag_map", {}) or {}),
            }
        )
    return entries


def _merge_room_tag_maps(hass: HomeAssistant) -> dict[str, list[str]]:
    merged: dict[str, set[str]] = {}
    for _entry_id, bucket in hass.data.get(DOMAIN, {}).items():
        if not isinstance(bucket, dict):
            continue
        coordinator = bucket.get("coordinator")
        if coordinator is None:
            continue
        room_map = (coordinator.data or {}).get("room_tag_map", {})
        if not isinstance(room_map, dict):
            continue
        for room, tags in room_map.items():
            room_s = str(room)
            if not isinstance(tags, list):
                continue
            merged.setdefault(room_s, set()).update(str(t) for t in tags)
    return {room: sorted(tags) for room, tags in sorted(merged.items())}


@websocket_api.websocket_command({websocket_api.Required("type"): "padspan_ha/status"})
@websocket_api.async_response
async def websocket_get_status(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], {"entries": _collect_entries(hass)})


@websocket_api.websocket_command({websocket_api.Required("type"): "padspan_ha/refresh"})
@websocket_api.async_response
async def websocket_refresh(hass: HomeAssistant, connection, msg) -> None:
    tasks = []
    for _entry_id, bucket in hass.data.get(DOMAIN, {}).items():
        if not isinstance(bucket, dict):
            continue
        coordinator = bucket.get("coordinator")
        if coordinator is None:
            continue
        tasks.append(coordinator.async_request_refresh())

    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)

    connection.send_result(msg["id"], {"ok": True, "entries": _collect_entries(hass)})


@websocket_api.websocket_command({websocket_api.Required("type"): "padspan_ha/room_tags"})
@websocket_api.async_response
async def websocket_room_tags(hass: HomeAssistant, connection, msg) -> None:
    room_tag_map = _merge_room_tag_maps(hass)
    connection.send_result(
        msg["id"],
        {"room_tag_map": room_tag_map, "rooms": sorted(room_tag_map.keys())},
    )


async def async_setup_websocket_api(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, websocket_get_status)
    websocket_api.async_register_command(hass, websocket_refresh)
    websocket_api.async_register_command(hass, websocket_room_tags)
