from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import SensorEntity, SensorEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DATA_COORDINATOR, DATA_STORE, DOMAIN


@dataclass(frozen=True, kw_only=True)
class PadSpanSensorDescription(SensorEntityDescription):
    value_fn: Callable[[dict[str, Any], Any], Any]


SENSORS: tuple[PadSpanSensorDescription, ...] = (
    PadSpanSensorDescription(
        key="active_now",
        name="Active BLE devices",
        icon="mdi:bluetooth-connect",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data, store: data.get("active_now"),
    ),
    PadSpanSensorDescription(
        key="seen_ever",
        name="Seen BLE devices (ever)",
        icon="mdi:bluetooth",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data, store: data.get("seen_ever"),
    ),
    PadSpanSensorDescription(
        key="scanner_count_all",
        name="Scanners (all)",
        icon="mdi:access-point-network",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data, store: data.get("scanner_count_all"),
    ),
    PadSpanSensorDescription(
        key="scanner_count_connectable",
        name="Scanners (connectable)",
        icon="mdi:access-point-network",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data, store: data.get("scanner_count_connectable"),
    ),
    PadSpanSensorDescription(
        key="map_count",
        name="Maps configured",
        icon="mdi:map",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data, store: len(store.maps),
    ),
)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    domain_data = hass.data[DOMAIN][entry.entry_id]
    coordinator = domain_data[DATA_COORDINATOR]
    store = domain_data[DATA_STORE]

    async_add_entities(
        [PadSpanSensorEntity(coordinator, store, entry, desc) for desc in SENSORS],
        update_before_add=True,
    )


class PadSpanSensorEntity(CoordinatorEntity, SensorEntity):
    """PadSpan sensor entity."""

    _attr_has_entity_name = True

    def __init__(self, coordinator, store, entry: ConfigEntry, description: PadSpanSensorDescription) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._store = store
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"

    @property
    def native_value(self) -> Any:
        return self.entity_description.value_fn(self.coordinator.data or {}, self._store)
