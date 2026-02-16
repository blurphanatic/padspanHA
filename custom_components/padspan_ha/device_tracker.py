from homeassistant.components.device_tracker import SourceType
from homeassistant.components.device_tracker.config_entry import TrackerEntity

from .const import DOMAIN
from .entity import PadSpanCoordinatorEntity

async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
    devices = (coordinator.data or {}).get("devices", [])
    async_add_entities([PadSpanTracker(coordinator, d) for d in devices])

class PadSpanTracker(PadSpanCoordinatorEntity, TrackerEntity):
    _attr_should_poll = False

    def __init__(self, coordinator, device):
        self._dev_id = str(device.get("id"))
        super().__init__(coordinator, f"device_{self._dev_id}", str(device.get("name", self._dev_id)))

    def _device(self):
        for d in (self.coordinator.data or {}).get("devices", []):
            if str(d.get("id")) == self._dev_id:
                return d
        return None

    @property
    def source_type(self):
        return SourceType.ROUTER

    @property
    def is_connected(self):
        d = self._device()
        return bool(d and d.get("is_connected"))

    @property
    def extra_state_attributes(self):
        d = self._device() or {}
        return {
            "room": d.get("room"),
            "rssi": d.get("rssi"),
            "distance_m": d.get("distance_m"),
            "last_seen": d.get("last_seen"),
        }
