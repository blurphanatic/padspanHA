from __future__ import annotations

from homeassistant.components import system_health
from homeassistant.core import HomeAssistant

from .const import DOMAIN


async def async_register(hass: HomeAssistant, register: system_health.SystemHealthRegistration) -> None:
    register.async_register_info(system_health_info)


async def system_health_info(hass: HomeAssistant) -> dict[str, object]:
    entries = []
    for _, bucket in hass.data.get(DOMAIN, {}).items():
        if not isinstance(bucket, dict):
            continue
        coordinator = bucket.get("coordinator")
        if coordinator:
            entries.append((coordinator.data or {}).get("status", "unknown"))
    return {"entries_loaded": len(entries), "statuses": entries}
