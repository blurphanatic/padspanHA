#!/bin/sh
set -eu
BASE="/config/custom_components/padspan_ha"
echo "Checking $BASE..."
[ -d "$BASE" ] || { echo "Missing folder"; exit 1; }
[ -f "$BASE/manifest.json" ] || { echo "Missing manifest.json"; exit 1; }
[ -f "$BASE/config_flow.py" ] || { echo "Missing config_flow.py"; exit 1; }
echo "OK: core files found."
echo "If invalid handler persists, check HA logs for:"
echo "custom_components.padspan_ha.config_flow"
