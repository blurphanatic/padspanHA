# PadSpan HA Maps – 0.3.24

## Best practices applied
- Convert uploads into a **standard working PNG**
- Resize on upload to a **known max dimension** for performance
- Store receiver positions as **normalized 0..1** coordinates so resizing doesn't break placement
- Keep **calibration** as separate metadata (px-per-meter) so recalibrating doesn’t move receivers
- Store sha256 hashes to support cache-busting and change tracking

## What’s in the UI
- Maps library: Open / Download PNG / Download JSON / Delete
- Map editor: pan/zoom, add/drag/delete receivers, grid/snap toggles
- Calibration: double-click two points → enter meters → saves px_per_meter

## Next mapping features we can add
- Multiple map layers (physical/radio/distortion/combined)
- Per-room polygons and “rooms view”
- Receiver coverage visualization (heatmap mock)
- Import/export receiver sets as presets
