
from __future__ import annotations
import logging
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

async def async_setup(hass: HomeAssistant, config):
    hass.data.setdefault(DOMAIN, {})
    try:
        from .panel import async_setup_panel
        await async_setup_panel(hass)
    except Exception as e:
        _LOGGER.exception("Panel setup failed: %s", e)
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry):
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN]["entry"] = entry
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry):
    return True
