"""Unit tests for custom_components.padspan_ha.maps_store."""

from __future__ import annotations

import base64
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.maps_store import (
    MAX_MAP_BYTES,
    MapsStore,
    _sha256,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_store(tmp_path: Path) -> MapsStore:
    """Create a MapsStore with a mock hass backed by *tmp_path*."""
    hass = MagicMock()
    hass.config.path = lambda *parts: str(tmp_path.joinpath(*parts))

    store = MapsStore.__new__(MapsStore)
    store.hass = hass
    store.store = AsyncMock()
    store.store.async_load = AsyncMock(return_value=None)
    store.store.async_save = AsyncMock()
    store.maps_dir = tmp_path / "www" / "padspan_ha" / "maps"
    store.maps_dir.mkdir(parents=True, exist_ok=True)
    store.data = {"maps": []}
    return store


def _small_png_b64() -> str:
    """Return a small, valid-ish PNG payload encoded as base64."""
    # 1x1 transparent PNG (67 bytes)
    raw = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
        b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    return base64.b64encode(raw).decode()


# ---------------------------------------------------------------------------
# Tests: file size limit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_add_map_rejects_oversized_base64(tmp_path: Path) -> None:
    """Base64 string longer than the b64 equivalent of MAX_MAP_BYTES is rejected."""
    store = _make_store(tmp_path)
    # Create a base64 string that exceeds the limit check
    oversized_b64 = "A" * ((MAX_MAP_BYTES * 4) // 3 + 5 + 100)
    with pytest.raises(ValueError, match="exceeds"):
        await store.async_add_map(
            name="big",
            filename="big.png",
            mime="image/png",
            width=100,
            height=100,
            png_base64=oversized_b64,
        )


@pytest.mark.asyncio
async def test_add_map_rejects_oversized_decoded(tmp_path: Path) -> None:
    """Decoded bytes larger than MAX_MAP_BYTES are rejected even if b64 was short enough."""
    store = _make_store(tmp_path)
    # Build raw bytes that are exactly 1 byte over the limit
    raw = b"\x00" * (MAX_MAP_BYTES + 1)
    b64 = base64.b64encode(raw).decode()
    with pytest.raises(ValueError, match="exceeds"):
        await store.async_add_map(
            name="big",
            filename="big.png",
            mime="image/png",
            width=100,
            height=100,
            png_base64=b64,
        )


# ---------------------------------------------------------------------------
# Tests: path traversal protection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_map_rejects_path_traversal(tmp_path: Path) -> None:
    """A map whose filename contains '..' must not escape maps_dir."""
    store = _make_store(tmp_path)
    # Manually insert a map entry with a malicious filename
    bad_map = {
        "id": "evil",
        "image": {"filename": "../../etc/passwd"},
        "receivers": [],
        "calibration": {},
        "notes": "",
        "floor_id": "main",
        "room_bounds": {},
        "stack": {},
    }
    store.data["maps"].append(bad_map)

    # The delete method should silently skip the file (resolve check fails)
    await store.async_delete_map("evil")
    # Map entry should still be removed from the data list
    assert store.get_map("evil") is None


@pytest.mark.asyncio
async def test_replace_image_rejects_path_traversal(tmp_path: Path) -> None:
    """async_replace_image rejects filenames that resolve outside maps_dir."""
    store = _make_store(tmp_path)
    bad_map = {
        "id": "evil2",
        "image": {"filename": "../../../tmp/attack.png"},
        "receivers": [],
        "calibration": {},
        "notes": "",
        "floor_id": "main",
        "room_bounds": {},
        "stack": {},
    }
    store.data["maps"].append(bad_map)

    with pytest.raises(ValueError, match="Invalid filename"):
        await store.async_replace_image(
            map_id="evil2",
            png_base64=_small_png_b64(),
            width=1,
            height=1,
        )


# ---------------------------------------------------------------------------
# Tests: add / get / delete lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_add_get_delete_lifecycle(tmp_path: Path) -> None:
    """Add a map, retrieve it by id, delete it, confirm gone."""
    store = _make_store(tmp_path)
    b64 = _small_png_b64()

    info = await store.async_add_map(
        name="Living Room",
        filename="living.png",
        mime="image/png",
        width=800,
        height=600,
        png_base64=b64,
    )

    map_id = info["id"]
    assert isinstance(map_id, str) and len(map_id) == 16  # os.urandom(8).hex()

    # get_map returns the same info
    fetched = store.get_map(map_id)
    assert fetched is not None
    assert fetched["name"] == "Living Room"
    assert fetched["image"]["width"] == 800
    assert fetched["image"]["height"] == 600

    # list_maps includes it
    assert len(store.list_maps()) == 1

    # Delete
    await store.async_delete_map(map_id)
    assert store.get_map(map_id) is None
    assert len(store.list_maps()) == 0


@pytest.mark.asyncio
async def test_get_nonexistent_map_returns_none(tmp_path: Path) -> None:
    """get_map for a missing ID returns None."""
    store = _make_store(tmp_path)
    assert store.get_map("does_not_exist") is None


@pytest.mark.asyncio
async def test_delete_nonexistent_map_is_noop(tmp_path: Path) -> None:
    """Deleting a map ID that doesn't exist should not raise."""
    store = _make_store(tmp_path)
    await store.async_delete_map("nope")  # should not raise


# ---------------------------------------------------------------------------
# Tests: name truncation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_name_truncated_to_120_chars(tmp_path: Path) -> None:
    """Map name is truncated to 120 characters."""
    store = _make_store(tmp_path)
    long_name = "X" * 300
    info = await store.async_add_map(
        name=long_name,
        filename="f.png",
        mime="image/png",
        width=1,
        height=1,
        png_base64=_small_png_b64(),
    )
    assert len(info["name"]) == 120


@pytest.mark.asyncio
async def test_empty_name_becomes_untitled(tmp_path: Path) -> None:
    """An empty name defaults to 'Untitled Map'."""
    store = _make_store(tmp_path)
    info = await store.async_add_map(
        name="",
        filename="f.png",
        mime="image/png",
        width=1,
        height=1,
        png_base64=_small_png_b64(),
    )
    assert info["name"] == "Untitled Map"


@pytest.mark.asyncio
async def test_original_filename_truncated_to_180(tmp_path: Path) -> None:
    """Original filename is truncated to 180 characters."""
    store = _make_store(tmp_path)
    info = await store.async_add_map(
        name="ok",
        filename="A" * 500 + ".png",
        mime="image/png",
        width=1,
        height=1,
        png_base64=_small_png_b64(),
    )
    assert len(info["image"]["original_filename"]) == 180


# ---------------------------------------------------------------------------
# Tests: _sha256 helper
# ---------------------------------------------------------------------------


def test_sha256_helper() -> None:
    """_sha256 returns the correct hex digest for known input."""
    import hashlib

    data = b"padspan"
    expected = hashlib.sha256(data).hexdigest()
    assert _sha256(data) == expected
