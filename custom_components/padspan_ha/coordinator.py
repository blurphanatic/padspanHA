"""Data coordinator for PadSpan HA BLE aggregation."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
import logging
import time
from typing import Any, Callable

from homeassistant.components import bluetooth
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.util import dt as dt_util

from .const import CONF_ACTIVE_WINDOW_SECONDS, DEFAULT_ACTIVE_WINDOW_SECONDS, DOMAIN

_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class DeviceSnapshot:
    """Mutable device snapshot kept in memory."""

    address: str
    name: str
    rssi: int | None
    source: str
    connectable: bool
    first_seen_unix: float
    last_seen_unix: float
    last_seen: str
    seen_count: int
    tx_power: int | None
    service_uuids: list[str]
    manufacturer_keys: list[int]
    service_data_keys: list[str]


class PadSpanCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinate BLE scanner and device state for PadSpan HA."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.active_window_seconds: int = int(
            entry.options.get(CONF_ACTIVE_WINDOW_SECONDS, DEFAULT_ACTIVE_WINDOW_SECONDS)
        )
        self.devices: dict[str, DeviceSnapshot] = {}
        self.scanners_all: set[str] = set()
        self.scanners_connectable: set[str] = set()
        self._unsub_ble: Callable[[], None] | None = None

        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{entry.entry_id}",
            update_interval=timedelta(seconds=30),
        )

    async def _async_update_data(self) -> dict[str, Any]:
        """Periodic refresh hook for coordinator."""
        await self.async_reload_cache()
        if self._unsub_ble is None:
            self._subscribe_ble_callbacks()
        return self._snapshot()

    async def async_stop(self) -> None:
        """Stop listeners."""
        if self._unsub_ble:
            self._unsub_ble()
            self._unsub_ble = None

    async def async_reload_cache(self) -> None:
        """Load currently known BLE discoveries from HA cache."""
        infos = self._get_discovered_service_info(connectable=False)
        for info in infos:
            self._ingest_service_info(info)

        infos_connectable = self._get_discovered_service_info(connectable=True)
        for info in infos_connectable:
            self._ingest_service_info(info)

        self.async_set_updated_data(self._snapshot())

    def _get_discovered_service_info(self, connectable: bool) -> list[Any]:
        """Safely read discovered service info across HA versions."""
        getter = getattr(bluetooth, "async_discovered_service_info", None)
        if getter is None:
            _LOGGER.warning("Bluetooth cache API unavailable on this HA version")
            return []

        try:
            infos = getter(self.hass, connectable=connectable)
        except TypeError:
            try:
                infos = getter(self.hass, connectable)
            except Exception:
                return []
        except Exception:
            return []

        return list(infos or [])

    def _subscribe_ble_callbacks(self) -> None:
        """Subscribe to passive BLE callbacks to include non-connectable devices."""

        @callback
        def _on_ble(service_info: Any, _change: Any) -> None:
            self._ingest_service_info(service_info)
            self.async_set_updated_data(self._snapshot())

        matcher = bluetooth.BluetoothCallbackMatcher()
        mode = bluetooth.BluetoothScanningMode.PASSIVE
        self._unsub_ble = bluetooth.async_register_callback(
            self.hass,
            _on_ble,
            matcher,
            mode,
        )
        _LOGGER.debug("Registered passive BLE callback for PadSpan HA")

    def _ingest_service_info(self, service_info: Any) -> None:
        """Update in-memory device inventory from BLE service info."""
        address = (getattr(service_info, "address", "") or "").upper()
        if not address:
            return

        device_obj = getattr(service_info, "device", None)
        source = str(getattr(service_info, "source", "unknown"))
        connectable = bool(getattr(service_info, "connectable", False))
        rssi = getattr(service_info, "rssi", None)
        tx_power = getattr(service_info, "tx_power", None)

        name = (
            getattr(service_info, "name", None)
            or getattr(device_obj, "name", None)
            or address
        )

        now_unix = time.time()
        now_iso = dt_util.utcnow().isoformat()

        service_uuids = list(getattr(service_info, "service_uuids", []) or [])
        manufacturer_data = getattr(service_info, "manufacturer_data", {}) or {}
        service_data = getattr(service_info, "service_data", {}) or {}

        if source:
            self.scanners_all.add(source)
            if connectable:
                self.scanners_connectable.add(source)

        existing = self.devices.get(address)
        if existing is None:
            self.devices[address] = DeviceSnapshot(
                address=address,
                name=str(name),
                rssi=rssi,
                source=source,
                connectable=connectable,
                first_seen_unix=now_unix,
                last_seen_unix=now_unix,
                last_seen=now_iso,
                seen_count=1,
                tx_power=tx_power,
                service_uuids=service_uuids,
                manufacturer_keys=[int(k) for k in manufacturer_data.keys()],
                service_data_keys=[str(k) for k in service_data.keys()],
            )
        else:
            existing.name = str(name) or existing.name
            existing.rssi = rssi
            existing.source = source or existing.source
            existing.connectable = connectable
            existing.last_seen_unix = now_unix
            existing.last_seen = now_iso
            existing.seen_count += 1
            existing.tx_power = tx_power
            existing.service_uuids = service_uuids or existing.service_uuids
            existing.manufacturer_keys = [int(k) for k in manufacturer_data.keys()]
            existing.service_data_keys = [str(k) for k in service_data.keys()]

    def _snapshot(self) -> dict[str, Any]:
        """Build coordinator snapshot consumed by entities and diagnostics."""
        now_unix = time.time()
        active_now = 0

        devices: dict[str, Any] = {}
        for address, dev in self.devices.items():
            is_active = (now_unix - dev.last_seen_unix) <= self.active_window_seconds
            if is_active:
                active_now += 1

            devices[address] = {
                "address": dev.address,
                "name": dev.name,
                "rssi": dev.rssi,
                "source": dev.source,
                "connectable": dev.connectable,
                "first_seen_unix": dev.first_seen_unix,
                "last_seen_unix": dev.last_seen_unix,
                "last_seen": dev.last_seen,
                "seen_count": dev.seen_count,
                "tx_power": dev.tx_power,
                "service_uuids": dev.service_uuids,
                "manufacturer_keys": dev.manufacturer_keys,
                "service_data_keys": dev.service_data_keys,
                "active_now": is_active,
            }

        return {
            "metrics": {
                "scanner_count_all": len(self.scanners_all),
                "scanner_count_connectable": len(self.scanners_connectable),
                "seen_ever": len(self.devices),
                "active_now": active_now,
                "active_window_seconds": self.active_window_seconds,
            },
            "scanners": {
                "all": sorted(self.scanners_all),
                "connectable": sorted(self.scanners_connectable),
            },
            "devices": devices,
        }
