from __future__ import annotations

from copy import deepcopy
import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigEntry, OptionsFlow
from homeassistant.core import callback

from .const import (
    CONF_BOOTSTRAP_CACHE,
    CONF_DEVICE_TIMEOUT,
    CONF_HUB_SOURCES,
    CONF_HUB_SOURCES_CSV,
    CONF_INCLUDE_PASSIVE,
    CONF_MAP_ID,
    CONF_NAME,
    DEFAULT_BOOTSTRAP_CACHE,
    DEFAULT_DEVICE_TIMEOUT,
    DEFAULT_INCLUDE_PASSIVE,
    DEFAULT_MAP_ID,
    DEFAULT_NAME,
    DOMAIN,
)
from .map_store import import_map_image_file


def _csv_to_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [v.strip() for v in value.split(",") if v.strip()]


class PadSpanConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        errors = {}

        if user_input is not None:
            hub_sources = _csv_to_list(user_input.get(CONF_HUB_SOURCES_CSV))
            data = {
                CONF_NAME: user_input[CONF_NAME],
                CONF_MAP_ID: user_input.get(CONF_MAP_ID, DEFAULT_MAP_ID),
            }
            options = {
                CONF_INCLUDE_PASSIVE: user_input.get(CONF_INCLUDE_PASSIVE, DEFAULT_INCLUDE_PASSIVE),
                CONF_BOOTSTRAP_CACHE: user_input.get(CONF_BOOTSTRAP_CACHE, DEFAULT_BOOTSTRAP_CACHE),
                CONF_DEVICE_TIMEOUT: int(user_input.get(CONF_DEVICE_TIMEOUT, DEFAULT_DEVICE_TIMEOUT)),
                CONF_HUB_SOURCES: hub_sources,
            }
            return self.async_create_entry(title=data[CONF_NAME], data=data, options=options)

        schema = vol.Schema(
            {
                vol.Required(CONF_NAME, default=DEFAULT_NAME): str,
                vol.Optional(CONF_MAP_ID, default=DEFAULT_MAP_ID): str,
                vol.Optional(CONF_INCLUDE_PASSIVE, default=DEFAULT_INCLUDE_PASSIVE): bool,
                vol.Optional(CONF_BOOTSTRAP_CACHE, default=DEFAULT_BOOTSTRAP_CACHE): bool,
                vol.Optional(CONF_DEVICE_TIMEOUT, default=DEFAULT_DEVICE_TIMEOUT): int,
                vol.Optional(CONF_HUB_SOURCES_CSV, default=""): str,
            }
        )

        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry):
        return PadSpanOptionsFlow()


class PadSpanOptionsFlow(OptionsFlow):
    async def async_step_init(self, user_input=None):
        options = deepcopy(dict(self.config_entry.options))
        data = dict(self.config_entry.data)

        if user_input is not None:
            options[CONF_INCLUDE_PASSIVE] = user_input.get(CONF_INCLUDE_PASSIVE, DEFAULT_INCLUDE_PASSIVE)
            options[CONF_BOOTSTRAP_CACHE] = user_input.get(CONF_BOOTSTRAP_CACHE, DEFAULT_BOOTSTRAP_CACHE)
            options[CONF_DEVICE_TIMEOUT] = int(user_input.get(CONF_DEVICE_TIMEOUT, DEFAULT_DEVICE_TIMEOUT))
            options[CONF_HUB_SOURCES] = _csv_to_list(user_input.get(CONF_HUB_SOURCES_CSV))

            # Optional quick map import directly from options flow
            map_id = user_input.get("map_id_import")
            map_source = user_input.get("map_source_path")
            if map_id and map_source:
                try:
                    await import_map_image_file(
                        hass=self.hass,
                        entry_id=self.config_entry.entry_id,
                        map_store=self.hass.data[DOMAIN][self.config_entry.entry_id]["map_store"],
                        map_id=map_id,
                        source_path=map_source,
                        overwrite=bool(user_input.get("overwrite_map", False)),
                    )
                except Exception:
                    # keep options flow resilient
                    return self.async_show_form(
                        step_id="init",
                        data_schema=vol.Schema(
                            {
                                vol.Optional(CONF_NAME, default=self.config_entry.title): str,
                                vol.Optional(CONF_MAP_ID, default=data.get(CONF_MAP_ID, DEFAULT_MAP_ID)): str,
                                vol.Optional(CONF_INCLUDE_PASSIVE, default=options.get(CONF_INCLUDE_PASSIVE, DEFAULT_INCLUDE_PASSIVE)): bool,
                                vol.Optional(CONF_BOOTSTRAP_CACHE, default=options.get(CONF_BOOTSTRAP_CACHE, DEFAULT_BOOTSTRAP_CACHE)): bool,
                                vol.Optional(CONF_DEVICE_TIMEOUT, default=options.get(CONF_DEVICE_TIMEOUT, DEFAULT_DEVICE_TIMEOUT)): int,
                                vol.Optional(CONF_HUB_SOURCES_CSV, default=", ".join(options.get(CONF_HUB_SOURCES, []))): str,
                                vol.Optional("map_id_import", default=map_id): str,
                                vol.Optional("map_source_path", default=map_source): str,
                                vol.Optional("overwrite_map", default=bool(user_input.get("overwrite_map", False))): bool,
                            }
                        ),
                        errors={"base": "map_import_failed"},
                    )

            new_title = user_input.get(CONF_NAME, data.get(CONF_NAME, DEFAULT_NAME))
            if new_title != self.config_entry.title:
                self.hass.config_entries.async_update_entry(self.config_entry, title=new_title)
            self.hass.config_entries.async_update_entry(
                self.config_entry,
                data={
                    **data,
                    CONF_NAME: new_title,
                    CONF_MAP_ID: user_input.get(CONF_MAP_ID, data.get(CONF_MAP_ID, DEFAULT_MAP_ID)),
                },
                options=options,
            )
            return self.async_create_entry(title="", data={})

        hub_sources_csv = ", ".join(options.get(CONF_HUB_SOURCES, []))
        schema = vol.Schema(
            {
                vol.Optional(CONF_NAME, default=self.config_entry.title): str,
                vol.Optional(CONF_MAP_ID, default=data.get(CONF_MAP_ID, DEFAULT_MAP_ID)): str,
                vol.Optional(CONF_INCLUDE_PASSIVE, default=options.get(CONF_INCLUDE_PASSIVE, DEFAULT_INCLUDE_PASSIVE)): bool,
                vol.Optional(CONF_BOOTSTRAP_CACHE, default=options.get(CONF_BOOTSTRAP_CACHE, DEFAULT_BOOTSTRAP_CACHE)): bool,
                vol.Optional(CONF_DEVICE_TIMEOUT, default=options.get(CONF_DEVICE_TIMEOUT, DEFAULT_DEVICE_TIMEOUT)): int,
                vol.Optional(CONF_HUB_SOURCES_CSV, default=hub_sources_csv): str,
                vol.Optional("map_id_import", default=""): str,
                vol.Optional("map_source_path", default=""): str,
                vol.Optional("overwrite_map", default=False): bool,
            }
        )

        return self.async_show_form(step_id="init", data_schema=schema)
