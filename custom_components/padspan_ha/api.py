from __future__ import annotations

from datetime import UTC, datetime
from hashlib import sha1
from typing import Any

import aiohttp
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .exceptions import PadSpanApiError

class PadSpanApiClient:
    def __init__(self, hass, api_base: str, api_key: str, demo_mode: bool) -> None:
        self.hass = hass
        self.api_base = api_base.rstrip("/")
        self.api_key = api_key
        self.demo_mode = demo_mode
        self._session = async_get_clientsession(hass)

    async def async_get_state(self) -> dict[str, Any]:
        if self.demo_mode:
            return self._demo_payload()

        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        url = f"{self.api_base}/api/v1/state"
        try:
            async with self._session.get(url, headers=headers, timeout=12) as resp:
                if resp.status >= 400:
                    raise PadSpanApiError(f"GET {url} failed: {resp.status}")
                return await resp.json()
        except aiohttp.ClientError as err:
            raise PadSpanApiError(f"Network error: {err}") from err

    async def async_trigger_scan(self) -> dict[str, Any]:
        if self.demo_mode:
            return {"accepted": True, "mode": "demo", "ts": datetime.now(UTC).isoformat()}

        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        url = f"{self.api_base}/api/v1/scan"
        try:
            async with self._session.post(url, headers=headers, timeout=12) as resp:
                if resp.status >= 400:
                    raise PadSpanApiError(f"POST {url} failed: {resp.status}")
                return await resp.json()
        except aiohttp.ClientError as err:
            raise PadSpanApiError(f"Network error: {err}") from err

    def _demo_payload(self) -> dict[str, Any]:
        now = datetime.now(UTC).replace(microsecond=0).isoformat()
        seed = int(sha1(now.encode()).hexdigest(), 16)

        rooms = ["Entry", "Kitchen", "Living", "Garage", "Office"]
        names = ["Garry iPhone", "Android Tablet", "Watch", "Keys Beacon", "Laptop"]
        devices: list[dict[str, Any]] = []
        for i, n in enumerate(names):
            h = (seed >> (i * 6)) & 0xFF
            room = rooms[h % len(rooms)]
            rssi = -35 - (h % 50)
            distance_m = round(max(0.4, min(15.0, (abs(rssi) - 30) / 8.5)), 2)
            devices.append({
                "id": f"dev_{i+1}",
                "name": n,
                "room": room,
                "rssi": rssi,
                "distance_m": distance_m,
                "is_connected": h % 5 != 0,
                "last_seen": now
            })

        rooms_covered = len({d["room"] for d in devices})
        summary = {
            "devices_seen": len(devices),
            "rooms_covered": rooms_covered,
            "calibration_valid": rooms_covered >= 3,
            "last_scan_age_s": 0
        }
        return {"generated_at": now, "summary": summary, "devices": devices, "rooms": rooms}
