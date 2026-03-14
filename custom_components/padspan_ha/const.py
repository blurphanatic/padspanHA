# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
DOMAIN = "padspan_ha"
NAME = "PadSpan HA"
VERSION = "0.12.3"

CONF_ENABLE_CLOUD = "enable_cloud"
CONF_HUB_URL = "hub_url"
CONF_API_KEY = "api_key"
CONF_SCAN_INTERVAL = "scan_interval"

DEFAULT_SCAN_INTERVAL = 30
DEFAULT_REF_POWER = -59.0        # dBm RSSI at 1 m
DEFAULT_PATH_LOSS_EXP = 2.5      # path-loss exponent n

# Kalman filter parameters for per-scanner RSSI smoothing (replaces EMA)
DEFAULT_KALMAN_Q = 0.125         # process noise: how much true RSSI varies per poll
DEFAULT_KALMAN_R = 8.0           # measurement noise: how noisy raw RSSI is

# Gaussian room-scoring σ in metres.  score = exp(−(d/σ)²)
# At d=σ the scanner's influence drops to ~37%; at d=2σ to ~2%.
DEFAULT_ROOM_SIGMA_M = 4.0

DATA_COORDINATOR = "coordinator"
DATA_PANEL_REGISTERED = "_panel_registered"
DATA_SETTINGS = "settings"
DATA_MAPS = "maps"
DATA_MODEL = "model"
SETTINGS_STORE_KEY = "padspan_ha.settings"
MAPS_STORE_KEY = "padspan_ha.maps"
MODEL_STORE_KEY = "padspan_ha.model"
DEFAULT_FLOOR_ID = "main"
OUTSIDE_FLOOR_ID = "__outside__"
DEFAULT_ROOM_RADIUS = 0.12  # normalized (0–1) radius around receiver before polygon is drawn
MAPS_DIR = "padspan_ha/maps"
VENDOR_CACHE_STORE_KEY = "padspan_ha.vendor_cache"
OBJECT_STORE_KEY = "padspan_ha.objects"
DATA_OBJECTS = "objects"
DATA_OBJECTS_CACHE = "objects_cache"
CALIBRATION_STORE_KEY = "padspan_ha.calibration"
DATA_CALIBRATION = "calibration"
ALERTS_STORE_KEY = "padspan_ha.follow_alerts"
DATA_ALERTS = "alerts"
MOVEMENT_STORE_KEY = "padspan_ha.movement_history"
DATA_MOVEMENT = "movement"
ADAPTIVE_STORE_KEY = "padspan_ha.adaptive"
DATA_ADAPTIVE = "adaptive"
BACKUPS_STORE_KEY = "padspan_ha.backups"
OBJECT_HISTORY_STORE_KEY = "padspan_ha.object_history"
DATA_OBJECT_HISTORY = "object_history"
TRACEBACK_STORE_KEY = "padspan_ha.traceback"
DATA_TRACEBACK = "traceback"
DATA_TAG_INTEGRATION = "tag_integration"
