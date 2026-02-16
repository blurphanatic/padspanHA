from homeassistant.components.sensor import SensorEntity, SensorStateClass

from .const import DOMAIN
from .entity import PadSpanCoordinatorEntity

async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
    async_add_entities([
        SummarySensor(coordinator, "devices_seen", "Devices Seen"),
        SummarySensor(coordinator, "rooms_covered", "Rooms Covered"),
        SummarySensor(coordinator, "last_scan_age_s", "Last Scan Age", "s", SensorStateClass.MEASUREMENT),
    ])

class SummarySensor(PadSpanCoordinatorEntity, SensorEntity):
    def __init__(self, coordinator, key: str, name: str, unit: str | None = None, state_class=None):
        super().__init__(coordinator, f"summary_{key}", name)
        self._key = key
        self._attr_native_unit_of_measurement = unit
        self._attr_state_class = state_class

    @property
    def native_value(self):
        return (self.coordinator.data or {}).get("summary", {}).get(self._key)
