from __future__ import annotations

import json
import logging

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers.json import JSONEncoder

from .const import DOMAIN, DATA_MAP_STORE
from .map_store import MapStore

_LOGGER = logging.getLogger(__name__)

def _store(hass: HomeAssistant) -> MapStore:
    ms: MapStore | None = hass.data.get(DOMAIN, {}).get(DATA_MAP_STORE)
    if ms is None:
        raise RuntimeError("MapStore not initialized")
    return ms

class PadSpanMapsView(HomeAssistantView):
    url = "/api/padspan_ha/maps"
    name = "api:padspan_ha:maps"
    requires_auth = True

    async def get(self, request):
        hass: HomeAssistant = request.app["hass"]
        ms = _store(hass)
        return self.json({"maps": ms.list_maps()}, dumps=lambda o: json.dumps(o, cls=JSONEncoder))

    async def post(self, request):
        hass: HomeAssistant = request.app["hass"]
        ms = _store(hass)
        try:
            payload = await request.json()
            info = await ms.async_add_map(payload)
            return self.json(info, dumps=lambda o: json.dumps(o, cls=JSONEncoder))
        except Exception as err:
            _LOGGER.exception("Map upload failed: %s", err)
            return self.json({"error": str(err)}, status_code=400)

class PadSpanMapMetaView(HomeAssistantView):
    url = "/api/padspan_ha/maps/{map_id}/meta"
    name = "api:padspan_ha:map_meta"
    requires_auth = True

    async def get(self, request, map_id: str):
        hass: HomeAssistant = request.app["hass"]
        ms = _store(hass)
        m = ms.get_map(map_id)
        if not m:
            return self.json({"error": "not_found"}, status_code=404)
        return self.json(m, dumps=lambda o: json.dumps(o, cls=JSONEncoder))

    async def put(self, request, map_id: str):
        hass: HomeAssistant = request.app["hass"]
        ms = _store(hass)
        try:
            meta = await request.json()
            m = await ms.async_update_meta(map_id, meta)
            return self.json(m, dumps=lambda o: json.dumps(o, cls=JSONEncoder))
        except KeyError:
            return self.json({"error": "not_found"}, status_code=404)
        except Exception as err:
            _LOGGER.exception("Map meta update failed: %s", err)
            return self.json({"error": str(err)}, status_code=400)

class PadSpanMapFileView(HomeAssistantView):
    url = "/api/padspan_ha/maps/{map_id}/file"
    name = "api:padspan_ha:map_file"
    requires_auth = True

    async def get(self, request, map_id: str):
        hass: HomeAssistant = request.app["hass"]
        ms = _store(hass)
        try:
            raw, mime = await ms.async_read_file(map_id)
            return self._file(raw, mime, filename=f"{map_id}.png")
        except KeyError:
            return self.json({"error": "not_found"}, status_code=404)
        except Exception as err:
            _LOGGER.exception("Map file read failed: %s", err)
            return self.json({"error": str(err)}, status_code=400)

    def _file(self, raw: bytes, mime: str, filename: str):
        from aiohttp import web
        resp = web.Response(body=raw)
        resp.content_type = mime
        resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        return resp

class PadSpanMapDeleteView(HomeAssistantView):
    url = "/api/padspan_ha/maps/{map_id}"
    name = "api:padspan_ha:map_delete"
    requires_auth = True

    async def delete(self, request, map_id: str):
        hass: HomeAssistant = request.app["hass"]
        ms = _store(hass)
        await ms.async_delete_map(map_id)
        return self.json({"ok": True})
