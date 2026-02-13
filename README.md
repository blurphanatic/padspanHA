# PadSpan HA (v0.2.9)

PadSpan HA is a Home Assistant custom integration for BLE presence mapping with:

- passive + connectable BLE ingest
- multi-scanner / multi-hub signal aggregation
- map image import and storage
- per-map scanner anchors
- estimated `(x, y)` device position
- dynamic BLE tracker entities
- advanced sidebar panel for visualization + map building

## HACS install

1. Push this repository to GitHub.
2. In Home Assistant, open **HACS → Integrations → ⋮ → Custom repositories**
3. Add your repo URL as **Integration**.
4. Install **PadSpan HA** and restart Home Assistant.
5. Add **PadSpan HA** in **Settings → Devices & Services**.

## Sidebar panel

This build registers a custom sidebar panel at:

- **Path**: `/padspan-ha`
- **Title**: `PadSpan HA`
- **Icon**: `mdi:map-search`

The panel helps you:

- upload map images
- pick active map
- place scanner anchors
- view live devices overlaid on map

## Services

- `padspan_ha.import_map_image`
- `padspan_ha.set_map_anchor`
- `padspan_ha.delete_map_anchor`
- `padspan_ha.set_active_map`
- `padspan_ha.reload_ble_cache`

## Notes

- Keep **include passive BLE** enabled if your devices are visible through proxy scanners that do not provide connectable paths.
- Map and anchor data are stored per config entry in Home Assistant storage.
