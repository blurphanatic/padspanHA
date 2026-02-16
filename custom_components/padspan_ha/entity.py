from __future__ import annotations

from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.helpers.device_registry import DeviceInfo

from .const import DOMAIN
from .coordinator import PadSpanCoordinator

class PadSpanCoordinatorEntity(CoordinatorEntity[PadSpanCoordinator]):
    _attr_has_entity_name = True

    def __init__(self, coordinator: PadSpanCoordinator, suffix: str, name: str) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.entry.entry_id}_{suffix}"
        self._attr_name = name

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self.coordinator.entry.entry_id)},
            name=f"PadSpan {self.coordinator.entry.title}",
            manufacturer="PadSpan",
            model="PadSpan HA Integration",
            sw_version="3.3.3",
        )
