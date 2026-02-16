from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries

from .const import (
    CONF_API_BASE,
    CONF_API_KEY,
    CONF_DEMO_MODE,
    DEFAULT_API_BASE,
    DEFAULT_DEMO_MODE,
    DEFAULT_ENABLE_SIDEBAR,
    DEFAULT_REFRESH_SECONDS,
    DOMAIN,
    OPTION_ENABLE_SIDEBAR,
    OPTION_REFRESH_SECONDS,
)

class PadSpanConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            return self.async_create_entry(title="PadSpan HA", data=user_input)

        schema = vol.Schema({
            vol.Required(CONF_DEMO_MODE, default=DEFAULT_DEMO_MODE): bool,
            vol.Required(CONF_API_BASE, default=DEFAULT_API_BASE): str,
            vol.Optional(CONF_API_KEY, default=""): str,
            vol.Required(OPTION_ENABLE_SIDEBAR, default=DEFAULT_ENABLE_SIDEBAR): bool,
        })
        return self.async_show_form(step_id="user", data_schema=schema)

    @staticmethod
    def async_get_options_flow(config_entry):
        return PadSpanOptionsFlow(config_entry)

class PadSpanOptionsFlow(config_entries.OptionsFlow):
    def __init__(self, config_entry) -> None:
        self.config_entry = config_entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        schema = vol.Schema({
            vol.Required(
                OPTION_REFRESH_SECONDS,
                default=self.config_entry.options.get(OPTION_REFRESH_SECONDS, DEFAULT_REFRESH_SECONDS),
            ): vol.All(int, vol.Range(min=5, max=300)),
            vol.Required(
                OPTION_ENABLE_SIDEBAR,
                default=self.config_entry.options.get(
                    OPTION_ENABLE_SIDEBAR,
                    self.config_entry.data.get(OPTION_ENABLE_SIDEBAR, DEFAULT_ENABLE_SIDEBAR),
                ),
            ): bool,
        })
        return self.async_show_form(step_id="init", data_schema=schema)
