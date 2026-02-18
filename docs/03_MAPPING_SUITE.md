# Mapping Suite

## What exists now
- Upload a floorplan (PNG/JPG/WEBP/GIF)
- Convert to a working PNG (consistent rendering)
- Resize to max dimension (performance)
- Map list (open/delete/export)
- Map editor:
  - pan/zoom
  - add receivers (dbl-click)
  - drag receivers
  - delete (right click)
  - save receivers
- Export:
  - PNG (download)
  - JSON (metadata)

## Storage
- PNG images: `/config/www/padspan_ha/maps/<map_id>.png`
- Metadata store: `.storage/padspan_ha.maps`

## Planned next steps
- Layered maps (physical/radio/distortion/combined)
- Room polygons
- Heatmap visualization
- Receiver calibration per room
- Import receiver templates/presets

