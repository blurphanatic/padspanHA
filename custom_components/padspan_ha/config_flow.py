from __future__ import annotations

from typing import Any
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import config_validation as cv

from .const import (
    DOMAIN,
    CONF_INCLUDE_PASSIVE,
    CONF_STALE_SECONDS,
    CONF_TX_POWER,
    CONF_PATH_LOSS,
    CONF_SMOOTHING,
    DEFAULT_INCLUDE_PASSIVE,
    DEFAULT_STALE_SECONDS,
    DEFAULT_TX_POWER,
    DEFAULT_PATH_LOSS,
    DEFAULT_SMOOTHING,
)


class PadSpanConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            title = user_input.get("name", "PadSpan HA")
            return self.async_create_entry(title=title, data={})
        schema = vol.Schema({
            vol.Optional("name", default="PadSpan HA"): str,
        })
        return self.async_show_form(step_id="user", data_schema=schema)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry):
        return PadSpanOptionsFlow(config_entry)


class PadSpanOptionsFlow(config_entries.OptionsFlow):
    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        self.config_entry = config_entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        opts = self.config_entry.options
        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_INCLUDE_PASSIVE,
                    default=opts.get(CONF_INCLUDE_PASSIVE, DEFAULT_INCLUDE_PASSIVE),
                ): cv.boolean,
                vol.Optional(
                    CONF_STALE_SECONDS,
                    default=opts.get(CONF_STALE_SECONDS, DEFAULT_STALE_SECONDS),
                ): vol.All(vol.Coerce(int), vol.Range(min=5, max=600)),
                vol.Optional(
                    CONF_TX_POWER,
                    default=opts.get(CONF_TX_POWER, DEFAULT_TX_POWER),
                ): vol.All(vol.Coerce(int), vol.Range(min=-120, max=0)),
                vol.Optional(
                    CONF_PATH_LOSS,
                    default=opts.get(CONF_PATH_LOSS, DEFAULT_PATH_LOSS),
                ): vol.All(vol.Coerce(float), vol.Range(min=1.2, max=6.0)),
                vol.Optional(
                    CONF_SMOOTHING,
                    default=opts.get(CONF_SMOOTHING, DEFAULT_SMOOTHING),
                ): vol.All(vol.Coerce(float), vol.Range(min=0.0, max=1.0)),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
