from homeassistant.components import websocket_api

from .const import DOMAIN, WEBSOCKET_GET_STATE

@websocket_api.websocket_command({"type": WEBSOCKET_GET_STATE, "entry_id": str})
@websocket_api.async_response
async def handle_get_state(hass, connection, msg):
    entry_id = msg["entry_id"]
    data = hass.data.get(DOMAIN, {}).get(entry_id)
    if not data:
        connection.send_error(msg["id"], "not_found", "Entry not loaded")
        return
    connection.send_result(msg["id"], data["coordinator"].data or {})

async def async_setup(hass):
    websocket_api.async_register_command(hass, handle_get_state)
