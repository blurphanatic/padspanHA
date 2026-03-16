# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""
PadSpan HA — Private BLE Device Resolver
==========================================
Resolves Bluetooth Resolvable Private Addresses (RPAs) to canonical device
identities using IRKs registered in HA's built-in 'private_ble_device' component.

HOW IT WORKS
------------
Modern phones (iPhone, Android) rotate their Bluetooth MAC address every 10–15
minutes to prevent tracking.  They use a resolvable private address (RPA) scheme
from the BLE spec:

    hash  = AES-128-ECB(IRK, 0x000000000000000000000000 || prand)[0:3]
    address = prand[2] || prand[1] || prand[0] || hash[2] || hash[1] || hash[0]
              (where prand is 3 random bytes with bits 47-46 = "01")

Given the IRK (Identity Resolving Key), you can check any random MAC to see if
it was generated from that IRK — this is how HA's private_ble_device component
works, and how PadSpan finds rotating-MAC phones in the advertisement stream.

IBEACON SUPPORT
---------------
The HA Companion App iBeacon transmitter embeds a stable 16-byte UUID in Apple
manufacturer data (company ID 0x004C, sub-type 0x02).  This is parsed here as an
additional stable identifier independent of the MAC address.

USAGE
-----
    resolver = PrivateBLEResolver(hass)
    await resolver.async_load()                    # load IRKs from HA config entries

    result = resolver.resolve_address("AA:BB:CC:DD:EE:FF")
    # → {"canonical_id": "irk:...", "name": "Alice's Phone", "kind": "private_ble"}
    # → None if address doesn't match any registered IRK

    ibeacon = resolver.parse_ibeacon(manufacturer_data_dict)
    # → {"uuid": "...", "major": 1, "minor": 2}  or None
"""
from __future__ import annotations

import base64
import logging
import time
from typing import Any

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

# Resolvable Private Address: top byte bits 7-6 == 01 (0x40 mask)
_RPA_MASK = 0xC0
_RPA_VALUE = 0x40

# Cache resolved (address → canonical_id) mappings.
# RPAs change every ~15 minutes; cache for 20 minutes to avoid redundant AES checks.
_CACHE_TTL_S = 1200


class PrivateBLEResolver:
    """Loads IRKs from HA Private BLE Device config entries and resolves RPAs."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        # [{canonical_id, name, irk_bytes}]
        self._devices: list[dict[str, Any]] = []
        # {address_upper: (canonical_id | None, expiry_ts)}
        self._cache: dict[str, tuple[str | None, float]] = {}
        self._loaded_at: float = 0.0
        self._unresolved_log_count: int = 0

    # ── public interface ──────────────────────────────────────────────────────

    async def async_load(self) -> None:
        """Read IRKs from private_ble_device + mobile_app config entries."""
        self._devices.clear()
        self._source_info: list[dict[str, Any]] = []  # for UI status
        seen_irk_hex: set[str] = set()
        try:
            # 1) private_ble_device entries (the standard HA integration)
            for entry in self._hass.config_entries.async_entries("private_ble_device"):
                irk_raw = (entry.data or {}).get("irk")
                if not irk_raw:
                    continue
                irk_bytes = _parse_irk(irk_raw)
                if irk_bytes and irk_bytes.hex() not in seen_irk_hex:
                    seen_irk_hex.add(irk_bytes.hex())
                    canonical_id = f"irk:{irk_bytes.hex()}"
                    name = entry.title or entry.entry_id
                    self._devices.append({
                        "canonical_id": canonical_id,
                        "name": name,
                        "irk_bytes": irk_bytes,
                    })
                    self._source_info.append({
                        "name": name, "source": "private_ble_device",
                        "entry_id": entry.entry_id,
                    })

            # 2) mobile_app entries — some companion apps expose IRK
            for entry in self._hass.config_entries.async_entries("mobile_app"):
                data = entry.data or {}
                # Check common IRK key names the companion app might use
                irk_raw = data.get("ble_irk") or data.get("irk")
                if not irk_raw:
                    continue
                irk_bytes = _parse_irk(irk_raw)
                if irk_bytes and irk_bytes.hex() not in seen_irk_hex:
                    seen_irk_hex.add(irk_bytes.hex())
                    canonical_id = f"irk:{irk_bytes.hex()}"
                    name = entry.title or entry.entry_id
                    self._devices.append({
                        "canonical_id": canonical_id,
                        "name": name,
                        "irk_bytes": irk_bytes,
                    })
                    self._source_info.append({
                        "name": name, "source": "mobile_app",
                        "entry_id": entry.entry_id,
                    })

            # 3) PadSpan settings — IRKs added directly via PadSpan UI
            try:
                from .const import DOMAIN
                _settings = self._hass.data.get(DOMAIN, {}).get("settings")
                if _settings:
                    for irk_entry in (_settings.data.get("irk_devices") or []):
                        irk_raw = irk_entry.get("irk_hex") or ""
                        irk_name = irk_entry.get("name") or "PadSpan Device"
                        if not irk_raw:
                            continue
                        irk_bytes = _parse_irk(irk_raw)
                        if irk_bytes and irk_bytes.hex() not in seen_irk_hex:
                            seen_irk_hex.add(irk_bytes.hex())
                            canonical_id = f"irk:{irk_bytes.hex()}"
                            self._devices.append({
                                "canonical_id": canonical_id,
                                "name": irk_name,
                                "irk_bytes": irk_bytes,
                            })
                            self._source_info.append({
                                "name": irk_name, "source": "padspan",
                                "entry_id": "",
                            })
            except Exception as _ps_err:
                _LOGGER.debug("PadSpan IRK load: %s", _ps_err)

            if self._devices:
                _LOGGER.info(
                    "PrivateBLEResolver loaded %d private device(s): %s",
                    len(self._devices),
                    ", ".join(d["name"] for d in self._devices),
                )
            else:
                _LOGGER.debug("PrivateBLEResolver: no private BLE devices found")
        except Exception as err:
            _LOGGER.warning("PrivateBLEResolver load failed: %s", err)
        self._loaded_at = time.monotonic()

    def resolve_address(self, address: str) -> dict[str, Any] | None:
        """
        Return {canonical_id, name} if the address resolves to a known private device.
        Returns None if unresolved or if address is not an RPA.

        Results are cached for _CACHE_TTL_S to avoid redundant AES ops on the same
        rotating address (an RPA stays valid for ~15 minutes).
        """
        if not self._devices:
            return None

        addr_upper = address.upper()
        now = time.monotonic()

        # Check cache
        cached = self._cache.get(addr_upper)
        if cached and now < cached[1]:
            cid = cached[0]
            if cid:
                dev = next((d for d in self._devices if d["canonical_id"] == cid), None)
                if dev:
                    return {"canonical_id": cid, "name": dev["name"], "kind": "private_ble"}
            return None

        # Check if it's even an RPA before running crypto
        if not _is_rpa(addr_upper):
            self._cache[addr_upper] = (None, now + _CACHE_TTL_S)
            return None

        # Try each registered IRK
        for dev in self._devices:
            try:
                if _address_matches_irk(addr_upper, dev["irk_bytes"]):
                    _LOGGER.debug(
                        "Resolved RPA %s → %s (%s)",
                        addr_upper, dev["canonical_id"], dev["name"],
                    )
                    self._cache[addr_upper] = (dev["canonical_id"], now + _CACHE_TTL_S)
                    return {"canonical_id": dev["canonical_id"], "name": dev["name"], "kind": "private_ble"}
            except Exception as err:
                _LOGGER.warning("IRK match error for %s: %s", addr_upper, err)

        # Log first few unresolved RPAs for debugging (helps diagnose IRK byte-order issues)
        _unresolved = getattr(self, "_unresolved_log_count", 0)
        if _unresolved < 5:
            self._unresolved_log_count = _unresolved + 1
            _LOGGER.info(
                "Unresolved RPA %s (checked %d IRK(s)). If your phone is nearby, "
                "the IRK byte order may be wrong or the IRK value is incorrect.",
                addr_upper, len(self._devices),
            )

        self._cache[addr_upper] = (None, now + _CACHE_TTL_S)
        return None

    def has_devices(self) -> bool:
        return bool(self._devices)

    @property
    def device_count(self) -> int:
        return len(self._devices)

    def count_rpas(self, addresses: list[str] | set[str]) -> int:
        """Count how many addresses in the list are Resolvable Private Addresses."""
        return sum(1 for a in addresses if _is_rpa(a.upper()))

    def get_status(self) -> dict[str, Any]:
        """Return status info for the UI."""
        has_integration = False
        try:
            entries = list(self._hass.config_entries.async_entries("private_ble_device"))
            has_integration = len(entries) > 0
        except Exception:
            pass

        mobile_apps: list[str] = []
        try:
            for entry in self._hass.config_entries.async_entries("mobile_app"):
                mobile_apps.append(entry.title or entry.entry_id)
        except Exception:
            pass

        # Merge source_info into device entries for unified UI display
        _si = {s["name"]: s for s in getattr(self, "_source_info", [])}
        devs = []
        for d in self._devices:
            si = _si.get(d["name"], {})
            devs.append({
                "name": d["name"],
                "canonical_id": d["canonical_id"],
                "source": si.get("source", ""),
                "entry_id": si.get("entry_id", ""),
            })
        return {
            "irk_count": len(self._devices),
            "devices": devs,
            "source_info": getattr(self, "_source_info", []),
            "has_private_ble_integration": has_integration,
            "mobile_apps": mobile_apps,
        }

    # ── iBeacon ───────────────────────────────────────────────────────────────

    @staticmethod
    def parse_ibeacon(manufacturer_data: dict[str, Any]) -> dict[str, Any] | None:
        """
        Parse Apple iBeacon from manufacturer_data dict.

        The HA Companion App iBeacon transmitter uses:
            manufacturer_data = {76: <bytes>}   (Apple company ID = 0x004C = 76)
        The bytes payload: [0x02, 0x15, <16-byte UUID>, <2-byte major>, <2-byte minor>, <1-byte TX power>]
        """
        try:
            # Apple company ID is 76 (0x004C) — may be stored as int key or string
            payload: bytes | None = None
            for k in (76, "76", "0x004c", "0x004C"):
                raw = manufacturer_data.get(k)
                if raw is not None:
                    if isinstance(raw, (bytes, bytearray)):
                        payload = bytes(raw)
                    elif isinstance(raw, str):
                        # HA stores manufacturer_data as hex string "0x4A 0x17 ..."
                        payload = bytes(int(x, 16) for x in raw.split())
                    break

            if not payload or len(payload) < 23:
                return None
            if payload[0] != 0x02 or payload[1] != 0x15:
                return None

            uuid_bytes = payload[2:18]
            major = int.from_bytes(payload[18:20], "big")
            minor = int.from_bytes(payload[20:22], "big")

            # Format UUID as standard 8-4-4-4-12
            h = uuid_bytes.hex()
            uuid = f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"

            # TX Power byte (index 22) — factory-calibrated RSSI at 1 m, signed int8.
            # ESPresense uses this to automatically set ref_power per iBeacon.
            raw_tx = payload[22]
            tx_power = raw_tx if raw_tx < 128 else raw_tx - 256  # convert to signed

            return {"uuid": uuid, "major": major, "minor": minor, "tx_power": tx_power}
        except Exception:
            return None


# ── module-level singleton per hass instance ──────────────────────────────────
# Keyed by hass object id to support test harnesses with multiple hass instances.
_resolvers: dict[int, PrivateBLEResolver] = {}


async def get_resolver(hass: HomeAssistant) -> PrivateBLEResolver:
    """Return (and lazily refresh) the cached resolver for this hass instance."""
    hass_id = id(hass)
    resolver = _resolvers.get(hass_id)
    if resolver is None:
        resolver = PrivateBLEResolver(hass)
        _resolvers[hass_id] = resolver

    # Reload IRK list every 5 minutes (catches newly-added Private BLE Devices)
    if time.monotonic() - resolver._loaded_at > 300:
        await resolver.async_load()

    return resolver


# ── crypto helpers ────────────────────────────────────────────────────────────

def _is_rpa(address: str) -> bool:
    """Return True if address is a BLE Resolvable Private Address."""
    try:
        msb = int(address.split(":")[0], 16)
        return (msb & _RPA_MASK) == _RPA_VALUE
    except Exception:
        return False


def _address_matches_irk(address: str, irk: bytes) -> bool:
    """
    Check if a BLE RPA was generated from the given IRK.

    Algorithm (BLE Core Spec Vol 3, Part H, §2.2.2 — ``ah`` function):
        rpa        = unhexlify(address)       — 6 bytes, MSB-first
        prand      = rpa[0:3]                 — upper 24 bits (bits 47-46 = "01")
        hash_value = rpa[3:6]                 — lower 24 bits
        plaintext  = b'\\x00'*13 + prand      — zero-padded to 128 bits
        ct         = AES-128-ECB(irk, plaintext)
        match      = (ct[13:16] == hash_value)  — least-significant 24 bits of ct

    Tries BOTH the given byte order and the reversed byte order to handle
    LE/BE ambiguity — iOS/Android provide LE IRKs, but storage format varies.
    """
    try:
        import binascii  # noqa: PLC0415
        from cryptography.hazmat.primitives.ciphers import (  # noqa: PLC0415
            Cipher, algorithms, modes,
        )
        from cryptography.hazmat.backends import default_backend  # noqa: PLC0415

        rpa = binascii.unhexlify(address.replace(":", "").replace("-", ""))
        prand = rpa[:3]
        hash_value = rpa[3:]
        plaintext = b"\x00" * 13 + prand

        # Try IRK as-is first
        cipher = Cipher(algorithms.AES(irk), modes.ECB(), backend=default_backend())
        enc = cipher.encryptor()
        ct = enc.update(plaintext) + enc.finalize()
        if ct[13:] == hash_value:
            return True

        # Try reversed byte order (handles LE vs BE ambiguity)
        irk_rev = bytes(reversed(irk))
        if irk_rev != irk:
            cipher2 = Cipher(algorithms.AES(irk_rev), modes.ECB(), backend=default_backend())
            enc2 = cipher2.encryptor()
            ct2 = enc2.update(plaintext) + enc2.finalize()
            if ct2[13:] == hash_value:
                return True

        return False
    except Exception:
        return False


def _parse_irk(raw: Any) -> bytes | None:
    """Parse IRK from whatever format HA stored it (bytes, hex string, base64 string, irk:-prefixed base64)."""
    try:
        if isinstance(raw, (bytes, bytearray)):
            b = bytes(raw)
            if len(b) == 16:
                return b
        if isinstance(raw, str):
            s = raw.strip()
            # Strip "irk:" prefix (HA's private_ble_device stores IRKs this way)
            if s.lower().startswith("irk:"):
                s = s[4:]
            # Try hex (32 hex chars)
            if len(s) == 32:
                try:
                    b = bytes.fromhex(s)
                    if len(b) == 16:
                        return b
                except ValueError:
                    pass
            # Try hex with spaces or colons
            try:
                clean = s.replace(":", "").replace(" ", "")
                if len(clean) == 32:
                    b = bytes.fromhex(clean)
                    if len(b) == 16:
                        return b
            except ValueError:
                pass
            # Try base64 — Apple/Android IRKs are little-endian; reverse to
            # big-endian for AES (matches HA's private_ble_device coordinator).
            try:
                b = base64.b64decode(s)
                if len(b) == 16:
                    return bytes(reversed(b))
            except Exception:
                pass
    except Exception:
        pass
    return None
