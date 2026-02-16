from homeassistant.components.binary_sensor import BinarySensorEntity

from .const import DOMAIN
from .entity import PadSpanCoordinatorEntity

async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
    async_add_entities([CalibrationProblemSensor(coordinator)])

class CalibrationProblemSensor(PadSpanCoordinatorEntity, BinarySensorEntity):
    _attr_device_class = "problem"

    def __init__(self, coordinator):
        super().__init__(coordinator, "calibration_problem", "Calibration Problem")

    @property
    def is_on(self):
        valid = (self.coordinator.data or {}).get("summary", {}).get("calibration_valid")
        if valid is None:
            return None
        return not bool(valid)
