from __future__ import annotations

from datetime import UTC, datetime, timedelta
import logging
from typing import Any

from homeassistant.components import bluetooth
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    CONF_INCLUDE_PASSIVE,
    CONF_SEEN_TIMEOUT,
    CONF_UPDATE_INTERVAL,
    DEFAULT_INCLUDE_PASSIVE,
    DEFAULT_SEEN_TIMEOUT,
    DEFAULT_UPDATE_INTERVAL,
    DOMAIN,
)
from .map_store import MapStore

_LOGGER = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _to_iso(ts: datetime | None) -> str | None:
    if ts is None:
        return None
    return ts.isoformat()


class PadSpanCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """PadSpan BLE coordinator."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, store: MapStore) -> None:
        self.hass = hass
        self.entry = entry
        self.store = store

        update_interval = int(entry.options.get(CONF_UPDATE_INTERVAL, entry.data.get(CONF_UPDATE_INTERVAL, DEFAULT_UPDATE_INTERVAL)))
        self._seen_timeout = int(entry.options.get(CONF_SEEN_TIMEOUT, entry.data.get(CONF_SEEN_TIMEOUT, DEFAULT_SEEN_TIMEOUT)))
        self._include_passive = bool(entry.options.get(CONF_INCLUDE_PASSIVE, entry.data.get(CONF_INCLUDE_PASSIVE, DEFAULT_INCLUDE_PASSIVE)))

        self.devices: dict[str, dict[str, Any]] = {}
        self.seen_ever: set[str] = set()

        super().__init__(
            hass=hass,
            logger=_LOGGER,
            name=f"{DOMAIN}_{entry.entry_id}",
            update_interval=timedelta(seconds=max(2, update_interval)),
        )

    @property
    def seen_timeout(self) -> int:
        return self._seen_timeout

    @property
    def include_passive(self) -> bool:
        return self._include_passive

    def _iter_connectable_modes(self) -> list[bool]:
        if self._include_passive:
            # connectable=False includes data from connectable and non-connectable scanners.
            return [False, True]
        return [True]

    def _read_scanner_count(self, connectable: bool) -> int | None:
        fn = getattr(bluetooth, "async_scanner_count", None)
        if fn is None:
            return None
        try:
            return int(fn(self.hass, connectable=connectable))
        except Exception:
            return None

    def _merge_service_info(self, info: Any, connectable_mode: bool) -> None:
        address = getattr(info, "address", None)
        if not address:
            return

        source = getattr(info, "source", None) or "unknown"
        rssi = getattr(info, "rssi", None)
        name = getattr(info, "name", None)

        device_obj = getattr(info, "device", None)
        if not name and device_obj is not None:
            name = getattr(device_obj, "name", None)

        now = _utcnow()
        rec = self.devices.setdefault(
            address,
            {
                "address": address,
                "name": name or address,
                "first_seen": now,
                "last_seen": now,
                "seen_count": 0,
                "connectable_seen": False,
                "sources": {},
                "manufacturer_data_keys": [],
                "service_uuids": [],
                "map_x": None,
                "map_y": None,
                "map_confidence": 0.0,
            },
        )

        rec["name"] = name or rec.get("name") or address
        rec["last_seen"] = now
        rec["seen_count"] = int(rec.get("seen_count", 0)) + 1
        if connectable_mode:
            rec["connectable_seen"] = True

        mfr_data = getattr(info, "manufacturer_data", None) or {}
        rec["manufacturer_data_keys"] = sorted([str(k) for k in mfr_data.keys()])[:12]

        service_uuids = getattr(info, "service_uuids", None) or []
        rec["service_uuids"] = sorted([str(x) for x in service_uuids])[:16]

        rec["sources"].setdefault(source, {})
        rec["sources"][source].update(
            {
                "source_id": source,
                "rssi": int(rssi) if isinstance(rssi, (int, float)) else None,
                "last_seen": now,
            }
        )

        self.seen_ever.add(address)

        by_addr_fn = getattr(bluetooth, "async_scanner_devices_by_address", None)
        if by_addr_fn is None:
            return

        try:
            by_scanner = by_addr_fn(self.hass, address, connectable=connectable_mode)
        except Exception:
            return

        if isinstance(by_scanner, dict):
            values = by_scanner.values()
        elif isinstance(by_scanner, list):
            values = by_scanner
        else:
            values = []

        for item in values:
            src = getattr(item, "source", None) or getattr(getattr(item, "scanner", None), "source", None)
            adv = getattr(item, "advertisement", None)
            irssi = getattr(adv, "rssi", None)
            if irssi is None:
                irssi = getattr(item, "rssi", None)
            if not src:
                continue
            rec["sources"].setdefault(src, {})
            rec["sources"][src].update(
                {
                    "source_id": src,
                    "rssi": int(irssi) if isinstance(irssi, (int, float)) else None,
                    "last_seen": now,
                }
            )

    def _compute_positions(self) -> None:
        active_map = self.store.active_map
        if not active_map:
            for rec in self.devices.values():
                rec["map_x"] = None
                rec["map_y"] = None
                rec["map_confidence"] = 0.0
            return

        anchors = self.store.anchors.get(active_map, {})
        if not anchors:
            for rec in self.devices.values():
                rec["map_x"] = None
                rec["map_y"] = None
                rec["map_confidence"] = 0.0
            return

        now = _utcnow()
        timeout = timedelta(seconds=self._seen_timeout)

        for rec in self.devices.values():
            weighted_x = 0.0
            weighted_y = 0.0
            total_w = 0.0
            contributing = 0

            for source_id, srec in rec.get("sources", {}).items():
                if source_id not in anchors:
                    continue
                seen_ts = srec.get("last_seen")
                if not isinstance(seen_ts, datetime):
                    continue
                if now - seen_ts > timeout:
                    continue
                rssi = srec.get("rssi")
                if rssi is None:
                    continue

                anchor = anchors[source_id]
                base_weight = float(anchor.get("weight", 1.0))
                signal_score = max(1.0, float(rssi + 100))
                w = base_weight * signal_score * signal_score

                weighted_x += float(anchor.get("x", 0.0)) * w
                weighted_y += float(anchor.get("y", 0.0)) * w
                total_w += w
                contributing += 1

            if total_w <= 0:
                rec["map_x"] = None
                rec["map_y"] = None
                rec["map_confidence"] = 0.0
            else:
                rec["map_x"] = round(weighted_x / total_w, 2)
                rec["map_y"] = round(weighted_y / total_w, 2)
                rec["map_confidence"] = round(min(1.0, contributing / max(1, len(anchors))), 3)

    async def async_reload_cache(self) -> None:
        await self.async_request_refresh()

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            modes = self._iter_connectable_modes()
            for connectable_mode in modes:
                infos = bluetooth.async_discovered_service_info(self.hass, connectable=connectable_mode)
                for info in infos:
                    self._merge_service_info(info, connectable_mode)

            now = _utcnow()
            timeout = timedelta(seconds=self._seen_timeout * 3)
            for rec in self.devices.values():
                stale_sources: list[str] = []
                for source_id, srec in rec.get("sources", {}).items():
                    seen_ts = srec.get("last_seen")
                    if not isinstance(seen_ts, datetime):
                        stale_sources.append(source_id)
                        continue
                    if now - seen_ts > timeout:
                        stale_sources.append(source_id)
                for source_id in stale_sources:
                    rec["sources"].pop(source_id, None)

            self._compute_positions()

            active_now = 0
            scanner_sources: set[str] = set()
            for rec in self.devices.values():
                for src in rec.get("sources", {}):
                    scanner_sources.add(src)
                last_seen = rec.get("last_seen")
                if isinstance(last_seen, datetime) and now - last_seen <= timedelta(seconds=self._seen_timeout):
                    active_now += 1

            scanner_count_connectable = self._read_scanner_count(True)
            scanner_count_all = self._read_scanner_count(False if self._include_passive else True)

            return {
                "updated_at": _to_iso(now),
                "active_now": active_now,
                "seen_ever": len(self.seen_ever),
                "scanner_count_connectable": scanner_count_connectable,
                "scanner_count_all": scanner_count_all,
                "scanner_sources": sorted(scanner_sources),
                "device_count": len(self.devices),
            }
        except Exception as err:
            raise UpdateFailed(str(err)) from err

    def get_device(self, address: str) -> dict[str, Any] | None:
        return self.devices.get(address)

    def get_devices(self) -> dict[str, dict[str, Any]]:
        return self.devices

    def get_device_snapshot(self, limit: int = 500) -> list[dict[str, Any]]:
        now = _utcnow()
        rows: list[dict[str, Any]] = []
        for rec in self.devices.values():
            last_seen = rec.get("last_seen")
            age = None
            if isinstance(last_seen, datetime):
                age = int((now - last_seen).total_seconds())
            row = {
                "address": rec.get("address"),
                "name": rec.get("name"),
                "last_seen": _to_iso(last_seen if isinstance(last_seen, datetime) else None),
                "age_seconds": age,
                "seen_count": rec.get("seen_count", 0),
                "connectable_seen": rec.get("connectable_seen", False),
                "map_x": rec.get("map_x"),
                "map_y": rec.get("map_y"),
                "map_confidence": rec.get("map_confidence", 0.0),
                "sources": [],
            }
            for src, srec in rec.get("sources", {}).items():
                src_last = srec.get("last_seen")
                row["sources"].append(
                    {
                        "source_id": src,
                        "rssi": srec.get("rssi"),
                        "last_seen": _to_iso(src_last if isinstance(src_last, datetime) else None),
                    }
                )
            row["sources"].sort(key=lambda x: (x["source_id"] or ""))
            rows.append(row)

        rows.sort(key=lambda x: x.get("age_seconds") if x.get("age_seconds") is not None else 999999)
        return rows[:limit]
