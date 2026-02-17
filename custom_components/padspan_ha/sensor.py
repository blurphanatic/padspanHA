from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DATA_COORDINATOR, DOMAIN
from .entity import PadSpanCoordinatorEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator = hass.data[DOMAIN][entry.entry_id][DATA_COORDINATOR]
    async_add_entities(
        [
            PadSpanStatusSensor(coordinator),
            PadSpanCloudDevicesSensor(coordinator),
            PadSpanLastSuccessSensor(coordinator),
            PadSpanRoomCountSensor(coordinator),
        ]
    )


class PadSpanStatusSensor(PadSpanCoordinatorEntity, SensorEntity):
    _attr_name = "Status"
    _attr_unique_id = "padspan_status"

    @property
    def native_value(self) -> str:
        return str((self.coordinator.data or {}).get("status", "unknown"))


class PadSpanCloudDevicesSensor(PadSpanCoordinatorEntity, SensorEntity):
    _attr_name = "Cloud Devices"
    _attr_unique_id = "padspan_cloud_devices"
    _attr_icon = "mdi:devices"

    @property
    def native_value(self) -> int:
        devices = (self.coordinator.data or {}).get("devices", [])
        return len(devices) if isinstance(devices, list) else 0


class PadSpanLastSuccessSensor(PadSpanCoordinatorEntity, SensorEntity):
    _attr_name = "Last Success"
    _attr_unique_id = "padspan_last_success"
    _attr_icon = "mdi:clock-check-outline"

    @property
    def native_value(self):
        return (self.coordinator.data or {}).get("last_success")


class PadSpanRoomCountSensor(PadSpanCoordinatorEntity, SensorEntity):
    _attr_name = "Room Count"
    _attr_unique_id = "padspan_room_count"
    _attr_icon = "mdi:floor-plan"

    @property
    def native_value(self) -> int:
        room_map = (self.coordinator.data or {}).get("room_tag_map", {})
        return len(room_map) if isinstance(room_map, dict) else 0
