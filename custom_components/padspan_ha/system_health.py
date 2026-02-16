async def async_register(hass, register) -> None:
    register.async_register_info(system_health_info)

async def system_health_info(hass):
    loaded = len(hass.data.get("padspan_ha", {}))
    return {
        "loaded_entries": loaded,
        "service_registered": hass.services.has_service("padspan_ha", "rescan"),
    }
