// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
// PadSpan HA — User-facing help content
// Each entry: { title, body: string[] }
// Opened by the ? help buttons in Basic, Advanced, and Development modes.

export const HELP = {

  // ── Follow ──────────────────────────────────────────────────────────────────
  follow: {
    title: "Follow — Track a tag in real time",
    body: [
      "The Follow page lets you watch exactly where a specific person or object is right now.",
      "Pick any tracked tag from the dropdown — a phone, key fob, AirTag, Tile tracker, or anything Bluetooth. PadSpan™ shows you which room it's currently in, how strong the signal is, and which of your scanners can see it.",
      "The location updates automatically every few seconds. You don't need to refresh the page.",
      "Click Details → in the status card to open the full device detail view — per-scanner RSSI, signal history, and quick access to Tag/Relabel.",
    ],
  },
  follow_selector: {
    title: "Choosing which tag to follow",
    body: [
      "The dropdown lists every device PadSpan is currently tracking.",
      "Devices with a friendly name (like 'Alice's Phone' or 'Car Keys') appear first. You can name any unrecognised device using the Tag button in the Objects section.",
      "If a device shows 'not_home' or is missing from the list, it hasn't been detected recently. It may have left range or gone away. Check the Objects tab for the red Away badge and its last known location.",
    ],
  },
  follow_map: {
    title: "Location map — Where is the tag right now?",
    body: [
      "The map shows every room in your home and highlights the tracked tag's current location with a bright pulsing dot.",
      "Green antenna rings inside rooms show where your Bluetooth scanners (radios) are placed.",
      "The more scanners that can detect the tag, the more accurately PadSpan can pinpoint the location.",
      "The map refreshes automatically every few seconds — no manual refresh needed.",
    ],
  },
  follow_alerts: {
    title: "Movement alerts — Get notified when a tag moves",
    body: [
      "PadSpan can send you an email every time a tracked tag moves from one room to another.",
      "Enter the email address where you want notifications sent, then turn on the switch.",
      "You can also choose specific rooms to watch — for example, get an alert only when a tag enters the front hallway.",
      "Emails are sent through Home Assistant's built-in notification system. If emails aren't arriving, check that a notification service (like Gmail or SMTP) is configured in HA Settings → Integrations.",
    ],
  },

  // ── Overview ─────────────────────────────────────────────────────────────────
  overview: {
    title: "Overview — Your home at a glance",
    body: [
      "Overview shows a live diagram of all your rooms with your Bluetooth scanners and tracked objects displayed inside them.",
      "Think of it as your home's control tower — a quick snapshot of where everything is right now.",
      "Each box is a room from your Home Assistant Areas & Zones. Green antenna icons are your Bluetooth radios. Coloured dots are tracked people or objects.",
      "In Advanced or Development mode, click any KPI number (Rooms, Objects, Radios) to see a full list. Click any row in that list for detailed info on that item.",
    ],
  },
  overview_grid: {
    title: "Room diagram — What you're seeing",
    body: [
      "Each coloured box represents a room from Home Assistant's Areas & Zones settings.",
      "Inside each room you'll see green antenna rings — those are your Bluetooth scanners. Larger rings mean wider detection coverage.",
      "Coloured dots are tracked objects. Teal dots are identified (named) devices like phones and key tags. Orange dots are unrecognised Bluetooth signals.",
      "The numbers in the corner of each box show how many scanners and objects are in that room.",
      "The diagram refreshes every 5 seconds in Live mode.",
    ],
  },

  // ── Objects ───────────────────────────────────────────────────────────────────
  objects: {
    title: "Objects — Everything being tracked",
    body: [
      "Objects lists every device PadSpan can see — phones tracked by Home Assistant, AirTags, Tile trackers, key fobs, and any other Bluetooth device your scanners have detected.",
      "Badge colours tell you the device type: green BLE = standard Bluetooth device, orange BLE? = unidentified, blue Private BLE = phone using rotating MAC address (resolved automatically), amber iBeacon = AirTag / Tile / HA Companion App iBeacon grouped by stable UUID.",
      "Each object shows enrichment badges decoded from its BLE advertisement: a blue Company badge (e.g. Apple, Samsung, Google), a purple Device Type badge (e.g. Find My, AirPods, Nearby Info), and green Service badges (e.g. Battery, Device Information, Tile). These help identify unknown devices without tagging them.",
      "A red Away badge appears when a BLE device hasn't been seen for longer than the configured away timeout (default 5 min). 'Last: Kitchen' shows where it was last detected. The corresponding device_tracker entity in HA also shows not_home.",
      "Use the search box to find a device by name, address, company, or device type. Type 'apple' to see all Apple devices, 'tile' for Tile trackers, or 'away' for absent devices.",
      "Click any row (anywhere except the buttons) to open a full detail panel — per-scanner RSSI, signal bars, company info, decoded service UUIDs, connectable status, and quick Tag/Relabel/Untag actions.",
    ],
  },
  objects_tag: {
    title: "Naming (tagging) a device",
    body: [
      "When PadSpan detects a Bluetooth device it doesn't recognise, it shows a hardware address like AA:BB:CC:11:22:33.",
      "Click the 'Tag' button next to any device to give it a friendly name — for example 'Alice's AirTag', 'Car Keys', or 'Backpack Tracker'. Click Save. The name is stored permanently in Home Assistant.",
      "Once tagged, the name appears everywhere in PadSpan — on the Overview map, the Follow tracker, and all other pages. PadSpan also creates a device_tracker entity (e.g. device_tracker.car_keys) and an area sensor (e.g. sensor.car_keys_area) in Home Assistant for use in automations.",
      "AirTags and other iBeacon devices use a stable UUID as their identifier. The tag sticks even as the MAC address rotates — you never need to re-tag them.",
      "You can rename a device at any time by clicking 'Relabel'. To remove a tag entirely, go to Settings → Manage → BLE Tags.",
    ],
  },

  // ── Maps ─────────────────────────────────────────────────────────────────────
  maps: {
    title: "Mapping — Floor plans for your home",
    body: [
      "The Mapping section lets you upload photos or scans of your home's floor plans.",
      "Once uploaded, your floor plan shows the rooms alongside your Bluetooth scanner layout, helping you visualise coverage and plan where to add more scanners.",
      "You can upload one floor plan per floor — for example 'Ground Floor', 'Upper Floor', and 'Basement'.",
    ],
  },
  maps_library: {
    title: "Map library — Your uploaded floor plans",
    body: [
      "The library shows all the floor plans you've uploaded.",
      "In Sample mode, a demonstration home (Smith Residence) is shown so you can explore how the feature works without uploading anything.",
      "Switch to Live mode and go to the Upload tab to add your own floor plans.",
    ],
  },
  maps_upload: {
    title: "Uploading a floor plan",
    body: [
      "You can upload any floor plan image — PNG, JPG, or even a photo you took of a hand-drawn plan.",
      "Give the map a name (like 'Ground Floor'), then pick your image file and click Upload & Convert.",
      "PadSpan automatically resizes and stores the image in Home Assistant so it loads quickly.",
      "Tip: a photo of your architect's drawing or even a rough sketch works great.",
    ],
  },
  maps_stack: {
    title: "3D Floor Stack — align plans vertically",
    body: [
      "The 3D Stack tool lets you assign each floor plan to a building level (Basement through Level 3) and record the ceiling height for each level.",
      "Use the Alignment tool to drag one floor plan on top of another so their coordinate spaces match — for example, positioning the first floor directly above the ground floor.",
      "The scale control handles cases where one floor plan covers a larger or smaller physical area than another.",
      "Once aligned, PadSpan can calculate real-world 3D distances between Bluetooth scanners and tracked objects across different floors.",
    ],
  },

  // ── Settings ─────────────────────────────────────────────────────────────────
  settings: {
    title: "Settings — Customise PadSpan™",
    body: [
      "In Advanced or Development mode, Settings has tabs: Appearance, Scanner Map, Presence, and UI Structure.",
      "Appearance — change room colours. Your floors and rooms are read from HA; add or rename them in HA Settings → Areas & Zones.",
      "Scanner Map — see estimated scanner positions on your floor plans, derived from calibration fingerprint data.",
      "Presence — tune room-switching speed and set the Home/Away timeout.",
      "UI Structure — choose which extra tabs appear in Advanced mode. All tabs are always visible in Development mode.",
      "In Basic mode only the Appearance tab is shown.",
    ],
  },
  settings_colors: {
    title: "Room colours — Pick a colour for each room",
    body: [
      "Each room has a colour used across all of PadSpan's maps and diagrams.",
      "Click the coloured square (■) next to a room name to open the colour picker and choose a new colour.",
      "Click 'Save' when you're done — your choices are stored in Home Assistant and will be remembered next time.",
    ],
  },
  settings_presence: {
    title: "Presence — Smoothing, timeouts, and adaptive learning",
    body: [
      "Room Change Delay — how many seconds a scanner must consistently win before PadSpan switches a device to that room. Raise this (e.g. 30–60 s) to prevent flickering when a device sits on the boundary between two scanners. Set to 0 for instant switching.",
      "Home/Away Timeout — if a device hasn't been detected for this long, its device_tracker entity in HA changes to not_home and a red Away badge appears in the Objects tab. Default is 5 minutes. Raise it if devices briefly drop off in thick-walled rooms or during normal use.",
      "Adaptive Learning (Experimental) — when enabled, PadSpan passively learns room RSSI fingerprints from high-confidence room assignments. Over days, this tightens radio propagation models without manual calibration. The maturity bar shows progress: 0–25% = collecting baseline, 25–75% = building model, 75–100% = model active. Floor detection enhancement learns cross-floor signal attenuation for better multi-story accuracy.",
      "All settings take effect on the next poll (every 10 seconds) — no restart needed.",
    ],
  },
  settings_manage: {
    title: "Manage — Untag devices and delete rooms",
    body: [
      "BLE Tags — every named BLE device is listed with its address, kind, and last-seen time. Click Untag to remove the friendly name (two-click confirm prevents accidents). The device reverts to its hardware address but continues to be tracked.",
      "Rooms (HA Areas) — lists every area from Home Assistant. Click Delete to remove an area from HA entirely. This also unassigns any scanners in that room. Cannot be undone from within PadSpan — re-add in HA Settings → Areas & Zones if needed.",
      "This tab is visible in Advanced and Development modes. For deeper data management (orphan cleanup, entity deletion, integration controls) use the Manage sidebar tab.",
    ],
  },

  // ── Monitor ────────────────────────────────────────────────────────────────
  monitor: {
    title: "Monitor — System health & analytics hub",
    body: [
      "Monitor has three sub-tabs: Diagnostics, Zones, and Insights.",
      "Diagnostics — websocket call counts, timing, scanner performance, advertisement freshness, and session info. The Per-Scanner Breakdown table shows each scanner's device count, average RSSI, and quality grade.",
      "Zones — every room as a card sorted by occupancy. Occupied rooms have a coloured border; empty rooms are dimmed. Click a room card to see its detail. Rooms are grouped by floor when configured in HA.",
      "Insights — visual analytics: room occupancy bar chart, signal quality table, object mobility (devices seen in multiple rooms), coverage gaps, and device breakdown stats.",
    ],
  },

  // ── History ────────────────────────────────────────────────────────────────
  history: {
    title: "History — Session event timeline",
    body: [
      "History shows every action taken during this browser session — view changes, data refreshes, tagging, and websocket calls.",
      "Use the type filter buttons to show or hide specific event types. The timeline is newest-first.",
      "This data is session-scoped and resets when you reload the page. It is not stored on the server.",
      "Click Clear History to reset the event log.",
    ],
  },

  // ── Events ─────────────────────────────────────────────────────────────────
  events: {
    title: "Events — Notable activity stream",
    body: [
      "Events shows only the actionable events from your session — tagging, navigation, and data refreshes.",
      "Click a navigation event to jump back to that view.",
      "Unlike History (which logs everything), Events filters to the activity that matters most for understanding what's happened.",
    ],
  },

  // ── QA ─────────────────────────────────────────────────────────────────────
  qa: {
    title: "QA — Configuration quality checks",
    body: [
      "QA runs automated health checks on your PadSpan setup and highlights anything that needs attention.",
      "Config Health — seven pass/fail checks covering maps, rooms, scanners, BLE feed, tagging, and snapshot availability. Failed checks include a fix suggestion.",
      "Data Consistency — detects orphaned objects, unmapped scanners, and rooms without scanner coverage. Click any item to see its detail.",
      "Propagation Health — grades your radio propagation model (A through F) based on room coverage, distance accuracy, fingerprint stability, and floor separation. Click 'More Detail' for per-room and per-scanner breakdowns with improvement recommendations. 'How It Works' shows the underlying math.",
      "Data Backup & Recovery — create snapshots of all PadSpan data before enabling experimental features. Restore to roll back if needed. Up to 3 backups are kept.",
      "Quick Actions — refresh the snapshot, export the full panel state as JSON for debugging, or jump to diagnostics.",
    ],
  },

  qa_propagation: {
    title: "Propagation Health — Model quality analysis",
    body: [
      "Propagation Health analyses the quality of PadSpan's underlying radio model \u2014 the math that converts signal strength (RSSI) into room assignments.",
      "The overall grade (A\u2013F) combines four sub-indicators: Model Coverage (% of rooms with learned fingerprints), Distance Accuracy (cross-validation error from calibration data), Fingerprint Stability (variance in adaptive room models), and Floor Separation (signal attenuation between floors).",
      "Click 'More Detail' to see per-room fingerprint quality (how many observations each room has, variance, and stability status) and per-scanner path-loss models (exponent, RSSI@1m, R\u00b2 fit quality).",
      "Improvement recommendations are generated automatically: rooms that need more data, scanners with poor path-loss fits, suggestions to enable adaptive learning or add calibration points.",
      "'How It Works' shows the actual formulas and current parameter values: path-loss distance calculation, Gaussian room scoring, Kalman filter settings, and adaptive blending weight.",
      "Reset buttons at the bottom let you clear adaptive learning data (keeps manual calibration) or clear all calibration data (requires typing RESET to confirm).",
    ],
  },

  qa_backup: {
    title: "Data Backup & Recovery",
    body: [
      "The backup system lets you create a full snapshot of all PadSpan configuration and learned data before making changes.",
      "Each backup captures: settings, calibration points, adaptive learning fingerprints, object tags, model data, map metadata, movement history, and follow alert configs.",
      "Up to 3 backups are stored. Creating a 4th automatically removes the oldest. Each backup shows its timestamp, version, and optional note.",
      "Click 'Restore' to overwrite all current data with a backup. The page reloads automatically after restore. Click 'Delete' to remove a backup you no longer need.",
      "Recommended workflow: create a backup before enabling adaptive learning, before major calibration changes, or before upgrading PadSpan.",
    ],
  },

  qa_radio_analysis: {
    title: "Radio Analysis — Per-scanner ranking & health",
    body: [
      "Radio Analysis ranks every Bluetooth scanner by overall quality, combining three scores: Hardware (40%), Coverage (30%), and Reliability (30%).",
      "Hardware Score isolates radio hardware quality from placement. It compares per-device RSSI across scanners that share the same devices \u2014 a radio that consistently reads higher RSSI for shared devices has a better antenna or Bluetooth chipset.",
      "Coverage Score measures how many devices the scanner sees and how many other scanners it overlaps with. High coverage means the scanner reaches broadly across your home.",
      "Reliability Score combines advertisement freshness, RSSI consistency (spread), WiFi signal strength (or wired bonus), and scanning status.",
      "Scanners are sorted by overall score (best first) with medal badges for the top 3. Click any row to expand and see the full score breakdown with comparison notes.",
      "Click a scanner\u2019s name to open the full scanner detail modal with per-device signal bars and area controls.",
    ],
  },

  qa_radio_ranking: {
    title: "Understanding radio ranking scores",
    body: [
      "The ranking system helps you identify which radios have the best hardware versus which are just well-placed.",
      "Hardware Score (0\u2013100): For each pair of radios that share devices, PadSpan compares the RSSI each radio reads for those same devices. A radio that consistently reads stronger signals has better hardware. Score 50 = average; higher = better antenna/chipset.",
      "Coverage Score (0\u2013100): Combines device count (how many devices seen), overlap breadth (how many other scanners share devices), and unique reach (devices only seen by this scanner).",
      "Reliability Score (0\u2013100): Freshness of latest advertisement (up to 35 pts), RSSI spread consistency (up to 25 pts), WiFi signal or wired connection (up to 20 pts), and scanning status (up to 20 pts).",
      "The comparison note in expanded detail tells you exactly how much stronger or weaker a radio reads compared to the top-ranked radio, in dBm. A 3\u20135 dBm difference is noticeable; 6+ dBm suggests meaningfully different hardware.",
    ],
  },

  // ── Calibration — Beacon Tune ────────────────────────────────────────────
  calibration_beacon: {
    title: "Beacon Tune — Pin stationary beacons on floor plans",
    body: [
      "Beacon Tune lets you place stationary BLE beacons (AirTags, Tiles, key fobs) at their exact physical positions on your floor plans.",
      "Pick a map, then add beacons from the dropdown. Each pinned beacon appears as a teal diamond on the floor plan — drag it to match the real-world position.",
      "Once pinned, PadSpan uses the known position to override the beacon's room assignment — no more flickering between adjacent rooms.",
      "With Auto-Calibrate enabled, PadSpan automatically builds calibration fingerprints from the beacon's RSSI readings at its pinned location. This improves location accuracy for ALL tracked devices over time.",
      "Auto-generated calibration points are labelled [auto] in the Model tab and are capped at 50 per beacon to prevent data bloat.",
      "This is an experimental feature — it works best with stationary beacons that don't move. If you relocate a beacon, update its position on the map and the old auto-calibration data will naturally age out.",
    ],
  },

  // ── Sandbox ────────────────────────────────────────────────────────────────
  sandbox: {
    title: "Sandbox — Experimental data playground",
    body: [
      "Sandbox is your data playground — explore live data, check experimental feature status, and poke around under the hood. Nothing here changes your config.",
      "Experimental Features — status dashboard for all experimental features across PadSpan (Adaptive Learning, MQTT Publishing, Beacon Tune). Click any row to jump to its settings.",
      "State Inspector — current data mode, snapshot age, object/room/radio counts, and session uptime at a glance.",
      "Room Color Grid — compact tiles showing each room's assigned colour and device count. Click any tile for room details.",
      "RSSI Distribution — histogram of all current signal strengths bucketed by 10 dBm, with average RSSI shown.",
      "Live Signal Bars — per-scanner bar chart showing device count. Click any bar for scanner details.",
      "Signal Pulse — animated room activity bubbles. Ring size reflects device count, pulsing rings indicate fresh signal activity.",
      "Raw Snapshot Explorer — browse the live data snapshot as a collapsible JSON tree. Copy the full snapshot to clipboard for debugging.",
    ],
  },
};
