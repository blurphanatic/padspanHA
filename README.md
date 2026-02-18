# PadSpan HA (Home Assistant Custom Integration)

Version: **0.3.23**

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
