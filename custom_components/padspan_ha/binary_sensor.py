from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorEntity
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
    async_add_entities([PadSpanCloudReachableBinarySensor(coordinator)])


class PadSpanCloudReachableBinarySensor(PadSpanCoordinatorEntity, BinarySensorEntity):
    _attr_name = "Cloud Reachable"
    _attr_unique_id = "padspan_cloud_reachable"
    _attr_icon = "mdi:cloud-check-outline"

    @property
    def is_on(self) -> bool:
        return bool((self.coordinator.data or {}).get("cloud_reachable", False))
