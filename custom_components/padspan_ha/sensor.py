# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""
PadSpan HA — Presence Sensors
================================
Creates sensor entities for every BLE device the user has labelled:

  sensor.{label}_area          — current room name ("unknown" / "not_home")
  sensor.{label}_distance      — distance to the nearest scanner (metres)
  sensor.{label}_distance_{scanner} — distance to each individual scanner (metres)

The per-scanner distance sensors are created dynamically: a new entity is
registered the first time a scanner reports an advertisement from the device.
State returns None (unavailable) while the device is away.

Entity ID examples:
  sensor.padspan_car_keys_area
  sensor.padspan_car_keys_distance
  sensor.padspan_car_keys_distance_kitchen_proxy
Automation example:
  trigger when sensor.padspan_wallet_distance_bedroom_proxy < 1.5
"""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, DATA_SETTINGS, DEFAULT_REF_POWER, DEFAULT_PATH_LOSS_EXP
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


def _distance_params(hass: HomeAssistant) -> tuple[float, float]:
    """Return (ref_power, path_loss_exp) from settings, with safe defaults."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    data = (st.data or {}) if st else {}
    ref = float(data.get("ref_power", DEFAULT_REF_POWER))
    exp = float(data.get("path_loss_exp", DEFAULT_PATH_LOSS_EXP))
    return max(-100.0, min(0.0, ref)), max(1.0, min(4.0, exp))


def _calc_distance(rssi: float, obj: dict, hass: HomeAssistant) -> float:
    """Calculate distance using path-loss formula, preferring device's own TX power."""
    ref, n = _distance_params(hass)
    # Use device's own advertised TX Power (from iBeacon payload or BLE AD type 0x0A)
    # if available — this eliminates the need for manual ref_power calibration.
    tx_power = obj.get("tx_power")
    if tx_power is not None:
        ref = float(tx_power)
    return round(max(0.0, 10 ** ((ref - rssi) / (10.0 * n))), 1)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: PresenceCoordinator | None = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    if not coordinator:
        return

    created: set[str] = set()
    # label → list of sensor entities (for key migration on MAC rotation)
    label_sensors: dict[str, list[SensorEntity]] = {}
    created_scanner: set[tuple[str, str]] = set()
    # label → list of scanner sensor entities
    label_scanner_sensors: dict[tuple[str, str], PadSpanScannerDistanceSensor] = {}

    @callback
    def _check_new() -> None:
        if not coordinator.data:
            return
        st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        _sd = (st.data or {}) if st else {}
        _area_on = _sd.get("ha_entity_area_enabled", True)
        _dist_on = _sd.get("ha_entity_distance_enabled", True)
        _scan_on = _sd.get("ha_entity_scanner_distance_enabled", True)
        new: list[SensorEntity] = []
        # Sort by freshness — lowest age_s first so the active key wins dedup
        items = sorted(
            coordinator.data.items(),
            key=lambda kv: kv[1].get("age_s") if isinstance(kv[1].get("age_s"), (int, float)) else 999999,
        )
        for key, obj in items:
            if not _should_track(obj):
                continue
            label = obj["user_label"]
            if key not in created:
                if label in label_sensors:
                    # Label already has entities — migrate keys if this one is fresher
                    existing = label_sensors[label]
                    if existing:
                        old_key = existing[0]._key
                        old_obj = (coordinator.data or {}).get(old_key, {})
                        old_age = old_obj.get("age_s")
                        age = obj.get("age_s")
                        if (isinstance(age, (int, float)) and
                            (not isinstance(old_age, (int, float)) or age < old_age)):
                            for ent in existing:
                                _LOGGER.debug(
                                    "Migrating sensor '%s' from key %s to fresher key %s",
                                    label, ent._key, key,
                                )
                                ent._key = key
                else:
                    sensors: list[SensorEntity] = []
                    if _area_on:
                        s = PadSpanAreaSensor(coordinator, key)
                        new.append(s)
                        sensors.append(s)
                    if _dist_on:
                        s = PadSpanDistanceSensor(coordinator, key)
                        new.append(s)
                        sensors.append(s)
                    label_sensors[label] = sensors
                created.add(key)
            # Per-scanner distance sensors — one per device × scanner pair
            if _scan_on:
                for source in (obj.get("_source_rssi") or {}).keys():
                    pair = (key, source)
                    if pair not in created_scanner:
                        label_pair = (label, source)
                        if label_pair in label_scanner_sensors:
                            # Migrate key if fresher
                            existing_s = label_scanner_sensors[label_pair]
                            old_obj = (coordinator.data or {}).get(existing_s._key, {})
                            old_age = old_obj.get("age_s")
                            age = obj.get("age_s")
                            if (isinstance(age, (int, float)) and
                                (not isinstance(old_age, (int, float)) or age < old_age)):
                                existing_s._key = key
                        else:
                            s = PadSpanScannerDistanceSensor(coordinator, key, source)
                            new.append(s)
                            label_scanner_sensors[label_pair] = s
                        created_scanner.add(pair)
        if new:
            _LOGGER.debug("Adding %d new PadSpan sensor(s)", len(new))
            async_add_entities(new)

    _check_new()
    entry.async_on_unload(coordinator.async_add_listener(_check_new))


def _should_track(obj: dict[str, Any]) -> bool:
    """Only create entities for BLE objects the user has explicitly labelled."""
    return obj.get("kind") in ("ble", "private_ble", "ibeacon") and bool(obj.get("user_label"))


def _device_uid(obj: dict[str, Any]) -> str:
    # Prefer padspan_id (immutable stable identity from DeviceRegistry),
    # then canonical_id (survives MAC rotation for private_ble),
    # then volatile identifiers as last resort.
    if obj.get("padspan_id"):
        return obj["padspan_id"]
    if obj.get("canonical_id"):
        return obj["canonical_id"]
    return obj.get("address") or obj.get("entity_id") or obj.get("key", "")


class PadSpanAreaSensor(CoordinatorEntity[PresenceCoordinator], SensorEntity):
    """Reports the current room for a labelled BLE device."""

    _attr_icon = "mdi:map-marker"
    _attr_has_entity_name = True

    def __init__(self, coordinator: PresenceCoordinator, key: str) -> None:
        super().__init__(coordinator)
        self._key = key
        obj = (coordinator.data or {}).get(key, {})
        self._init_label = str(obj.get("user_label") or obj.get("name") or key)
        self._init_uid = _device_uid(obj) or key

    # ── internal helpers ─────────────────────────────────────────────────────

    @property
    def _obj(self) -> dict[str, Any]:
        return (self.coordinator.data or {}).get(self._key, {})

    def _label(self) -> str:
        obj = self._obj
        return str(obj.get("user_label") or obj.get("name") or self._init_label)

    # ── HA entity identity ────────────────────────────────────────────────────

    @property
    def unique_id(self) -> str:
        safe = self._key.replace(":", "_").replace(" ", "_").replace("/", "_")
        return f"padspan_ha__{safe}__area"

    @property
    def name(self) -> str:
        # With has_entity_name=True this renders as "{device name} Area"
        return "Area"

    @property
    def device_info(self) -> dict[str, Any]:
        uid = _device_uid(self._obj) or self._init_uid
        return {
            "identifiers": {(DOMAIN, uid)},
            "name": self._label(),
            "manufacturer": "PadSpan HA",
            "model": "BLE Presence Tracker",
        }

    # ── state ─────────────────────────────────────────────────────────────────

    @property
    def native_value(self) -> str:
        obj = self._obj
        age = obj.get("age_s")
        if isinstance(age, (int, float)) and age > _away_timeout_s(self.coordinator.hass):
            return "not_home"
        return obj.get("room") or "unknown"

    @property
    def available(self) -> bool:
        # Entity stays available as long as the coordinator is healthy.
        # "not_home" is a valid state — going unavailable would break automations.
        return bool(self.coordinator.last_update_success and self.coordinator.data is not None)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        obj = self._obj
        age = obj.get("age_s")
        timeout = _away_timeout_s(self.coordinator.hass)
        home = not (isinstance(age, (int, float)) and age > timeout)
        attrs: dict[str, Any] = {
            "kind": obj.get("kind"),
            "address": obj.get("address"),
            "padspan_id": obj.get("padspan_id"),
            "rssi": obj.get("rssi") if home else None,
            "age_s": round(age, 1) if isinstance(age, (int, float)) else None,
            "sources": obj.get("sources") if home else None,
            "home": home,
            "room_confidence": obj.get("room_confidence"),
            "rssi_margin_confidence": obj.get("rssi_margin_confidence"),
        }
        if obj.get("ibeacon_uuid"):
            attrs["ibeacon_uuid"] = obj["ibeacon_uuid"]
            attrs["ibeacon_major"] = obj.get("ibeacon_major")
            attrs["ibeacon_minor"] = obj.get("ibeacon_minor")
        if obj.get("all_addresses"):
            attrs["all_addresses"] = obj["all_addresses"]
        return attrs


class PadSpanDistanceSensor(CoordinatorEntity[PresenceCoordinator], SensorEntity):
    """Reports the estimated distance (metres) to the nearest scanner for a labelled BLE device."""

    _attr_icon = "mdi:ruler"
    _attr_has_entity_name = True
    _attr_native_unit_of_measurement = "m"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 1

    def __init__(self, coordinator: PresenceCoordinator, key: str) -> None:
        super().__init__(coordinator)
        self._key = key
        obj = (coordinator.data or {}).get(key, {})
        self._init_label = str(obj.get("user_label") or obj.get("name") or key)
        self._init_uid = _device_uid(obj) or key

    @property
    def _obj(self) -> dict[str, Any]:
        return (self.coordinator.data or {}).get(self._key, {})

    def _label(self) -> str:
        obj = self._obj
        return str(obj.get("user_label") or obj.get("name") or self._init_label)

    @property
    def unique_id(self) -> str:
        safe = self._key.replace(":", "_").replace(" ", "_").replace("/", "_")
        return f"padspan_ha__{safe}__distance"

    @property
    def name(self) -> str:
        return "Distance"

    @property
    def device_info(self) -> dict[str, Any]:
        uid = _device_uid(self._obj) or self._init_uid
        return {
            "identifiers": {(DOMAIN, uid)},
            "name": self._label(),
            "manufacturer": "PadSpan HA",
            "model": "BLE Presence Tracker",
        }

    @property
    def native_value(self) -> float | None:
        obj = self._obj
        rssi = obj.get("rssi")
        age = obj.get("age_s")
        if rssi is None:
            return None
        if isinstance(age, (int, float)) and age > _away_timeout_s(self.coordinator.hass):
            return None
        return _calc_distance(float(rssi), obj, self.coordinator.hass)

    @property
    def available(self) -> bool:
        return bool(self.coordinator.last_update_success and self.coordinator.data is not None)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        obj = self._obj
        age = obj.get("age_s")
        return {
            "rssi": obj.get("rssi"),
            "tx_power": obj.get("tx_power"),
            "age_s": round(age, 1) if isinstance(age, (int, float)) else None,
            "room": obj.get("room"),
        }


class PadSpanScannerDistanceSensor(CoordinatorEntity[PresenceCoordinator], SensorEntity):
    """Reports the estimated distance (metres) from one specific scanner to a labelled BLE device.

    One entity is created per device × scanner pair the first time a scanner reports
    an advertisement from the device.  State returns None while the device is away or
    the scanner has not heard from it recently.

    Automation example:
        trigger when sensor.my_tag_distance_bedroom_proxy < 1.5
    """

    _attr_icon = "mdi:bluetooth-audio"
    _attr_has_entity_name = True
    _attr_native_unit_of_measurement = "m"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 1

    def __init__(self, coordinator: PresenceCoordinator, key: str, source: str) -> None:
        super().__init__(coordinator)
        self._key = key
        self._source = source
        obj = (coordinator.data or {}).get(key, {})
        self._init_label = str(obj.get("user_label") or obj.get("name") or key)
        self._init_uid = _device_uid(obj) or key

    @property
    def _obj(self) -> dict[str, Any]:
        return (self.coordinator.data or {}).get(self._key, {})

    def _label(self) -> str:
        obj = self._obj
        return str(obj.get("user_label") or obj.get("name") or self._init_label)

    @property
    def unique_id(self) -> str:
        safe_key = self._key.replace(":", "_").replace(" ", "_").replace("/", "_")
        safe_src = self._source.replace(":", "_").replace(" ", "_").replace("/", "_")
        return f"padspan_ha__{safe_key}__dist__{safe_src}"

    @property
    def name(self) -> str:
        return f"Distance {self._source}"

    @property
    def device_info(self) -> dict[str, Any]:
        uid = _device_uid(self._obj) or self._init_uid
        return {
            "identifiers": {(DOMAIN, uid)},
            "name": self._label(),
            "manufacturer": "PadSpan HA",
            "model": "BLE Presence Tracker",
        }

    @property
    def native_value(self) -> float | None:
        obj = self._obj
        age = obj.get("age_s")
        if isinstance(age, (int, float)) and age > _away_timeout_s(self.coordinator.hass):
            return None
        rssi = (obj.get("_source_rssi") or {}).get(self._source)
        if rssi is None:
            return None
        return _calc_distance(float(rssi), obj, self.coordinator.hass)

    @property
    def available(self) -> bool:
        return bool(self.coordinator.last_update_success and self.coordinator.data is not None)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        obj = self._obj
        rssi = (obj.get("_source_rssi") or {}).get(self._source)
        age = obj.get("age_s")
        return {
            "scanner": self._source,
            "rssi": round(rssi, 1) if rssi is not None else None,
            "age_s": round(age, 1) if isinstance(age, (int, float)) else None,
            "room": obj.get("room"),
        }
