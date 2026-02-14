from __future__ import annotations

from pathlib import Path
import json
from typing import Any

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import DOMAIN


def _resolve_ctx(hass: HomeAssistant, entry_id: str | None):
    raw = hass.data.get(DOMAIN, {})
    data = {k: v for k, v in raw.items() if not str(k).startswith("_")}
    if not data:
        raise web.HTTPNotFound(text="PadSpan HA is not configured")
    if entry_id:
        ctx = data.get(entry_id)
        if not ctx:
            raise web.HTTPNotFound(text=f"Entry not found: {entry_id}")
        return ctx
    first_key = next(iter(data))
    return data[first_key]


class PadSpanStatusView(HomeAssistantView):
    url = "/api/padspan_ha/status"
    name = "api:padspan_ha:status"
    requires_auth = True

    async def get(self, request: web.Request):
        entry_id = request.query.get("entry_id")
        ctx = _resolve_ctx(request.app["hass"], entry_id)
        coord = ctx["coordinator"]
        if coord.data is None:
            await coord.async_request_refresh()
        payload = coord.data or coord._build_snapshot()
        all_ids = [k for k in request.app["hass"].data.get(DOMAIN, {}).keys() if not str(k).startswith("_")]
        payload["all_entry_ids"] = all_ids
        return self.json(payload)


class PadSpanMapUploadView(HomeAssistantView):
    url = "/api/padspan_ha/map/upload"
    name = "api:padspan_ha:map_upload"
    requires_auth = True

    async def post(self, request: web.Request):
        hass = request.app["hass"]
        data = await request.post()

        entry_id = data.get("entry_id")
        map_id = data.get("map_id")
        map_name = data.get("name")
        overwrite = str(data.get("overwrite", "true")).lower() in ("1", "true", "yes")
        up = data.get("file")

        if not map_id:
            raise web.HTTPBadRequest(text="Missing map_id")
        if up is None:
            raise web.HTTPBadRequest(text="Missing file")

        ctx = _resolve_ctx(hass, entry_id)
        store = ctx["map_store"]

        payload = up.file.read()
        rec = await store.save_uploaded_map(
            map_id=map_id,
            filename=up.filename or f"{map_id}.png",
            payload=payload,
            name=map_name,
            overwrite=overwrite,
        )
        await ctx["coordinator"].async_request_refresh()
        return self.json({"ok": True, "map": rec})


class PadSpanCommandView(HomeAssistantView):
    url = "/api/padspan_ha/command"
    name = "api:padspan_ha:command"
    requires_auth = True

    async def post(self, request: web.Request):
        hass = request.app["hass"]
        body = await request.json()
        action = body.get("action")
        entry_id = body.get("entry_id")
        ctx = _resolve_ctx(hass, entry_id)
        store = ctx["map_store"]
        coord = ctx["coordinator"]

        try:
            if action == "set_active_map":
                await store.set_active_map(body["map_id"])

            elif action == "set_anchor":
                await store.set_anchor(
                    map_id=body["map_id"],
                    source_id=body["source_id"],
                    x=body["x"],
                    y=body["y"],
                    z=body.get("z", 0.0),
                    weight=body.get("weight", 1.0),
                    label=body.get("label"),
                )

            elif action == "delete_anchor":
                await store.delete_anchor(body["map_id"], body["source_id"])

            elif action == "set_room":
                await store.set_room_polygon(
                    map_id=body["map_id"],
                    room_id=body["room_id"],
                    name=body["name"],
                    points=body["points"],
                )

            elif action == "delete_room":
                await store.delete_room(body["map_id"], body["room_id"])

            elif action == "start_calibration":
                await store.start_calibration(body["map_id"])

            elif action == "capture_calibration":
                await store.capture_calibration_point(
                    map_id=body["map_id"],
                    image_x=body["image_x"],
                    image_y=body["image_y"],
                    real_x=body["real_x"],
                    real_y=body["real_y"],
                )

            elif action == "finish_calibration":
                await store.finish_calibration(body["map_id"])

            elif action == "reload_ble_cache":
                await coord.async_reload_ble_cache()

            else:
                raise web.HTTPBadRequest(text=f"Unknown action: {action}")

            await coord.async_request_refresh()
            return self.json({"ok": True, "snapshot": coord.data or coord._build_snapshot()})
        except KeyError as err:
            raise web.HTTPBadRequest(text=f"Missing field: {err}") from err
        except ValueError as err:
            raise web.HTTPBadRequest(text=str(err)) from err
