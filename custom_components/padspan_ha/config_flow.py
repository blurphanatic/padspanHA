from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import callback

from .const import (
    CONF_API_KEY,
    CONF_ENABLE_CLOUD,
    CONF_HUB_URL,
    CONF_SCAN_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    NAME,
)


def _clamp_interval(value: Any) -> int:
    try:
        v = int(value)
    except Exception:
        v = DEFAULT_SCAN_INTERVAL
    return max(5, min(3600, v))


def _schema(default_interval: int) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(CONF_SCAN_INTERVAL, default=default_interval): vol.All(
                vol.Coerce(int), vol.Range(min=5, max=3600)
            ),
        }
    )


# Compatibility: newer HA has OptionsFlowWithConfigEntry; older uses OptionsFlow(config_entry passed in __init__)
_OptionsBase = getattr(config_entries, "OptionsFlowWithConfigEntry", config_entries.OptionsFlow)
_HAS_WITH_CONFIG_ENTRY = _OptionsBase is not config_entries.OptionsFlow


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle config flow for PadSpan HA."""

    VERSION = 1
    MINOR_VERSION = 2

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        """Initial setup (local-first)."""
        if self.hass.config_entries.async_entries(DOMAIN):
            return self.async_abort(reason="already_configured")

        if user_input is None:
            return self.async_show_form(
                step_id="user",
                data_schema=_schema(DEFAULT_SCAN_INTERVAL),
                errors={},
            )

        interval = _clamp_interval(user_input.get(CONF_SCAN_INTERVAL))
        data = {
            CONF_ENABLE_CLOUD: False,
            CONF_HUB_URL: "",
            CONF_API_KEY: "",
            CONF_SCAN_INTERVAL: interval,
        }
        return self.async_create_entry(title=NAME, data=data)

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None):
        """Handle UI 'Configure' action safely."""
        entry_id = self.context.get("entry_id")
        entry = self.hass.config_entries.async_get_entry(entry_id) if entry_id else None
        default_interval = DEFAULT_SCAN_INTERVAL
        if entry:
            default_interval = _clamp_interval(
                entry.options.get(CONF_SCAN_INTERVAL, entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL))
            )

        if user_input is None:
            return self.async_show_form(
                step_id="reconfigure",
                data_schema=_schema(default_interval),
                errors={},
            )

        interval = _clamp_interval(user_input.get(CONF_SCAN_INTERVAL))
        if entry:
            data = dict(entry.data)
            data[CONF_SCAN_INTERVAL] = interval
            data.setdefault(CONF_ENABLE_CLOUD, False)
            data.setdefault(CONF_HUB_URL, "")
            data.setdefault(CONF_API_KEY, "")
            self.hass.config_entries.async_update_entry(entry, data=data)
            await self.hass.config_entries.async_reload(entry.entry_id)
            return self.async_abort(reason="reconfigure_successful")

        # Fallback when no entry context exists
        return self.async_create_entry(
            title=NAME,
            data={
                CONF_ENABLE_CLOUD: False,
                CONF_HUB_URL: "",
                CONF_API_KEY: "",
                CONF_SCAN_INTERVAL: interval,
            },
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry):
        """Return options flow with compatibility across HA versions."""
        if _HAS_WITH_CONFIG_ENTRY:
            return OptionsFlowHandler()
        return OptionsFlowHandler(config_entry)


class OptionsFlowHandler(_OptionsBase):
    """PadSpan options flow."""

    def __init__(self, config_entry: ConfigEntry | None = None) -> None:
        # Old HA path
        if not _HAS_WITH_CONFIG_ENTRY:
            self.config_entry = config_entry  # type: ignore[assignment]
        else:
            super().__init__()

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            interval = _clamp_interval(user_input.get(CONF_SCAN_INTERVAL))
            return self.async_create_entry(title="", data={CONF_SCAN_INTERVAL: interval})

        default_interval = _clamp_interval(
            self.config_entry.options.get(
                CONF_SCAN_INTERVAL,
                self.config_entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
            )
        )

        return self.async_show_form(
            step_id="init",
            data_schema=_schema(default_interval),
            errors={},
        )
