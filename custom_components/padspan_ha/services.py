from __future__ import annotations

from typing import Any
import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN


def _point_schema(value):
    if not isinstance(value, dict):
        raise vol.Invalid("Point must be a dict with x/y")
    if "x" not in value or "y" not in value:
        raise vol.Invalid("Point needs x and y")
    return {"x": float(value["x"]), "y": float(value["y"])}


async def async_register_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, "import_map_image"):
        return

    async def _ctx(call: ServiceCall):
        entry_id = call.data.get("entry_id")
        raw = hass.data.get(DOMAIN, {})
        domain_data = {k: v for k, v in raw.items() if not str(k).startswith("_")}
        if entry_id:
            if entry_id not in domain_data:
                raise ValueError(f"Unknown entry_id: {entry_id}")
            return domain_data[entry_id]
        # default to first configured entry
        if not domain_data:
            raise ValueError("PadSpan HA is not configured.")
        first_key = next(iter(domain_data))
        return domain_data[first_key]

    async def import_map_image(call: ServiceCall):
        ctx = await _ctx(call)
        rec = await ctx["map_store"].import_map_image(
            map_id=call.data["map_id"],
            source_path=call.data["source_path"],
            name=call.data.get("name"),
            overwrite=call.data.get("overwrite", False),
        )
        await ctx["coordinator"].async_request_refresh()
        return rec

    async def set_active_map(call: ServiceCall):
        ctx = await _ctx(call)
        await ctx["map_store"].set_active_map(call.data["map_id"])
        await ctx["coordinator"].async_request_refresh()

    async def set_map_anchor(call: ServiceCall):
        ctx = await _ctx(call)
        await ctx["map_store"].set_anchor(
            map_id=call.data["map_id"],
            source_id=call.data["source_id"],
            x=call.data["x"],
            y=call.data["y"],
            z=call.data.get("z", 0.0),
            weight=call.data.get("weight", 1.0),
            label=call.data.get("label"),
        )
        await ctx["coordinator"].async_request_refresh()

    async def delete_map_anchor(call: ServiceCall):
        ctx = await _ctx(call)
        await ctx["map_store"].delete_anchor(call.data["map_id"], call.data["source_id"])
        await ctx["coordinator"].async_request_refresh()

    async def set_room_polygon(call: ServiceCall):
        ctx = await _ctx(call)
        await ctx["map_store"].set_room_polygon(
            map_id=call.data["map_id"],
            room_id=call.data["room_id"],
            name=call.data["name"],
            points=call.data["points"],
        )
        await ctx["coordinator"].async_request_refresh()

    async def delete_room(call: ServiceCall):
        ctx = await _ctx(call)
        await ctx["map_store"].delete_room(call.data["map_id"], call.data["room_id"])
        await ctx["coordinator"].async_request_refresh()

    async def start_calibration(call: ServiceCall):
        ctx = await _ctx(call)
        await ctx["map_store"].start_calibration(call.data["map_id"])
        await ctx["coordinator"].async_request_refresh()

    async def capture_calibration_point(call: ServiceCall):
        ctx = await _ctx(call)
        await ctx["map_store"].capture_calibration_point(
            map_id=call.data["map_id"],
            image_x=call.data["image_x"],
            image_y=call.data["image_y"],
            real_x=call.data["real_x"],
            real_y=call.data["real_y"],
        )
        await ctx["coordinator"].async_request_refresh()

    async def finish_calibration(call: ServiceCall):
        ctx = await _ctx(call)
        await ctx["map_store"].finish_calibration(call.data["map_id"])
        await ctx["coordinator"].async_request_refresh()

    async def reload_ble_cache(call: ServiceCall):
        ctx = await _ctx(call)
        await ctx["coordinator"].async_reload_ble_cache()
        await ctx["coordinator"].async_request_refresh()

    hass.services.async_register(
        DOMAIN,
        "import_map_image",
        import_map_image,
        schema=vol.Schema(
            {
                vol.Required("map_id"): cv.string,
                vol.Required("source_path"): cv.string,
                vol.Optional("name"): cv.string,
                vol.Optional("overwrite", default=False): cv.boolean,
                vol.Optional("entry_id"): cv.string,
            }
        ),
    )

    hass.services.async_register(
        DOMAIN,
        "set_active_map",
        set_active_map,
        schema=vol.Schema(
            {
                vol.Required("map_id"): cv.string,
                vol.Optional("entry_id"): cv.string,
            }
        ),
    )

    hass.services.async_register(
        DOMAIN,
        "set_map_anchor",
        set_map_anchor,
        schema=vol.Schema(
            {
                vol.Required("map_id"): cv.string,
                vol.Required("source_id"): cv.string,
                vol.Required("x"): vol.Coerce(float),
                vol.Required("y"): vol.Coerce(float),
                vol.Optional("z", default=0.0): vol.Coerce(float),
                vol.Optional("weight", default=1.0): vol.Coerce(float),
                vol.Optional("label"): cv.string,
                vol.Optional("entry_id"): cv.string,
            }
        ),
    )

    hass.services.async_register(
        DOMAIN,
        "delete_map_anchor",
        delete_map_anchor,
        schema=vol.Schema(
            {
                vol.Required("map_id"): cv.string,
                vol.Required("source_id"): cv.string,
                vol.Optional("entry_id"): cv.string,
            }
        ),
    )

    hass.services.async_register(
        DOMAIN,
        "set_room_polygon",
        set_room_polygon,
        schema=vol.Schema(
            {
                vol.Required("map_id"): cv.string,
                vol.Required("room_id"): cv.string,
                vol.Required("name"): cv.string,
                vol.Required("points"): vol.All(cv.ensure_list, [_point_schema]),
                vol.Optional("entry_id"): cv.string,
            }
        ),
    )

    hass.services.async_register(
        DOMAIN,
        "delete_room",
        delete_room,
        schema=vol.Schema(
            {
                vol.Required("map_id"): cv.string,
                vol.Required("room_id"): cv.string,
                vol.Optional("entry_id"): cv.string,
            }
        ),
    )

    hass.services.async_register(
        DOMAIN,
        "start_calibration",
        start_calibration,
        schema=vol.Schema(
            {
                vol.Required("map_id"): cv.string,
                vol.Optional("entry_id"): cv.string,
            }
        ),
    )

    hass.services.async_register(
        DOMAIN,
        "capture_calibration_point",
        capture_calibration_point,
        schema=vol.Schema(
            {
                vol.Required("map_id"): cv.string,
                vol.Required("image_x"): vol.Coerce(float),
                vol.Required("image_y"): vol.Coerce(float),
                vol.Required("real_x"): vol.Coerce(float),
                vol.Required("real_y"): vol.Coerce(float),
                vol.Optional("entry_id"): cv.string,
            }
        ),
    )

    hass.services.async_register(
        DOMAIN,
        "finish_calibration",
        finish_calibration,
        schema=vol.Schema(
            {
                vol.Required("map_id"): cv.string,
                vol.Optional("entry_id"): cv.string,
            }
        ),
    )

    hass.services.async_register(
        DOMAIN,
        "reload_ble_cache",
        reload_ble_cache,
        schema=vol.Schema({vol.Optional("entry_id"): cv.string}),
    )


async def async_remove_services(hass: HomeAssistant) -> None:
    for svc in (
        "import_map_image",
        "set_active_map",
        "set_map_anchor",
        "delete_map_anchor",
        "set_room_polygon",
        "delete_room",
        "start_calibration",
        "capture_calibration_point",
        "finish_calibration",
        "reload_ble_cache",
    ):
        if hass.services.has_service(DOMAIN, svc):
            hass.services.async_remove(DOMAIN, svc)
