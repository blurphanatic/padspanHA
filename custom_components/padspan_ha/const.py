from __future__ import annotations

DOMAIN = "padspan_ha"
PLATFORMS = ["sensor", "device_tracker"]

CONF_INCLUDE_PASSIVE = "include_passive"
CONF_STALE_SECONDS = "stale_seconds"
CONF_TX_POWER = "tx_power"
CONF_PATH_LOSS = "path_loss"
CONF_SMOOTHING = "smoothing_alpha"

DEFAULT_INCLUDE_PASSIVE = True
DEFAULT_STALE_SECONDS = 25
DEFAULT_TX_POWER = -59
DEFAULT_PATH_LOSS = 2.2
DEFAULT_SMOOTHING = 0.45

STORAGE_VERSION = 1
DATA_ROOT = "padspan_ha_data"

SIGNAL_NEW_DEVICE = f"{DOMAIN}_new_device"
PANEL_URL_PATH = "padspan-ha"
STATIC_URL = "/padspan_ha_static"
