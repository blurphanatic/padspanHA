"""Persistent storage and file operations for map assets and anchors."""
from __future__ import annotations

from copy import deepcopy
import logging
from pathlib import Path
import shutil
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
STORAGE_KEY_PREFIX = f"{DOMAIN}_maps"


class MapStore:
    """Store and manage map images + BLE anchor coordinates."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self._store = Store[dict[str, Any]](hass, STORAGE_VERSION, f"{STORAGE_KEY_PREFIX}_{entry_id}")
        self.data: dict[str, Any] = {"maps": {}}

    async def async_load(self) -> None:
        """Load persisted data."""
        loaded = await self._store.async_load()
        if isinstance(loaded, dict):
            self.data = loaded
        else:
            self.data = {"maps": {}}

    async def async_save(self) -> None:
        """Persist current data."""
        await self._store.async_save(self.data)

    def as_dict(self) -> dict[str, Any]:
        """Return deep-copied state."""
        return deepcopy(self.data)

    async def async_import_image(self, map_id: str, source_path: str, overwrite: bool = False) -> dict[str, Any]:
        """Copy source image from /config into /config/www/padspan_ha/<entry_id>/."""
        if not map_id:
            raise HomeAssistantError("map_id is required")
        if not source_path:
            raise HomeAssistantError("source_path is required")

        src = Path(source_path)
        if not src.is_absolute():
            src = Path(self.hass.config.path(source_path))

        config_root = Path(self.hass.config.config_dir).resolve()
        try:
            src_resolved = src.resolve(strict=True)
        except FileNotFoundError as err:
            raise HomeAssistantError(f"source_path not found: {source_path}") from err

        if config_root not in src_resolved.parents and src_resolved != config_root:
            raise HomeAssistantError("source_path must be inside /config")

        if src_resolved.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp", ".svg"}:
            raise HomeAssistantError("source_path must be an image file (.png/.jpg/.jpeg/.webp/.svg)")

        dest_dir = Path(self.hass.config.path("www", DOMAIN, self.entry_id))
        dest_dir.mkdir(parents=True, exist_ok=True)

        filename = f"{map_id}{src_resolved.suffix.lower()}"
        dest = dest_dir / filename

        if dest.exists() and not overwrite:
            raise HomeAssistantError(
                f"Destination exists: {dest}. Set overwrite: true to replace it."
            )

        shutil.copy2(src_resolved, dest)
        local_url = f"/local/{DOMAIN}/{self.entry_id}/{filename}"

        map_obj = self.data.setdefault("maps", {}).setdefault(map_id, {})
        map_obj["image_file"] = str(dest)
        map_obj["image_local_url"] = local_url
        map_obj.setdefault("anchors", {})

        await self.async_save()

        _LOGGER.debug("Imported map image %s -> %s", src_resolved, dest)
        return deepcopy(map_obj)

    async def async_set_anchor(
        self,
        map_id: str,
        anchor_id: str,
        x: float,
        y: float,
        z: float = 0.0,
        weight: float = 1.0,
    ) -> dict[str, Any]:
        """Set or update a map anchor."""
        if not map_id:
            raise HomeAssistantError("map_id is required")
        if not anchor_id:
            raise HomeAssistantError("anchor_id is required")

        map_obj = self.data.setdefault("maps", {}).setdefault(map_id, {})
        map_obj.setdefault("anchors", {})
        map_obj["anchors"][anchor_id] = {
            "x": float(x),
            "y": float(y),
            "z": float(z),
            "weight": float(weight),
        }

        await self.async_save()
        return deepcopy(map_obj["anchors"][anchor_id])
