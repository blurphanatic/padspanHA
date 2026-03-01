# Changelog

All notable changes to PadSpan HA are documented here.

---

## 0.5.88 — Beta Launch Prep (2026-02-28)

### Added
- **BLE data enrichment** — Objects now show decoded company names (Apple, Samsung, Google, Xiaomi, etc.), device types (Find My, AirPods, Nearby Info), and GATT service names (Battery, Tile, Device Information) as color-coded badges. Search by company or device type in the Objects tab.
- **QA Radio Analysis card** — Per-radio health scoring with activity metrics, cross-scanner overlap comparison, and network info (IP, SSID, WiFi signal)
- **Development disclosure** — README, CONTRIBUTING, and repo topics transparently describe AI-assisted development process
- CI tests — 36 automated tests for maps store, object store, config flow
- GitHub issue templates (bug report + feature request)
- CONTRIBUTING.md with development setup guide
- `connectable` flag captured per BLE advertisement

### Fixed
- **Security** — Escaped all user-controlled strings in overview, maps, and settings SVG innerHTML (XSS prevention)
- **Security** — Admin-only gating on destructive WebSocket handlers (maps delete, area delete, entity delete, calibration clear, integration reload)
- **Security** — Map upload 20MB size limit + path traversal protection on file operations
- **Mobile** — Tooltip overflow on small screens, input minWidth overflow, toolbar wrapping
- **Performance** — Visibility handler and modal ESC listener now properly cleaned up on disconnect (prevents memory leak in long sessions)
- `esc is not defined` error in maps.js 3D Stack view
- Radio Analysis identity section words running together
- Network info only showing for one radio (backend now tries source slug)

### Changed
- Radio health scoring only flags provable issues — "Unhealthy" for hard failures, "Fair" for ambiguous, "Healthy" otherwise
- `binary_sensor.py` proper `async_setup_entry` stub (was causing silent platform failure)
- Config flow exception handling narrowed from `Exception` to `(ValueError, TypeError)`

---

## 0.5.79 — Training Hub & Documentation (2026-02-27)

### Added
- **Training Hub** — Guided walkthroughs for Overview, Follow, Objects, Maps, Settings, and Calibration
- 9 new Manual sections covering all remaining views
- Calibration walkthrough with 4-step animated guide
- Marketing screenshots and launch documentation

---

## 0.5.77 — HACS & Hassfest Validation (2026-02-27)

### Added
- HACS validation CI workflow
- Hassfest validation CI workflow
- Brand icon for HACS store listing

### Fixed
- manifest.json key ordering and removed invalid `icon` key
- services.yaml removed invalid `response` key, added proper `target`
- Added `bluetooth` to `after_dependencies` in manifest

---

## 0.5.75 — Major Feature Release (2026-02-27)

### Presence & Tracking
- **Follow mode** — animated room map, movement timeline, multi-device simultaneous tracking
- **Email alerts** on room change (per-device, 60s rate limit, persistent config)
- **Kalman-filtered RSSI smoothing** replacing simple EMA for smoother room transitions
- **Private BLE address resolution** — iBeacon UUID parsing + IRK support for rotating addresses
- **HA entities** — area sensors, distance sensors, device trackers, binary sensors per tracked device
- **Home/away persistence** — binary sensors survive HA restarts
- **Distance estimation** — log-distance path-loss model with configurable reference power and exponent

### Floor Plans & Maps
- **Floor plan editor** — upload PNG/JPG, draw room boundary polygons over blueprints
- **3D isometric multi-floor visualization** with live object positions and room labels
- **Scanner markers** — drag-and-place with 3-digit radio short IDs
- **Stale radio detection** — auto-detect and flag radios no longer in your BLE network
- **Scanner network info** — WiFi SSID, IP address, connection type

### Calibration
- **Full calibration system** — walk-around fingerprint collection with standalone phone panel
- **k-NN fingerprint matching** + **OLS path-loss model** fitting per scanner
- **Coverage heatmap** with guided next-target suggestions
- **Leave-one-out cross-validation** for model quality scoring
- **3D isometric tune view** with draggable receiver markers

### UI & Experience
- **21 dedicated views** across Basic and Advanced modes
- **Training Hub** with guided walkthroughs
- **Sample mode** — fully functional demo with synthetic data
- **11 languages** — EN, ES, FR, DE, IT, PT, NL, ZH, JA, KO, RU
- **Dark forest-green theme** designed for ambient displays
- **Object tagging** — label BLE devices with friendly names, OUI vendor lookup

### Backend
- **DataUpdateCoordinator** polling live BLE snapshot every 10s
- **WebSocket API** for all frontend communication
- **Persistent stores** for settings, maps, objects, calibration, and alert configs

---

## 0.4.x — Foundation (2026-02)

### Added
- Initial integration scaffold with config flow
- Basic BLE scanning via HA Bluetooth component
- Live snapshot with radios and advertisements
- Objects inventory with deduplication and OUI frequency badges
- Vendor lookup via MACVendors + MACLookup APIs (cached 30 days)
- Packaging for HACS (icons, install path, cache-busting)
