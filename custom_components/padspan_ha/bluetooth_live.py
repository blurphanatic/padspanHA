"""Live Bluetooth advertisements cache.

Purpose
-------
The Home Assistant Bluetooth UI (Settings → Devices & Services → Bluetooth →
Advertisements) is driven by the core Bluetooth integration's in-memory cache
of recent advertisements.

PadSpanHA uses this module to expose that same data to the frontend so the user
can see:
  - Radios (Bluetooth scanners / proxies)
  - Tags (advertising devices) and which radio saw them

We intentionally keep the implementation conservative:
  - No entity creation
  - Best-effort: if Bluetooth isn't enabled, we return empty lists
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import time
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.util import dt as dt_util


DOMAIN = "padspan_ha"


@dataclass
class BleAdRow:
    """One advertisement as seen by one source."""

    address: str
    name: str
    source: str
    source_name: str
    rssi: int | None
    seen: datetime
    connectable: bool
    manufacturer_data: dict[int, bytes]
    service_data: dict[str, bytes]
    service_uuids: list[str]


class BluetoothLive:
    """Maintain a short-lived cache of BLE advertisements keyed by (source, address)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._rows: dict[tuple[str, str], BleAdRow] = {}
        self._unsubs: list[callable] = []

    def stop(self) -> None:
        for u in list(self._unsubs):
            try:
                u()
            except Exception:
                pass
        self._unsubs.clear()

    @callback
    def _on_adv(self, service_info: Any, change: Any | None = None) -> None:
        """Bluetooth callback for advertisements.

        Signature matches homeassistant.components.bluetooth.async_register_callback.
        We only rely on fields that are stable across HA versions.
        """

        try:
            address = getattr(service_info, "address", None)
            source = getattr(service_info, "source", None)
            if not address or not source:
                return

            name = getattr(service_info, "name", None) or address
            rssi = getattr(service_info, "rssi", None)
            connectable = bool(getattr(service_info, "connectable", False))

            manufacturer_data = getattr(service_info, "manufacturer_data", None) or {}
            service_data = getattr(service_info, "service_data", None) or {}
            service_uuids = list(getattr(service_info, "service_uuids", None) or [])

            # Best-effort source name: may be present on service_info
            source_name = getattr(service_info, "source_name", None) or source

            self._rows[(source, address)] = BleAdRow(
                address=address,
                name=name,
                source=source,
                source_name=source_name,
                rssi=rssi,
                seen=dt_util.utcnow(),
                connectable=connectable,
                manufacturer_data=manufacturer_data,
                service_data=service_data,
                service_uuids=service_uuids,
            )
        except Exception:
            # never let BT callbacks take down the loop
            return

    def snapshot(self) -> dict[str, Any]:
        """Return a JSON-serializable snapshot for the UI."""

        now = dt_util.utcnow()
        out = []
        # drop anything stale (>15 minutes) to keep payload small
        cutoff = now.timestamp() - (15 * 60)

        for row in self._rows.values():
            if row.seen.timestamp() < cutoff:
                continue
            age_s = max(0.0, (now - row.seen).total_seconds())

            def _hex(b: Any, max_len: int = 64) -> str:
                if b is None:
                    return ""
                try:
                    bb = bytes(b)
                except Exception:
                    return ""
                if len(bb) > max_len:
                    return bb[:max_len].hex() + f"…(+{len(bb) - max_len}B)"
                return bb.hex()

            mfg = {}
            for k, v in (row.manufacturer_data or {}).items():
                try:
                    mfg[int(k)] = _hex(v)
                except Exception:
                    continue

            svc = {}
            for k, v in (row.service_data or {}).items():
                try:
                    svc[str(k)] = _hex(v)
                except Exception:
                    continue
            out.append(
                {
                    "address": row.address,
                    "name": row.name,
                    "source": row.source,
                    "source_name": row.source_name,
                    "rssi": row.rssi,
                    "seen_at": row.seen.isoformat(),
                    "age_s": age_s,
                    "connectable": row.connectable,
                    "service_uuids": row.service_uuids,
                    "manufacturer_data": mfg,
                    "service_data": svc,
                }
            )

        # newest first
        out.sort(key=lambda x: x.get("seen_at", ""), reverse=True)
        return {"advertisements": out}


async def async_setup_bluetooth_live(hass: HomeAssistant) -> callable:
    """Start the BluetoothLive cache and return an unload callable."""

    # Import lazily so the integration can load even if Bluetooth isn't set up.
    from homeassistant.components import bluetooth

    live = BluetoothLive(hass)

    # Match "everything" by only filtering on connectable. We register both so
    # users see all advertisements similar to the Bluetooth UI.
    unsub_1 = bluetooth.async_register_callback(
        hass,
        live._on_adv,
        {"connectable": False},
    )
    unsub_2 = bluetooth.async_register_callback(
        hass,
        live._on_adv,
        {"connectable": True},
    )

    live._unsubs.extend([unsub_1, unsub_2])

    hass.data[DOMAIN]["_bluetooth_live_obj"] = live

    def _unload() -> None:
        live.stop()
        hass.data.get(DOMAIN, {}).pop("_bluetooth_live_obj", None)

    return _unload


def get_bluetooth_live(hass: HomeAssistant) -> BluetoothLive | None:
    """Get the BluetoothLive object if available."""

    return hass.data.get(DOMAIN, {}).get("_bluetooth_live_obj")
