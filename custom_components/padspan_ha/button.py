from __future__ import annotations

from homeassistant.components.button import ButtonEntity
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
    async_add_entities([PadSpanRetryCloudButton(coordinator)])


class PadSpanRetryCloudButton(PadSpanCoordinatorEntity, ButtonEntity):
    _attr_name = "Retry Cloud Connection"
    _attr_unique_id = "padspan_retry_cloud_connection"
    _attr_icon = "mdi:cloud-refresh"

    async def async_press(self) -> None:
        await self.coordinator.async_request_refresh()
