DOMAIN = "padspan_ha"

CONF_API_BASE = "api_base"
CONF_API_KEY = "api_key"
CONF_DEMO_MODE = "demo_mode"
CONF_ENABLE_SIDEBAR = "enable_sidebar"

DEFAULT_API_BASE = "http://padspan-hub.local:8080"
DEFAULT_REFRESH_SECONDS = 15
DEFAULT_DEMO_MODE = True
DEFAULT_ENABLE_SIDEBAR = True

OPTION_REFRESH_SECONDS = "refresh_seconds"
OPTION_ENABLE_SIDEBAR = "enable_sidebar"

PLATFORMS = ["sensor", "binary_sensor", "device_tracker", "button"]

SERVICE_RESCAN = "rescan"
WEBSOCKET_GET_STATE = "padspan_ha/get_state"
