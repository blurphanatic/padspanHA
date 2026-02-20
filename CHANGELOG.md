<!-- Branch-dump packaging: manifest/version pinned to 0.4.2 per request (no zip_release). -->
# Changelog

## 0.4.15

- Packaging cleanup for HACS (icons, install path, consistent cache-busting)
- No functional changes to BLE/object UI in this bump

## 0.4.14 — 2026-02-19

- Overview: every metric links to a list modal (Rooms, Objects, Unidentified, Radios).
- Live snapshot: now includes `ble.radios` and `ble.advertisements`.
- Objects inventory:
  - union list of Entity objects + deduped BLE addresses
  - filters + OUI frequency badge (≥3 occurrences)
  - "Unidentified" list (BLE addresses not linked to a HA device/entity)
- Vendor lookup (best-effort online):
  - new WS command `padspan_ha/vendor_lookup`
  - caches by OUI prefix for 30 days, rate-limited
