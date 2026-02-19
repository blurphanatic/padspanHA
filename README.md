# PadSpan HA

PadSpan HA is a Home Assistant custom integration for BLE presence / mapping experiments (PadSpan).

## What’s in this repository

- `custom_components/padspan_ha/` – the integration
- `custom_components/padspan_ha/www/padspan-ha/` – the frontend panel

## HACS

This repo is intended to be installable through HACS as a custom repository.

## Notes

This project is under active development.

---
## HACS updates (zip_release)
This repository is configured for HACS **zip_release** installs.

- `hacs.json` sets `zip_release: true` and `filename: padspan_ha.zip`.
- When you create a GitHub Release (tag e.g. `0.4.12`), attach an asset named **`padspan_ha.zip`**.
- If you enable the included GitHub Action (`.github/workflows/release.yml`), pushing a tag will automatically build and attach `padspan_ha.zip` to the release.
