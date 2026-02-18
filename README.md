# PadSpan HA (Home Assistant Custom Integration)

Version: **0.4.1**

## What’s in this zip
- Full Home Assistant custom integration: `custom_components/padspan_ha`
- Sidebar panel (single HA sidebar entry "PadSpan HA") with internal menu
- WebSocket endpoints used by the panel:
  - `padspan_ha/status`
  - `padspan_ha/room_tags`
  - `padspan_ha/auto_diagnostics`
  - `padspan_ha/version`
  - `padspan_ha/settings_get`
  - `padspan_ha/settings_set`
  - `padspan_ha/live_snapshot`
  - `padspan_ha/maps_list`
  - `padspan_ha/maps_upload`
  - `padspan_ha/maps_update`
  - `padspan_ha/maps_delete`

## Install (HA OS)
1. Stop Home Assistant
2. Remove any old folders:
   - `/config/custom_components/padspan`
   - `/config/custom_components/padspan_ha`
3. Copy `custom_components/padspan_ha` into `/config/custom_components/`
4. Start Home Assistant
5. Hard refresh the browser (Ctrl+F5)

## Diagnostics (copy/paste)
Open **PadSpan HA** in the sidebar → open **Diagnostics** view → copy the JSON blob.

## Notes
Cloud is optional and disabled by default. This build is **local-first**.

## Live vs Sample data switch
- Top-right of the PadSpan panel header: **Data: Sample / Live**
- **Sample** uses built-in demo data so you can validate UI quickly.
- **Live** runs a best-effort discovery pass against your HA Areas/Devices/Entities (Bermuda-first heuristics) and populates:
  - Rooms (HA Areas)
  - Radios/Receivers (Bluetooth/Proxy/Bermuda/ESP32 heuristic)
  - Tags seen (entities whose state matches a room/area)

## Mapping suite
Open **Maps** in the internal menu:
- **Upload**: accept any image type; auto-resize to max dimension (default 1600) and store as PNG.
- **Edit**: double-click to add receivers; drag to reposition; save.
- **Export**: download PNG + JSON (receiver layout + metadata)

Where files are stored:
- Map PNGs are saved to: `/config/www/padspan_ha/maps/`
- They are served by HA at: `/local/padspan_ha/maps/<map_id>.png`

---

## Repository logic (maintainer notes)

This repo contains a **full logic trail** so it’s understandable after long breaks.

Start here:
- `docs/00_REPO_LOGIC_OVERVIEW.md`

Then:
- `docs/01_ARCHITECTURE.md`
- `docs/02_WEBSOCKET_API.md`
- `docs/03_MAPPING_SUITE.md`
- `docs/04_LIVE_DISCOVERY.md`
- `docs/90_TROUBLESHOOTING.md`

### Why we bias toward websockets
We use `hass.callWS(...)` as the primary UI API because it is stable across Home Assistant releases and avoids auth/cors issues.

### Why receiver coordinates are normalized
Receiver positions are stored as x/y in [0..1] relative to image width/height, so resizing does not break placement.

### Common gotcha: caching
If UI changes do not appear after install, hard refresh the browser.



## Proving you are on the right build
Open **Diagnostics** inside the panel. It shows:
- UI: v0.4.1 • build <ID>
- Backend: version + build_id
If those are not v0.4.1, you still have an old install or cached JS.
