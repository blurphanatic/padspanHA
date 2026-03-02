# Getting Started with PadSpan HA

This guide walks you through your first 30 minutes with PadSpan — from install to tracking your first device across rooms.

## Prerequisites

- Home Assistant **2024.1** or newer
- At least **one BLE scanner** (ESP32 Bluetooth Proxy, ESPresense, or built-in HA Bluetooth)
- HACS installed (recommended)

## Choosing Scanner Hardware

PadSpan's goal is placing devices in the correct room on your floor plan — not just home/away. That's a harder problem, and hardware matters more than you'd think.

I started with about a dozen old ESP32 boards from a project three years ago and ordered 10 more for testing. Most of the old boards made poor BLE scanners — noisy, inconsistent signal readings. The few that had decent antennas worked OK, which is what narrowed it down: **the antenna is the thing that matters**, more than the chip.

### What worked (ranked)

1. **ESP32-S3 with Ethernet (LAN) port + external antenna** — The wired connection means no WiFi radio competing with BLE scanning. Honestly it didn't test noticeably better than WiFi, but for a permanent always-on scanner it feels like the right call.
2. **ESP32-S3 with external antenna (WiFi)** — Probably the most practical option for most people. Great BLE 5.0 support, no need to run Ethernet to every room.
3. **ESP32-C3 with external antenna** — Cheaper than the S3 and still performed well for room-level tracking.

### What to look for

- **IPEX / u.FL antenna connector** with an included 2.4 GHz antenna
- **ESP32-S3 or ESP32-C3** chip (newer BLE 5.0 support)
- Any board running **ESPresense** or **Bluetooth Proxy** firmware

### What to avoid

- **Onboard chip/PCB antennas only** — the tiny antennas on most dev boards produce noisy RSSI readings that make room discrimination unreliable
- **Older ESP32 boards** (not S3/C3) with no external antenna — fine as basic Bluetooth proxies or for home/away, but too inconsistent for room-level accuracy

### Why the antenna matters

Home/away just needs to see *any* signal from *any* scanner — easy. Room-level tracking needs to reliably tell which scanner is closest, and sometimes the difference is only 7 dBm. A noisy chip antenna can flip that decision randomly. A full-size external antenna keeps the readings consistent enough for PadSpan to get the room right.

## Step 1: Install

### Via HACS (recommended)
1. Open HACS → Integrations → three-dot menu → **Custom repositories**
2. URL: `https://github.com/gbroeckling/padspanHA` — Category: **Integration**
3. Search for **PadSpan HA** and install it
4. **Restart Home Assistant completely** (Settings → System → Restart)

### Manual
1. Download the [latest release ZIP](https://github.com/gbroeckling/padspanHA/releases/latest)
2. Extract `custom_components/padspan_ha/` into your HA `config/custom_components/` directory
3. Restart Home Assistant

## Step 2: Add the Integration

1. Go to Settings → Devices & Services → **Add Integration**
2. Search for **PadSpan HA**
3. Follow the config flow (defaults are fine for most setups)

## Step 3: Explore with Sample Mode

Before touching real data, flip to **Sample mode** (toggle in the top-right corner of the panel). This loads a complete demo house with:
- 3 BLE scanners across 5 rooms
- 11 objects (phones, AirTags, Tile trackers, unidentified devices)
- Floor plan with room boundaries
- Follow mode with movement tracking

Explore every view to understand what PadSpan can do.

## Step 4: Switch to Live Mode

Toggle back to **Live mode**. Your BLE scanners are auto-discovered. You should immediately see:
- **Radios** — Your BLE scanners listed in the Bluetooth view
- **Objects** — Every Bluetooth device your scanners detect (phones, AirTags, smart home gadgets, and plenty of unknown devices)

## Step 5: Tag Your Devices

Go to the **Objects** tab. You'll see a mix of named and unnamed Bluetooth devices. Click **Tag** next to any device you recognize:
- Your phone → "Alice's Phone"
- Your AirTag → "Car Keys"
- Your Tile → "Backpack"

Once tagged, PadSpan creates HA entities for that device (device_tracker, area sensor, distance sensor).

## Step 6: Upload a Floor Plan

Go to **Maps** → **Upload** tab:
1. Upload a PNG/JPG of your floor plan (or draw one — even a rough sketch works)
2. Draw room boundary polygons by clicking the map
3. Place scanner markers where your BLE scanners are physically located

## Step 7: Start Following

Go to the **Follow** tab:
1. Select a tagged device from the dropdown
2. Watch it move between rooms in real time on the animated map
3. Optionally configure **email alerts** for room-change notifications

## What's Next?

- **Calibration** — Run the calibration walkthrough (Training Hub → Calibration) for sub-room accuracy
- **Basic vs Advanced** — Toggle between simplified and full views (top-right toggle)
- **Training Hub** — Guided walkthroughs for every major feature
- **Settings** — Customize appearance, scanner offsets, presence thresholds

## Troubleshooting

- **No scanners visible?** Confirm your ESP32 or Bluetooth proxy is connected and showing in HA → Settings → Devices & Services → Bluetooth
- **No objects?** Wait 30 seconds — the first BLE scan takes a moment. Check the Diagnostics view for errors.
- **UI not updating?** Hard refresh your browser (Ctrl+F5) to clear cached JavaScript
