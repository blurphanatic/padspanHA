DOMAIN = "padspan_ha"
NAME = "PadSpan HA"
VERSION = "0.5.18"

CONF_ENABLE_CLOUD = "enable_cloud"
CONF_HUB_URL = "hub_url"
CONF_API_KEY = "api_key"
CONF_SCAN_INTERVAL = "scan_interval"

DEFAULT_SCAN_INTERVAL = 30
DEFAULT_REF_POWER = -59.0        # dBm RSSI at 1 m
DEFAULT_PATH_LOSS_EXP = 2.5      # path-loss exponent n

DATA_COORDINATOR = "coordinator"
DATA_PANEL_REGISTERED = "_panel_registered"
DATA_SETTINGS = "settings"
DATA_MAPS = "maps"
DATA_MODEL = "model"
SETTINGS_STORE_KEY = "padspan_ha.settings"
MAPS_STORE_KEY = "padspan_ha.maps"
MODEL_STORE_KEY = "padspan_ha.model"
DEFAULT_FLOOR_ID = "main"
DEFAULT_ROOM_RADIUS = 0.12  # normalized (0–1) radius around receiver before polygon is drawn
MAPS_DIR = "padspan_ha/maps"
VENDOR_CACHE_STORE_KEY = "padspan_ha.vendor_cache"
OBJECT_STORE_KEY = "padspan_ha.objects"
DATA_OBJECTS = "objects"
CALIBRATION_STORE_KEY = "padspan_ha.calibration"
DATA_CALIBRATION = "calibration"
