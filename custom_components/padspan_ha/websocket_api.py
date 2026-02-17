from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN, PLATFORMS, SERVICE_SET_TEST_PRESENCE, VERSION


def _collect_entries(hass: HomeAssistant) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
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


def _merge_room_tag_maps(hass: HomeAssistant) -> Dict[str, List[str]]:
    merged: Dict[str, set] = {}
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


def _check(name: str, ok: bool, detail: str, level: str = "info") -> Dict[str, Any]:
    return {"name": name, "ok": bool(ok), "detail": detail, "level": level}


def _auto_diagnostics(hass: HomeAssistant) -> Dict[str, Any]:
    checks: List[Dict[str, Any]] = []
    recommendations: List[str] = []

    domain_data_present = DOMAIN in hass.data
    checks.append(_check("domain_data_present", domain_data_present, f"hass.data contains '{DOMAIN}'"))
    if not domain_data_present:
        recommendations.append(f"Integration domain '{DOMAIN}' is not present in hass.data yet.")

    entries = hass.config_entries.async_entries(DOMAIN)
    checks.append(_check("config_entries_found", len(entries) > 0, f"Found {len(entries)} config entr{'y' if len(entries)==1 else 'ies'}"))
    if not entries:
        recommendations.append("No PadSpan config entry found. Add the integration in Settings → Devices & Services.")

    service_ok = hass.services.has_service(DOMAIN, SERVICE_SET_TEST_PRESENCE)
    checks.append(_check("test_service_registered", service_ok, f"Service {DOMAIN}.{SERVICE_SET_TEST_PRESENCE}"))
    if not service_ok:
        recommendations.append("Service registration missing; restart Home Assistant after reinstalling custom component.")

    base_dir = Path(__file__).resolve().parent
    panel_js = base_dir / "www" / "padspan-ha" / "panel.js"
    logo_1 = base_dir / "www" / "padspan-ha" / "assets" / "padspan-mark.svg"
    logo_2 = base_dir / "www" / "padspan-ha" / "assets" / "padspan-logo.svg"

    checks.append(_check("panel_js_exists", panel_js.exists(), str(panel_js)))
    checks.append(_check("logo_mark_exists", logo_1.exists(), str(logo_1)))
    checks.append(_check("logo_full_exists", logo_2.exists(), str(logo_2)))

    legacy_manifest = base_dir.parent / "padspan" / "manifest.json"
    legacy_status = "not_found"
    legacy_ok = True
    if legacy_manifest.exists():
        try:
            data = json.loads(legacy_manifest.read_text(encoding="utf-8"))
            if bool(data.get("config_flow", True)):
                legacy_ok = False
                legacy_status = "active_config_flow"
                recommendations.append("Legacy 'padspan' domain has config_flow enabled; disable/remove it to avoid duplicate integrations.")
            else:
                legacy_status = "disabled_tombstone"
        except Exception:
            legacy_ok = False
            legacy_status = "invalid_manifest"
            recommendations.append("Legacy 'padspan' manifest is invalid; remove or replace it.")
    checks.append(_check("legacy_domain_safe", legacy_ok, f"legacy padspan manifest: {legacy_status}", level="warn"))

    checks.append(_check("platforms_declared", len(PLATFORMS) > 0, ", ".join(str(p) for p in PLATFORMS)))
    if len(PLATFORMS) == 0:
        recommendations.append("No platforms declared in const.py.")

    status_entries = _collect_entries(hass)
    if status_entries:
        degraded = [e for e in status_entries if e.get("status") in ("cloud_degraded", "error", "panel_error")]
        checks.append(_check("entry_health", len(degraded) == 0, f"{len(degraded)} degraded entries out of {len(status_entries)}", level="warn"))
        if degraded:
            recommendations.append("One or more entries are degraded; inspect Last Error in overview.")
    else:
        checks.append(_check("entry_health", False, "No runtime entries available", level="warn"))

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


@websocket_api.websocket_command({websocket_api.Required("type"): "padspan_ha/auto_diagnostics"})
@websocket_api.async_response
async def websocket_auto_diagnostics(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], _auto_diagnostics(hass))


async def async_setup_websocket_api(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, websocket_get_status)
    websocket_api.async_register_command(hass, websocket_refresh)
    websocket_api.async_register_command(hass, websocket_room_tags)
    websocket_api.async_register_command(hass, websocket_auto_diagnostics)
