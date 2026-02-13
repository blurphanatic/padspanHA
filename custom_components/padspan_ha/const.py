from __future__ import annotations

from homeassistant.const import Platform

DOMAIN = "padspan_ha"

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.DEVICE_TRACKER]

DATA_COORDINATOR = "coordinator"
DATA_STORE = "store"
DATA_PANEL_REGISTERED = "panel_registered"
DATA_VIEWS_REGISTERED = "views_registered"
DATA_SERVICES_REGISTERED = "services_registered"

CONF_INCLUDE_PASSIVE = "include_passive"
CONF_UPDATE_INTERVAL = "update_interval"
CONF_SEEN_TIMEOUT = "seen_timeout"
CONF_ENABLE_SIDEBAR = "enable_sidebar"

DEFAULT_INCLUDE_PASSIVE = True
DEFAULT_UPDATE_INTERVAL = 5
DEFAULT_SEEN_TIMEOUT = 30
DEFAULT_ENABLE_SIDEBAR = True

SERVICE_IMPORT_MAP_IMAGE = "import_map_image"
SERVICE_SET_MAP_ANCHOR = "set_map_anchor"
SERVICE_DELETE_MAP_ANCHOR = "delete_map_anchor"
SERVICE_SET_ACTIVE_MAP = "set_active_map"
SERVICE_RELOAD_BLE_CACHE = "reload_ble_cache"

ATTR_ENTRY_ID = "entry_id"
ATTR_MAP_ID = "map_id"
ATTR_SOURCE_PATH = "source_path"
ATTR_NAME = "name"
ATTR_ACTIVATE = "activate"
ATTR_SOURCE_ID = "source_id"
ATTR_X = "x"
ATTR_Y = "y"
ATTR_Z = "z"
ATTR_WEIGHT = "weight"
ATTR_LABEL = "label"

FRONTEND_URL_PATH = "padspan-ha"
FRONTEND_COMPONENT_NAME = "padspan-ha-panel"
FRONTEND_TITLE = "PadSpan HA"
FRONTEND_ICON = "mdi:map-search"
FRONTEND_MODULE_URL_PATH = "/padspan_ha_frontend"
