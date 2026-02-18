from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback

from .const import (
    CONF_API_KEY,
    CONF_ENABLE_CLOUD,
    CONF_HUB_URL,
    CONF_SCAN_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    NAME,
    VERSION,
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
            vol.Required(CONF_SCAN_INTERVAL, default=_clamp_interval(default_interval)): vol.All(
                vol.Coerce(int), vol.Range(min=5, max=3600)
            ),
        }
    )


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Config flow for PadSpan HA (local-first)."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        try:
            if self.hass.config_entries.async_entries(DOMAIN):
                return self.async_abort(reason="already_configured")

            if user_input is None:
                return self.async_show_form(step_id="user", data_schema=_schema(DEFAULT_SCAN_INTERVAL))

            interval = _clamp_interval(user_input.get(CONF_SCAN_INTERVAL))
            data = {
                CONF_ENABLE_CLOUD: False,
                CONF_HUB_URL: "",
                CONF_API_KEY: "",
                CONF_SCAN_INTERVAL: interval,
            }
            return self.async_create_entry(title=NAME, data=data)
        except Exception as err:
            _LOGGER.exception("ConfigFlow async_step_user crashed (v%s): %s", VERSION, err)
            return self.async_abort(reason="unknown")

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None):
        """Handle HA 'Configure' action without throwing."""
        try:
            # Find the existing entry (singleton)
            entry = None
            entry_id = self.context.get("entry_id")
            if entry_id:
                try:
                    entry = self.hass.config_entries.async_get_entry(entry_id)
                except Exception:
                    entry = None
            if entry is None:
                entries = self.hass.config_entries.async_entries(DOMAIN)
                entry = entries[0] if entries else None

            default_interval = DEFAULT_SCAN_INTERVAL
            if entry:
                default_interval = _clamp_interval(
                    entry.options.get(CONF_SCAN_INTERVAL, entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL))
                )

            if user_input is None:
                return self.async_show_form(step_id="reconfigure", data_schema=_schema(default_interval))

            interval = _clamp_interval(user_input.get(CONF_SCAN_INTERVAL))

            if entry:
                options = dict(entry.options)
                options[CONF_SCAN_INTERVAL] = interval
                self.hass.config_entries.async_update_entry(entry, options=options)
                await self.hass.config_entries.async_reload(entry.entry_id)
                return self.async_abort(reason="reconfigure_successful")

            return self.async_create_entry(
                title=NAME,
                data={
                    CONF_ENABLE_CLOUD: False,
                    CONF_HUB_URL: "",
                    CONF_API_KEY: "",
                    CONF_SCAN_INTERVAL: interval,
                },
            )
        except Exception as err:
            _LOGGER.exception("ConfigFlow async_step_reconfigure crashed (v%s): %s", VERSION, err)
            return self.async_abort(reason="unknown")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return OptionsFlowHandler(config_entry)


class OptionsFlowHandler(config_entries.OptionsFlow):
    """Options flow for PadSpan HA."""

    def __init__(self, config_entry) -> None:
        self.config_entry = config_entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        try:
            if user_input is not None:
                interval = _clamp_interval(user_input.get(CONF_SCAN_INTERVAL))
                return self.async_create_entry(title="", data={CONF_SCAN_INTERVAL: interval})

            default_interval = _clamp_interval(
                self.config_entry.options.get(
                    CONF_SCAN_INTERVAL,
                    self.config_entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
                )
            )
            return self.async_show_form(step_id="init", data_schema=_schema(default_interval))
        except Exception as err:
            _LOGGER.exception("OptionsFlow crashed (v%s): %s", VERSION, err)
            return self.async_abort(reason="unknown")
