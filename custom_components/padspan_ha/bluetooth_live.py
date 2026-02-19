"""Live Bluetooth snapshot for PadSpan.

Goal: expose the same kind of scanner + advertisement feed you can see in
Home Assistant Settings → Devices & services → Bluetooth → Visualization.

We keep a light in-memory cache via bluetooth async callbacks, and we also
fall back to querying Home Assistant's discovered service-info list when
available.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from homeassistant.core import HomeAssistant, callback

_LOGGER = logging.getLogger(__name__)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _bytes_to_hex_list(b: bytes) -> str:
    # Match HA UI-ish style: "0x4A 0x17 ..."
    return " ".join(f"0x{v:02X}" for v in b)


def _coerce_source(src: Any) -> str:
    # src may be a string, list/tuple/set of strings, or None.
    if src is None:
        return ""
    if isinstance(src, str):
        return src
    try:
        # iterable
        for s in src:
            if isinstance(s, str):
                return s
        return ""
    except Exception:
        return str(src)


def _service_info_to_record(si: Any, seen: Optional[dt.datetime] = None) -> Dict[str, Any]:
    seen_dt = seen or getattr(si, "time", None) or getattr(si, "seen", None) or _now()
    if isinstance(seen_dt, (int, float)):
        # Some implementations may use unix seconds.
        seen_dt = dt.datetime.fromtimestamp(float(seen_dt), tz=dt.timezone.utc)
    if isinstance(seen_dt, dt.datetime) and seen_dt.tzinfo is None:
        seen_dt = seen_dt.replace(tzinfo=dt.timezone.utc)

    address = getattr(si, "address", "") or ""
    name = getattr(si, "name", None) or getattr(si, "local_name", None) or ""
    source = _coerce_source(getattr(si, "source", None))

    rssi = getattr(si, "rssi", None)
    if rssi is None:
        adv = getattr(si, "advertisement", None)
        rssi = getattr(adv, "rssi", None) if adv is not None else None

    service_uuids = getattr(si, "service_uuids", None) or getattr(si, "service_uuids", None) or []

    manuf = getattr(si, "manufacturer_data", None)
    if manuf is None:
        adv = getattr(si, "advertisement", None)
        manuf = getattr(adv, "manufacturer_data", None) if adv is not None else None
    if manuf is None:
        manuf = {}

    svcdata = getattr(si, "service_data", None)
    if svcdata is None:
        adv = getattr(si, "advertisement", None)
        svcdata = getattr(adv, "service_data", None) if adv is not None else None
    if svcdata is None:
        svcdata = {}

    manuf_out: Dict[str, str] = {}
    try:
        for k, v in dict(manuf).items():
            if isinstance(v, (bytes, bytearray)):
                manuf_out[str(k)] = _bytes_to_hex_list(bytes(v))
            else:
                manuf_out[str(k)] = str(v)
    except Exception:
        manuf_out = {}

    svc_out: Dict[str, str] = {}
    try:
        for k, v in dict(svcdata).items():
            if isinstance(v, (bytes, bytearray)):
                svc_out[str(k)] = _bytes_to_hex_list(bytes(v))
            else:
                svc_out[str(k)] = str(v)
    except Exception:
        svc_out = {}

    return {
        "address": address,
        "name": name or address,
        "source": source,
        "rssi": rssi,
        "last_seen": seen_dt.isoformat(),
        # age_s is filled in get_snapshot so it's relative to snapshot time
        "manufacturer_data": manuf_out,
        "service_data": svc_out,
        "service_uuids": list(service_uuids) if isinstance(service_uuids, (list, tuple, set)) else [],
    }


@dataclass
class _Adv:
    record: Dict[str, Any]
    seen: dt.datetime


class BluetoothLive:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._seen_by_addr: Dict[str, _Adv] = {}
        self._unsubs: List[Any] = []

    def unload(self) -> None:
        for u in self._unsubs:
            try:
                u()
            except Exception:
                pass
        self._unsubs.clear()
        self._seen_by_addr.clear()

    @callback
    def _on_adv(self, service_info: Any, change: Any = None) -> None:
        # Store latest per address
        try:
            addr = getattr(service_info, "address", None) or ""
            if not addr:
                return
            seen = _now()
            rec = _service_info_to_record(service_info, seen=seen)
            self._seen_by_addr[addr] = _Adv(record=rec, seen=seen)
        except Exception as e:
            _LOGGER.debug("BLE adv parse failed: %s", e)

    def _seed_from_discovered(self) -> None:
        """Populate cache from HA's discovered service-info list (best-effort)."""
        try:
            from homeassistant.components import bluetooth  # type: ignore

            if hasattr(bluetooth, "async_discovered_service_info"):
                infos = bluetooth.async_discovered_service_info(self.hass)
                for si in infos:
                    self._on_adv(si)
        except Exception as e:
            _LOGGER.debug("BLE seed failed: %s", e)

    def get_snapshot(self, max_ads: int = 300, max_age_s: int = 120) -> Dict[str, Any]:
        """Return a lightweight BLE snapshot for the UI.

        radios: active scanners/adapters (local + remote proxies)
        advertisements: recently seen advertisements with RSSI + metadata

        We include a small diagnostics object so the UI can surface why BLE might look empty.
        """
        diag: Dict[str, Any] = {
            "ok": True,
            "seeded": False,
            "adv_cache_size": len(self._seen_by_addr),
            "errors": [],
        }

        try:
            from homeassistant.components import bluetooth  # type: ignore

            radios: List[Dict[str, Any]] = []
            try:
                scanners_fn = getattr(bluetooth, "async_current_scanners", None)
                if scanners_fn is not None:
                    scanners = scanners_fn(self.hass)

                    # Some HA versions return dict-like containers.
                    if isinstance(scanners, dict):
                        scanners = scanners.values()

                    for s in scanners:
                        src = getattr(s, "source", None)
                        name = getattr(s, "name", None)
                        connectable = getattr(s, "connectable", None)
                        scanning = getattr(s, "scanning", None)
                        adapter = getattr(s, "adapter", None)

                        radios.append(
                            {
                                "source": _coerce_source(src) or "",
                                "name": str(name or ""),
                                "connectable": bool(connectable) if connectable is not None else None,
                                "scanning": bool(scanning) if scanning is not None else None,
                                "adapter": str(adapter or "") if adapter is not None else "",
                            }
                        )
                else:
                    # Older HA: we may not be able to list scanners individually.
                    count = None
                    count_fn = getattr(bluetooth, "async_scanner_count", None)
                    if count_fn is not None:
                        try:
                            count = count_fn(self.hass, connectable=True)
                        except TypeError:
                            count = count_fn(self.hass)
                    if isinstance(count, int):
                        radios.append(
                            {
                                "source": "",
                                "name": f"Scanners active: {count} (upgrade HA for per-scanner list)",
                                "connectable": None,
                                "scanning": None,
                                "adapter": "",
                            }
                        )
            except Exception as e:
                diag["ok"] = False
                diag["errors"].append(f"scanner_list_failed: {e!s}")
                radios = []

            # If callbacks haven't filled anything yet, try seeding from HA.
            if not self._seen_by_addr:
                try:
                    self._seed_from_discovered()
                    diag["seeded"] = True
                except Exception as e:
                    diag["ok"] = False
                    diag["errors"].append(f"seed_failed: {e!s}")

            now = _now()
            ads: List[Dict[str, Any]] = []
            for a in self._seen_by_addr.values():
                age_s = (now - a.seen).total_seconds()
                if max_age_s and age_s > max_age_s:
                    continue
                rec = dict(a.record)
                rec["age_s"] = age_s
                ads.append(rec)

            # Sort: most recently seen first
            ads.sort(key=lambda x: x.get("age_s", 1e9))
            if max_ads and len(ads) > max_ads:
                ads = ads[:max_ads]

            diag["adv_cache_size"] = len(self._seen_by_addr)

            return {
                "radios": radios,
                "advertisements": ads,
                "diag": diag,
            }
        except Exception as e:
            _LOGGER.debug("BLE snapshot failed: %s", e)
            return {"radios": [], "advertisements": [], "diag": {"ok": False, "errors": [str(e)]}}
DATA_KEY = "bluetooth_live"


async def async_setup_bluetooth_live(hass: HomeAssistant) -> BluetoothLive:
    """Create + register BLE callbacks."""
    bl = BluetoothLive(hass)

    try:
        from homeassistant.components import bluetooth  # type: ignore

        # Register a single callback without filters to capture all advertisements.
        # Prefer ACTIVE scanning when the enum exists (newer HA), but stay compatible.
        mode_enum = getattr(bluetooth, "BluetoothScanningMode", None)
        scan_mode = mode_enum.ACTIVE if mode_enum is not None else None

        unsub = None
        # Newer HA signature (per docs): async_register_callback(hass, callback, match_dict, mode)
        try:
            if scan_mode is not None:
                unsub = bluetooth.async_register_callback(hass, bl._on_adv, {}, scan_mode)
            else:
                unsub = bluetooth.async_register_callback(hass, bl._on_adv, {})
        except TypeError:
            # Older HA signature(s)
            try:
                unsub = bluetooth.async_register_callback(hass, bl._on_adv)
            except TypeError:
                # Last-ditch: try keyword variants that have appeared in some releases
                try:
                    unsub = bluetooth.async_register_callback(hass, bl._on_adv, matcher={})
                except Exception:
                    unsub = None

        if unsub:
            bl._unsubs.append(unsub)

        # Seed once on startup so UI isn't empty while we wait for callbacks.
        bl._seed_from_discovered()

    except Exception as e:
        _LOGGER.debug("Bluetooth callbacks not available: %s", e)

    hass.data.setdefault("padspan_ha", {})[DATA_KEY] = bl
    return bl


def get_bluetooth_live(hass: HomeAssistant) -> Optional[BluetoothLive]:
    return hass.data.get("padspan_ha", {}).get(DATA_KEY)
