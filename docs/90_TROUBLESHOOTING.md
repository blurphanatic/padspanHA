# Troubleshooting

## “Config flow could not be loaded” / 500 on gear icon
This is almost always an **import-time error**.

Checklist:
1) Confirm folder name matches domain:
   - `/config/custom_components/padspan_ha/`
   - `manifest.json: { "domain": "padspan_ha" }`
2) Confirm `config_flow.py` exists and defines the handler class
3) Confirm all new files were copied (zip overwrite)
4) Restart HA after updates
5) Check HA logs for a stack trace referencing `padspan_ha`

## Sidebar / UI not updating
Usually browser cache.
- Hard refresh (Ctrl+Shift+R)
- Or open private window

Also confirm `manifest.json` version matches expected.

## Panel missing
Confirm `panel.py` registers ONE panel and only one.
Check WS diagnostics.

## “Nothing changed after zip install”
Most likely you updated only some files.
This repo is designed to ship as a **full zip** every time.

Compare `FILE_MANIFEST.txt` after install to ensure all files were replaced.

