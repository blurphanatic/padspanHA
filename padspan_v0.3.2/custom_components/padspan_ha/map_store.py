from __future__ import annotations

from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
from typing import Any
import shutil

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN, STORAGE_VERSION


def _default_map_record(map_id: str, name: str | None = None) -> dict[str, Any]:
    return {
        "id": map_id,
        "name": name or map_id,
        "image_url": None,
        "image_path": None,
        "width": None,
        "height": None,
        "anchors": {},
        "rooms": {},
        "calibration": {
            "scale": 1.0,
            "rotation_deg": 0.0,
            "offset_x": 0.0,
            "offset_y": 0.0,
            "ref_points": [],
            "status": "idle",
            "captured_points": [],
        },
    }


class MapStore:
    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self.store = Store(hass, STORAGE_VERSION, f"{DOMAIN}_{entry_id}.storage")
        self.data: dict[str, Any] = {
            "active_map_id": None,
            "maps": {},
        }

    async def async_load(self) -> None:
        loaded = await self.store.async_load()
        if isinstance(loaded, dict):
            self.data = loaded
        self.data.setdefault("active_map_id", None)
        self.data.setdefault("maps", {})

    async def async_save(self) -> None:
        await self.store.async_save(self.data)

    def get_map(self, map_id: str) -> dict[str, Any]:
        maps = self.data.setdefault("maps", {})
        if map_id not in maps:
            maps[map_id] = _default_map_record(map_id)
        return maps[map_id]

    async def set_active_map(self, map_id: str) -> None:
        self.get_map(map_id)
        self.data["active_map_id"] = map_id
        await self.async_save()

    def active_map(self) -> dict[str, Any] | None:
        active_id = self.data.get("active_map_id")
        if not active_id:
            return None
        return self.data.get("maps", {}).get(active_id)

    async def import_map_image(self, map_id: str, source_path: str, name: str | None = None, overwrite: bool = False) -> dict[str, Any]:
        map_rec = self.get_map(map_id)
        if name:
            map_rec["name"] = name

        full_src = Path(self.hass.config.path(source_path))
        if not full_src.exists():
            raise FileNotFoundError(f"Map source not found: {full_src}")

        target_dir = Path(self.hass.config.path("www", "padspan_ha", self.entry_id))
        target_dir.mkdir(parents=True, exist_ok=True)

        dst_name = f"{map_id}_{full_src.name}"
        full_dst = target_dir / dst_name

        if full_dst.exists() and not overwrite:
            raise FileExistsError(f"Map already exists: {full_dst}")

        await self.hass.async_add_executor_job(shutil.copy2, full_src, full_dst)

        map_rec["image_path"] = str(full_dst)
        map_rec["image_url"] = f"/local/padspan_ha/{self.entry_id}/{dst_name}"
        if not self.data.get("active_map_id"):
            self.data["active_map_id"] = map_id

        await self.async_save()
        return map_rec

    async def save_uploaded_map(self, map_id: str, filename: str, payload: bytes, name: str | None = None, overwrite: bool = True) -> dict[str, Any]:
        map_rec = self.get_map(map_id)
        if name:
            map_rec["name"] = name

        safe_name = os.path.basename(filename) or "map.png"
        target_dir = Path(self.hass.config.path("www", "padspan_ha", self.entry_id))
        target_dir.mkdir(parents=True, exist_ok=True)
        dst_name = f"{map_id}_{safe_name}"
        full_dst = target_dir / dst_name

        if full_dst.exists() and not overwrite:
            raise FileExistsError(f"Map already exists: {full_dst}")

        def _write() -> None:
            with open(full_dst, "wb") as f:
                f.write(payload)

        await self.hass.async_add_executor_job(_write)

        map_rec["image_path"] = str(full_dst)
        map_rec["image_url"] = f"/local/padspan_ha/{self.entry_id}/{dst_name}"
        if not self.data.get("active_map_id"):
            self.data["active_map_id"] = map_id

        await self.async_save()
        return map_rec

    async def set_anchor(
        self,
        map_id: str,
        source_id: str,
        x: float,
        y: float,
        z: float = 0.0,
        weight: float = 1.0,
        label: str | None = None,
    ) -> dict[str, Any]:
        map_rec = self.get_map(map_id)
        anchors = map_rec.setdefault("anchors", {})
        anchors[source_id] = {
            "source_id": source_id,
            "x": float(x),
            "y": float(y),
            "z": float(z),
            "weight": float(weight),
            "label": label or source_id,
        }
        await self.async_save()
        return anchors[source_id]

    async def delete_anchor(self, map_id: str, source_id: str) -> None:
        map_rec = self.get_map(map_id)
        map_rec.setdefault("anchors", {}).pop(source_id, None)
        await self.async_save()

    async def set_room_polygon(self, map_id: str, room_id: str, name: str, points: list[dict[str, float]]) -> dict[str, Any]:
        map_rec = self.get_map(map_id)
        rooms = map_rec.setdefault("rooms", {})
        rooms[room_id] = {
            "id": room_id,
            "name": name,
            "points": [{"x": float(p["x"]), "y": float(p["y"])} for p in points],
        }
        await self.async_save()
        return rooms[room_id]

    async def delete_room(self, map_id: str, room_id: str) -> None:
        map_rec = self.get_map(map_id)
        map_rec.setdefault("rooms", {}).pop(room_id, None)
        await self.async_save()

    async def start_calibration(self, map_id: str) -> dict[str, Any]:
        map_rec = self.get_map(map_id)
        calib = map_rec.setdefault("calibration", {})
        calib.setdefault("ref_points", [])
        calib["status"] = "capturing"
        calib["captured_points"] = []
        await self.async_save()
        return calib

    async def capture_calibration_point(
        self,
        map_id: str,
        image_x: float,
        image_y: float,
        real_x: float,
        real_y: float,
    ) -> dict[str, Any]:
        map_rec = self.get_map(map_id)
        calib = map_rec.setdefault("calibration", {})
        cap = calib.setdefault("captured_points", [])
        point = {
            "image_x": float(image_x),
            "image_y": float(image_y),
            "real_x": float(real_x),
            "real_y": float(real_y),
        }
        cap.append(point)
        await self.async_save()
        return point

    async def finish_calibration(self, map_id: str) -> dict[str, Any]:
        map_rec = self.get_map(map_id)
        calib = map_rec.setdefault("calibration", {})
        points = calib.get("captured_points", [])

        if len(points) < 2:
            raise ValueError("Need at least two reference points to solve calibration.")

        p1, p2 = points[0], points[1]

        ivx = p2["image_x"] - p1["image_x"]
        ivy = p2["image_y"] - p1["image_y"]
        rvx = p2["real_x"] - p1["real_x"]
        rvy = p2["real_y"] - p1["real_y"]

        i_len = math.hypot(ivx, ivy)
        r_len = math.hypot(rvx, rvy)
        if i_len < 1e-6:
            raise ValueError("Invalid image reference points.")

        scale = r_len / i_len
        angle_img = math.atan2(ivy, ivx)
        angle_real = math.atan2(rvy, rvx)
        theta = angle_real - angle_img

        cos_t = math.cos(theta)
        sin_t = math.sin(theta)

        # t = real1 - sR*img1
        tx = p1["real_x"] - scale * (cos_t * p1["image_x"] - sin_t * p1["image_y"])
        ty = p1["real_y"] - scale * (sin_t * p1["image_x"] + cos_t * p1["image_y"])

        calib["scale"] = float(scale)
        calib["rotation_deg"] = float(math.degrees(theta))
        calib["offset_x"] = float(tx)
        calib["offset_y"] = float(ty)
        calib["ref_points"] = points
        calib["status"] = "solved"
        await self.async_save()
        return calib

    def apply_calibration(self, map_id: str, x: float, y: float) -> tuple[float, float]:
        map_rec = self.get_map(map_id)
        calib = map_rec.get("calibration", {})
        scale = float(calib.get("scale", 1.0))
        theta = math.radians(float(calib.get("rotation_deg", 0.0)))
        tx = float(calib.get("offset_x", 0.0))
        ty = float(calib.get("offset_y", 0.0))

        cos_t = math.cos(theta)
        sin_t = math.sin(theta)
        rx = scale * (cos_t * x - sin_t * y) + tx
        ry = scale * (sin_t * x + cos_t * y) + ty
        return rx, ry
