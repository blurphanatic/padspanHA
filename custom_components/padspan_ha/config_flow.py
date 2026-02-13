from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .const import (
    CONF_ENABLE_SIDEBAR,
    CONF_INCLUDE_PASSIVE,
    CONF_SEEN_TIMEOUT,
    CONF_UPDATE_INTERVAL,
    DEFAULT_ENABLE_SIDEBAR,
    DEFAULT_INCLUDE_PASSIVE,
    DEFAULT_SEEN_TIMEOUT,
    DEFAULT_UPDATE_INTERVAL,
    DOMAIN,
)


def _options_schema(defaults: dict[str, Any]) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(
                CONF_INCLUDE_PASSIVE,
                default=defaults.get(CONF_INCLUDE_PASSIVE, DEFAULT_INCLUDE_PASSIVE),
            ): bool,
            vol.Required(
                CONF_UPDATE_INTERVAL,
                default=defaults.get(CONF_UPDATE_INTERVAL, DEFAULT_UPDATE_INTERVAL),
            ): vol.All(int, vol.Range(min=2, max=120)),
            vol.Required(
                CONF_SEEN_TIMEOUT,
                default=defaults.get(CONF_SEEN_TIMEOUT, DEFAULT_SEEN_TIMEOUT),
            ): vol.All(int, vol.Range(min=5, max=600)),
            vol.Required(
                CONF_ENABLE_SIDEBAR,
                default=defaults.get(CONF_ENABLE_SIDEBAR, DEFAULT_ENABLE_SIDEBAR),
            ): bool,
        }
    )


class PadSpanConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for PadSpan HA."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if user_input is not None:
            return self.async_create_entry(title="PadSpan HA", data=user_input)

        schema = _options_schema({})
        return self.async_show_form(step_id="user", data_schema=schema)

    @staticmethod
    def async_get_options_flow(config_entry: config_entries.ConfigEntry) -> config_entries.OptionsFlow:
        return PadSpanOptionsFlow(config_entry)


class PadSpanOptionsFlow(config_entries.OptionsFlow):
    """PadSpan HA options flow."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        self._entry = config_entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        defaults = dict(self._entry.data)
        defaults.update(self._entry.options)
        return self.async_show_form(step_id="init", data_schema=_options_schema(defaults))
