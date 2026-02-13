"""Constants for PadSpan HA."""
from __future__ import annotations

from homeassistant.const import Platform

DOMAIN = "padspan_ha"
NAME = "PadSpan HA"
VERSION = "0.2.6"

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.DEVICE_TRACKER]

DATA_COORDINATOR = "coordinator"
DATA_STORE = "store"

SERVICE_IMPORT_MAP_IMAGE = "import_map_image"
SERVICE_SET_MAP_ANCHOR = "set_map_anchor"
SERVICE_RELOAD_BLE_CACHE = "reload_ble_cache"

CONF_ACTIVE_WINDOW_SECONDS = "active_window_seconds"
DEFAULT_ACTIVE_WINDOW_SECONDS = 60
