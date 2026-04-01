# PadSpan HA — Reddit Campaign (April 2026)

5-day rollout, one subreddit per day. Each post leads with a different feature angle
to avoid cross-post fatigue. All posts reference v0.19 as the current release.

Image links use raw GitHub URLs — attach screenshots directly when posting on Reddit
for better engagement.

---

## Day 1 (Tuesday) — r/homeassistant

**Flair:** Integration
**Title:** PadSpan HA v0.19 — room-level BLE tracking with Device Registry, occupancy estimation, and a full onboarding wizard

---

Six months ago I posted about PadSpan HA during its alpha. Since then I've been heads-down on stability and features, and v0.19 is a different animal. Here's what's new:

**Device Registry** — BLE devices rotate MAC addresses constantly (especially Apple). PadSpan now assigns every device a stable `padspan_id` that survives MAC rotation, iBeacon UUID changes, and firmware updates. You label a device once and it stays labeled forever, even across HA restarts.

**Occupancy Estimation** — New dedicated view that counts how many people are in each room. It combines identified devices (1:1) with unidentified BLE signals using a trainable multiplier. Enter the actual headcount once in a while and it learns your space.

**Onboarding Wizard** — A persistent progress bar that walks you through the full setup: upload floor plan, set scale, draw rooms, place scanners, calibrate. Each step auto-completes when it detects the data. Click any step to jump directly to the right view.

**Positioning Fabric** — Scanner positions, room geometry, and RF barriers now live in a real-world metre-space model, decoupled from any single floor plan. This means multi-floor calibration data doesn't break when you replace a floor plan image.

**Everything else from the last month:**
- Multi-floor accuracy learning with dwell-based velocity gates
- Traceback playback — NVR-style movement replay for any device
- BLE data enrichment — decoded company names, device types, GATT services
- Training Hub with guided walkthroughs for every view
- 22 views across Basic/Advanced/Dev modes
- Persistent safe saves with write verification (no more lost config)
- 11 languages, dark theme, works with ESPresense / Bermuda / HA BLE proxies

Still 100% local, no cloud, no subscription. Install via HACS.

**Screenshots:** https://github.com/gbroeckling/padspanHA

I'm actively looking for testers — especially anyone running 3+ BLE scanners across multiple floors. Feedback welcome.

---

## Day 2 (Wednesday) — r/ESPHome

**Title:** Turned my ESPresense network into a full room-tracking system — PadSpan HA v0.19 now has device identity, occupancy counting, and per-scanner diagnostics

---

If you're running ESPresense nodes or ESP32 BLE proxies and want more than just "home/away" — I built **PadSpan HA**, a Home Assistant integration that sits on top of your existing scanner network and gives you room-level tracking with floor plans.

**What's new in v0.19 (last month's work):**

**For your scanner network specifically:**
- Per-scanner health scoring with activity metrics, WiFi SSID/IP, signal strength
- Cross-scanner overlap analysis — see which scanners cover the same rooms
- QA Radio Analysis card for each scanner in your network
- Scanner positions stored in real-world metres — swap a floor plan image and all your scanner placements survive

**For tracking:**
- Stable device identity that survives MAC rotation (Apple devices, iPhones, etc.)
- Occupancy estimation per room (identified + unidentified BLE signals)
- Traceback playback — replay any device's movement like an NVR timeline
- BLE data enrichment: company names (Apple, Samsung, Xiaomi), device types (Find My, AirPods), GATT services
- Multi-floor accuracy learning with cross-floor attenuation corrections

**Setup:**
- Upload floor plans, draw rooms, place your ESPresense nodes on the map
- Walk-around calibration: collect fingerprints room by room, auto-fit k-NN model
- New onboarding wizard guides you through the whole process step by step

Works with ESPresense, Bermuda proxies, or HA Bluetooth proxies. No firmware changes needed. No cloud.

GitHub: https://github.com/gbroeckling/padspanHA
Install: HACS → Custom repositories → add the GitHub URL → Integration

Anyone running 3+ ESP32 scanners want to try it? Would love feedback on the scanner diagnostics.

---

## Day 3 (Thursday) — r/home_automation

**Title:** I built a system that tells you which room every Bluetooth device is in — not just "home" or "away." Here's what 6 months of work looks like.

---

Most presence detection gives you a binary: home or away. I wanted to know *which room* my phone was in, see my kids' AirTags move between rooms on a floor plan, and get alerts when someone enters the garage after bedtime.

Nothing did all of that, so I built **PadSpan HA** — a Home Assistant integration for room-level Bluetooth tracking. It runs entirely local, uses your existing BLE scanners (any ESP32 with Bluetooth), and has no cloud dependency.

**Here's what it actually looks like in practice:**

1. Upload your floor plans (any image — photo, blueprint, hand-drawn sketch)
2. Draw room boundaries right in the UI
3. Place your Bluetooth scanners on the map
4. Walk around collecting signal fingerprints for 15 seconds per room
5. Done — every BLE device now shows up in the correct room, updated every 5 seconds

**The things that surprised people when I demo'd it:**

- **3D multi-floor view** — stacked isometric floor plans with live device positions, like a building cross-section
- **Traceback playback** — pick any device and replay its movement through your house like rewinding a security camera, but for Bluetooth
- **Occupancy estimation** — "there are 4 people in the living room" based on BLE signals, with a trainable model you can correct
- **Follow mode** — tap any device and watch it move room to room with an animated floor plan

**What you need:**
- Home Assistant (any installation type)
- 2+ Bluetooth scanners (ESP32 with ESPresense, or HA Bluetooth proxies)
- HACS for installation

It's free, open source, and I'm actively developing it. v0.19 just dropped with stable device identity (survives MAC rotation), an onboarding wizard, and a real-world positioning fabric.

GitHub: https://github.com/gbroeckling/padspanHA

Happy to answer questions about setup, hardware recommendations, or how the tracking actually works under the hood.

---

## Day 4 (Friday) — r/selfhosted

**Title:** PadSpan HA — self-hosted room-level Bluetooth tracking with floor plans, 3D maps, and zero cloud dependency

---

Built a fully self-hosted room-level Bluetooth presence tracking system for Home Assistant. No cloud, no subscription, no phoning home. Everything runs on your HA instance.

**What it does:** Uses your existing BLE scanners (ESP32 boards) to determine which room every Bluetooth device is in — phones, AirTags, key fobs, fitness trackers, anything that broadcasts BLE. Updated every 5 seconds.

**Why I'm posting here:** This is the kind of thing that *should* be self-hosted but usually isn't. Commercial room tracking systems (Mist, Cisco Spaces, Aruba) cost thousands and phone home constantly. PadSpan runs on a Raspberry Pi.

**The self-hosted stack:**
- All data in HA's `.storage/` — no external database
- All processing local — k-NN fingerprint model, Kalman filtering, path-loss calculations
- No API keys, no accounts, no telemetry
- Persistent device identity that survives BLE MAC rotation locally
- Write-verified saves with read-back confirmation (your config doesn't silently disappear)

**What v0.19 added this month:**
- Device Registry with stable IDs across MAC rotation
- Occupancy estimation (people counting per room)
- Traceback playback (movement replay timeline)
- BLE data enrichment (device manufacturer, type, services — all decoded locally)
- Onboarding wizard for guided setup
- Real-world metre-space positioning model

**Hardware:** Any ESP32 board running ESPresense firmware (~$5 each). I use 3 per floor. HA Bluetooth proxies also work.

22 views, 11 languages, dark theme, full sample/demo mode to explore before committing hardware.

GitHub: https://github.com/gbroeckling/padspanHA
Install via HACS (custom repository).

---

## Day 5 (Saturday) — r/homeautomation

**Title:** PadSpan HA — the automation triggers you can build when you know which room everyone is in

---

I built a Home Assistant integration called **PadSpan HA** that tracks which room every Bluetooth device is in. Here's why that matters for automation:

**Automations that "home/away" can't do:**

- *Turn off the kitchen lights 2 minutes after everyone leaves the kitchen* (not the house — the kitchen)
- *Send a notification when the kids' AirTags leave the basement after 9pm*
- *Set the thermostat zone based on which rooms are actually occupied*
- *Announce on the living room speaker when someone enters the front hallway*
- *Auto-arm the garage alarm when no phones have been in the garage for 10 minutes*

PadSpan creates real HA entities — area sensors, device trackers, binary sensors — so these automations are just standard HA YAML or UI automations. No templates, no custom scripts.

**How it works:**
- You need 2-3 ESP32 Bluetooth scanners per floor (~$5 each)
- Upload your floor plans, draw room boundaries, place scanners
- Walk-around calibration: 15 seconds per room collecting signal fingerprints
- PadSpan builds a k-NN model and tracks every BLE device to the correct room

**What's new in v0.19 (released this month):**
- Stable device identity (Apple devices rotate MACs — PadSpan tracks through it)
- Occupancy counting per room (how many people, not just who)
- Onboarding wizard to get you from install to tracking in under 30 minutes
- Traceback — replay any device's path through your house
- 22 views, works with ESPresense / Bermuda / HA BLE proxies

Free, open source, 100% local. No cloud, no subscription.

GitHub: https://github.com/gbroeckling/padspanHA

What automations would you build if you knew which room every device was in?

---

## Posting Schedule

| Day | Subreddit | Angle | Best Image |
|-----|-----------|-------|------------|
| Tue | r/homeassistant | Full feature update (technical audience) | overview-3d-multifloor.jpg |
| Wed | r/ESPHome | Scanner network enhancement | bluetooth-scanner-graph.jpg |
| Thu | r/home_automation | "What it looks like in practice" story | overview-3d-heatmap.jpg |
| Fri | r/selfhosted | Privacy/local-first angle | overview-3d-multifloor.jpg |
| Sat | r/homeautomation | Automation use cases | maps-library-live.jpg |

## Tips

- **Attach images directly** to Reddit posts (don't rely on GitHub links — inline images get 3x more engagement)
- **Post between 9-11am EST** for peak visibility on these subs
- **Reply to every comment** in the first 2 hours — Reddit's algorithm rewards engagement
- **Cross-link the demo video** (`demo-walkthrough.mp4`) in comments, not the main post
- **Don't post the GitHub link first** — lead with the story/problem, link at the bottom
- Wait for the persistence fix to be confirmed by the tester before starting (v0.19.19)
