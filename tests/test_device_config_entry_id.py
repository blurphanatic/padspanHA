# PadSpan HA - BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A device's config entry, read without HA 2026.10's deprecation report.

HA 2026.10 gives a device exactly one config entry, `DeviceEntry.config_entry_id`,
and turns `DeviceEntry.config_entries` into a compatibility shim
(helpers/device_registry.py, `_report_deprecated_config_entries_property`,
"breaks in 2027.10"). Every read of the shim walks the call stack and every
loaded module to name the caller. The live snapshot read it for every device
on every build: on a 611-device install, three builds a minute, that was about
30% of Home Assistant's CPU (profiled 15 Oct 2026, `frame.get_integration_frame`
under `DeviceEntry.config_entries`).

`util.device_config_entry_ids` is the one read that is right on both shapes,
so it is the only place allowed to touch a device's `config_entries`.
"""

from __future__ import annotations

import ast
from pathlib import Path
from types import SimpleNamespace

from custom_components.padspan_ha import snapshot_builder as SB
from custom_components.padspan_ha.const import DOMAIN
from custom_components.padspan_ha.util import device_config_entry_ids

_ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"


class _Dev2026_10:
    """HA 2026.10's DeviceEntry: one config entry; the old set reports and serves."""

    is_composite_device = False

    def __init__(self, id: str, config_entry_id: str | None, reads: list[str]) -> None:
        self.id = id
        self.config_entry_id = config_entry_id
        self.name = f"radio {id}"
        self.name_by_user = None
        self.model = "ESP32"
        self.manufacturer = "Espressif"
        self.sw_version = "1"
        self.area_id = None
        self.identifiers: set = set()
        self.connections: set = set()
        self._reads = reads

    @property
    def config_entries(self) -> set[str]:
        self._reads.append(self.id)
        return {self.config_entry_id}


class _Dev2026_9:
    """HA 2026.9 and earlier: no config_entry_id; config_entries is the real set."""

    def __init__(self, config_entries: set[str]) -> None:
        self.config_entries = config_entries


def test_the_2026_10_device_is_read_without_the_shim() -> None:
    reads: list[str] = []
    assert device_config_entry_ids(_Dev2026_10("d1", "e1", reads)) == {"e1"}
    assert reads == [], f"deprecated DeviceEntry.config_entries read: {reads}"


def test_a_device_with_no_entry_belongs_to_none() -> None:
    reads: list[str] = []
    assert device_config_entry_ids(_Dev2026_10("d1", None, reads)) == set()
    assert reads == []


def test_the_2026_9_device_keeps_all_its_entries() -> None:
    assert device_config_entry_ids(_Dev2026_9({"e1", "e2"})) == {"e1", "e2"}


def test_a_restored_composite_device_keeps_the_union() -> None:
    """async_get synthesizes these for a pre-migration id; their set does not report."""
    dev = SimpleNamespace(is_composite_device=True, config_entry_id="e1",
                          config_entries={"e1", "e2"})
    assert device_config_entry_ids(dev) == {"e1", "e2"}


async def test_the_live_snapshot_finds_bermuda_receivers_without_the_shim(monkeypatch) -> None:
    """The hot path, end to end: every device, every build."""
    reads: list[str] = []
    devs = [_Dev2026_10("rx1", "bermuda_entry", reads),
            _Dev2026_10("other", "esphome_entry", reads),
            _Dev2026_10("orphan", None, reads)]
    bermuda = SimpleNamespace(domain="bermuda", entry_id="bermuda_entry")
    esphome = SimpleNamespace(domain="esphome", entry_id="esphome_entry")
    hass = SimpleNamespace(
        data={DOMAIN: {}},
        states=SimpleNamespace(async_all=lambda *a: [], get=lambda e: None),
        config_entries=SimpleNamespace(async_entries=lambda *a: [bermuda, esphome],
                                       async_get_entry=lambda e: None),
    )
    monkeypatch.setattr(SB, "get_bluetooth_live", lambda _h: None)
    monkeypatch.setattr(SB.device_registry, "async_get",
                        lambda _h: SimpleNamespace(devices=devs), raising=False)

    snap = await SB._build_live_snapshot(hass)

    assert [r["id"] for r in snap["receivers"]] == ["rx1"]
    assert reads == [], f"deprecated DeviceEntry.config_entries read on the snapshot path: {reads}"


def test_a_device_config_entries_is_read_in_one_place() -> None:
    """No `x.config_entries` outside util.py unless x is hass.

    `hass.config_entries` (and `self.hass` / `self._hass`) is HA's
    ConfigEntries manager and is fine; any other `.config_entries`, or a
    `getattr(x, "config_entries", ...)`, is a device read and goes through
    util.device_config_entry_ids.
    """
    def _is_hass(node: ast.expr) -> bool:
        if isinstance(node, ast.Name):
            return node.id == "hass"
        return isinstance(node, ast.Attribute) and node.attr in {"hass", "_hass"}

    found = []
    for path in sorted(_ROOT.rglob("*.py")):
        if path.name == "util.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if (isinstance(node, ast.Attribute) and node.attr == "config_entries"
                    and not _is_hass(node.value)):
                found.append(f"{path.name}:{node.lineno}")
            elif (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                    and node.func.id in {"getattr", "hasattr"}
                    and any(isinstance(a, ast.Constant) and a.value == "config_entries"
                            for a in node.args)):
                found.append(f"{path.name}:{node.lineno}")
    assert not found, (
        "read a device's config entries through util.device_config_entry_ids: "
        "`DeviceEntry.config_entries` is a deprecated shim in HA 2026.10 that "
        f"walks the stack on every read: {found}"
    )
