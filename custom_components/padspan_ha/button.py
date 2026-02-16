from homeassistant.components.button import ButtonEntity

from .const import DOMAIN
from .entity import PadSpanCoordinatorEntity

async def async_setup_entry(hass, entry, async_add_entities):
    data = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([RescanButton(data["coordinator"], data["api"])])

class RescanButton(PadSpanCoordinatorEntity, ButtonEntity):
    def __init__(self, coordinator, api):
        super().__init__(coordinator, "rescan", "Rescan")
        self._api = api

    async def async_press(self):
        await self._api.async_trigger_scan()
        await self.coordinator.async_request_refresh()
