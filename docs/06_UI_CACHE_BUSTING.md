# UI Cache Busting

Home Assistant serves custom panel JS/CSS aggressively cached by browsers.
We bust cache in two ways:

- `panel.py` appends `?v=<VERSION>` to the module URL.
- `panel.js` loads CSS with `?v=<VERSION>&b=<BUILD_ID>`.

If you still see old UI after copying files:
- Perform a hard refresh (Ctrl+F5).
- Clear cache for your HA URL.
- Confirm the build stamp in Diagnostics.
