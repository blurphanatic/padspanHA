"""Diagnostics support for PadSpan HA."""
from __future__ import annotations

from hashlib import sha256
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DATA_COORDINATOR, DATA_STORE, DOMAIN


def _hash_address(address: str) -> str:
    return sha256(address.encode("utf-8")).hexdigest()[:12]


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict[str, Any]:
    """Return diagnostics for a config entry."""
    entry_data = hass.data[DOMAIN][entry.entry_id]
    coordinator = entry_data[DATA_COORDINATOR]
    store = entry_data[DATA_STORE]

    devices = coordinator.data.get("devices", {})
    sample = []
    for _, data in list(devices.items())[:50]:
        sample.append(
            {
                "address_hash": _hash_address(data.get("address", "")),
                "name": data.get("name"),
                "rssi": data.get("rssi"),
                "source": data.get("source"),
                "connectable": data.get("connectable"),
                "last_seen": data.get("last_seen"),
                "seen_count": data.get("seen_count"),
                "service_uuids": data.get("service_uuids"),
            }
        )

    return {
        "entry_id": entry.entry_id,
        "entry_title": entry.title,
        "options": dict(entry.options),
        "metrics": coordinator.data.get("metrics", {}),
        "scanners": coordinator.data.get("scanners", {}),
        "devices_sample": sample,
        "map_store": store.as_dict(),
    }
