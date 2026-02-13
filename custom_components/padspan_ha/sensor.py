from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import PadSpanCoordinator


SENSOR_KEYS = [
    "scanner_count_all",
    "scanner_count_connectable",
    "devices_seen_total",
    "devices_active",
    "map_count",
    "anchor_count_active_map",
]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: PadSpanCoordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]

    entities = [PadSpanStatSensor(coordinator, entry, key) for key in SENSOR_KEYS]
    entities.append(PadSpanModeSensor(coordinator, entry))
    entities.append(PadSpanMapCatalogSensor(coordinator, entry))
    async_add_entities(entities)


class PadSpanBaseSensor(CoordinatorEntity[PadSpanCoordinator], SensorEntity):
    _attr_should_poll = False

    def __init__(self, coordinator: PadSpanCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._attr_has_entity_name = True
        self._attr_entity_category = EntityCategory.DIAGNOSTIC


class PadSpanStatSensor(PadSpanBaseSensor):
    def __init__(self, coordinator: PadSpanCoordinator, entry: ConfigEntry, key: str) -> None:
        super().__init__(coordinator, entry)
        self._key = key
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_name = key.replace("_", " ").title()

    @property
    def native_value(self) -> int | None:
        return (self.coordinator.data or {}).get("stats", {}).get(self._key)


class PadSpanModeSensor(PadSpanBaseSensor):
    def __init__(self, coordinator: PadSpanCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry)
        self._attr_unique_id = f"{entry.entry_id}_mode"
        self._attr_name = "BLE Mode"

    @property
    def native_value(self) -> str:
        stats = (self.coordinator.data or {}).get("stats", {})
        return "passive+connectable" if stats.get("include_passive") else "connectable-only"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        stats = (self.coordinator.data or {}).get("stats", {})
        return {
            "hub_sources_filter": stats.get("hub_sources_filter", []),
            "active_map_id": stats.get("active_map_id"),
            "device_timeout": stats.get("device_timeout"),
        }


class PadSpanMapCatalogSensor(PadSpanBaseSensor):
    def __init__(self, coordinator: PadSpanCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry)
        self._attr_unique_id = f"{entry.entry_id}_map_catalog"
        self._attr_name = "Map Catalog"

    @property
    def native_value(self) -> str:
        stats = (self.coordinator.data or {}).get("stats", {})
        return stats.get("active_map_id", "default")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self.coordinator.data or {}
        return {
            "maps": data.get("maps", {}),
            "stats": data.get("stats", {}),
        }
