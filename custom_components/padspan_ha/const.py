DOMAIN = "padspan_ha"

PLATFORMS = ["sensor", "device_tracker"]

CONF_NAME = "name"
CONF_INCLUDE_PASSIVE = "include_passive"
CONF_BOOTSTRAP_CACHE = "bootstrap_cache"
CONF_DEVICE_TIMEOUT = "device_timeout"
CONF_HUB_SOURCES = "hub_sources"
CONF_HUB_SOURCES_CSV = "hub_sources_csv"
CONF_MAP_ID = "map_id"

DEFAULT_NAME = "PadSpan Hub"
DEFAULT_INCLUDE_PASSIVE = True
DEFAULT_BOOTSTRAP_CACHE = True
DEFAULT_DEVICE_TIMEOUT = 180
DEFAULT_MAP_ID = "default"

SERVICE_IMPORT_MAP_IMAGE = "import_map_image"
SERVICE_SET_MAP_ANCHOR = "set_map_anchor"
SERVICE_REMOVE_MAP_ANCHOR = "remove_map_anchor"
SERVICE_SET_ACTIVE_MAP = "set_active_map"
SERVICE_RELOAD_BLE_CACHE = "reload_ble_cache"
