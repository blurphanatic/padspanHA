# PadSpan HA

PadSpan HA is a Home Assistant custom integration for BLE presence + map anchoring.

## Features (v0.2.7)
- Passive BLE ingest support (works with Bermuda-style proxy setups).
- Bootstrap from HA Bluetooth cache.
- Multiple hubs/scanners supported.
- Dynamic BLE device tracker entities (home/not_home).
- Map image import service (`import_map_image`).
- Map anchor service (`set_map_anchor`) to pin scanner/hub coordinates.
- Position estimation (weighted centroid from RSSI and anchors).
- Diagnostics sensors for scanner/device visibility.

## HACS install
1. Push this repo to GitHub.
2. HACS → Integrations → ⋮ → Custom repositories
3. Add your repo URL as **Integration**.
4. Install **PadSpan HA**, restart Home Assistant.
5. Add integration in **Settings → Devices & Services**.

## Quick start
### 1) Import a map image
```yaml
service: padspan_ha.import_map_image
data:
  map_id: main_floor
  source_path: www/maps/main_floor.png
  overwrite: true
```

### 2) Add scanner/hub anchors
(Use your scanner source id, e.g. Bermuda proxy source/MAC)
```yaml
service: padspan_ha.set_map_anchor
data:
  map_id: main_floor
  anchor_id: bermuda_office
  source_id: AA:BB:CC:DD:EE:FF
  x: 390
  y: 145
  z: 0
  weight: 1.0
  name: Office Bermuda
```

### 3) Optional BLE cache reload
```yaml
service: padspan_ha.reload_ble_cache
data: {}
```

## Why passive mode?
If your BLE feed comes from non-connectable proxies (common for Bermuda), `connectable: false` is required to receive all advertisements.

## Notes
- The map file is copied into `/config/www/padspan_ha/<entry_id>/...`
- The public URL will be `/local/padspan_ha/<entry_id>/...`
- Use that URL in a Picture card / floorplan card.
