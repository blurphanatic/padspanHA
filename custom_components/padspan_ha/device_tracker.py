from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from homeassistant.components.device_tracker import SourceType
from homeassistant.components.device_tracker.config_entry import TrackerEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DATA_COORDINATOR, DOMAIN


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator = hass.data[DOMAIN][entry.entry_id][DATA_COORDINATOR]
    entities: dict[str, PadSpanTrackerEntity] = {}

    @callback
    def _sync_entities() -> None:
        new_entities: list[PadSpanTrackerEntity] = []
        for address in coordinator.get_devices():
            if address in entities:
                continue
            ent = PadSpanTrackerEntity(coordinator, entry, address)
            entities[address] = ent
            new_entities.append(ent)
        if new_entities:
            async_add_entities(new_entities)

    _sync_entities()
    entry.async_on_unload(coordinator.async_add_listener(_sync_entities))


class PadSpanTrackerEntity(CoordinatorEntity, TrackerEntity):
    """Dynamic BLE tracker entity."""

    _attr_has_entity_name = True
    _attr_source_type = SourceType.BLUETOOTH
    _attr_icon = "mdi:bluetooth"

    def __init__(self, coordinator, entry: ConfigEntry, address: str) -> None:
        super().__init__(coordinator)
        self._address = address
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_{address.lower().replace(':', '')}"

    @property
    def name(self) -> str:
        rec = self.coordinator.get_device(self._address) or {}
        return rec.get("name") or f"BLE {self._address}"

    @property
    def is_connected(self) -> bool:
        rec = self.coordinator.get_device(self._address) or {}
        last_seen = rec.get("last_seen")
        if not isinstance(last_seen, datetime):
            return False
        timeout = timedelta(seconds=self.coordinator.seen_timeout)
        return datetime.now(UTC) - last_seen <= timeout

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        rec = self.coordinator.get_device(self._address) or {}
        sources = []
        for source_id, src in (rec.get("sources") or {}).items():
            ts = src.get("last_seen")
            sources.append(
                {
                    "source_id": source_id,
                    "rssi": src.get("rssi"),
                    "last_seen": ts.isoformat() if isinstance(ts, datetime) else None,
                }
            )
        sources.sort(key=lambda r: r["source_id"])
        first_seen = rec.get("first_seen")
        last_seen = rec.get("last_seen")
        return {
            "address": self._address,
            "first_seen": first_seen.isoformat() if isinstance(first_seen, datetime) else None,
            "last_seen": last_seen.isoformat() if isinstance(last_seen, datetime) else None,
            "seen_count": rec.get("seen_count", 0),
            "map_x": rec.get("map_x"),
            "map_y": rec.get("map_y"),
            "map_confidence": rec.get("map_confidence", 0.0),
            "sources": sources,
        }

    @property
    def latitude(self):
        return None

    @property
    def longitude(self):
        return None

    @property
    def battery_level(self):
        return None

    @property
    def device_info(self):
        return {
            "identifiers": {(DOMAIN, self._address)},
            "name": self.name,
            "manufacturer": "BLE",
            "model": "Advertisement",
        }
