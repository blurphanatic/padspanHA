# PadSpan HA (v0.3.10)

This package is a **local-first** Home Assistant custom integration for PadSpan.

## Highlights in v0.3.10

- Cloud/API remains optional.
- Sidebar badges for cloud + integration health.
- Sidebar action: **Reconnect cloud now**.
- Diagnostics view in panel.
- New **Objects by Rooms** checklist:
  - Select rooms (checkboxes)
  - Object tags update from selected rooms
  - Mode switch: **ALL selected rooms** (intersection) or **ANY selected room** (union)

## Install

1. Copy `custom_components/padspan_ha` into your HA config `custom_components/`.
2. Restart Home Assistant.
3. Add integration: **Settings → Devices & Services → Add Integration → PadSpan HA**
4. Keep **Enable cloud hub connection** OFF for API-free startup (recommended first run).

## Integration card icon note

Home Assistant integration card logos are served from the official `home-assistant/brands` repo.
Bundling icons in this zip does not override that card automatically.
A brands PR starter asset folder is included in `docs/brands/...`.


## 0.3.7 hotfix
- Fix for Home Assistant error: `Config flow could not be loaded: {"message":"Invalid handler specified"}`.
- Simplified config flow imports and constants for broader HA compatibility.


## v0.3.10
- Added **Auto Diagnostics** in the Diagnostics page.
- Added backend WebSocket endpoint: `padspan_ha/auto_diagnostics`.
- Kept local-first startup, with compatibility-safe config flow.
- Added legacy `padspan` tombstone to reduce duplicate integration entries.
