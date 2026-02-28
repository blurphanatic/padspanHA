Hey everyone,

I've been building **PadSpan HA** — a custom integration that turns your existing Bluetooth scanners into a full room-level presence tracking system — and it's coming out of alpha in **March 2026**.

This started as a personal project because I wanted more than just "home" or "away." I wanted to know *which room* my phone was in, see it on a floor plan, and get alerts when my kids' trackers moved between rooms. Nothing out there did all of that, so I built it.

## What's in the alpha right now

- **Room-level BLE tracking** with 5-second updates (not just home/away)
- Upload floor plans and **draw room boundary polygons** right in the UI
- **3D multi-floor isometric maps** with live object positions
- Walk-around **calibration system** — k-NN fingerprint matching + path-loss model fitting
- **Follow mode** — pick any tag, watch it move room to room with an animated map
- **Email alerts** when a tracked device changes rooms
- **21 dedicated views** (Basic mode for simplicity, Advanced for power users)
- Full **HA entities** — area sensors, distance sensors, device trackers, binary sensors
- Works with **ESPresense, Bermuda proxies, or any HA Bluetooth proxy**
- **Sample mode** — explore every feature with synthetic data before plugging in hardware
- **11 languages** (EN, ES, FR, DE, IT, PT, NL, ZH, JA, KO, RU)
- Standalone **phone-friendly calibration panel** for walk-around data collection
- Per-scanner **signal quality metrics**, WiFi SSID/IP display
- Built-in **Training Hub** with guided walkthroughs

## Screenshots

### 3D Multi-Floor Tracking
![3D Stack tracking|690x388](https://raw.githubusercontent.com/gbroeckling/padspanHA/main/images/3d-stack-tracking.png)

### Floor Plan Editor
![Floor plan editor|690x388](https://raw.githubusercontent.com/gbroeckling/padspanHA/main/images/floor-plan-edit.png)

### Maps Library
![Maps library|690x388](https://raw.githubusercontent.com/gbroeckling/padspanHA/main/images/maps-library.png)

### Training Hub
![Training Hub|690x388](https://raw.githubusercontent.com/gbroeckling/padspanHA/main/images/training-hub.png)

## What's coming for the beta

More details soon — but think tighter HA dashboard integration, automation blueprints, and some things I'm not ready to talk about yet.

## Try the alpha now

1. HACS → Custom repositories → add `gbroeckling/padspanHA` (Integration)
2. Install **PadSpan HA** → Restart HA
3. Settings → Devices & Services → Add Integration → PadSpan HA

Feedback and bug reports welcome — drop them here or [open an issue on GitHub](https://github.com/gbroeckling/padspanHA/issues).

---

GitHub: https://github.com/gbroeckling/padspanHA

*More coming in March.*
