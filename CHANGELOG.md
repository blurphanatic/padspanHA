# Changelog

## 0.2.7
- Fix: robust config flow/options flow (prevents common 500 load failures from broken flow scaffolding).
- Fix: allow multiple config entries (removed single-entry behavior).
- Fix: improved BLE ingest with passive mode option and cache bootstrap.
- Feature: map image import service.
- Feature: map anchor service with source mapping (multi-hub/scanner).
- Feature: dynamic device tracker entities with estimated map x/y attributes.
- Feature: diagnostics sensors (scanner counts, active devices, map/anchor counts).
- Feature: `reload_ble_cache` service.
