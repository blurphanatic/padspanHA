# Changelog

## 0.5.75 — 2026-02-27

Major feature release with 30+ versions of improvements since 0.4.x.

### Presence & Tracking
- **Follow mode** — animated room map, movement timeline, multi-device simultaneous tracking
- **Email alerts** on room change (per-device, 60s rate limit, persistent config)
- **Kalman-filtered RSSI smoothing** replacing simple EMA for smoother room transitions
- **Private BLE address resolution** — iBeacon UUID parsing + IRK support for rotating addresses
- **HA entities** — area sensors, distance sensors, device trackers, binary sensors per tracked device
- **Home/away persistence** — binary sensors survive HA restarts

### Floor Plans & Maps
- **Floor plan editor** — upload PNG/JPG, draw room boundary polygons over blueprints
- **3D isometric multi-floor visualization** with live object positions and room labels
- **Scanner markers** — drag-and-place with 3-digit radio short IDs
- **Stale radio detection** — auto-detect and flag radios no longer in your BLE network
- **Scanner network info** — WiFi SSID, IP address, connection type displayed in radio lists

### Calibration
- **Full calibration system** — walk-around fingerprint collection with standalone phone panel
- **k-NN fingerprint matching** + **OLS path-loss model** fitting per scanner
- **Coverage heatmap** with guided next-target suggestions for optimal data collection
- **Leave-one-out cross-validation** for model quality scoring
- **3D isometric tune view** with draggable receiver markers

### UI & Experience
- **21 dedicated views** across Basic and Advanced modes
- **Training Hub** with guided walkthroughs for setup, calibration, and daily use
- **Sample mode** — fully functional demo with synthetic data, no hardware required
- **11 languages** — EN, ES, FR, DE, IT, PT, NL, ZH, JA, KO, RU
- **Dark forest-green theme** designed for ambient/always-on displays
- **Object tagging** — label BLE devices with friendly names, OUI vendor lookup

### Backend
- **DataUpdateCoordinator** polling live BLE snapshot every 10s
- **WebSocket API** for all frontend communication (no REST endpoints)
- **Persistent stores** for settings, maps, objects, calibration, and alert configs
- **Distance estimation** — configurable reference power and path-loss exponent

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
