from __future__ import annotations

from homeassistant.components.device_tracker import SourceType
from homeassistant.components.device_tracker.config_entry import TrackerEntity
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
    async_add_entities([PadSpanTestPresenceTracker(coordinator)])


class PadSpanTestPresenceTracker(PadSpanCoordinatorEntity, TrackerEntity):
    _attr_name = "Test Presence"
    _attr_unique_id = "padspan_test_presence"
    _attr_icon = "mdi:account-radar"

    @property
    def source_type(self) -> SourceType:
        return SourceType.ROUTER

    @property
    def is_connected(self) -> bool:
        return bool((self.coordinator.data or {}).get("test_presence", False))
