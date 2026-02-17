# PadSpan (Home Assistant) v0.3.12 clean single-domain build

This package intentionally includes only the required files for a stable custom integration load.

## Install path (exact)
`/config/custom_components/padspan_ha/manifest.json`

## Clean install
1. Stop Home Assistant
2. Delete old folders if they exist:
   - `/config/custom_components/padspan`
   - `/config/custom_components/padspan_ha`
3. Copy this package's `custom_components/padspan_ha` into `/config/custom_components/`
4. Start Home Assistant
5. Browser hard refresh (Ctrl+F5)

## Notes
- Integration card branding icon in HA is domain-brand based and may not use local files immediately.
- Panel/sidebar logos are bundled under `www/padspan-ha/assets`.
