"""ESPresense MQTT ingestion for PadSpan HA.

Subscribes to ESPresense MQTT topics and maintains an in-memory cache of
BLE advertisements from ESPresense scanner nodes.  Output format matches
bluetooth_live.py so data merges seamlessly into the live snapshot pipeline.

Off by default — enable via Settings → espresense_mqtt_enabled.

Topic structure (default prefix: "espresense"):
  espresense/devices/{device_id}          — per-device RSSI/distance from each node
  espresense/rooms/{room_name}            — scanner telemetry (IP, firmware, uptime)
  espresense/rooms/{room_name}/status     — online/offline LWT
  espresense/rooms/{room_name}/telemetry  — detailed telemetry

Each ESPresense node publishes to the same device topic, but the JSON payload
may include which room/node saw the device.  We subscribe to devices/# and
rooms/# and parse accordingly.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from homeassistant.core import HomeAssistant

from .const import DATA_ESPRESENSE_MQTT, DATA_SETTINGS, DOMAIN

_LOGGER = logging.getLogger(__name__)
_PRUNE_AGE_S = 14400  # 4 hours — same as bluetooth_live


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


@dataclass
class _EspAdv:
    """Cached advertisement from an ESPresense node."""
    address: str
    name: str
    rssi: int
    distance: float
    source: str      # "espresense_{room_name}"
    seen: dt.datetime
    raw: dict = field(default_factory=dict)


@dataclass
class _EspScanner:
    """Cached ESPresense scanner (room/node) info."""
    room: str
    source: str        # "espresense_{room}"
    online: bool = True
    ip: str = ""
    firmware: str = ""
    uptime: int = 0
    last_seen: dt.datetime = field(default_factory=_now)


class EspresenseMqtt:
    """Subscribe to ESPresense MQTT topics and cache BLE advertisements."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._unsubs: list[Callable] = []
        self._prefix = "espresense"

        # Cache: {address: {source: _EspAdv}}
        self._seen: Dict[str, Dict[str, _EspAdv]] = {}
        # Scanners: {room_name: _EspScanner}
        self._scanners: Dict[str, _EspScanner] = {}

    async def async_start(self, topic_prefix: str = "espresense") -> None:
        """Subscribe to ESPresense MQTT topics."""
        self._prefix = topic_prefix.strip().rstrip("/")
        try:
            from homeassistant.components.mqtt import async_subscribe  # type: ignore
        except ImportError:
            _LOGGER.warning("MQTT integration not available — ESPresense ingestion disabled")
            return

        # Subscribe to device advertisements
        try:
            unsub = await async_subscribe(
                self.hass,
                f"{self._prefix}/devices/#",
                self._on_device_message,
                qos=0,
            )
            self._unsubs.append(unsub)
            _LOGGER.info("ESPresense MQTT: subscribed to %s/devices/#", self._prefix)
        except Exception as e:
            _LOGGER.error("ESPresense MQTT: failed to subscribe to devices: %s", e)

        # Subscribe to room/scanner info
        try:
            unsub = await async_subscribe(
                self.hass,
                f"{self._prefix}/rooms/#",
                self._on_room_message,
                qos=0,
            )
            self._unsubs.append(unsub)
            _LOGGER.info("ESPresense MQTT: subscribed to %s/rooms/#", self._prefix)
        except Exception as e:
            _LOGGER.error("ESPresense MQTT: failed to subscribe to rooms: %s", e)

    async def async_stop(self) -> None:
        """Unsubscribe from all MQTT topics."""
        for unsub in self._unsubs:
            try:
                unsub()
            except Exception:
                pass
        self._unsubs.clear()
        self._seen.clear()
        self._scanners.clear()
        _LOGGER.info("ESPresense MQTT: stopped")

    # ── MQTT Callbacks (must be fast — just cache, no async work) ─────────

    def _on_device_message(self, msg) -> None:
        """Handle espresense/devices/{id} or espresense/devices/{id}/{room}."""
        try:
            topic = msg.topic
            payload = msg.payload
            if isinstance(payload, bytes):
                payload = payload.decode("utf-8", errors="replace")

            # Parse topic: prefix/devices/{device_id} or prefix/devices/{device_id}/{room}
            parts = topic.split("/")
            prefix_depth = len(self._prefix.split("/"))
            # parts = [prefix..., "devices", device_id, ?room]
            if len(parts) < prefix_depth + 2:
                return
            device_id = parts[prefix_depth + 1]
            room_from_topic = parts[prefix_depth + 2] if len(parts) > prefix_depth + 2 else None

            data = json.loads(payload) if isinstance(payload, str) else {}
            if not isinstance(data, dict):
                return

            # Extract fields
            address = str(data.get("id") or data.get("mac") or device_id).upper()
            name = str(data.get("name") or address)
            rssi = data.get("rssi")
            distance = data.get("distance")

            if rssi is None and distance is None:
                return  # no useful data

            # Determine which scanner/room this came from
            room = room_from_topic or str(data.get("room") or data.get("scanner") or "unknown")
            source = f"espresense_{room}"

            now = _now()

            # Register scanner if not seen before
            if room not in self._scanners:
                self._scanners[room] = _EspScanner(room=room, source=source, last_seen=now)
            else:
                self._scanners[room].last_seen = now
                self._scanners[room].online = True

            # Cache the advertisement
            adv = _EspAdv(
                address=address,
                name=name,
                rssi=int(rssi) if rssi is not None else -999,
                distance=float(distance) if distance is not None else -1,
                source=source,
                seen=now,
                raw=data,
            )
            self._seen.setdefault(address, {})[source] = adv

        except Exception:
            pass  # fast path — never block

    def _on_room_message(self, msg) -> None:
        """Handle espresense/rooms/{room} and espresense/rooms/{room}/status."""
        try:
            topic = msg.topic
            payload = msg.payload
            if isinstance(payload, bytes):
                payload = payload.decode("utf-8", errors="replace")

            parts = topic.split("/")
            prefix_depth = len(self._prefix.split("/"))
            # parts = [prefix..., "rooms", room_name, ?status|?telemetry]
            if len(parts) < prefix_depth + 2:
                return
            room = parts[prefix_depth + 1]
            sub = parts[prefix_depth + 2] if len(parts) > prefix_depth + 2 else None
            source = f"espresense_{room}"
            now = _now()

            if room not in self._scanners:
                self._scanners[room] = _EspScanner(room=room, source=source, last_seen=now)

            scanner = self._scanners[room]
            scanner.last_seen = now

            if sub == "status":
                scanner.online = (payload.strip().lower() in ("online", "1", "true"))
            elif sub == "telemetry" or sub is None:
                try:
                    data = json.loads(payload) if isinstance(payload, str) else {}
                    if isinstance(data, dict):
                        scanner.ip = str(data.get("ip") or scanner.ip)
                        scanner.firmware = str(data.get("firmware") or data.get("ver") or scanner.firmware)
                        scanner.uptime = int(data.get("uptime") or scanner.uptime)
                except (json.JSONDecodeError, ValueError):
                    pass
        except Exception:
            pass

    # ── Snapshot (called from _live_snapshot) ─────────────────────────────

    def get_snapshot(self, max_age_s: int = 900) -> Dict[str, Any]:
        """Return BLE snapshot matching bluetooth_live.py format."""
        now = _now()

        # Prune stale entries
        prune_addrs = []
        for addr, src_map in self._seen.items():
            dead = [s for s, a in src_map.items() if (now - a.seen).total_seconds() > _PRUNE_AGE_S]
            for s in dead:
                del src_map[s]
            if not src_map:
                prune_addrs.append(addr)
        for addr in prune_addrs:
            del self._seen[addr]

        # Build radios list
        radios: List[Dict[str, Any]] = []
        for room, sc in self._scanners.items():
            age_s = round((now - sc.last_seen).total_seconds(), 1)
            radios.append({
                "source": sc.source,
                "name": f"{room} (ESPresense)",
                "connectable": False,
                "scanning": sc.online,
                "adapter": "mqtt",
                "last_heard_s": age_s,
                "espresense": True,
                "espresense_room": room,
                "ip": sc.ip,
                "firmware": sc.firmware,
            })

        # Build advertisements list
        ads: List[Dict[str, Any]] = []
        for addr, src_map in self._seen.items():
            for source, adv in src_map.items():
                age_s = (now - adv.seen).total_seconds()
                if max_age_s and age_s > max_age_s:
                    continue
                ads.append({
                    "address": adv.address,
                    "name": adv.name,
                    "source": adv.source,
                    "rssi": adv.rssi if adv.rssi != -999 else None,
                    "tx_power": None,
                    "connectable": None,
                    "last_seen": adv.seen.isoformat(),
                    "age_s": round(age_s, 1),
                    "manufacturer_data": {},
                    "service_data": {},
                    "service_uuids": [],
                    "espresense_distance": adv.distance if adv.distance >= 0 else None,
                })

        ads.sort(key=lambda x: x.get("age_s", 1e9))

        return {
            "radios": radios,
            "advertisements": ads,
            "diag": {
                "ok": bool(self._scanners),
                "source": "espresense_mqtt",
                "scanners": len(self._scanners),
                "online": sum(1 for s in self._scanners.values() if s.online),
                "cached_devices": len(self._seen),
                "cached_readings": sum(len(v) for v in self._seen.values()),
            },
        }

    @property
    def scanner_count(self) -> int:
        return len(self._scanners)

    @property
    def online_count(self) -> int:
        return sum(1 for s in self._scanners.values() if s.online)


async def async_setup_espresense_mqtt(hass: HomeAssistant, topic_prefix: str = "espresense") -> EspresenseMqtt:
    """Create and start the ESPresense MQTT subscriber."""
    esp = EspresenseMqtt(hass)
    await esp.async_start(topic_prefix)
    hass.data.setdefault(DOMAIN, {})[DATA_ESPRESENSE_MQTT] = esp
    return esp
