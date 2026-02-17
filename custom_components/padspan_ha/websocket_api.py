from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN, PLATFORMS, SERVICE_SET_TEST_PRESENCE, VERSION


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


def _check(name: str, ok: bool, detail: str, level: str = "info") -> dict[str, Any]:
    return {"name": name, "ok": bool(ok), "detail": detail, "level": level}


def _auto_diagnostics(hass: HomeAssistant) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    recommendations: list[str] = []

    has_domain_data = DOMAIN in hass.data
    checks.append(_check("domain_data_present", has_domain_data, f"hass.data contains '{DOMAIN}'"))
    if not has_domain_data:
        recommendations.append("Domain data missing; restart Home Assistant after reinstall.")

    entries = hass.config_entries.async_entries(DOMAIN)
    checks.append(_check("config_entries_found", len(entries) > 0, f"Found {len(entries)} entry(s)"))
    if not entries:
        recommendations.append("No PadSpan HA config entry found.")

    service_ok = hass.services.has_service(DOMAIN, SERVICE_SET_TEST_PRESENCE)
    checks.append(_check("service_registered", service_ok, f"Service {DOMAIN}.{SERVICE_SET_TEST_PRESENCE}"))
    if not service_ok:
        recommendations.append("Service registration missing; verify integration fully loaded.")

    status_entries = _collect_entries(hass)
    degraded = [e for e in status_entries if e.get("status") in ("cloud_degraded", "error", "panel_error")]
    checks.append(_check("entry_health", len(degraded) == 0, f"{len(degraded)} degraded entries", "warn"))

    checks.append(_check("platforms_declared", len(PLATFORMS) > 0, ", ".join(PLATFORMS)))

    passed = len([c for c in checks if c.get("ok")])
    failed = len([c for c in checks if not c.get("ok")])

    return {
        "domain": DOMAIN,
        "version": VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {"passed": passed, "failed": failed, "total": len(checks)},
        "checks": checks,
        "entries": status_entries,
        "recommendations": recommendations,
    }


@websocket_api.websocket_command({vol.Required("type"): "padspan_ha/status"})
@websocket_api.async_response
async def websocket_get_status(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], {"entries": _collect_entries(hass)})


@websocket_api.websocket_command({vol.Required("type"): "padspan_ha/refresh"})
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


@websocket_api.websocket_command({vol.Required("type"): "padspan_ha/room_tags"})
@websocket_api.async_response
async def websocket_room_tags(hass: HomeAssistant, connection, msg) -> None:
    room_tag_map = _merge_room_tag_maps(hass)
    connection.send_result(
        msg["id"], {"room_tag_map": room_tag_map, "rooms": sorted(room_tag_map.keys())}
    )


@websocket_api.websocket_command({vol.Required("type"): "padspan_ha/auto_diagnostics"})
@websocket_api.async_response
async def websocket_auto_diagnostics(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], _auto_diagnostics(hass))


async def async_setup_websocket_api(hass: HomeAssistant) -> None:
    # Idempotent registration guard
    guard_key = "_padspan_ws_registered"
    if hass.data.get(DOMAIN, {}).get(guard_key):
        return

    websocket_api.async_register_command(hass, websocket_get_status)
    websocket_api.async_register_command(hass, websocket_refresh)
    websocket_api.async_register_command(hass, websocket_room_tags)
    websocket_api.async_register_command(hass, websocket_auto_diagnostics)

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][guard_key] = True
