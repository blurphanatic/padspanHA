from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Any

from homeassistant.components.sensor import SensorEntity, SensorEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import callback, HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN


@dataclass(frozen=True, kw_only=True)
class PadSpanSensorDescription(SensorEntityDescription):
    value_fn: Callable[[dict[str, Any]], Any]


DESCRIPTIONS: tuple[PadSpanSensorDescription, ...] = (
    PadSpanSensorDescription(
        key="scanner_count_all",
        name="PadSpan Scanner Count",
        icon="mdi:access-point-network",
        value_fn=lambda d: d.get("scanner_count_all", 0),
    ),
    PadSpanSensorDescription(
        key="active_now",
        name="PadSpan Active BLE Devices",
        icon="mdi:bluetooth-connect",
        value_fn=lambda d: d.get("active_now", 0),
    ),
    PadSpanSensorDescription(
        key="seen_ever",
        name="PadSpan Seen Ever",
        icon="mdi:counter",
        value_fn=lambda d: d.get("seen_ever", 0),
    ),
    PadSpanSensorDescription(
        key="maps_total",
        name="PadSpan Maps",
        icon="mdi:map",
        value_fn=lambda d: len(d.get("maps", {})),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    ctx = hass.data[DOMAIN][entry.entry_id]
    coordinator = ctx["coordinator"]
    async_add_entities([PadSpanSensor(coordinator, entry, d) for d in DESCRIPTIONS])


class PadSpanSensor(CoordinatorEntity, SensorEntity):
    _attr_has_entity_name = True

    def __init__(self, coordinator, entry: ConfigEntry, description: PadSpanSensorDescription) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        self._attr_name = description.name
        self._entry = entry

    @property
    def native_value(self):
        data = self.coordinator.data or {}
        return self.entity_description.value_fn(data)

    @property
    def extra_state_attributes(self):
        data = self.coordinator.data or {}
        if self.entity_description.key == "scanner_count_all":
            return {"scanner_sources": data.get("scanner_sources", [])}
        return None
