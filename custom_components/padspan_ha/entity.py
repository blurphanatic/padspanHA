from __future__ import annotations

from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, NAME


class PadSpanCoordinatorEntity(CoordinatorEntity):
    """Base entity using PadSpan coordinator."""

    _attr_has_entity_name = True

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, "padspan_controller")},
            name=NAME,
            manufacturer="PadSpan",
            model="Virtual Presence Hub",
            sw_version="0.3.7",
        )
