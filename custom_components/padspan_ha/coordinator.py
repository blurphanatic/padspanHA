from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import PadSpanApiClient
from .const import DEFAULT_REFRESH_SECONDS, OPTION_REFRESH_SECONDS
from .exceptions import PadSpanApiError

LOGGER = logging.getLogger(__name__)

class PadSpanCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    def __init__(self, hass, entry: ConfigEntry, api: PadSpanApiClient) -> None:
        self.entry = entry
        self.api = api
        refresh_s = int(entry.options.get(OPTION_REFRESH_SECONDS, DEFAULT_REFRESH_SECONDS))
        super().__init__(
            hass,
            LOGGER,
            name=f"PadSpan {entry.entry_id}",
            update_interval=timedelta(seconds=max(5, refresh_s)),
        )

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            data = await self.api.async_get_state()
        except PadSpanApiError as err:
            raise UpdateFailed(str(err)) from err

        if not isinstance(data, dict):
            raise UpdateFailed("Payload must be an object")
        data.setdefault("summary", {})
        data.setdefault("devices", [])
        data.setdefault("rooms", [])
        return data
