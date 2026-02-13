from __future__ import annotations

from typing import Any

from homeassistant.components.device_tracker.config_entry import ScannerEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import PadSpanCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: PadSpanCoordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]

    known: set[str] = set()

    @callback
    def _async_add_new_entities() -> None:
        data = coordinator.data or {}
        devices = data.get("devices", {})
        new_entities = []
        for address in devices:
            if address in known:
                continue
            known.add(address)
            new_entities.append(PadSpanBleDeviceTracker(coordinator, entry, address))
        if new_entities:
            async_add_entities(new_entities)

    _async_add_new_entities()
    entry.async_on_unload(coordinator.async_add_listener(_async_add_new_entities))


class PadSpanBleDeviceTracker(CoordinatorEntity[PadSpanCoordinator], ScannerEntity):
    _attr_should_poll = False

    def __init__(self, coordinator: PadSpanCoordinator, entry: ConfigEntry, address: str) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._address = address
        self._attr_unique_id = f"{entry.entry_id}_{address.replace(':', '').lower()}"
        self._attr_name = f"PadSpan {address[-5:].replace(':','')}"

    @property
    def available(self) -> bool:
        dev = self._device()
        return dev is not None

    def _device(self) -> dict[str, Any] | None:
        data = self.coordinator.data or {}
        return data.get("devices", {}).get(self._address)

    @property
    def is_connected(self) -> bool:
        dev = self._device()
        return bool(dev and dev.get("active"))

    @property
    def mac_address(self) -> str | None:
        return self._address

    @property
    def hostname(self) -> str | None:
        dev = self._device()
        if not dev:
            return None
        return dev.get("name")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        dev = self._device() or {}
        return {
            "address": self._address,
            "name": dev.get("name"),
            "last_rssi": dev.get("last_rssi"),
            "last_seen": dev.get("last_seen"),
            "sources": dev.get("sources", {}),
            "connectable": dev.get("connectable"),
            "map_id": dev.get("map_id"),
            "map_x": dev.get("x"),
            "map_y": dev.get("y"),
            "confidence": dev.get("confidence"),
            "unavailable": dev.get("unavailable"),
        }
