"""Sensor entities for PadSpan HA metrics."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DATA_COORDINATOR, DOMAIN


class PadSpanMetricSensor(CoordinatorEntity, SensorEntity):
    """Metric sensor backed by the PadSpan coordinator."""

    _attr_has_entity_name = True

    def __init__(self, coordinator, entry: ConfigEntry, metric_key: str, label: str, icon: str) -> None:
        super().__init__(coordinator)
        self._metric_key = metric_key
        self._attr_unique_id = f"{entry.entry_id}_{metric_key}"
        self._attr_name = label
        self._attr_icon = icon

    @property
    def native_value(self):
        return self.coordinator.data.get("metrics", {}).get(self._metric_key)

    @property
    def available(self) -> bool:
        return self.coordinator.last_update_success


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up PadSpan metric sensors."""
    coordinator = hass.data[DOMAIN][entry.entry_id][DATA_COORDINATOR]
    entities = [
        PadSpanMetricSensor(coordinator, entry, "scanner_count_all", "Scanner Count (All)", "mdi:bluetooth"),
        PadSpanMetricSensor(
            coordinator,
            entry,
            "scanner_count_connectable",
            "Scanner Count (Connectable)",
            "mdi:bluetooth-connect",
        ),
        PadSpanMetricSensor(coordinator, entry, "seen_ever", "BLE Devices Seen (Ever)", "mdi:devices"),
        PadSpanMetricSensor(coordinator, entry, "active_now", "BLE Devices Active (Now)", "mdi:access-point"),
    ]
    async_add_entities(entities)
