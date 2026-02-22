// PadSpan HA — User-facing help content
// Each entry: { title, body: string[] }
// Opened by the ? help buttons in Basic (and Advanced) mode.

export const HELP = {

  // ── Follow ──────────────────────────────────────────────────────────────────
  follow: {
    title: "Follow — Track a tag in real time",
    body: [
      "The Follow page lets you watch exactly where a specific person or object is right now.",
      "Pick any tracked tag from the dropdown — a phone, key fob, AirTag, Tile tracker, or anything Bluetooth. PadSpan shows you which room it's currently in, how strong the signal is, and which of your scanners can see it.",
      "The location updates automatically every few seconds. You don't need to refresh the page.",
    ],
  },
  follow_selector: {
    title: "Choosing which tag to follow",
    body: [
      "The dropdown lists every device PadSpan is currently tracking.",
      "Devices with a friendly name (like 'Alice's Phone' or 'Car Keys') appear first. You can name any unrecognised device using the Tag button in the Objects section.",
      "If a device is missing from the list, it hasn't been seen by your Bluetooth scanners recently — try moving it closer to a scanner.",
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
      "Devices with a green badge are 'identified' — they have a friendly name. Orange 'unidentified' devices are raw Bluetooth signals that haven't been named yet.",
      "Use the search box to quickly find a specific device by name, room, or address.",
    ],
  },
  objects_tag: {
    title: "Naming (tagging) an unidentified device",
    body: [
      "When PadSpan detects a Bluetooth device it doesn't recognise, it shows a hardware address like AA:BB:CC:11:22:33.",
      "Click the 'Tag' button next to any device to give it a friendly name — for example 'Alice's AirTag', 'Car Keys', or 'Backpack Tracker'.",
      "Once tagged, the name appears everywhere in PadSpan — on the Overview map, the Follow tracker, and all other pages.",
      "You can rename a device at any time by clicking 'Relabel'.",
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
    title: "Settings — Customise how rooms look",
    body: [
      "Settings lets you personalise the appearance of your rooms in PadSpan.",
      "You can change the colour used for each room — this colour appears on the Overview diagram, the Follow map, and all other visualisations.",
      "Your floors and rooms are read automatically from Home Assistant's Areas & Zones. To add, rename, or delete a floor or room, go to HA Settings → Areas & Zones.",
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
};
