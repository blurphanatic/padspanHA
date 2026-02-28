# PadSpan HA — Alpha Exit Announcements (March 2026)

Copy-paste these into the relevant platforms. Adjust tone as needed.

---

## 1. Home Assistant Community Forum (community.home-assistant.io)

**Category:** Share your Projects!
**Title:** PadSpan HA — Room-level BLE presence tracking is coming out of alpha in March

---

Hey everyone,

I've been building **PadSpan HA** — a custom integration that turns your existing Bluetooth scanners into a full room-level presence tracking system — and it's coming out of alpha in **March 2026**.

This started as a personal project because I wanted more than just "home" or "away." I wanted to know *which room* my phone was in, see it on a floor plan, and get alerts when my kids' trackers moved between rooms. Nothing out there did all of that, so I built it.

**What's in the box right now (alpha):**

- Room-level BLE tracking with 5-second updates
- Upload your floor plans and draw room boundaries right in the UI
- 3D multi-floor isometric maps with live object positions
- Walk-around calibration system (k-NN fingerprint + path-loss modeling)
- Follow mode — pick any tag and watch it move room to room
- Email alerts when a tracked device changes rooms
- 21 dedicated views (Basic mode for simplicity, Advanced for power users)
- Full HA entities — area sensors, distance sensors, device trackers, binary sensors
- Works with ESPresense, Bermuda proxies, or any HA Bluetooth proxy
- Sample mode so you can explore every feature before plugging in hardware
- 11 languages

**What's coming for the beta launch:**

More details soon, but think: tighter HA dashboard integration, automation blueprints, and some things I'm not ready to talk about yet.

**Screenshots:**

![3D Stack tracking](https://raw.githubusercontent.com/gbroeckling/padspanHA/main/images/3d-stack-tracking.png)

![Floor plan editor](https://raw.githubusercontent.com/gbroeckling/padspanHA/main/images/floor-plan-edit.png)

![Training Hub](https://raw.githubusercontent.com/gbroeckling/padspanHA/main/images/training-hub.png)

**Links:**
- GitHub: https://github.com/gbroeckling/padspanHA
- Install via HACS (custom repository) if you want to try the alpha now

Would love feedback from anyone who tries it. More coming in March.

---

## 2. Reddit — r/homeassistant

**Title:** PadSpan HA — room-level BLE presence tracking with floor plans, 3D maps, and calibration — coming out of alpha in March

---

I've been working on **PadSpan HA**, a custom Home Assistant integration for room-level Bluetooth presence tracking, and it's exiting alpha in **March 2026**.

Quick rundown of what it does:

- Tells you **which room** every BLE device is in (not just home/away)
- Upload floor plans, draw room boundaries, place your scanners on the map
- **3D multi-floor visualization** with live tracked objects
- Walk-around **calibration system** — collect fingerprints, fit a model, validate accuracy
- **Follow mode** with animated room map and email alerts
- 21 views, Basic + Advanced modes, sample/demo mode
- Creates real HA entities (area sensors, distance sensors, device trackers)
- Works with ESPresense, Bermuda proxies, or HA Bluetooth proxies
- 11 languages, dark theme, standalone phone panel for calibration

It's been my passion project for a few months and I think it's the most feature-complete BLE presence UI for HA. The alpha is available now via HACS (custom repo), and the March release will be the first beta with some new capabilities I'll announce soon.

Screenshots: https://github.com/gbroeckling/padspanHA

Feedback welcome — especially from anyone running ESPresense or multiple BLE proxies.

---

## 3. Reddit — r/ESPHome

**Title:** Built a HA integration that turns your ESPresense/BLE proxy network into a full room tracking system — PadSpan HA exiting alpha in March

---

If you're running ESPresense nodes or ESP32 Bluetooth proxies, you might be interested in **PadSpan HA** — a custom HA integration I've been building that takes your scanner network and builds a complete room-level presence tracking system on top of it.

**What it adds on top of your existing BLE scanners:**

- Room-level tracking (which room, not just home/away) — 5s updates
- Upload your floor plans and draw room polygons
- 3D isometric multi-floor maps showing where every tracked device is
- Calibration: walk around your house, collect fingerprints, auto-fit a k-NN model
- Per-scanner signal quality metrics, WiFi SSID/IP display
- Follow any device with an animated room map + email alerts on room change
- Full HA entities for automations

It works with whatever BLE scanner setup you already have — ESPresense, Bermuda, or plain HA Bluetooth proxies. No firmware changes needed.

Coming out of alpha in **March 2026**. More details on the beta soon. You can try the alpha now:

GitHub: https://github.com/gbroeckling/padspanHA
Install: HACS → Custom repositories → Integration

---

## 4. Reddit — r/home_automation

**Title:** PadSpan HA — know which room every Bluetooth device is in, with floor plans and 3D maps. Coming out of alpha in March.

---

Built a Home Assistant integration called **PadSpan HA** that does room-level Bluetooth presence tracking. Not just "home" or "away" — it tells you which specific room a phone, AirTag, key fob, or any BLE device is in, updated every 5 seconds.

You upload your floor plans, draw room boundaries, place your Bluetooth scanners on the map, and it handles the rest — including a calibration system where you walk around collecting signal fingerprints to improve accuracy.

It has 21 different views, 3D multi-floor visualizations, email alerts when devices change rooms, and creates real Home Assistant entities you can use in automations.

**Coming out of alpha in March 2026.** Available now for early testing via HACS.

GitHub: https://github.com/gbroeckling/padspanHA

---

## 5. Home Assistant Discord — #share-your-projects

---

**PadSpan HA** — room-level BLE presence tracking for Home Assistant — is coming out of alpha in **March 2026** :tada:

Upload floor plans. Draw room boundaries. See where every Bluetooth device is on a 3D multi-floor map. Walk-around calibration. Follow mode with email alerts. 21 views. 11 languages. Works with ESPresense, Bermuda, or HA BLE proxies.

Try the alpha now: https://github.com/gbroeckling/padspanHA

More details on the beta coming soon.

---

## 6. ESPHome Discord — #projects or #showcase

---

If you're running ESP32 BLE scanners — **PadSpan HA** is a Home Assistant integration that turns your scanner network into a full room-level tracking system with floor plans, 3D maps, and a calibration system.

Coming out of alpha in **March 2026**. Works with ESPresense nodes and HA Bluetooth proxies — no firmware changes.

https://github.com/gbroeckling/padspanHA

---

## Where to Post

| Platform | URL | Section |
|----------|-----|---------|
| HA Community Forum | https://community.home-assistant.io | Share your Projects! |
| r/homeassistant | https://reddit.com/r/homeassistant | New post |
| r/ESPHome | https://reddit.com/r/ESPHome | New post |
| r/home_automation | https://reddit.com/r/home_automation | New post |
| HA Discord | https://discord.gg/home-assistant | #share-your-projects |
| ESPHome Discord | https://discord.gg/esphome | #projects / #showcase |
| GitHub Discussions | https://github.com/gbroeckling/padspanHA/discussions | Announcements |
