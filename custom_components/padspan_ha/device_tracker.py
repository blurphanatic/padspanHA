"""Device tracker platform for PadSpan HA BLE discoveries."""
from __future__ import annotations

from datetime import UTC, datetime

from homeassistant.components.device_tracker import SourceType
from homeassistant.components.device_tracker.config_entry import TrackerEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DATA_COORDINATOR, DOMAIN


class PadSpanBleTracker(CoordinatorEntity, TrackerEntity):
    """Track discovered BLE devices as device_tracker entities."""

    _attr_should_poll = False
    _attr_has_entity_name = True

    def __init__(self, coordinator, entry: ConfigEntry, address: str) -> None:
        super().__init__(coordinator)
        self._address = address
        self._attr_unique_id = f"{entry.entry_id}_{address.lower().replace(':', '')}"
        self._attr_name = f"BLE {address[-5:]}"
        self._attr_source_type = SourceType.BLUETOOTH_LE

    @property
    def _device_data(self) -> dict:
        return self.coordinator.data.get("devices", {}).get(self._address, {})

    @property
    def is_connected(self) -> bool:
        data = self._device_data
        last_seen_unix = data.get("last_seen_unix")
        if last_seen_unix is None:
            return False
        now_unix = datetime.now(UTC).timestamp()
        return (now_unix - float(last_seen_unix)) <= self.coordinator.active_window_seconds

    @property
    def extra_state_attributes(self) -> dict:
        data = self._device_data
        return {
            "address": data.get("address"),
            "name": data.get("name"),
            "rssi": data.get("rssi"),
            "source": data.get("source"),
            "connectable": data.get("connectable"),
            "last_seen": data.get("last_seen"),
            "seen_count": data.get("seen_count"),
            "service_uuids": data.get("service_uuids"),
            "manufacturer_keys": data.get("manufacturer_keys"),
            "service_data_keys": data.get("service_data_keys"),
        }


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up tracker entities for every discovered BLE device."""
    coordinator = hass.data[DOMAIN][entry.entry_id][DATA_COORDINATOR]
    known: dict[str, PadSpanBleTracker] = {}

    @callback
    def _sync_entities() -> None:
        new_entities: list[PadSpanBleTracker] = []
        devices = coordinator.data.get("devices", {})
        for address in devices:
            if address in known:
                known[address].async_write_ha_state()
                continue

            ent = PadSpanBleTracker(coordinator, entry, address)
            known[address] = ent
            new_entities.append(ent)

        if new_entities:
            async_add_entities(new_entities)

    _sync_entities()
    entry.async_on_unload(coordinator.async_add_listener(_sync_entities))
