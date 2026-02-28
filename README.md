# PadSpan™ HA

**BLE room-level presence tracking for Home Assistant**

PadSpan™ HA is a custom Home Assistant integration that adds whole-home Bluetooth Low Energy (BLE) presence tracking. It turns your existing Bluetooth scanners (ESPresense, Bermuda, or similar) into a real-time people and object tracking system.

Unlike basic presence detection that only knows if someone is home or away, PadSpan™ tells you which room a person or device is in — and updates every 5 seconds.

## Features

- **Room-level tracking** — know exactly which room every BLE device is in
- **Live floor plans** — draw room boundaries, upload maps, build multi-floor 3D visualisations
- **Follow mode** — track a specific tag with animated room map and movement log
- **Calibration** — fingerprint-based k-NN positioning for high accuracy
- **Email alerts** — get notified when a tracked device changes rooms
- **Scanner management** — assign scanners to floors, view signal quality and coverage
- **Sample mode** — fully functional demo to explore the UI before going live

## Installation

### Via HACS (recommended)

1. Add this repository as a custom repository in HACS
2. Install **PadSpan™ HA**
3. Restart Home Assistant completely (not just reload)
4. Add the integration via Settings → Devices & Services → Add Integration → PadSpan HA

### Manual

1. Copy `custom_components/padspan_ha/` to your HA `custom_components/` directory
2. Restart Home Assistant
3. Add the integration via Settings → Devices & Services

## What's in this repository

- `custom_components/padspan_ha/` — the integration (Python backend)
- `custom_components/padspan_ha/www/padspan-ha/` — the frontend panel (JavaScript)

## Requirements

- Home Assistant 2024.1+
- At least one BLE scanner (ESPresense, Bermuda, or Bluetooth proxy)
- HACS (for easy installation)

## License

Copyright (C) 2026 Garry Broeckling. Licensed under the [GNU General Public License v3.0](LICENSE).

PadSpan is a trademark of Garry Broeckling.

---

This project is under active development.
