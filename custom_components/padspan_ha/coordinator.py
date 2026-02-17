from __future__ import annotations

from datetime import timedelta, datetime, timezone
from typing import Any, Optional

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .api import PadSpanApiClient
from .const import DOMAIN
from .exceptions import PadSpanApiError


def _sample_room_tag_map() -> dict[str, list[str]]:
    """Fallback room->tag map for local-only testing."""
    return {
        "Kitchen": ["tag.keys", "tag.wallet", "tag.phone_anna", "tag.dog_collar"],
        "Living Room": ["tag.remote", "tag.phone_anna", "tag.tablet", "tag.keys"],
        "Garage": ["tag.bike", "tag.toolbox", "tag.keys", "tag.car_fob"],
        "Primary Bedroom": ["tag.watch", "tag.phone_garry", "tag.tablet"],
        "Office": ["tag.laptop", "tag.headset", "tag.phone_garry", "tag.keys"],
        "Entry": ["tag.keys", "tag.mailbag", "tag.car_fob"],
    }


def _room_map_from_devices(devices: list[dict[str, Any]]) -> dict[str, list[str]]:
    room_map: dict[str, set[str]] = {}

    for dev in devices:
        if not isinstance(dev, dict):
            continue

        room = dev.get("room") or dev.get("room_name") or dev.get("zone")
        tag = (
            dev.get("tag")
            or dev.get("tag_id")
            or dev.get("name")
            or dev.get("device_id")
            or dev.get("id")
        )

        if room is None or tag is None:
            continue

        room_s = str(room).strip()
        tag_s = str(tag).strip()

        if not room_s or not tag_s:
            continue

        room_map.setdefault(room_s, set()).add(tag_s)

    return {room: sorted(tags) for room, tags in sorted(room_map.items())}


class PadSpanCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinator for PadSpan data.

    v0.3.7:
    - local-first startup
    - non-fatal cloud errors
    - room/tag map for checklist UI
    """

    def __init__(
        self,
        hass: HomeAssistant,
        client: PadSpanApiClient,
        scan_interval: int,
    ) -> None:
        super().__init__(
            hass,
            logger=hass.data[DOMAIN]["logger"],
            name=DOMAIN,
            update_interval=timedelta(seconds=max(5, int(scan_interval))),
        )
        self.client = client
        self._test_presence = False
        self._last_success_iso = None  # type: Optional[str]
        self._last_error = None  # type: Optional[str]
        self._room_tag_map: dict[str, list[str]] = _sample_room_tag_map()

    def set_test_presence(self, is_home: bool) -> None:
        self._test_presence = bool(is_home)
        data = dict(self.data or {})
        data["test_presence"] = self._test_presence
        self.async_set_updated_data(data)

    async def _async_update_data(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "status": "local_only",
            "cloud_enabled": self.client.enabled,
            "cloud_reachable": False,
            "hub_url": self.client.hub_url,
            "devices": [],
            "room_tag_map": self._room_tag_map,
            "test_presence": self._test_presence,
            "last_success": self._last_success_iso,
            "last_error": self._last_error,
        }

        if not self.client.enabled:
            return data

        try:
            await self.client.ping()
            devices = await self.client.fetch_devices()

            parsed_map = _room_map_from_devices(devices)
            if parsed_map:
                self._room_tag_map = parsed_map

            self._last_success_iso = datetime.now(timezone.utc).isoformat()
            self._last_error = None
            data.update(
                {
                    "status": "cloud_connected",
                    "cloud_enabled": True,
                    "cloud_reachable": True,
                    "devices": devices,
                    "room_tag_map": self._room_tag_map,
                    "last_success": self._last_success_iso,
                    "last_error": None,
                }
            )
            return data
        except PadSpanApiError as err:
            self._last_error = str(err)
            data.update(
                {
                    "status": "cloud_degraded",
                    "cloud_enabled": True,
                    "cloud_reachable": False,
                    "room_tag_map": self._room_tag_map,
                    "last_success": self._last_success_iso,
                    "last_error": self._last_error,
                }
            )
            return data
