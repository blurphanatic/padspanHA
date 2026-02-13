# PadSpan HA (v0.2.6)

Home Assistant custom integration for BLE discovery diagnostics + map image anchoring (PadSpan HA track).

## What this version includes

- Passive BLE ingestion (`connectable: false`) so devices visible via Bermuda/proxies are included.
- BLE cache bootstrap + manual service to reload cache.
- Diagnostic metrics:
  - Scanner Count (All)
  - Scanner Count (Connectable)
  - BLE Devices Seen (Ever)
  - BLE Devices Active (Now)
- `device_tracker` entities for discovered BLE devices.
- Map image import and anchor placement services:
  - `padspan_ha.import_map_image`
  - `padspan_ha.set_map_anchor`

---

## HACS install (Custom repository)

1. Push this repo to GitHub.
2. In Home Assistant:
   - **HACS → Integrations → ⋮ (menu) → Custom repositories**
   - Repository: `https://github.com/<your-user>/padspanHA`
   - Category: **Integration**
3. Find **PadSpan HA** in HACS and install.
4. Restart Home Assistant.
5. Go to **Settings → Devices & Services → Add Integration** and add **PadSpan HA**.

---

## Required repository layout

This package is already structured correctly:

```
<repo root>/
  custom_components/
    padspan_ha/
      manifest.json
      ...
  hacs.json
  README.md
```

---

## Initial service calls

### 1) Reload BLE cache
```yaml
service: padspan_ha.reload_ble_cache
data: {}
```

### 2) Import a floor/map image
```yaml
service: padspan_ha.import_map_image
data:
  map_id: main_floor
  source_path: www/maps/main_floor.png
  overwrite: true
```

### 3) Add/update anchor coordinates
```yaml
service: padspan_ha.set_map_anchor
data:
  map_id: main_floor
  anchor_id: bermuda_office
  x: 390
  y: 145
  z: 0
  weight: 1.0
```

---

## Notes

- Imported map images are copied to:
  `/config/www/padspan_ha/<entry_id>/...`
- They become available to dashboards as:
  `/local/padspan_ha/<entry_id>/...`
- Replace the placeholder GitHub links in `manifest.json` with your real repository URL before publishing.
