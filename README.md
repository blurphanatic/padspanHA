# PadSpan HA Integration (v3.3.3)

Complete Home Assistant custom integration scaffold for PadSpan BLE mapping/presence.

## Includes
- Config + Options flow
- DataUpdateCoordinator backend
- Platforms: sensor, binary_sensor, device_tracker, button
- Service: `padspan_ha.rescan`
- WebSocket command: `padspan_ha/get_state`
- Diagnostics + system health
- Sidebar panel + static UI
- Sidebar variation lab with multiple presets

## Install
1. Copy `custom_components/padspan_ha` into your Home Assistant config `custom_components/`.
2. Restart Home Assistant.
3. Settings → Devices & Services → Add Integration → **PadSpan HA**

## Version
- 3.3.3
