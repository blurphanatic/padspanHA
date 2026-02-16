# padspanHA v0.3.2

Home Assistant custom integration starter for PadSpan.

## Features in this package
- HACS-ready custom component skeleton.
- Web panel with a **working sidebar** (collapse/expand, active state, keyboard shortcut `[`).
- Map canvas placeholder and calibration wizard shell.
- BLE observation endpoint stubs for future trilateration logic.

## Install (developer)
1. Copy `custom_components/padspan_ha` to your HA config `custom_components` folder.
2. Restart Home Assistant.
3. Add integration from UI (or load by domain in dev).
4. Open panel: `/padspan-ha`.

## Files
- `custom_components/padspan_ha/manifest.json` versioned 0.3.2
- `custom_components/padspan_ha/www/padspan-ha/` static frontend
