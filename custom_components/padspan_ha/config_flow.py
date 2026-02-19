from __future__ import annotations

"""
Config flow + options flow for PadSpan HA.

Important for HA Core >= 2025.12:
- OptionsFlow now provides self.config_entry automatically.
- Do NOT set self.config_entry manually; do NOT pass config_entry into __init__.
"""

import logging
from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback

from .const import (
    DOMAIN,
    NAME,
    VERSION,
    CONF_ENABLE_CLOUD,
    CONF_HUB_URL,
    CONF_API_KEY,
    CONF_SCAN_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
)

_LOGGER = logging.getLogger(__name__)

def _clamp_interval(value: Any) -> int:
    try:
        v = int(value)
    except Exception:
        v = DEFAULT_SCAN_INTERVAL
    return max(5, min(3600, v))

def _schema(default_interval: int) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(
                CONF_SCAN_INTERVAL,
                default=_clamp_interval(default_interval),
            ): vol.All(vol.Coerce(int), vol.Range(min=5, max=3600)),
        }
    )

class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle initial setup."""
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        try:
            if self.hass.config_entries.async_entries(DOMAIN):
                return self.async_abort(reason="already_configured")

            if user_input is None:
                return self.async_show_form(
                    step_id="user",
                    data_schema=_schema(DEFAULT_SCAN_INTERVAL),
                )

            interval = _clamp_interval(user_input.get(CONF_SCAN_INTERVAL))
            data = {
                CONF_ENABLE_CLOUD: False,
                CONF_HUB_URL: "",
                CONF_API_KEY: "",
                CONF_SCAN_INTERVAL: interval,
            }
            return self.async_create_entry(title=NAME, data=data)
        except Exception as err:
            _LOGGER.exception("ConfigFlow user crashed (v%s): %s", VERSION, err)
            return self.async_abort(reason="unknown")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry):
        """Return options flow handler."""
        return OptionsFlowHandler()

class OptionsFlowHandler(config_entries.OptionsFlowWithReload):
    """Options flow (gear icon). Reload integration after saving."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        try:
            if user_input is not None:
                interval = _clamp_interval(user_input.get(CONF_SCAN_INTERVAL))
                return self.async_create_entry(data={CONF_SCAN_INTERVAL: interval})

            # Suggested values from current options/data
            current = _clamp_interval(
                self.config_entry.options.get(
                    CONF_SCAN_INTERVAL,
                    self.config_entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
                )
            )
            base = _schema(current)
            schema = self.add_suggested_values_to_schema(base, self.config_entry.options)
            return self.async_show_form(step_id="init", data_schema=schema)
        except Exception as err:
            _LOGGER.exception("OptionsFlow crashed (v%s): %s", VERSION, err)
            return self.async_abort(reason="unknown")
