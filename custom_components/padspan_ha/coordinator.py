from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging
import math
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.util import dt as dt_util

from homeassistant.components import bluetooth

from .const import (
    DOMAIN,
    CONF_INCLUDE_PASSIVE,
    CONF_STALE_SECONDS,
    CONF_TX_POWER,
    CONF_PATH_LOSS,
    CONF_SMOOTHING,
    DEFAULT_INCLUDE_PASSIVE,
    DEFAULT_STALE_SECONDS,
    DEFAULT_TX_POWER,
    DEFAULT_PATH_LOSS,
    DEFAULT_SMOOTHING,
    SIGNAL_NEW_DEVICE,
)
from .map_store import MapStore

_LOGGER = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(ts: datetime | None) -> str | None:
    if ts is None:
        return None
    return ts.isoformat()


@dataclass
class Obs:
    rssi: float
    seen: datetime
    connectable: bool | None
    name: str | None = None


class PadSpanCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    def __init__(self, hass: HomeAssistant, entry, map_store: MapStore) -> None:
        self.hass = hass
        self.entry = entry
        self.map_store = map_store
        self._unsubs: list[Any] = []
        self._obs: dict[str, dict[str, Obs]] = {}
        self._meta: dict[str, dict[str, Any]] = {}
        self._seen_ever: set[str] = set()
        self._known_addresses: set[str] = set()
        self._scanner_seen: dict[str, datetime] = {}

        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{entry.entry_id}",
            update_interval=timedelta(seconds=3),
        )

    @property
    def include_passive(self) -> bool:
        return self.entry.options.get(CONF_INCLUDE_PASSIVE, DEFAULT_INCLUDE_PASSIVE)

    @property
    def stale_seconds(self) -> int:
        return int(self.entry.options.get(CONF_STALE_SECONDS, DEFAULT_STALE_SECONDS))

    @property
    def tx_power(self) -> int:
        return int(self.entry.options.get(CONF_TX_POWER, DEFAULT_TX_POWER))

    @property
    def path_loss(self) -> float:
        return float(self.entry.options.get(CONF_PATH_LOSS, DEFAULT_PATH_LOSS))

    @property
    def smoothing_alpha(self) -> float:
        return float(self.entry.options.get(CONF_SMOOTHING, DEFAULT_SMOOTHING))

    async def async_start(self) -> None:
        await self.async_reload_ble_cache()
        await self._register_callbacks()
        await self.async_request_refresh()

    async def async_stop(self) -> None:
        while self._unsubs:
            unsub = self._unsubs.pop()
            try:
                unsub()
            except Exception:  # pragma: no cover
                pass

    async def _register_callbacks(self) -> None:
        async def _cb(service_info, change=None):
            self._handle_service_info(service_info)

        # Best-effort compatibility across HA versions:
        # Try (callback, matcher) signature first, then with scanning mode.
        try:
            self._unsubs.append(
                bluetooth.async_register_callback(
                    self.hass,
                    _cb,
                    bluetooth.BluetoothCallbackMatcher(),
                )
            )
        except Exception:
            try:
                self._unsubs.append(
                    bluetooth.async_register_callback(
                        self.hass,
                        _cb,
                        bluetooth.BluetoothCallbackMatcher(),
                        bluetooth.BluetoothScanningMode.ACTIVE,
                    )
                )
            except Exception as err:
                _LOGGER.warning("BLE callback registration fallback failed: %s", err)

    async def async_reload_ble_cache(self) -> None:
        infos = []
        try:
            if self.include_passive:
                infos.extend(bluetooth.async_discovered_service_info(self.hass, connectable=False))
            infos.extend(bluetooth.async_discovered_service_info(self.hass, connectable=True))
        except Exception:
            try:
                infos.extend(bluetooth.async_discovered_service_info(self.hass))
            except Exception as err:
                _LOGGER.debug("BLE cache bootstrap unavailable: %s", err)

        for info in infos:
            self._handle_service_info(info)

    def _extract_source_id(self, info) -> str:
        for key in ("source", "scanner", "scanner_id"):
            value = getattr(info, key, None)
            if value:
                return str(value)
        # HA sometimes provides source via as_dict
        if hasattr(info, "as_dict"):
            try:
                d = info.as_dict()
                source = d.get("source")
                if source:
                    return str(source)
            except Exception:
                pass
        return "unknown_scanner"

    def _extract_address(self, info) -> str | None:
        for key in ("address", "device"):
            value = getattr(info, key, None)
            if key == "device" and value is not None:
                addr = getattr(value, "address", None)
                if addr:
                    return str(addr).upper()
            elif value:
                return str(value).upper()
        return None

    def _extract_name(self, info) -> str | None:
        for key in ("name", "local_name"):
            value = getattr(info, key, None)
            if value:
                return str(value)
        return None

    def _extract_connectable(self, info) -> bool | None:
        return getattr(info, "connectable", None)

    def _extract_rssi(self, info) -> float | None:
        rssi = getattr(info, "rssi", None)
        if rssi is None:
            return None
        try:
            return float(rssi)
        except Exception:
            return None

    def _handle_service_info(self, info) -> None:
        address = self._extract_address(info)
        if not address:
            return

        source_id = self._extract_source_id(info)
        rssi = self._extract_rssi(info)
        if rssi is None:
            return

        connectable = self._extract_connectable(info)
        if (connectable is False) and (not self.include_passive):
            return

        now = _utcnow()
        per_source = self._obs.setdefault(address, {})
        prev = per_source.get(source_id)

        alpha = self.smoothing_alpha
        smoothed = rssi if prev is None else (alpha * rssi + (1 - alpha) * prev.rssi)

        per_source[source_id] = Obs(
            rssi=smoothed,
            seen=now,
            connectable=connectable,
            name=self._extract_name(info) or (prev.name if prev else None),
        )

        self._meta.setdefault(address, {})
        if per_source[source_id].name:
            self._meta[address]["name"] = per_source[source_id].name

        self._scanner_seen[source_id] = now
        self._seen_ever.add(address)

        was_new = address not in self._known_addresses
        self._known_addresses.add(address)

        if was_new:
            async_dispatcher_send(self.hass, SIGNAL_NEW_DEVICE, address)

    def _active_observations(self, address: str) -> dict[str, Obs]:
        now = _utcnow()
        stale = self.stale_seconds
        obs = self._obs.get(address, {})
        return {
            src: o
            for src, o in obs.items()
            if (now - o.seen).total_seconds() <= stale
        }

    def _estimate_position(self, address: str) -> dict[str, Any] | None:
        active_map = self.map_store.active_map()
        if not active_map:
            return None

        map_id = active_map["id"]
        anchors = active_map.get("anchors", {})
        active = self._active_observations(address)
        if not active:
            return None

        weighted_x = 0.0
        weighted_y = 0.0
        w_sum = 0.0
        used = 0
        rssi_values = []

        for source_id, obs in active.items():
            anchor = anchors.get(source_id)
            if not anchor:
                continue
            # Log-distance model distance (meters-ish)
            dist = 10 ** ((self.tx_power - obs.rssi) / (10 * self.path_loss))
            dist = max(0.2, min(dist, 50.0))
            base_w = 1.0 / (dist * dist)
            weight = base_w * float(anchor.get("weight", 1.0))
            weighted_x += float(anchor["x"]) * weight
            weighted_y += float(anchor["y"]) * weight
            w_sum += weight
            used += 1
            rssi_values.append(obs.rssi)

        if w_sum <= 0 or used == 0:
            return None

        x = weighted_x / w_sum
        y = weighted_y / w_sum

        # Confidence heuristic
        if used >= 4:
            conf = 0.88
        elif used == 3:
            conf = 0.76
        elif used == 2:
            conf = 0.62
        else:
            conf = 0.42

        if rssi_values:
            spread = max(rssi_values) - min(rssi_values)
            conf -= min(0.2, max(0.0, (spread - 8.0) / 80.0))

        # age penalty from oldest observation used
        oldest_age = max((_utcnow() - active[src].seen).total_seconds() for src in active if src in anchors) if used else 0
        conf -= min(0.25, oldest_age / max(1.0, self.stale_seconds * 2.0))
        conf = max(0.05, min(0.98, conf))

        # Calibration transform -> real coordinate frame
        real_x, real_y = self.map_store.apply_calibration(map_id, x, y)

        heat_radius = 10 + (1.0 - conf) * 75.0

        return {
            "map_id": map_id,
            "x": round(x, 2),
            "y": round(y, 2),
            "real_x": round(real_x, 3),
            "real_y": round(real_y, 3),
            "confidence": round(conf, 3),
            "heat_radius": round(heat_radius, 2),
            "anchors_used": used,
        }

    def _build_snapshot(self) -> dict[str, Any]:
        now = _utcnow()
        devices = []
        active_total = 0

        for address in sorted(self._known_addresses):
            active = self._active_observations(address)
            if active:
                active_total += 1
            name = self._meta.get(address, {}).get("name") or address
            position = self._estimate_position(address)
            devices.append(
                {
                    "address": address,
                    "name": name,
                    "active": bool(active),
                    "active_source_count": len(active),
                    "last_seen": _iso(max((o.seen for o in self._obs.get(address, {}).values()), default=None)),
                    "sources": {
                        src: {
                            "rssi": round(o.rssi, 2),
                            "seen": _iso(o.seen),
                            "connectable": o.connectable,
                        }
                        for src, o in self._obs.get(address, {}).items()
                    },
                    "position": position,
                }
            )

        scanner_sources = sorted(self._scanner_seen.keys())
        active_map = self.map_store.active_map()

        return {
            "entry_id": self.entry.entry_id,
            "generated_at": now.isoformat(),
            "options": {
                "include_passive": self.include_passive,
                "stale_seconds": self.stale_seconds,
                "tx_power": self.tx_power,
                "path_loss": self.path_loss,
                "smoothing_alpha": self.smoothing_alpha,
            },
            "scanner_sources": scanner_sources,
            "scanner_count_all": len(scanner_sources),
            "active_now": active_total,
            "seen_ever": len(self._seen_ever),
            "maps": self.map_store.data.get("maps", {}),
            "active_map_id": self.map_store.data.get("active_map_id"),
            "active_map": active_map,
            "devices": devices,
        }

    async def _async_update_data(self) -> dict[str, Any]:
        return self._build_snapshot()

    @property
    def known_addresses(self) -> set[str]:
        return set(self._known_addresses)

    def device_snapshot(self, address: str) -> dict[str, Any] | None:
        data = self.data or {}
        for dev in data.get("devices", []):
            if dev["address"] == address:
                return dev
        return None
