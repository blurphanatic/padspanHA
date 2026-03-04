# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""
PadSpan HA — Device Trackers
==============================
Creates device_tracker.{label} entities for every labelled BLE device.
location_name = current room, so the tracker can be linked to a HA Person.

When not seen for longer than the configured away timeout (Settings → Presence →
Away timeout; default 5 minutes), location_name returns None → state becomes "not_home".

Entity ID example:  device_tracker.padspan_car_keys
Person link:        Settings → People → Alice → add device_tracker.padspan_alice_phone
"""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, DATA_SETTINGS
from .presence_coordinator import PresenceCoordinator

_LOGGER = logging.getLogger(__name__)

_DEFAULT_AWAY_TIMEOUT_S = 300  # 5 minutes


def _away_timeout_s(hass: HomeAssistant) -> float:
    """Return the configured away timeout in seconds (default 5 min)."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if st:
        val = (st.data or {}).get("away_timeout_m")
        if val is not None:
            return max(1.0, min(1440.0, float(val))) * 60.0
    return float(_DEFAULT_AWAY_TIMEOUT_S)

try:
    from homeassistant.components.device_tracker import SourceType, TrackerEntity
except ImportError:  # very old HA — graceful degradation
    TrackerEntity = None  # type: ignore[assignment,misc]
    SourceType = None  # type: ignore[assignment]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    if TrackerEntity is None:
        _LOGGER.warning("device_tracker.TrackerEntity unavailable — skipping PadSpan trackers")
        return

    coordinator: PresenceCoordinator | None = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    if not coordinator:
        return

    created: set[str] = set()

    @callback
    def _check_new() -> None:
        if not coordinator.data:
            return
        st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        _tracker_on = ((st.data or {}) if st else {}).get("ha_entity_tracker_enabled", True)
        if not _tracker_on:
            return
        new: list[PadSpanDeviceTracker] = []
        for key, obj in coordinator.data.items():
            if key in created:
                continue
            if obj.get("kind") in ("ble", "private_ble", "ibeacon") and obj.get("user_label"):
                new.append(PadSpanDeviceTracker(coordinator, key))
                created.add(key)
        if new:
            _LOGGER.debug("Adding %d new PadSpan device tracker(s)", len(new))
            async_add_entities(new)

    _check_new()
    entry.async_on_unload(coordinator.async_add_listener(_check_new))


def _device_uid(obj: dict[str, Any]) -> str:
    return obj.get("address") or obj.get("entity_id") or obj.get("key", "")


class PadSpanDeviceTracker(CoordinatorEntity["PresenceCoordinator"], TrackerEntity):  # type: ignore[misc]
    """Device tracker whose location_name is the current room for a labelled BLE device."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: "PresenceCoordinator", key: str) -> None:
        super().__init__(coordinator)
        self._key = key

    # ── internal helpers ─────────────────────────────────────────────────────

    @property
    def _obj(self) -> dict[str, Any]:
        return (self.coordinator.data or {}).get(self._key, {})

    def _label(self) -> str:
        obj = self._obj
        return str(obj.get("user_label") or obj.get("name") or self._key)

    # ── HA entity identity ────────────────────────────────────────────────────

    @property
    def unique_id(self) -> str:
        safe = self._key.replace(":", "_").replace(" ", "_").replace("/", "_")
        return f"padspan_ha__{safe}__tracker"

    # name=None with has_entity_name=True → entity IS the device's main feature.
    # entity_id becomes device_tracker.alice (just the device label, no suffix).
    _attr_name = None

    @property
    def device_info(self) -> dict[str, Any]:
        return {
            "identifiers": {(DOMAIN, _device_uid(self._obj))},
            "name": self._label(),
            "manufacturer": "PadSpan HA",
            "model": "BLE Presence Tracker",
        }

    # ── TrackerEntity requirements ────────────────────────────────────────────

    @property
    def source_type(self):
        if SourceType is not None:
            return SourceType.BLUETOOTH_LE
        return "bluetooth_le"

    @property
    def location_name(self) -> str | None:
        """Return room name when seen recently, None (→ not_home) otherwise."""
        obj = self._obj
        age = obj.get("age_s")
        if isinstance(age, (int, float)) and age > _away_timeout_s(self.coordinator.hass):
            return None
        return obj.get("room") or None

    @property
    def latitude(self) -> float | None:
        return None

    @property
    def longitude(self) -> float | None:
        return None

    @property
    def battery_level(self) -> int | None:
        return None

    @property
    def available(self) -> bool:
        # Always available while the coordinator is healthy — "not_home" is a
        # valid persistent state, not an error condition.
        return bool(self.coordinator.last_update_success and self.coordinator.data is not None)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        obj = self._obj
        age = obj.get("age_s")
        home = not (isinstance(age, (int, float)) and age > _away_timeout_s(self.coordinator.hass))
        return {
            "address": obj.get("address"),
            "rssi": obj.get("rssi") if home else None,
            "age_s": round(age, 1) if isinstance(age, (int, float)) else None,
            "user_label": obj.get("user_label"),
            "home": home,
        }
