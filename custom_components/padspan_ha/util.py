# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Small helpers shared across the integration."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def ha_devices(dev_reg: Any) -> list[Any]:
    """Every device (DeviceEntry) in Home Assistant's device registry.

    The one place PadSpan reads `dev_reg.devices`, because its shape depends
    on the HA version. In HA 2026.7 and earlier it is a device_id ->
    DeviceEntry mapping, and iterating it yields ids. In HA 2026.9 it is a
    view whose iteration yields the entries, and every mapping use
    (`.values()`, `.get()`, `[id]`, `id in`) logs a deprecation warning and
    stops working in 2027.9.
    `.values()` on the first and iteration on the second give the same list.
    Look a device up by id in a dict built from this list, not with
    `dev_reg.async_get()`: from 2026.9 that also resolves child and composite
    devices, which `devices.get()` never did.
    """
    devices = dev_reg.devices
    if isinstance(devices, Mapping):
        return list(devices.values())
    return list(devices)


_NO_ENTRY_ID = object()


def device_config_entry_ids(device: Any) -> set[str]:
    """The config entry ids a DeviceEntry belongs to.

    The one place PadSpan asks a device which config entries it belongs to,
    because the answer moved. In HA 2026.10 a device belongs to exactly one
    config entry, `device.config_entry_id`, and `device.config_entries` is a
    deprecated shim: every read of it walks the call stack and every loaded
    module to name the caller, which cost about 30% of HA's CPU on a 611-device
    install, where the live snapshot read it for every device three times a
    minute. In HA 2026.9 and earlier there is no `config_entry_id`, and
    `config_entries` is the real set.

    A restored composite device (what `async_get` synthesizes for a
    pre-migration composite id) still spans several entries; its
    `config_entries` is the union and does not report, so it is read as is.
    """
    if getattr(device, "is_composite_device", False):
        return set(device.config_entries or ())
    entry_id = getattr(device, "config_entry_id", _NO_ENTRY_ID)
    if entry_id is _NO_ENTRY_ID:
        return set(getattr(device, "config_entries", ()) or ())
    return {entry_id} if entry_id else set()
