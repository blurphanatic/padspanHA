from __future__ import annotations

from homeassistant.const import Platform

DOMAIN = "padspan_ha"
NAME = "PadSpan HA"
VERSION = "0.3.7"

CONF_ENABLE_CLOUD = "enable_cloud"
CONF_HUB_URL = "hub_url"
CONF_API_KEY = "api_key"
CONF_SCAN_INTERVAL = "scan_interval"

DEFAULT_ENABLE_CLOUD = False
DEFAULT_HUB_URL = "http://padspan-hub.local:8080"
DEFAULT_SCAN_INTERVAL = 30

DATA_CLIENT = "client"
DATA_COORDINATOR = "coordinator"

PLATFORMS: list[Platform] = [
    Platform.SENSOR,
    Platform.BINARY_SENSOR,
    Platform.BUTTON,
    Platform.DEVICE_TRACKER,
]

SERVICE_SET_TEST_PRESENCE = "set_test_presence"
