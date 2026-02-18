# Versioning and No-Revert Rule

PadSpan HA is a long-running project. The #1 operational risk we've hit is **accidental reverts** (shipping a zip built from an older baseline).

This repo enforces a "prove the build" standard:

- **UI** shows: `vX.Y.Z • build <BUILD_ID>` in the left brand header.
- **Backend** returns: `padspan_ha/version -> {version, build_version, build_id}`.
- **Diagnostics** page shows both UI + backend stamps. If they don't match what you expect, you're not running the code you think you are.

## When changes don't show up

1. Remove duplicate installs:
   - HACS install of `padspan_ha` AND manual `/config/custom_components/padspan_ha` at the same time
   - Old `/config/custom_components/padspan` directory (legacy domain)

2. Restart Home Assistant.

3. Hard refresh browser (Ctrl+F5) to bypass cached JS.

4. Open Diagnostics and confirm:
   - UI stamp is correct
   - Backend stamp is correct

Only then should we debug features.
