"""PadSpan legacy domain tombstone (disabled)."""

import logging
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

_LOGGER = logging.getLogger(__name__)

async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    _LOGGER.warning(
        "Legacy domain 'padspan' is disabled in v0.3.10. Use domain 'padspan_ha' only."
    )
    return True
