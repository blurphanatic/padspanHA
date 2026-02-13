from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
import logging
import math
import time
from typing import Any

from homeassistant.components import bluetooth
from homeassistant.components.bluetooth import BluetoothChange, BluetoothScanningMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import (
    CONF_BOOTSTRAP_CACHE,
    CONF_DEVICE_TIMEOUT,
    CONF_HUB_SOURCES,
    CONF_INCLUDE_PASSIVE,
    DEFAULT_BOOTSTRAP_CACHE,
    DEFAULT_DEVICE_TIMEOUT,
    DEFAULT_INCLUDE_PASSIVE,
    DOMAIN,
)
from .map_store import MapStore

_LOGGER = logging.getLogger(__name__)


@dataclass
class DeviceState:
    address: str
    name: str | None = None
    connectable: bool | None = None
    last_seen: float = 0.0
    last_rssi: int | None = None
    sources: dict[str, int] = field(default_factory=dict)
    unavailable: bool = False
    map_id: str | None = None
    x: float | None = None
    y: float | None = None
    confidence: float | None = None

    def is_active(self, timeout: int, now_ts: float) -> bool:
        if self.unavailable:
            return False
        return (now_ts - self.last_seen) <= timeout


class PadSpanCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, map_store: MapStore) -> None:
        self.hass = hass
        self.entry = entry
        self.map_store = map_store

        self._cancel_bt_callback = None
        self._unavailable_unsubs: dict[str, Any] = {}
        self._devices: dict[str, DeviceState] = {}

        self.include_passive = bool(entry.options.get(CONF_INCLUDE_PASSIVE, DEFAULT_INCLUDE_PASSIVE))
        self.bootstrap_cache = bool(entry.options.get(CONF_BOOTSTRAP_CACHE, DEFAULT_BOOTSTRAP_CACHE))
        self.device_timeout = int(entry.options.get(CONF_DEVICE_TIMEOUT, DEFAULT_DEVICE_TIMEOUT))
        self.hub_sources = set(str(v).upper() for v in entry.options.get(CONF_HUB_SOURCES, []) if str(v).strip())

        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{entry.entry_id}",
            update_interval=timedelta(seconds=15),
        )

    async def async_setup(self) -> None:
        await self._async_register_ble_callbacks()
        if self.bootstrap_cache:
            await self.async_reload_cache()
        await self.async_refresh()

    async def async_shutdown(self) -> None:
        if self._cancel_bt_callback:
            self._cancel_bt_callback()
            self._cancel_bt_callback = None

        for cancel in list(self._unavailable_unsubs.values()):
            cancel()
        self._unavailable_unsubs.clear()

    async def async_reload_cache(self) -> None:
        connectable = not self.include_passive
        service_infos = bluetooth.async_discovered_service_info(self.hass, connectable=connectable)
        for info in service_infos:
            self._upsert_service_info(info)
        self.async_set_updated_data(self._build_data())

    async def _async_register_ble_callbacks(self) -> None:
        connectable = not self.include_passive
        matcher = {"connectable": connectable}

        @callback
        def _async_discovered(
            service_info: bluetooth.BluetoothServiceInfoBleak,
            change: BluetoothChange,
        ) -> None:
            self._upsert_service_info(service_info)
            self.async_set_updated_data(self._build_data())

        self._cancel_bt_callback = bluetooth.async_register_callback(
            self.hass,
            _async_discovered,
            matcher,
            BluetoothScanningMode.ACTIVE,
        )

    def _allowed_source(self, source: str | None) -> bool:
        if not self.hub_sources:
            return True
        if not source:
            return False
        return str(source).upper() in self.hub_sources

    def _register_unavailable(self, address: str) -> None:
        if address in self._unavailable_unsubs:
            return

        connectable = not self.include_passive

        @callback
        def _async_unavailable(service_info: bluetooth.BluetoothServiceInfoBleak) -> None:
            dev = self._devices.get(address)
            if not dev:
                return
            dev.unavailable = True
            self.async_set_updated_data(self._build_data())

        cancel = bluetooth.async_track_unavailable(
            self.hass,
            _async_unavailable,
            address,
            connectable=connectable,
        )
        self._unavailable_unsubs[address] = cancel

    def _upsert_service_info(self, service_info: bluetooth.BluetoothServiceInfoBleak) -> None:
        address = str(service_info.address).upper()
        source = str(getattr(service_info, "source", "") or "").upper()
        if not self._allowed_source(source):
            return

        dev = self._devices.get(address)
        if dev is None:
            dev = DeviceState(address=address)
            self._devices[address] = dev
            self._register_unavailable(address)

        dev.name = service_info.name or dev.name or address
        dev.last_seen = time.time()
        dev.last_rssi = getattr(service_info, "rssi", dev.last_rssi)
        dev.connectable = getattr(service_info, "connectable", dev.connectable)
        dev.unavailable = False

        if source and dev.last_rssi is not None:
            dev.sources[source] = int(dev.last_rssi)

        self._estimate_position(dev)

    def _estimate_position(self, dev: DeviceState) -> None:
        map_id = self.map_store.get_active_map_id()
        anchors = self.map_store.get_anchors(map_id)

        if not anchors or not dev.sources:
            dev.map_id = map_id
            dev.x = None
            dev.y = None
            dev.confidence = None
            return

        # RSSI -> distance approximation
        tx_power = -59.0
        path_loss = 2.2

        sum_w = 0.0
        sum_x = 0.0
        sum_y = 0.0

        for source_id, rssi in dev.sources.items():
            anchor = None
            for a in anchors.values():
                if str(a.get("source_id", "")).upper() == source_id.upper():
                    anchor = a
                    break
            if not anchor:
                continue

            # Distance estimate (meters-ish)
            distance = 10 ** ((tx_power - float(rssi)) / (10 * path_loss))
            distance = max(distance, 0.5)

            base_weight = float(anchor.get("weight", 1.0))
            w = base_weight / (distance * distance)

            ax = float(anchor.get("x", 0.0))
            ay = float(anchor.get("y", 0.0))

            sum_w += w
            sum_x += ax * w
            sum_y += ay * w

        if sum_w <= 0:
            dev.map_id = map_id
            dev.x = None
            dev.y = None
            dev.confidence = None
            return

        dev.map_id = map_id
        dev.x = sum_x / sum_w
        dev.y = sum_y / sum_w
        dev.confidence = min(1.0, max(0.0, math.log10(1.0 + sum_w)))

    async def _async_update_data(self) -> dict[str, Any]:
        return self._build_data()

    def _build_data(self) -> dict[str, Any]:
        now_ts = time.time()
        active_count = 0

        devices_payload: dict[str, dict[str, Any]] = {}
        for address, dev in self._devices.items():
            active = dev.is_active(self.device_timeout, now_ts)
            if active:
                active_count += 1

            devices_payload[address] = {
                "address": address,
                "name": dev.name or address,
                "connectable": dev.connectable,
                "last_seen": dev.last_seen,
                "last_rssi": dev.last_rssi,
                "sources": dict(dev.sources),
                "unavailable": dev.unavailable,
                "active": active,
                "map_id": dev.map_id,
                "x": dev.x,
                "y": dev.y,
                "confidence": dev.confidence,
            }

        maps = self.map_store.get_maps()
        active_map_id = self.map_store.get_active_map_id()
        anchor_count = len(self.map_store.get_anchors(active_map_id))

        stats = {
            "include_passive": self.include_passive,
            "scanner_count_all": bluetooth.async_scanner_count(self.hass, connectable=False),
            "scanner_count_connectable": bluetooth.async_scanner_count(self.hass, connectable=True),
            "devices_seen_total": len(self._devices),
            "devices_active": active_count,
            "map_count": len(maps),
            "anchor_count_active_map": anchor_count,
            "active_map_id": active_map_id,
            "hub_sources_filter": sorted(list(self.hub_sources)),
            "device_timeout": self.device_timeout,
        }

        return {
            "devices": devices_payload,
            "stats": stats,
            "maps": maps,
        }
