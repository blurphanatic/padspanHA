# PadSpan HA (Home Assistant Custom Integration)

Version: **0.3.24**

## What’s in this zip
- Full Home Assistant custom integration: `custom_components/padspan_ha`
- Sidebar panel (single HA sidebar entry "PadSpan") with internal menu
- WebSocket endpoints used by the panel:
  - `padspan_ha/status`
  - `padspan_ha/room_tags`
  - `padspan_ha/auto_diagnostics`
  - `padspan_ha/version`

## Install (HA OS)
1. Stop Home Assistant
2. Remove any old folders:
   - `/config/custom_components/padspan`
   - `/config/custom_components/padspan_ha`
3. Copy `custom_components/padspan_ha` into `/config/custom_components/`
4. Start Home Assistant
5. Hard refresh the browser (Ctrl+F5)

## Diagnostics (copy/paste)
Open **PadSpan** in the sidebar → open **Diagnostics** view → copy the JSON blob.

## Notes
Cloud is optional and disabled by default. This build is **local-first**.

## Maps (Mapping suite – 0.3.24)
Open **PadSpan → Maps**.

Features:
- Upload a floorplan image (PNG/JPG/WEBP/GIF) → auto-resized working PNG
- Map library (Open / Download PNG / Download JSON / Delete)
- Map editor:
  - Zoom/pan
  - Drop BLE receivers on the map (double-click)
  - Drag receivers to reposition
  - Delete receiver (right click)
  - Save receiver placements (normalized coordinates)
  - Optional grid and snap
  - Calibration tool (px-per-meter) via 2-point reference line

Storage:
- Images: `/config/www/padspan_ha/maps/<id>.png` (served as `/local/padspan_ha/maps/<id>.png`)
- Metadata: `.storage/padspan_ha.maps`

Auth API endpoints:
- `GET/POST /api/padspan_ha/maps`
- `GET/PUT /api/padspan_ha/maps/<id>/meta`
- `GET /api/padspan_ha/maps/<id>/file`
- `DELETE /api/padspan_ha/maps/<id>`
