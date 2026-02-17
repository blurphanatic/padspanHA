from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .api import PadSpanApiClient
from .const import DOMAIN
from .exceptions import PadSpanApiError


def _sample_room_tag_map() -> Dict[str, List[str]]:
    """Fallback map used when cloud is disabled/unreachable."""
    return {
        "Kitchen": ["tag.keys", "tag.wallet", "tag.phone_anna", "tag.dog_collar"],
        "Living Room": ["tag.remote", "tag.phone_anna", "tag.tablet", "tag.keys"],
        "Garage": ["tag.bike", "tag.toolbox", "tag.keys", "tag.car_fob"],
        "Primary Bedroom": ["tag.watch", "tag.phone_garry", "tag.tablet"],
        "Office": ["tag.laptop", "tag.headset", "tag.phone_garry", "tag.keys"],
        "Entry": ["tag.keys", "tag.mailbag", "tag.car_fob"],
    }


def _room_map_from_devices(devices: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    room_map: Dict[str, set] = {}
    for dev in devices:
        room = str(dev.get("room") or "Unknown")
        tag = str(dev.get("tag") or dev.get("id") or "unknown")
        room_map.setdefault(room, set()).add(tag)
    return {room: sorted(list(tags)) for room, tags in room_map.items()}


class PadSpanCoordinator(DataUpdateCoordinator[Dict[str, Any]]):
    """Coordinates PadSpan data updates."""

    def __init__(
        self,
        hass: HomeAssistant,
        client: PadSpanApiClient,
        scan_interval: int,
    ) -> None:
        self._client = client
        self._test_presence = False
        self._last_success_iso = None  # type: Optional[str]
        self._last_error = None  # type: Optional[str]

        super().__init__(
            hass,
            hass.data[DOMAIN].get("logger"),
            name=DOMAIN,
            update_interval=timedelta(seconds=max(5, int(scan_interval))),
        )

    async def _async_update_data(self) -> Dict[str, Any]:
        if not self._client.enabled:
            return self._local_payload(status="local_only", cloud_reachable=False)

        try:
            health = await self._client.ping()
            ok = bool(health.get("ok", True))
            result = await self._client.fetch_devices()
            devices = result.get("devices", [])
            if not isinstance(devices, list):
                devices = []

            room_tag_map = _room_map_from_devices(devices)
            if not room_tag_map:
                room_tag_map = _sample_room_tag_map()

            self._last_success_iso = datetime.now(timezone.utc).isoformat()
            self._last_error = None
            return {
                "status": "cloud_connected" if ok else "cloud_degraded",
                "cloud_enabled": True,
                "cloud_reachable": ok,
                "hub_url": self._client.hub_url,
                "devices": devices,
                "room_tag_map": room_tag_map,
                "test_presence": self._test_presence,
                "last_success": self._last_success_iso,
                "last_error": None,
            }
        except PadSpanApiError as err:
            self._last_error = str(err)
            return self._local_payload(status="cloud_degraded", cloud_reachable=False)

    def _local_payload(self, status: str, cloud_reachable: bool) -> Dict[str, Any]:
        return {
            "status": status,
            "cloud_enabled": self._client.enabled,
            "cloud_reachable": cloud_reachable,
            "hub_url": self._client.hub_url,
            "devices": [],
            "room_tag_map": _sample_room_tag_map(),
            "test_presence": self._test_presence,
            "last_success": self._last_success_iso,
            "last_error": self._last_error,
        }

    def set_test_presence(self, is_home: bool) -> None:
        self._test_presence = bool(is_home)
        merged = dict(self.data or {})
        merged["test_presence"] = self._test_presence
        if "status" not in merged:
            merged.update(self._local_payload(status="local_only", cloud_reachable=False))
        self.async_set_updated_data(merged)
