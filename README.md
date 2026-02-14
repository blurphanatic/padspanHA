# PadSpan HA (v0.3.0)

PadSpan HA is a Home Assistant custom integration for BLE presence + map visualization.

## Highlights in 0.3.0

- Sidebar interface (`/padspan-ha`) for advanced map tooling.
- Drag-to-move BLE scanner anchors.
- Anchor labels rendered on-canvas.
- Confidence heat circles for estimated BLE device positions.
- Map calibration wizard:
  - Start calibration
  - Capture reference points (image coords -> real coords)
  - Finish calibration (scale + rotation + translation)
- Room polygon drawing/editing in the sidebar.
- Multi-source BLE ingest with passive-capable mode.
- HACS-ready repository structure.

## Install with HACS

1. Upload this repository to GitHub.
2. In Home Assistant, open **HACS -> Integrations -> Custom repositories**.
3. Add your GitHub repository URL and choose **Integration**.
4. Install **PadSpan HA**.
5. Restart Home Assistant.
6. Add the integration from **Settings -> Devices & Services**.

## First-use checklist

1. Open **PadSpan HA** in the sidebar (`/padspan-ha`).
2. Upload a floorplan image.
3. Set active map.
4. Place scanner anchors (source IDs detected from BLE stream).
5. Enable calibration wizard and capture points.
6. Draw room polygons.
7. Confirm device heat circles appear as BLE data arrives.

## Services

- `padspan_ha.import_map_image`
- `padspan_ha.set_active_map`
- `padspan_ha.set_map_anchor`
- `padspan_ha.delete_map_anchor`
- `padspan_ha.set_room_polygon`
- `padspan_ha.delete_room`
- `padspan_ha.start_calibration`
- `padspan_ha.capture_calibration_point`
- `padspan_ha.finish_calibration`
- `padspan_ha.reload_ble_cache`

## Notes

- Use **Include passive BLE** in options when your Bluetooth source mostly emits non-connectable advertisements.
- Place at least 2-3 anchors for reliable map positioning.
