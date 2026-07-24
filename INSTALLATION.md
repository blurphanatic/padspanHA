# Installation / Update (IMPORTANT)

## Option A: Recommended: extract into `/config` (HA OS)
1. Download the ZIP
2. Extract it into your Home Assistant `/config` folder (NOT `/config/custom_components`)
   - The ZIP contains `custom_components/padspan_ha/...`
3. Restart Home Assistant
4. Hard-refresh the browser (Ctrl+Shift+R)

## Option B: Manual copy
Copy this folder:
`custom_components/padspan_ha`
to:
`/config/custom_components/padspan_ha`

When updating an existing install, delete the old `padspan_ha` folder first so no
stale files are left behind, then copy the new one in. Restart HA and hard-refresh
the browser (Ctrl+Shift+R) afterwards.

### Common mistake
Do **NOT** end up with:
`/config/custom_components/custom_components/padspan_ha`
If you see that, move `padspan_ha` up one level.
