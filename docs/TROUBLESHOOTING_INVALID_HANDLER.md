# Troubleshooting: Invalid handler specified

If Home Assistant shows:

`Config flow could not be loaded: {"message":"Invalid handler specified"}`

Use this clean build and ensure:

1. Final install path is exactly:
   `/config/custom_components/padspan_ha/manifest.json`
2. Remove any duplicate folder names (e.g. `padspanHA_v0.x.x/...`) under `custom_components`.
3. Restart Home Assistant after copy.
4. If still failing, remove old folder, restart, copy again, restart again.

This build minimizes import-time dependencies for config-flow loading and avoids Python 3.10-only `|` type annotations.
