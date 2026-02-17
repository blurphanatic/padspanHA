from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback

from .const import (
    CONF_API_KEY,
    CONF_ENABLE_CLOUD,
    CONF_HUB_URL,
    CONF_SCAN_INTERVAL,
    DEFAULT_ENABLE_CLOUD,
    DEFAULT_HUB_URL,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    NAME,
)


class PadSpanConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """PadSpan config flow (local-first)."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        errors: dict[str, str] = {}

        if user_input is not None:
            data = dict(user_input)
            if not data.get(CONF_ENABLE_CLOUD, False):
                data[CONF_HUB_URL] = ""
                data[CONF_API_KEY] = ""
            data[CONF_API_KEY] = (data.get(CONF_API_KEY) or "").strip()
            data[CONF_HUB_URL] = (data.get(CONF_HUB_URL) or "").strip()

            await self.async_set_unique_id("padspan_singleton")
            self._abort_if_unique_id_configured()
            return self.async_create_entry(title=NAME, data=data)

        return self.async_show_form(
            step_id="user",
            data_schema=self._build_schema(),
            errors=errors,
        )

    @staticmethod
    def _build_schema(defaults: dict[str, Any] | None = None) -> vol.Schema:
        defaults = defaults or {}
        return vol.Schema(
            {
                vol.Required(
                    CONF_ENABLE_CLOUD,
                    default=defaults.get(CONF_ENABLE_CLOUD, DEFAULT_ENABLE_CLOUD),
                ): bool,
                vol.Optional(
                    CONF_HUB_URL,
                    default=defaults.get(CONF_HUB_URL, DEFAULT_HUB_URL),
                ): str,
                vol.Optional(
                    CONF_API_KEY,
                    default=defaults.get(CONF_API_KEY, ""),
                ): str,
                vol.Required(
                    CONF_SCAN_INTERVAL,
                    default=int(defaults.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)),
                ): vol.All(vol.Coerce(int), vol.Range(min=5, max=3600)),
            }
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return PadSpanOptionsFlow(config_entry)


class PadSpanOptionsFlow(config_entries.OptionsFlow):
    def __init__(self, config_entry):
        self.config_entry = config_entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        defaults = dict(self.config_entry.data)
        defaults.update(self.config_entry.options)
        return self.async_show_form(
            step_id="init",
            data_schema=PadSpanConfigFlow._build_schema(defaults),
        )
