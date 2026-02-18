# Websocket API

All panel actions should go through websocket commands to keep the integration local-first and avoid API-key complexity.

## Common commands

### Panel + coordinator
- `padspan_ha/version` → returns integration version
- `padspan_ha/state` → returns current coordinator state for the panel
- `padspan_ha/auto_diagnostics` → returns health checks and guidance

### Data mode
- `padspan_ha/get_settings` → returns persisted settings (sample/live, active map)
- `padspan_ha/set_data_mode` → set sample/live
- `padspan_ha/live_snapshot` → triggers/returns best-effort discovery output

### Maps
- `padspan_ha/maps_list`
- `padspan_ha/maps_upload` (base64 PNG payload)
- `padspan_ha/maps_get`
- `padspan_ha/maps_set_active`
- `padspan_ha/maps_save_receivers`
- `padspan_ha/maps_export`
- `padspan_ha/maps_delete`

## Why normalize coordinates
Receiver placement is stored as:
- `x` in [0..1]
- `y` in [0..1]

This makes receiver positions stable even if the image gets resized later.

