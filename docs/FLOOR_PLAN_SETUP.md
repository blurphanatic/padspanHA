# Floor Plan Setup Guide

This guide covers uploading floor plans, drawing room boundaries, and placing scanner markers for accurate room-level tracking.

## Uploading a Floor Plan

1. Go to **Maps** → **Upload** tab
2. Click **Choose file** and select a PNG or JPG image (max 20MB)
3. Give your map a name (e.g., "Ground Floor", "Upstairs")
4. Click **Upload**

### Tips for good floor plans
- Architectural blueprints work best — straight walls, clear room labels
- Even a hand-drawn sketch on paper, photographed, works fine
- Higher resolution = more precise room boundaries
- One map per floor if you have multiple levels

## Drawing Room Boundaries

1. Go to **Maps** → select your uploaded map
2. Click a room in the **room list** on the right (rooms come from your HA Area Registry)
3. Click points on the map to draw a polygon around that room
4. Close the polygon by clicking near the first point
5. Repeat for each room

### Why this matters
PadSpan uses these boundaries to visualize which room a device is in on the floor plan. The boundaries also inform the 3D isometric multi-floor view.

## Placing Scanner Markers

1. In the map view, find the **scanner placement** section
2. Drag each scanner marker to its physical location on the floor plan
3. PadSpan shows a 3-digit short ID on each marker for quick identification

### Placement tips
- Place scanners **inside the rooms** you want to track, not in hallways
- **3+ scanners** gives reliable room discrimination
- Spread scanners so their coverage areas overlap slightly
- Avoid placing scanners behind large metal objects or thick walls

## Multi-Floor Setup

If you have multiple floors:
1. Upload one map per floor
2. Assign rooms to the correct floor in HA's Area Registry
3. Use the **3D Stack** view (Maps → 3D tab) to see all floors stacked with live object positions

## Scanner Network Info

In the **QA** → **Radio Analysis** card, you can verify each scanner's:
- IP address and WiFi SSID
- Connection type (wired vs wireless)
- Signal quality and device count
- Health status relative to other scanners

This helps diagnose placement issues — if one scanner sees significantly fewer devices than its neighbors, it may need to be repositioned.
