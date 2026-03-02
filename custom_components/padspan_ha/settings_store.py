# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
REPO LOGIC NOTES

Persistent UI settings store for sample/live toggle and active map selection.
"""


import logging
from dataclasses import dataclass
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import SETTINGS_STORE_KEY

_LOGGER = logging.getLogger(__name__)

DEFAULT_SETTINGS: dict[str, Any] = {
    "data_mode": "sample",  # "sample" | "live"
    "vendor_lookup_enabled": True,  # Sends MAC prefixes to vendor lookup APIs when requested from UI
    "ref_power":      -59.0,   # dBm RSSI at 1 m (distance formula)
    "path_loss_exp":   2.5,    # path-loss exponent n (distance formula)
    "hidden_map_ids":  [],     # map IDs hidden from 3D stack view
    "scanner_offsets": {},     # {source_name: offset_dBm} — manual per-scanner RSSI trim
    "kalman_q": 0.125,             # Kalman process noise (RSSI responsiveness)
    "kalman_r": 8.0,               # Kalman measurement noise (smoothing strength)
    "room_sigma_m": 4.0,           # Gaussian room-scoring sigma in metres
    "health_reminder_enabled": False,  # monthly calibration accuracy reminder (off by default)
    "health_reminder_last_ts":  None,  # epoch seconds when reminder was last shown
    "adaptive_learning_enabled": False,  # experimental: passive room fingerprint learning
    "adaptive_floor_detection": False,   # experimental: cross-floor attenuation learning
    "beacon_auto_calibrate": True,       # experimental: auto-inject calibration from pinned beacons
    # 3D isometric view layout (Maps tab)
    "maps_iso_floor_gap":    200,   # px spacing between floors
    "maps_iso_horiz_gap":    0,     # px L/R horizontal offset
    "maps_iso_focus":        None,  # z_level to highlight, or null = all
    # 3D isometric view layout (Overview tab)
    "overview_iso_floor_gap": 150,
    "overview_iso_horiz_gap": 0,
    "overview_iso_focus":     None,
}


@dataclass
class SettingsStore:
    hass: HomeAssistant
    store: Store
    data: dict[str, Any]

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = Store(hass, 1, SETTINGS_STORE_KEY)
        self.data = dict(DEFAULT_SETTINGS)

    async def async_load(self) -> dict[str, Any]:
        loaded = await self.store.async_load()
        if isinstance(loaded, dict):
            self.data = {**DEFAULT_SETTINGS, **loaded}
        else:
            self.data = dict(DEFAULT_SETTINGS)
        await self.store.async_save(self.data)
        return self.data

    async def async_set(self, **kwargs: Any) -> dict[str, Any]:
        self.data = {**self.data, **kwargs}
        await self.store.async_save(self.data)
        return self.data

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)
