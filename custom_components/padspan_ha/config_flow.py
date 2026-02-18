
from __future__ import annotations
import logging
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from .const import DOMAIN, NAME, CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL

_LOGGER = logging.getLogger(__name__)

def _schema(default):
    return vol.Schema({
        vol.Required(CONF_SCAN_INTERVAL, default=default): int
    })

class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        try:
            if self.hass.config_entries.async_entries(DOMAIN):
                return self.async_abort(reason="already_configured")

            if user_input is None:
                return self.async_show_form(step_id="user", data_schema=_schema(DEFAULT_SCAN_INTERVAL))

            return self.async_create_entry(title=NAME, data=user_input)

        except Exception as e:
            _LOGGER.exception("CONFIG FLOW CRASH: %s", e)
            return self.async_abort(reason="unknown")

    async def async_step_reconfigure(self, user_input=None):
        try:
            if user_input is None:
                return self.async_show_form(step_id="reconfigure", data_schema=_schema(DEFAULT_SCAN_INTERVAL))
            return self.async_abort(reason="reconfigure_successful")
        except Exception as e:
            _LOGGER.exception("RECONFIGURE CRASH: %s", e)
            return self.async_abort(reason="unknown")

    @staticmethod
    @callback
    def async_get_options_flow(entry):
        return OptionsFlow(entry)

class OptionsFlow(config_entries.OptionsFlow):
    def __init__(self, entry):
        self.entry = entry

    async def async_step_init(self, user_input=None):
        try:
            if user_input is not None:
                return self.async_create_entry(title="", data=user_input)
            return self.async_show_form(step_id="init", data_schema=_schema(DEFAULT_SCAN_INTERVAL))
        except Exception as e:
            _LOGGER.exception("OPTIONS FLOW CRASH: %s", e)
            return self.async_abort(reason="unknown")
