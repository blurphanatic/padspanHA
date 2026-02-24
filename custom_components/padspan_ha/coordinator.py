from __future__ import annotations

"""
REPO LOGIC NOTES

Single source of truth for panel state. Sample vs live modes, room_tag_map, diagnostics.
"""


import time
from dataclasses import dataclass, field
from typing import Any

from .const import DEFAULT_SCAN_INTERVAL

@dataclass
class PadSpanCoordinator:
    scan_interval: int = DEFAULT_SCAN_INTERVAL
    enable_cloud: bool = False
    hub_url: str = ""
    api_key: str = ""
    status: str = "local_only"
    cloud_reachable: bool = False
    devices: list[dict[str, Any]] = field(default_factory=list)
    room_tag_map: dict[str, list[str]] = field(default_factory=dict)
    test_presence: bool = False
    last_success: str | None = None
    last_error: str | None = None

    def ensure_defaults(self) -> None:
        if not self.room_tag_map:
            self.room_tag_map = {}

    def mark_success(self) -> None:
        self.last_success = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self.last_error = None

    def mark_error(self, err: str) -> None:
        self.last_error = err

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "cloud_enabled": self.enable_cloud,
            "cloud_reachable": self.cloud_reachable,
            "hub_url": self.hub_url,
            "scan_interval": self.scan_interval,
            "devices": self.devices,
            "room_tag_map": self.room_tag_map,
            "test_presence": self.test_presence,
            "last_success": self.last_success,
            "last_error": self.last_error,
        }
