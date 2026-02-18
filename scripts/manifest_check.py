"""Quick sanity check for local development."""
import json, pathlib
m=pathlib.Path('custom_components/padspan_ha/manifest.json')
print(json.loads(m.read_text()).get('version'))
