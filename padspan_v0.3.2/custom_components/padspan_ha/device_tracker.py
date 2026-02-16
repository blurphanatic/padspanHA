from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from homeassistant.components.device_tracker import SourceType
from homeassistant.components.device_tracker.config_entry import TrackerEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import callback, HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import DOMAIN, SIGNAL_NEW_DEVICE


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    ctx = hass.data[DOMAIN][entry.entry_id]
    coordinator = ctx["coordinator"]

    known = set()
    entities = []

    for addr in sorted(coordinator.known_addresses):
        known.add(addr)
        entities.append(PadSpanTracker(coordinator, entry, addr))

    if entities:
        async_add_entities(entities)

    @callback
    def _new_device(address: str):
        if address in known:
            return
        known.add(address)
        async_add_entities([PadSpanTracker(coordinator, entry, address)])

    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_NEW_DEVICE, _new_device))


class PadSpanTracker(CoordinatorEntity, TrackerEntity):
    _attr_has_entity_name = True

    def __init__(self, coordinator, entry: ConfigEntry, address: str) -> None:
        super().__init__(coordinator)
        self._address = address
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_{address}"
        self._attr_name = f"BLE {address[-5:].replace(':', '')}"

    @property
    def source_type(self):
        return SourceType.BLUETOOTH

    def _snapshot(self) -> dict[str, Any] | None:
        return self.coordinator.device_snapshot(self._address)

    @property
    def is_connected(self) -> bool:
        snap = self._snapshot() or {}
        return bool(snap.get("active"))

    @property
    def extra_state_attributes(self):
        snap = self._snapshot() or {}
        pos = snap.get("position") or {}
        return {
            "address": self._address,
            "name": snap.get("name"),
            "active_source_count": snap.get("active_source_count", 0),
            "last_seen": snap.get("last_seen"),
            "source_rssi": {k: v.get("rssi") for k, v in (snap.get("sources") or {}).items()},
            "map_id": pos.get("map_id"),
            "map_x": pos.get("x"),
            "map_y": pos.get("y"),
            "map_real_x": pos.get("real_x"),
            "map_real_y": pos.get("real_y"),
            "confidence": pos.get("confidence"),
            "heat_radius": pos.get("heat_radius"),
            "anchors_used": pos.get("anchors_used"),
        }
