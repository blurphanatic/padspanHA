// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
// PadSpan HA — BLE Fingerprint Calibration
// Phone-based signal collection for precise indoor location modelling.
//
// Sub-tabs:
//   Tune        — position scanner/receiver markers on 3D iso map
//   Beacon Tune — mark beacon positions, auto-collect 60s RSSI fingerprints
//   Setup       — pick your beacon device, collection settings
//   Pin & Listen — tap map to place pin, collect RSSI for N seconds
//   Roam        — guided coverage-maximising walk with live heatmap
//   Model       — quality stats, path-loss fits, LOO accuracy, export

const GRID_N    = 10;    // 10×10 coverage grid
const SIGMA_C   = 1.8;   // Gaussian sigma in cell units
const POLL_MS   = 1000;  // RSSI poll interval during collection (1s = ~60 samples in 60s)

// ── Exports ──────────────────────────────────────────────────────────────────
export function render(ctx) {
  const { el, radioShortId, scannerStatus } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";
  const root = el("section", { id: "calibration" });
  root.className = ctx.state.view === "calibration" ? "" : "hidden";

  // Per-session UI state
  if (!ctx.state._calib) ctx.state._calib = {
    tab:        "tune",
    deviceId:   null,
    deviceLabel: null,
    mapId:      null,
    duration:   15,
    pinX:       null,
    pinY:       null,
    pinRoom:    null,
    pinLabel:   "",
    collecting: false,
    stopFlag:   false,
    readings:   null,   // {source → {name,samples[]}} after collection
    savedThisSession: 0,
  };
  const cs = ctx.state._calib;

  // Load calibration DB once
  if (!ctx.state.calibration) {
    ctx.actions.calibrationGet()
      .then(d => { ctx.state.calibration = d; ctx.actions.renderRooms(); })
      .catch(() => { ctx.state.calibration = { points: [], model: {} }; });
  }
  const calData = ctx.state.calibration || { points: [], model: {} };

  // Header
  root.appendChild(el("div", { style: "margin-bottom:10px" }, [
    el("div", { style: "display:flex;align-items:center;gap:8px" }, [
      el("div", { style: "font-weight:700;font-size:16px;color:#52b788" }, "BLE Location Calibration"),
      ctx.helpers.helpBtn("calibration_overview"),
    ]),
    el("div", { style: "font-size:12px;color:#78909c;margin-top:2px" },
      "Build a fingerprint database so PadSpan™ can pinpoint every beacon in 3D space."),
  ]));

  // Tab bar
  const TABS = [["tune","Tune"],["beacon","Beacon Tune"],["setup","Setup"],["pin","Pin & Listen"],["roam","Roam"],["model","Model"]];
  const tabBar = el("div", { class: "tabs", style: "margin-bottom:14px;flex-wrap:wrap;gap:4px" });
  for (const [id, label] of TABS) {
    tabBar.appendChild(el("button", {
      class: "tab" + (cs.tab === id ? " active" : ""),
      onclick: () => { cs.tab = id; ctx.actions.renderRooms(); },
    }, label));
  }
  root.appendChild(tabBar);

  if (cs.tab === "setup") root.appendChild(_setup(ctx, el, cs, calData));
  if (cs.tab === "pin")   root.appendChild(_pinAndListen(ctx, el, cs, calData));
  if (cs.tab === "roam")  root.appendChild(_roam(ctx, el, cs, calData));
  if (cs.tab === "model") root.appendChild(_modelTab(ctx, el, cs, calData));
  if (cs.tab === "tune")  root.appendChild(_tuneTab(ctx, el, cs, calData));
  if (cs.tab === "beacon") root.appendChild(_beaconTuneTab(ctx, el, cs, calData));

  return root;
}

// ── Setup tab ─────────────────────────────────────────────────────────────────
function _setup(ctx, el, cs, calData) {
  const { radioShortId, scannerStatus } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";
  const wrap = el("div", { style: "display:flex;flex-direction:column;gap:14px" });
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;

  // How-it-works explainer
  wrap.appendChild(el("div", { class: "card", style: "border-color:#52b788" }, [
    el("div", { style: "font-weight:700;font-size:14px;margin-bottom:8px;color:#52b788" },
      "Phone-Based Calibration (Setup)"),
    el("div", { style: "font-size:13px;line-height:1.7;color:#b0c4b1" }, [
      el("div", {}, "This tab configures phone-based calibration (Pin & Listen / Roam)."),
      el("div", { style: "margin-top:4px" }, "1. Your phone broadcasts BLE. The house scanners hear it."),
      el("div", { style: "margin-top:4px" }, "2. You stand at a known spot on the map and tap it."),
      el("div", { style: "margin-top:4px" }, "3. PadSpan records the RSSI fingerprint — which scanners saw you and how strongly."),
      el("div", { style: "margin-top:4px" }, "4. Repeat at 10–20 locations spread across each floor."),
      el("div", { style: "margin-top:4px" }, "All calibration methods (Tune, Beacon Tune, Pin & Listen, Roam) feed the same model."),
    ]),
  ]));

  // Device selector — merge objects.list + raw advertisements so the user can pick ANY BLE device
  const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
  const _setupIsScanner = ctx.helpers.isScanner;
  const bleObjs = (snap?.objects?.list || [])
    .filter(o => {
      if (o.kind !== "ble" && o.kind !== "entity" && o.kind !== "private_ble" && o.kind !== "ibeacon") return false;
      if (_setupIsScanner(o)) return false;
      if (_quietMode && !o.user_label && !o.identified && !ctx.actions.followedHas(o.address || o.key || "")) return false;
      return true;
    })
    .sort((a, b) => (b.rssi || -100) - (a.rssi || -100));

  // Build unique-address map from raw advertisements (one entry per MAC)
  const _setupScannerAddrs = ctx.helpers.scannerAddrs();
  const adAddrMap = {};
  for (const ad of (snap?.ble?.advertisements || [])) {
    const addr = (ad.address || "").toUpperCase();
    if (!addr) continue;
    if (_setupScannerAddrs.has(addr)) continue;
    if (!adAddrMap[addr]) {
      adAddrMap[addr] = { address: addr, name: ad.name || addr, rssi: ad.rssi };
    } else if ((ad.rssi || -200) > (adAddrMap[addr].rssi || -200)) {
      adAddrMap[addr].rssi = ad.rssi;
    }
  }
  // Only show addresses not already covered by bleObjs (include all_addresses for rotating-MAC devices)
  const knownAddrs = new Set();
  for (const o of bleObjs) {
    if (o.address) knownAddrs.add(o.address.toUpperCase());
    for (const a of (o.all_addresses || [])) { if (a) knownAddrs.add(String(a).toUpperCase()); }
  }
  const adOnlyDevices = Object.values(adAddrMap).filter(d => !knownAddrs.has(d.address));
  adOnlyDevices.sort((a, b) => (b.rssi || -200) - (a.rssi || -200));

  const allDevices = bleObjs.length + adOnlyDevices.length;

  const deviceCard = el("div", { class: "card" });
  deviceCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:8px" }, "Beacon Device"));
  deviceCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
    "Select the phone or tag that will act as your calibration beacon. It must be visible to your scanners (Bluetooth on, HA companion app running)."));

  if (allDevices) {
    const sel = document.createElement("select");
    sel.style.cssText = "width:100%;margin-bottom:10px;";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = cs.deviceId ? "" : "— choose device —";
    sel.appendChild(placeholder);
    // Tracked objects — use stable identifiers for rotating-MAC devices
    for (const o of bleObjs) {
      // private_ble → canonical_id (irk:...), ibeacon → key, else → address/entity_id
      const stableId = o.kind === "private_ble" ? (o.canonical_id || o.address || "")
                      : o.kind === "ibeacon"     ? (o.key || o.address || "")
                      : (o.address || o.entity_id || "");
      const opt = document.createElement("option");
      opt.value = stableId;
      opt.textContent = (o.user_label || o.name || stableId) + (o.rssi ? ` (${o.rssi} dBm)` : "") + (o.kind === "private_ble" ? " [Private BLE]" : o.kind === "ibeacon" ? " [iBeacon]" : "");
      if (stableId === cs.deviceId) opt.selected = true;
      sel.appendChild(opt);
    }
    // Raw advertisement devices not already in objects.list (hidden in quiet mode)
    if (adOnlyDevices.length && !_quietMode) {
      const grp = document.createElement("optgroup");
      grp.label = "── Raw BLE advertisements ──";
      for (const d of adOnlyDevices) {
        const opt = document.createElement("option");
        opt.value = d.address;
        opt.textContent = (d.name !== d.address ? d.name + "  " : "") + d.address + (d.rssi ? ` (${d.rssi} dBm)` : "");
        if (d.address === (cs.deviceId || "").toUpperCase()) opt.selected = true;
        grp.appendChild(opt);
      }
      sel.appendChild(grp);
    }
    sel.addEventListener("change", () => {
      cs.deviceId = sel.value;
      const obj = bleObjs.find(o => {
        const sid = o.kind === "private_ble" ? (o.canonical_id || o.address || "")
                  : o.kind === "ibeacon"     ? (o.key || o.address || "")
                  : (o.address || o.entity_id || "");
        return sid === sel.value;
      });
      cs.deviceLabel = obj ? (obj.user_label || obj.name || sel.value) : sel.value;
      ctx.actions.renderRooms();
    });
    deviceCard.appendChild(sel);
  } else {
    deviceCard.appendChild(el("div", { style: "font-size:12px;color:#f59e0b;margin-bottom:10px" },
      "No BLE devices visible in snapshot. Switch to Live mode and ensure Bluetooth is active on your phone."));
  }

  // Manual MAC entry
  const manualRow = el("div", { style: "display:flex;gap:8px;align-items:center;margin-bottom:6px" });
  const macInput = document.createElement("input");
  macInput.type = "text";
  macInput.placeholder = "Or enter MAC / entity_id manually…";
  macInput.style.cssText = "flex:1;font-family:monospace;font-size:12px;";
  macInput.value = cs.deviceId || "";
  const applyBtn = el("button", { class: "btn inline" }, "Use");
  applyBtn.addEventListener("click", () => {
    if (macInput.value.trim()) {
      cs.deviceId = macInput.value.trim();
      cs.deviceLabel = cs.deviceId;
      ctx.actions.renderRooms();
    }
  });
  manualRow.appendChild(macInput);
  manualRow.appendChild(applyBtn);
  deviceCard.appendChild(manualRow);

  // Resolve selected device's advertisements (used by both status box and radio status)
  const _beaconResult = (cs.deviceId && snap) ? _findBeaconAds(snap, cs.deviceId) : { myAds: [], perRadio: {}, targetAddr: "" };

  // Show selected device live data using advertisements for real per-radio RSSI
  if (cs.deviceId && snap) {
    const { perRadio, targetAddr } = _beaconResult;
    const radioCount = Object.keys(perRadio).length;
    const _did = cs.deviceId;
    const obj = (snap?.objects?.list || []).find(o =>
      (o.address || "").toUpperCase() === (targetAddr || _did).toUpperCase() ||
      (o.entity_id || "") === _did ||
      (o.canonical_id || "") === _did ||
      (o.key || "") === _did
    );
    if (radioCount > 0) {
      const box = el("div", { style: "background:#0a150e;border:1px solid #1b3526;border-radius:8px;padding:10px;margin-top:6px" });
      box.appendChild(el("div", { style: "font-weight:600;font-size:13px;color:#52b788;margin-bottom:6px" },
        `✓ ${obj?.user_label || obj?.name || cs.deviceId} — seen by ${radioCount} radio${radioCount > 1 ? "s" : ""}`));
      if (obj?.room) box.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:6px" }, `Room: ${obj.room}`));
      box.appendChild(el("div", { style: "font-size:11px;color:#78909c;margin-bottom:4px" }, "Per-radio RSSI:"));
      const sorted = Object.entries(perRadio).sort((a, b) => (b[1].rssi || -200) - (a[1].rssi || -200));
      const _setupTxPower = obj?.tx_power ?? null;
      for (const [src, info] of sorted) {
        box.appendChild(_rssiRow(el, info.name || src, info.rssi, null, info.age_s, _setupTxPower));
      }
      deviceCard.appendChild(box);
    } else {
      // Check if this is a Bermuda/entity tracker with its own RSSI attribute
      const tag = (snap?.tags || []).find(t => t.entity_id === cs.deviceId);
      const entityRssi = tag?.rssi || obj?.rssi;
      const entityScanner = tag?.scanner || tag?.nearest_receiver || tag?.receiver;
      if (entityRssi || entityScanner) {
        const box = el("div", { style: "background:#0a150e;border:1px solid #3d2d0a;border-radius:8px;padding:10px;margin-top:6px" });
        box.appendChild(el("div", { style: "font-weight:600;font-size:13px;color:#fbbf24;margin-bottom:6px" },
          `⚠ ${obj?.user_label || obj?.name || cs.deviceId} — entity data only (no direct BLE advertisements)`));
        if (obj?.room) box.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:6px" }, `Room: ${obj.room}`));
        if (entityRssi) box.appendChild(el("div", { style: "font-size:12px;color:#94a3b8" }, `RSSI: ${entityRssi} dBm (from entity attributes)`));
        if (entityScanner) box.appendChild(el("div", { style: "font-size:12px;color:#94a3b8" }, `Nearest scanner: ${entityScanner}`));
        box.appendChild(el("div", { style: "font-size:11px;color:#78909c;margin-top:8px;line-height:1.5" },
          "This device uses private BLE (rotating MAC). To get per-radio RSSI, set up the Private BLE Device integration in HA " +
          "(Settings → Devices & Services → Add → Private BLE Device), or enable iBeacon transmitter in the HA Companion App."));
        deviceCard.appendChild(box);
      } else {
        const warnBox = el("div", { style: "font-size:12px;color:#f59e0b;margin-top:6px;padding:10px;background:#0a150e;border-radius:6px;line-height:1.6" });
        warnBox.appendChild(el("div", { style: "font-weight:600;margin-bottom:4px" }, `⚠ "${cs.deviceId}" not seen in any radio advertisement.`));
        warnBox.appendChild(el("div", {}, "If this is a phone or watch (rotating MAC), you need one of:"));
        warnBox.appendChild(el("div", { style: "padding-left:12px;margin-top:4px" }, "• Private BLE Device integration (Settings → Devices & Services → Add Integration)"));
        warnBox.appendChild(el("div", { style: "padding-left:12px" }, "• HA Companion App with iBeacon transmitter enabled"));
        warnBox.appendChild(el("div", { style: "margin-top:4px" }, "For other devices: make sure Bluetooth is on and the device is near a scanner."));
        deviceCard.appendChild(warnBox);
      }
    }
  }
  wrap.appendChild(deviceCard);

  // Floor selector (primary) — maps are background images, not the selection unit
  const maps = ctx.state.maps?.list || [];
  const mapCard = el("div", { class: "card" });
  mapCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:8px" }, "Floor"));
  mapCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
    "Select which floor you're calibrating. The map image is used as a visual reference."));
  if (maps.length) {
    const mapSel = document.createElement("select");
    mapSel.style.width = "100%";
    const mp0 = document.createElement("option");
    mp0.value = "";
    mp0.textContent = cs.mapId ? "" : "\u2014 choose a floor \u2014";
    mapSel.appendChild(mp0);

    // Build floor_id → maps lookup
    const _fl = ctx.state.model?.floors || [];
    const _floorMaps = new Map(); // floor_id → [map, ...]
    for (const m of maps) {
      const fid = m.floor_id || "main";
      if (!_floorMaps.has(fid)) _floorMaps.set(fid, []);
      _floorMaps.get(fid).push(m);
    }

    // Floor entries — primary selection
    for (const f of _fl) {
      const fMaps = _floorMaps.get(f.id) || [];
      if (!fMaps.length) continue;
      const opt = document.createElement("option");
      opt.value = `__floor__${f.id}`;
      opt.textContent = `${f.name || f.id} (${fMaps.length} map${fMaps.length > 1 ? "s" : ""})`;
      // Auto-select if current mapId is on this floor
      if (cs.mapId && fMaps.some(m => m.id === cs.mapId)) opt.selected = true;
      mapSel.appendChild(opt);
    }
    // Also show floors not in model but present in maps
    for (const [fid, fMaps] of _floorMaps) {
      if (_fl.some(f => f.id === fid)) continue;
      const opt = document.createElement("option");
      opt.value = `__floor__${fid}`;
      opt.textContent = `${fid} (${fMaps.length} map${fMaps.length > 1 ? "s" : ""})`;
      if (cs.mapId && fMaps.some(m => m.id === cs.mapId)) opt.selected = true;
      mapSel.appendChild(opt);
    }

    mapSel.addEventListener("change", () => {
      const v = mapSel.value;
      if (v.startsWith("__floor__")) {
        const fid = v.replace("__floor__", "");
        const candidates = _floorMaps.get(fid) || [];
        // Pick the best map on this floor (most receivers + room_bounds)
        const best = candidates.slice().sort((a, b) => {
          const ra = (a.receivers || []).length + Object.keys(a.room_bounds || {}).length;
          const rb = (b.receivers || []).length + Object.keys(b.room_bounds || {}).length;
          return rb - ra;
        })[0];
        cs.mapId = best ? best.id : "";
      } else {
        cs.mapId = v;
      }
      ctx.actions.renderRooms();
    });
    mapCard.appendChild(mapSel);
  } else {
    mapCard.appendChild(el("div", { style: "font-size:12px;color:#f59e0b" },
      "No maps uploaded yet. Upload a floor plan in the Maps tab first."));
  }
  wrap.appendChild(mapCard);

  // Duration setting
  const durCard = el("div", { class: "card" });
  durCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:8px" }, "Collection Duration"));
  durCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
    "How long to sample RSSI at each calibration point. Sampled every 1s — 30s gives ~30 samples, 60s gives ~60. 60s recommended for best accuracy."));
  const durRow = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap" });
  for (const d of [15, 30, 60, 90]) {
    const btn = el("button", {
      class: "btn" + (cs.duration === d ? "" : " inline"),
      style: "min-width:60px",
      onclick: () => { cs.duration = d; ctx.actions.renderRooms(); },
    }, `${d}s`);
    durRow.appendChild(btn);
  }
  durCard.appendChild(durRow);
  wrap.appendChild(durCard);

  // Radio status — show all radios and how many BLE devices each sees
  if (snap) {
    const radios = snap?.ble?.radios || [];
    const radioCard = el("div", { class: "card" });
    radioCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:6px" }, "Radio Status"));
    if (radios.length) {
      const ads = snap?.ble?.advertisements || [];
      for (const r of radios) {
        const seen = ads.filter(a => a.source === r.source).length;
        const beaconHere = cs.deviceId ? !!_beaconResult.perRadio[r.source] : false;
        // Prefer area name (room) over raw adapter name
        const sid = _sid(r.source || "");
        const displayName = (sid ? sid+" " : "") + (r.area_name || r.area || r.name || r.source || "?");
        const subLabel = (r.area_name || r.area) && r.name && r.name !== r.source ? r.name : "";
        const nameEl = el("div", { style: "flex:1;min-width:80px" }, [
          el("span", { style: "font-size:12px;font-weight:600" }, displayName),
          ...(subLabel ? [el("span", { style: "font-size:10px;color:#78909c;display:block;font-family:monospace" }, subLabel)] : []),
        ]);
        const row = el("div", { style: "display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid #0d1f12;flex-wrap:wrap" }, [
          nameEl,
          (()=>{ const ss = scannerStatus ? scannerStatus(r, ads) : {label:r.scanning?"scanning":"idle",cls:r.scanning?"badge":"badge warn",title:""}; const b = el("span",{class:ss.cls,style:"font-size:10px",title:ss.title},ss.label); if(ss.style) b.style.cssText+="font-size:10px;"+ss.style; return b; })(),
          el("span", { class: "muted", style: "font-size:11px;white-space:nowrap" }, `${seen} device${seen !== 1 ? "s" : ""}`),
          beaconHere ? el("span", { style: "font-size:10px;color:#52b788;white-space:nowrap" }, "✓ beacon") : null,
        ].filter(Boolean));
        radioCard.appendChild(row);
      }
    } else {
      radioCard.appendChild(el("div", { class: "muted", style: "font-size:12px" },
        "No radios in snapshot. Switch to Live mode."));
    }
    // Total advertisement count
    const totalAds = (snap?.ble?.advertisements || []).length;
    radioCard.appendChild(el("div", { class: "muted", style: "font-size:11px;margin-top:6px" },
      `${totalAds} total BLE advertisement${totalAds !== 1 ? "s" : ""} in snapshot`));
    wrap.appendChild(radioCard);
  }

  // Readiness check
  const ready = cs.deviceId && cs.mapId;
  const readyCard = el("div", { class: "card", style: `border-color:${ready ? "#52b788" : "#f59e0b"}` }, [
    el("div", { style: `font-weight:700;font-size:14px;margin-bottom:6px;color:${ready ? "#52b788" : "#f59e0b"}` },
      ready ? "✓ Ready to calibrate" : "⚠ Setup incomplete"),
    el("div", { style: "font-size:12px;color:#94a3b8" }, [
      el("span", { style: `color:${cs.deviceId ? "#52b788" : "#f59e0b"}` },
        (cs.deviceId ? "✓" : "✗") + " Beacon device selected"),
      el("br"),
      el("span", { style: `color:${cs.mapId ? "#52b788" : "#f59e0b"}` },
        (cs.mapId ? "\u2713" : "\u2717") + " Floor selected"),
    ]),
    ...(ready ? [
      el("button", {
        class: "btn",
        style: "margin-top:10px;width:100%",
        onclick: () => { cs.tab = "pin"; ctx.actions.renderRooms(); },
      }, "Start Calibrating →"),
    ] : []),
  ]);
  wrap.appendChild(readyCard);

  // Progress summary
  const pts = calData.points || [];
  if (pts.length) {
    const mapIds = [...new Set(pts.map(p => p.map_id).filter(Boolean))];
    const floorIds = [...new Set(pts.map(p => p.floor_id).filter(Boolean))];
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { style: "font-weight:700;font-size:14px;margin-bottom:6px" }, "Calibration Progress"),
      el("div", { style: "font-size:13px;color:#94a3b8" },
        `${pts.length} point${pts.length > 1 ? "s" : ""} collected across ${floorIds.length} floor${floorIds.length > 1 ? "s" : ""}.`),
      el("button", {
        class: "btn inline",
        style: "margin-top:8px",
        onclick: () => { cs.tab = "model"; ctx.actions.renderRooms(); },
      }, "View Model →"),
    ]));
  }

  return wrap;
}

// ── Pin & Listen tab ──────────────────────────────────────────────────────────
function _pinAndListen(ctx, el, cs, calData) {
  const wrap = el("div", { style: "display:flex;flex-direction:column;gap:14px" });

  if (!cs.deviceId || !cs.mapId) {
    wrap.appendChild(el("div", { class: "card", style: "border-color:#f59e0b" }, [
      el("div", { style: "font-size:13px;color:#f59e0b;font-weight:700" }, "Setup required"),
      el("div", { class: "muted", style: "font-size:12px;margin-top:4px" },
        "Return to Setup and select your beacon device and floor."),
      el("button", {
        class: "btn", style: "margin-top:10px",
        onclick: () => { cs.tab = "setup"; ctx.actions.renderRooms(); },
      }, "Go to Setup"),
    ]));
    return wrap;
  }

  const maps = ctx.state.maps?.list || [];
  const mapData = maps.find(m => m.id === cs.mapId);

  // Floor ID — from floor selector state, map fallback, or default
  const floorId = cs._floorId || (mapData?.floor_id) || "main";
  cs._floorId = floorId;

  // Check if we have fabric data for this floor
  const _floorGeo = ctx.state.model?.room_geometry_m || {};
  const _hasFloorData = Object.values(_floorGeo).some(g => g.floor_id === floorId);
  if (!_hasFloorData && !mapData?.image?.filename) {
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { class: "muted" }, "No room geometry for this floor. Draw room boundaries in the Maps tab first, or upload a floor plan."),
    ]));
    return wrap;
  }

  // All calibration points on this floor
  const pts = calData.points || [];
  const floorPts = pts.filter(p => p.floor_id === floorId);
  if (!floorPts.length) {
    wrap.appendChild(el("div", { style: "font-size:12px;color:#78909c;padding:8px 4px;line-height:1.6" },
      "Tap anywhere on the floor plan to place a calibration pin, then press Start Collecting. Stand still at that exact spot for the full duration."));
  }

  // ── Fabric-only floor canvas ─────────────────────────────────────────
  // Renders room geometry, scanner positions, and calibration points
  // directly from the fabric in metre space. No map images.
  const mapWrap = el("div", { style: "position:relative;border-radius:10px;overflow:hidden;border:2px solid #1b3526;touch-action:none" });
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;

  // Fabric spatial data for this floor
  const geo = ctx.state.model?.room_geometry_m || {};
  const scanPos = ctx.state.model?.scanner_positions_m || {};
  const beaconPos = ctx.state.model?.beacon_positions_m || {};

  // Compute metre-space bounding box from room geometry + scanner positions on this floor
  let mMinX = Infinity, mMinY = Infinity, mMaxX = -Infinity, mMaxY = -Infinity;
  for (const [rname, g] of Object.entries(geo)) {
    if (g.floor_id !== floorId) continue;
    if (g.type === "poly" && g.points_m) {
      for (const p of g.points_m) { mMinX = Math.min(mMinX, p[0]); mMinY = Math.min(mMinY, p[1]); mMaxX = Math.max(mMaxX, p[0]); mMaxY = Math.max(mMaxY, p[1]); }
    } else if (g.type === "circle") {
      mMinX = Math.min(mMinX, g.cx_m - g.r_m); mMinY = Math.min(mMinY, g.cy_m - g.r_m);
      mMaxX = Math.max(mMaxX, g.cx_m + g.r_m); mMaxY = Math.max(mMaxY, g.cy_m + g.r_m);
    }
  }
  for (const [src, sp] of Object.entries(scanPos)) {
    if (sp.floor_id !== floorId) continue;
    mMinX = Math.min(mMinX, sp.x_m); mMinY = Math.min(mMinY, sp.y_m);
    mMaxX = Math.max(mMaxX, sp.x_m); mMaxY = Math.max(mMaxY, sp.y_m);
  }
  for (const p of floorPts) {
    if (p.x_m != null) { mMinX = Math.min(mMinX, p.x_m); mMinY = Math.min(mMinY, p.y_m); mMaxX = Math.max(mMaxX, p.x_m); mMaxY = Math.max(mMaxY, p.y_m); }
  }
  if (!isFinite(mMinX)) { mMinX = 0; mMinY = 0; mMaxX = 20; mMaxY = 15; }
  const mPad = Math.max(1, (mMaxX - mMinX) * 0.08);
  mMinX -= mPad; mMinY -= mPad; mMaxX += mPad; mMaxY += mPad;
  const mW = mMaxX - mMinX || 20;
  const mH = mMaxY - mMinY || 15;
  const vbW = 100;
  const vbH = (mH / mW) * vbW;
  const m2svgX = (xm) => ((xm - mMinX) / mW) * vbW;
  const m2svgY = (ym) => ((ym - mMinY) / mH) * vbH;

  // Room polygons from fabric geometry
  let roomsSvg = "";
  for (const [rname, g] of Object.entries(geo)) {
    if (g.floor_id !== floorId) continue;
    const col = ctx.helpers.roomColor ? ctx.helpers.roomColor(rname) : "#52b788";
    if (g.type === "poly" && g.points_m?.length >= 3) {
      const pts2 = g.points_m.map(p => `${m2svgX(p[0]).toFixed(2)},${m2svgY(p[1]).toFixed(2)}`).join(" ");
      roomsSvg += `<polygon points="${pts2}" fill="${col}" fill-opacity="0.15" stroke="${col}" stroke-width="0.4" stroke-opacity="0.6"/>`;
      // Room label at centroid
      const cx = g.points_m.reduce((s, p) => s + p[0], 0) / g.points_m.length;
      const cy = g.points_m.reduce((s, p) => s + p[1], 0) / g.points_m.length;
      roomsSvg += `<text x="${m2svgX(cx).toFixed(2)}" y="${m2svgY(cy).toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-size="2.5" fill="${col}" fill-opacity="0.7" font-weight="600">${rname.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</text>`;
    } else if (g.type === "circle") {
      roomsSvg += `<circle cx="${m2svgX(g.cx_m).toFixed(2)}" cy="${m2svgY(g.cy_m).toFixed(2)}" r="${((g.r_m / mW) * vbW).toFixed(2)}" fill="${col}" fill-opacity="0.15" stroke="${col}" stroke-width="0.4"/>`;
      roomsSvg += `<text x="${m2svgX(g.cx_m).toFixed(2)}" y="${m2svgY(g.cy_m).toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-size="2.5" fill="${col}" fill-opacity="0.7" font-weight="600">${rname.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</text>`;
    }
  }

  // Scanner positions
  let scanSvg = "";
  for (const [src, sp] of Object.entries(scanPos)) {
    if (sp.floor_id !== floorId) continue;
    const sx = m2svgX(sp.x_m), sy = m2svgY(sp.y_m);
    scanSvg += `<rect x="${(sx-1.2).toFixed(2)}" y="${(sy-1.2).toFixed(2)}" width="2.4" height="2.4" rx="0.4" fill="#4db6ac" fill-opacity="0.7" stroke="white" stroke-width="0.3"/>`;
    scanSvg += `<text x="${sx.toFixed(2)}" y="${(sy+3).toFixed(2)}" text-anchor="middle" font-size="1.6" fill="#4db6ac" fill-opacity="0.6">${src.length > 12 ? src.slice(-8) : src}</text>`;
  }

  // Calibration points
  let dotsSvg = floorPts.map(p => {
    if (p.x_m == null) return "";
    const sx = m2svgX(p.x_m), sy = m2svgY(p.y_m);
    const sc = (p.scanner_readings || []).length;
    return `<circle cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="1.8" fill="#52b788" stroke="white" stroke-width="0.5" opacity="0.85"><title>${p.room || p.label || ""} (${sc} scanners)</title></circle>`;
  }).join("");

  // Current pin in metre space
  let pinSvg = "";
  if (cs._pinXm !== undefined && cs._pinXm !== null) {
    const px = m2svgX(cs._pinXm), py = m2svgY(cs._pinYm);
    pinSvg = `
      <circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="5" fill="none" stroke="#f59e0b" stroke-width="1.2" stroke-dasharray="2 1.5" opacity="0.8"/>
      <circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="2" fill="#f59e0b" stroke="white" stroke-width="0.8"/>
      <line x1="${px.toFixed(2)}" y1="${(py-5).toFixed(2)}" x2="${px.toFixed(2)}" y2="${(py-9).toFixed(2)}" stroke="#f59e0b" stroke-width="1"/>`;
  }

  // Grid lines for scale reference (every 5m)
  let gridSvg = "";
  const gridStep = mW > 40 ? 10 : 5;
  const gridStart = Math.ceil(mMinX / gridStep) * gridStep;
  for (let gx = gridStart; gx < mMaxX; gx += gridStep) {
    const sx = m2svgX(gx);
    gridSvg += `<line x1="${sx.toFixed(2)}" y1="0" x2="${sx.toFixed(2)}" y2="${vbH.toFixed(2)}" stroke="#1a3a2a" stroke-width="0.15"/>`;
    gridSvg += `<text x="${sx.toFixed(2)}" y="2" font-size="1.5" fill="#2d5a3d" fill-opacity="0.5">${gx.toFixed(0)}m</text>`;
  }
  const gridStartY = Math.ceil(mMinY / gridStep) * gridStep;
  for (let gy = gridStartY; gy < mMaxY; gy += gridStep) {
    const sy = m2svgY(gy);
    gridSvg += `<line x1="0" y1="${sy.toFixed(2)}" x2="${vbW}" y2="${sy.toFixed(2)}" stroke="#1a3a2a" stroke-width="0.15"/>`;
    gridSvg += `<text x="1" y="${(sy-0.5).toFixed(2)}" font-size="1.5" fill="#2d5a3d" fill-opacity="0.5">${gy.toFixed(0)}m</text>`;
  }

  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH.toFixed(2)}"
      preserveAspectRatio="xMidYMid meet" style="width:100%;display:block;cursor:crosshair;background:#0a1a10;min-height:250px">
    ${gridSvg}
    ${roomsSvg}
    ${scanSvg}
    ${dotsSvg}
    ${pinSvg}
  </svg>`;

  mapWrap.innerHTML = svgStr;

  // Tap handler — click → metres directly
  const svgEl = mapWrap.querySelector("svg");
  if (svgEl && !cs.collecting) {
    const onTap = (ev) => {
      const rect = svgEl.getBoundingClientRect();
      const touch = (ev.changedTouches && ev.changedTouches[0]) || null;
      const clientX = touch ? touch.clientX : ev.clientX;
      const clientY = touch ? touch.clientY : ev.clientY;
      const fracX = (clientX - rect.left) / rect.width;
      const fracY = (clientY - rect.top) / rect.height;
      // Convert directly to metres
      const xm = mMinX + fracX * mW;
      const ym = mMinY + fracY * mH;
      cs._pinXm = xm;
      cs._pinYm = ym;
      // Also set legacy pinX/pinY for save compatibility — derive from first map transform
      cs.pinX = 0.5; cs.pinY = 0.5;
      const _transforms = ctx.state.model?.map_transforms || {};
      for (const [mid, t] of Object.entries(_transforms)) {
        if (t.floor_id !== floorId) continue;
        const sx = t.scale_x_m || 1, sy = t.scale_y_m || 1;
        const rot = t.rotation_rad || 0;
        let dx = xm - (t.origin_x_m || 0), dy = ym - (t.origin_y_m || 0);
        if (Math.abs(rot) > 1e-9) { const c = Math.cos(-rot), s = Math.sin(-rot); const nx = dx*c - dy*s; dy = dx*s + dy*c; dx = nx; }
        cs.pinX = dx / sx; cs.pinY = dy / sy;
        cs.mapId = mid;
        break;
      }
      cs.readings = null;
      // Auto-detect room from fabric geometry
      cs.pinRoom = "";
      for (const [rname, g] of Object.entries(geo)) {
        if (g.floor_id !== floorId) continue;
        if (g.type === "poly" && g.points_m?.length >= 3) {
          let inside = false;
          const pts3 = g.points_m;
          for (let i = 0, j = pts3.length - 1; i < pts3.length; j = i++) {
            const [xi, yi] = pts3[i], [xj, yj] = pts3[j];
            if (((yi > ym) !== (yj > ym)) && (xm < (xj - xi) * (ym - yi) / (yj - yi) + xi)) inside = !inside;
          }
          if (inside) { cs.pinRoom = rname; break; }
        }
      }
      ctx.actions.renderRooms();
    };
    svgEl.addEventListener("click", onTap);
    svgEl.addEventListener("touchend", (ev) => { ev.preventDefault(); onTap(ev); });
  }
  wrap.appendChild(mapWrap);

  // Floor legend
  const roomCount = Object.values(geo).filter(g => g.floor_id === floorId).length;
  const scanCount = Object.values(scanPos).filter(s => s.floor_id === floorId).length;
  wrap.appendChild(el("div", { style: "font-size:11px;color:#78909c;text-align:center" },
    `${floorPts.length} cal point${floorPts.length !== 1 ? "s" : ""} \u00b7 ${roomCount} rooms \u00b7 ${scanCount} scanners \u00b7 tap to place pin`));

  // ── Pin info panel ────────────────────────────────────────────────────────
  if (cs.pinX !== null) {
    const pinPanel = el("div", { class: "card" });

    if (cs.collecting) {
      // Active collection UI — injected as a real DOM node we can update
      const collUI = _buildCollectionUI(ctx, el, cs, mapData);
      pinPanel.appendChild(collUI);
    } else if (cs.readings) {
      // Collection done — show summary + save/discard
      pinPanel.appendChild(_buildSavePanel(ctx, el, cs, calData, mapData));
    } else {
      // Ready to collect
      pinPanel.appendChild(el("div", { style: "margin-bottom:10px" }, [
        el("div", { style: "font-weight:700;font-size:14px;margin-bottom:4px" },
          `Pin at: ${cs.pinRoom || "Unknown room"}`),
        el("div", { style: "font-size:12px;color:#94a3b8" },
          cs._pinXm != null
            ? `Position: ${cs._pinXm.toFixed(1)}m, ${cs._pinYm.toFixed(1)}m`
            : `Position: ${(cs.pinX * 100).toFixed(1)}% \u00d7 ${(cs.pinY * 100).toFixed(1)}%`),
      ]));

      // Optional label
      const lblRow = el("div", { style: "margin-bottom:10px" });
      const lblInput = document.createElement("input");
      lblInput.type = "text";
      lblInput.placeholder = `Label (optional, e.g. "Kitchen center")`;
      lblInput.style.width = "100%";
      lblInput.style.boxSizing = "border-box";
      lblInput.value = cs.pinLabel || "";
      lblInput.addEventListener("input", () => { cs.pinLabel = lblInput.value; });
      lblRow.appendChild(lblInput);
      pinPanel.appendChild(lblRow);

      // Live beacon signal status
      const { perRadio: pinPerRadio } = _findBeaconAds(snap, cs.deviceId);
      const pinRadioCount = Object.keys(pinPerRadio).length;
      // Resolve TX power from selected object (iBeacon tx_power field) for distance estimate
      const _pinObj = (snap?.objects?.list || []).find(o =>
        (o.key || "") === cs.deviceId || (o.address || "").toUpperCase() === (cs.deviceId || "").toUpperCase() ||
        (o.entity_id || "") === cs.deviceId || (o.canonical_id || "") === cs.deviceId);
      const _pinTxPower = _pinObj?.tx_power ?? null;
      const signalBox = el("div", { style: `padding:8px 10px;border-radius:8px;margin-bottom:10px;background:#071008;border:1px solid ${pinRadioCount > 0 ? "#1b3526" : "#7d5c2b"}` });
      if (pinRadioCount > 0) {
        signalBox.appendChild(el("div", { style: "font-size:12px;color:#52b788;font-weight:600;margin-bottom:4px" },
          `✓ Beacon visible on ${pinRadioCount} radio${pinRadioCount > 1 ? "s" : ""}`));
        const sorted = Object.entries(pinPerRadio).sort((a, b) => (b[1].rssi || -200) - (a[1].rssi || -200));
        for (const [src, info] of sorted) {
          signalBox.appendChild(_rssiRow(el, info.name || src, info.rssi, null, info.age_s, _pinTxPower));
        }
      } else {
        signalBox.appendChild(el("div", { style: "font-size:12px;color:#f59e0b;font-weight:600" },
          "⚠ Beacon not currently detected by any radio"));
        signalBox.appendChild(el("div", { class: "muted", style: "font-size:11px;margin-top:3px" },
          "Collection will start but may capture no data. Verify beacon is broadcasting."));
      }
      pinPanel.appendChild(signalBox);

      // Start button
      const startBtn = el("button", {
        class: "btn",
        style: "width:100%;font-size:15px;padding:12px",
      }, `▶  Start Collecting (${cs.duration}s)`);
      startBtn.addEventListener("click", () => _startCollection(ctx, cs, snap, mapData));
      pinPanel.appendChild(startBtn);
    }

    wrap.appendChild(pinPanel);
  }

  return wrap;
}

// ── Collection UI ─────────────────────────────────────────────────────────────
function _buildCollectionUI(ctx, el, cs) {
  const wrap = el("div", { id: "collect-ui" });
  wrap.appendChild(el("div", { style: "font-weight:700;font-size:15px;text-align:center;margin-bottom:10px" },
    "Collecting — hold still!"));

  // Countdown — updated by collection loop via direct DOM ref stored on cs
  const timerDiv = el("div", {
    id: "collect-timer",
    style: "font-size:48px;font-weight:900;text-align:center;color:#52b788;font-family:monospace;margin-bottom:4px",
  }, "…");
  cs._timerEl = timerDiv;   // store ref so loop can update without document.getElementById
  wrap.appendChild(timerDiv);

  // Poll counter — proves the loop is running
  const pollDiv = el("div", {
    style: "font-size:11px;text-align:center;color:#78909c;margin-bottom:12px;font-family:monospace",
  }, `Poll #${cs._pollCount || 0}  ·  ${_totalSamples(cs)} sample${_totalSamples(cs) !== 1 ? "s" : ""} collected`);
  cs._pollCountEl = pollDiv;
  wrap.appendChild(pollDiv);

  wrap.appendChild(el("div", { style: "font-size:12px;color:#78909c;text-align:center;margin-bottom:8px" },
    "Per-radio RSSI (updating live):"));

  // Scanner RSSI container — updated by collection loop
  const scanDiv = el("div", { id: "collect-scanners", style: "display:flex;flex-direction:column;gap:6px" });
  cs._scanEl = scanDiv;     // store ref so loop can update without document.getElementById
  // Populate immediately from any readings already accumulated
  const { el: elHelper } = ctx.helpers;
  for (const [src, rd] of Object.entries(cs.readings || {})) {
    const mean = rd.samples.length ? rd.samples.reduce((a, b) => a + b, 0) / rd.samples.length : -100;
    scanDiv.appendChild(_rssiRow(elHelper, rd.name || src, Math.round(mean), rd.samples.length, null, cs._txPower));
  }
  wrap.appendChild(scanDiv);

  // Stop button
  const stopBtn = el("button", {
    class: "btn inline",
    style: "margin-top:14px;width:100%",
  }, "Stop & Discard");
  stopBtn.addEventListener("click", () => {
    cs.stopFlag = true;
    cs.collecting = false;
    cs.readings = null;
    ctx.actions.renderRooms();
  });
  wrap.appendChild(stopBtn);

  return wrap;
}

// ── Start collection loop ─────────────────────────────────────────────────────
function _startCollection(ctx, cs, _snap, _mapData) {
  cs.collecting  = true;
  cs.stopFlag    = false;
  cs.readings    = {};
  cs._pollCount  = 0;
  // Resolve TX power for distance estimates during/after collection
  const _csObj = (_snap?.objects?.list || []).find(o =>
    (o.key || "") === cs.deviceId || (o.address || "").toUpperCase() === (cs.deviceId || "").toUpperCase() ||
    (o.entity_id || "") === cs.deviceId || (o.canonical_id || "") === cs.deviceId);
  cs._txPower = _csObj?.tx_power ?? null;
  ctx.actions.renderRooms();

  const endTime = Date.now() + cs.duration * 1000;

  const loop = async () => {
    if (cs.stopFlag) return;

    // Poll snapshot
    try { await ctx.actions.refreshSnapshot(); } catch (_) { /**/ }
    cs._pollCount = (cs._pollCount || 0) + 1;

    const snap = ctx.state.live?.snapshot;

    // ── Collect per-radio RSSI from BLE advertisements (primary source) ──────
    // snap.objects.list[].sources is a list of {source, rssi, age_s} objects.
    // The real per-radio RSSI also lives in snap.ble.advertisements, one entry per {device,radio}.
    const { perRadio } = _findBeaconAds(snap, cs.deviceId);
    for (const [src, info] of Object.entries(perRadio)) {
      if (typeof info.rssi !== "number") continue;
      if (!cs.readings[src]) {
        cs.readings[src] = { name: info.name || src, samples: [] };
      } else if (info.name && info.name !== src) {
        cs.readings[src].name = info.name; // update to area name if now available
      }
      cs.readings[src].samples.push(info.rssi);
    }

    const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    const total = _totalSamples(cs);
    const { el } = ctx.helpers;

    // Update DOM directly via refs stored on cs (works in shadow DOM)
    if (cs._timerEl) cs._timerEl.textContent = remaining + "s";
    if (cs._pollCountEl) cs._pollCountEl.textContent =
      `Poll #${cs._pollCount}  ·  ${total} sample${total !== 1 ? "s" : ""} collected`;
    if (cs._scanEl) {
      cs._scanEl.innerHTML = "";
      const sorted = Object.entries(cs.readings).sort((a, b) => {
        const ma = a[1].samples.length ? a[1].samples.reduce((x,y)=>x+y,0)/a[1].samples.length : -200;
        const mb = b[1].samples.length ? b[1].samples.reduce((x,y)=>x+y,0)/b[1].samples.length : -200;
        return mb - ma;
      });
      if (sorted.length) {
        for (const [src, rd] of sorted) {
          const mean = rd.samples.reduce((a, b) => a + b, 0) / rd.samples.length;
          cs._scanEl.appendChild(_rssiRow(el, rd.name || src, Math.round(mean), rd.samples.length, null, cs._txPower));
        }
      } else {
        cs._scanEl.appendChild(el("div", { style: "font-size:12px;color:#f59e0b;text-align:center;padding:8px" },
          "Beacon not detected yet. Make sure Bluetooth is on and device is near a scanner."));
      }
    }

    if (Date.now() >= endTime || cs.stopFlag) {
      cs.collecting = false;
      cs.readings = (!cs.stopFlag && Object.keys(cs.readings).length > 0) ? cs.readings : null;
      ctx.actions.renderRooms();
      return;
    }

    const nextIn = Math.min(POLL_MS, endTime - Date.now());
    if (nextIn > 0) setTimeout(loop, nextIn);
  };

  loop();
}

// ── Save panel (after collection) ─────────────────────────────────────────────
function _buildSavePanel(ctx, el, cs, calData, mapData) {
  const wrap = el("div");
  const readingsEntries = Object.entries(cs.readings || {});
  const totalSamples = readingsEntries.reduce((s, [, r]) => s + r.samples.length, 0);

  wrap.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:8px;color:#52b788" },
    "✓ Collection complete"));
  wrap.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:10px" },
    `${readingsEntries.length} scanner${readingsEntries.length !== 1 ? "s" : ""} · ${totalSamples} total samples · ${cs.pinRoom || "unknown room"}`));

  // Per-scanner summary
  if (readingsEntries.length) {
    for (const [src, rd] of readingsEntries) {
      const mean = rd.samples.length ? rd.samples.reduce((a, b) => a + b, 0) / rd.samples.length : -100;
      wrap.appendChild(_rssiRow(el, rd.name || src, Math.round(mean), rd.samples.length, null, cs._txPower));
    }
  } else {
    wrap.appendChild(el("div", { style: "font-size:12px;color:#f59e0b;margin-bottom:8px" },
      "No scanner data captured. The device was not visible during collection."));
  }

  // Buttons
  const btnRow = el("div", { style: "display:flex;gap:8px;margin-top:12px" });

  if (readingsEntries.length > 0) {
    const saveBtn = el("button", { class: "btn", style: "flex:1" }, "Save Point");
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        // Build point payload
        const scannerReadings = readingsEntries.map(([source, rd]) => ({
          source,
          name: rd.name || source,
          rssi_samples: rd.samples,
        }));
        // Save with metre coords directly (fabric authority)
        const _pt = {
          floor_id:  floorId,
          room:      cs.pinRoom || "",
          label:     cs.pinLabel || "",
          device_id: cs.deviceId || "",
          duration_s: cs.duration,
          scanner_readings: scannerReadings,
          x_frac:    cs.pinX ?? 0.5,
          y_frac:    cs.pinY ?? 0.5,
          map_id:    cs.mapId || "",
        };
        // Metre coords from the fabric canvas tap (primary)
        if (cs._pinXm != null) {
          _pt.x_m = Math.round(cs._pinXm * 1000) / 1000;
          _pt.y_m = Math.round(cs._pinYm * 1000) / 1000;
        }
        await ctx.actions.calibrationSavePoint(_pt);
        // Refresh local DB
        const fresh = await ctx.actions.calibrationGet();
        ctx.state.calibration = fresh;
        cs.readings   = null;
        cs.pinX       = null;
        cs.pinY       = null;
        cs.pinRoom    = null;
        cs.pinLabel   = "";
        cs.savedThisSession++;
        ctx.toast(`Point saved (${cs.savedThisSession} this session).`);
        ctx.actions.renderRooms();
      } catch (e) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Point";
        ctx.toast("Save failed: " + String(e), true);
      }
    });
    btnRow.appendChild(saveBtn);
  }

  const discardBtn = el("button", { class: "btn inline", style: "flex:1" }, "Discard");
  discardBtn.addEventListener("click", () => {
    cs.readings = null;
    cs.pinX     = null;
    cs.pinY     = null;
    cs._pinXm   = null;
    cs._pinYm   = null;
    cs.pinLabel = "";
    ctx.actions.renderRooms();
  });
  btnRow.appendChild(discardBtn);
  wrap.appendChild(btnRow);

  return wrap;
}

// ── Roam tab (fabric-based, no map images) ───────────────────────────────────
function _roam(ctx, el, cs, calData) {
  const wrap = el("div", { style: "display:flex;flex-direction:column;gap:14px" });
  const floorId = cs._floorId || "main";

  if (!cs.deviceId) {
    wrap.appendChild(el("div", { class: "card", style: "border-color:#f59e0b" }, [
      el("div", { style: "color:#f59e0b;font-weight:700" }, "Setup required"),
      el("button", { class: "btn", style: "margin-top:10px",
        onclick: () => { cs.tab = "setup"; ctx.actions.renderRooms(); },
      }, "Go to Setup"),
    ]));
    return wrap;
  }

  const geo = ctx.state.model?.room_geometry_m || {};
  const scanPos = ctx.state.model?.scanner_positions_m || {};
  const pts = calData.points || [];
  const floorPts = pts.filter(p => p.floor_id === floorId && p.x_m != null);

  // Coverage grid in metre space
  const grid = _computeCoverage(floorPts.map(p => ({x_frac: p.x_m, y_frac: p.y_m})), GRID_N);
  const covered = grid.filter(v => v >= 0.5).length;
  const pct = Math.round(covered / (GRID_N * GRID_N) * 100);
  const target = _nextTarget(grid, GRID_N);

  // Progress bar
  const progCard = el("div", { class: "card" });
  progCard.appendChild(el("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:8px" }, [
    el("div", { style: "font-weight:700;font-size:14px" }, "Coverage"),
    el("span", { class: "badge", style: "margin-left:auto" }, `${floorPts.length} points`),
    el("span", { class: pct >= 70 ? "badge" : "badge warn" }, `${pct}%`),
  ]));
  const barOuter = el("div", { style: "height:10px;background:#1b3526;border-radius:5px;overflow:hidden" });
  barOuter.appendChild(el("div", { style: `height:100%;width:${pct}%;background:${pct >= 70 ? "#52b788" : pct >= 40 ? "#f59e0b" : "#dc2626"};transition:width 0.5s` }));
  progCard.appendChild(barOuter);
  progCard.appendChild(el("div", { class: "muted", style: "font-size:11px;margin-top:6px" },
    pct >= 80 ? "\u2713 Excellent coverage." : pct >= 50 ? "Good progress. Keep adding points." : "Keep going \u2014 more points needed."));
  wrap.appendChild(progCard);

  // Fabric floor canvas with coverage heatmap overlay
  // Compute metre bounding box
  let mMinX = Infinity, mMinY = Infinity, mMaxX = -Infinity, mMaxY = -Infinity;
  for (const g of Object.values(geo)) {
    if (g.floor_id !== floorId) continue;
    if (g.type === "poly" && g.points_m) for (const p of g.points_m) { mMinX=Math.min(mMinX,p[0]); mMinY=Math.min(mMinY,p[1]); mMaxX=Math.max(mMaxX,p[0]); mMaxY=Math.max(mMaxY,p[1]); }
    else if (g.type === "circle") { mMinX=Math.min(mMinX,g.cx_m-g.r_m); mMinY=Math.min(mMinY,g.cy_m-g.r_m); mMaxX=Math.max(mMaxX,g.cx_m+g.r_m); mMaxY=Math.max(mMaxY,g.cy_m+g.r_m); }
  }
  for (const sp of Object.values(scanPos)) { if(sp.floor_id===floorId){mMinX=Math.min(mMinX,sp.x_m);mMinY=Math.min(mMinY,sp.y_m);mMaxX=Math.max(mMaxX,sp.x_m);mMaxY=Math.max(mMaxY,sp.y_m);} }
  if (!isFinite(mMinX)) { mMinX=0; mMinY=0; mMaxX=20; mMaxY=15; }
  const mPad = Math.max(1, (mMaxX-mMinX)*0.08);
  mMinX-=mPad; mMinY-=mPad; mMaxX+=mPad; mMaxY+=mPad;
  const mW=mMaxX-mMinX||20, mH=mMaxY-mMinY||15;
  const vbW=100, vbH=(mH/mW)*vbW;
  const m2x = xm => ((xm-mMinX)/mW)*vbW;
  const m2y = ym => ((ym-mMinY)/mH)*vbH;

  // Coverage grid cells (in metre space, mapped to SVG)
  const cellW = vbW / GRID_N, cellH = vbH / GRID_N;
  let gridSvg = "";
  for (let cy=0; cy<GRID_N; cy++) for (let cx=0; cx<GRID_N; cx++) {
    const v = grid[cy*GRID_N+cx];
    const opacity = Math.max(0, 0.5*(1-v)).toFixed(2);
    const color = v >= 0.5 ? "#52b788" : v >= 0.2 ? "#f59e0b" : "#dc2626";
    gridSvg += `<rect x="${(cx*cellW).toFixed(2)}" y="${(cy*cellH).toFixed(2)}" width="${cellW.toFixed(2)}" height="${cellH.toFixed(2)}" fill="${color}" opacity="${opacity}" rx="0.3"/>`;
  }

  // Room outlines
  let roomsSvg = "";
  for (const [rname, g] of Object.entries(geo)) {
    if (g.floor_id !== floorId) continue;
    const col = ctx.helpers.roomColor ? ctx.helpers.roomColor(rname) : "#52b788";
    if (g.type === "poly" && g.points_m?.length >= 3) {
      roomsSvg += `<polygon points="${g.points_m.map(p=>`${m2x(p[0]).toFixed(2)},${m2y(p[1]).toFixed(2)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="0.5" stroke-opacity="0.8"/>`;
      const cx2=g.points_m.reduce((s,p)=>s+p[0],0)/g.points_m.length;
      const cy2=g.points_m.reduce((s,p)=>s+p[1],0)/g.points_m.length;
      roomsSvg += `<text x="${m2x(cx2).toFixed(2)}" y="${m2y(cy2).toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-size="2.2" fill="${col}" fill-opacity="0.6" font-weight="600">${rname.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</text>`;
    }
  }

  // Cal points
  const dotsSvg = floorPts.map(p => `<circle cx="${m2x(p.x_m).toFixed(2)}" cy="${m2y(p.y_m).toFixed(2)}" r="1.5" fill="#52b788" stroke="white" stroke-width="0.4" opacity="0.9"/>`).join("");

  // Target crosshair (target is in 0-1 grid space → convert to SVG)
  const tx = (target.x_frac * vbW).toFixed(2);
  const ty = (target.y_frac * vbH).toFixed(2);
  const targetSvg = pct < 100 ? `
    <circle cx="${tx}" cy="${ty}" r="5" fill="none" stroke="#60a5fa" stroke-width="1.5" stroke-dasharray="2 1.5"/>
    <circle cx="${tx}" cy="${ty}" r="2" fill="#60a5fa"/>
    <line x1="${tx}" y1="${(parseFloat(ty)-5)}" x2="${tx}" y2="${(parseFloat(ty)-9)}" stroke="#60a5fa" stroke-width="1"/>
    <line x1="${tx}" y1="${(parseFloat(ty)+5)}" x2="${tx}" y2="${(parseFloat(ty)+9)}" stroke="#60a5fa" stroke-width="1"/>
    <line x1="${(parseFloat(tx)-5)}" y1="${ty}" x2="${(parseFloat(tx)-9)}" y2="${ty}" stroke="#60a5fa" stroke-width="1"/>
    <line x1="${(parseFloat(tx)+5)}" y1="${ty}" x2="${(parseFloat(tx)+9)}" y2="${ty}" stroke="#60a5fa" stroke-width="1"/>` : "";

  const mapWrap2 = el("div", { style: "border-radius:10px;overflow:hidden;border:2px solid #1b3526" });
  mapWrap2.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH.toFixed(2)}"
      preserveAspectRatio="xMidYMid meet" style="width:100%;display:block;background:#0a1a10;min-height:200px">
    ${gridSvg}${roomsSvg}${dotsSvg}${targetSvg}
  </svg>`;
  wrap.appendChild(mapWrap2);

  // Legend
  wrap.appendChild(el("div", { style: "display:flex;gap:14px;font-size:11px;color:#78909c;padding:0 4px" }, [
    el("span", {}, [el("span", { style: "color:#52b788" }, "\u25a0 "), "Covered"]),
    el("span", {}, [el("span", { style: "color:#f59e0b" }, "\u25a0 "), "Partial"]),
    el("span", {}, [el("span", { style: "color:#dc2626" }, "\u25a0 "), "Uncovered"]),
    el("span", {}, [el("span", { style: "color:#60a5fa" }, "\u2295 "), "Target"]),
  ]));

  // Next target card
  if (pct < 100) {
    // Convert target grid position to metres for room detection
    const tgtXm = mMinX + target.x_frac * mW;
    const tgtYm = mMinY + target.y_frac * mH;
    let tgtRoom = "";
    for (const [rname, g] of Object.entries(geo)) {
      if (g.floor_id !== floorId || g.type !== "poly" || !g.points_m?.length) continue;
      let inside = false;
      const pts2 = g.points_m;
      for (let i=0, j=pts2.length-1; i<pts2.length; j=i++) {
        const [xi,yi]=pts2[i],[xj,yj]=pts2[j];
        if(((yi>tgtYm)!==(yj>tgtYm))&&(tgtXm<(xj-xi)*(tgtYm-yi)/(yj-yi)+xi)) inside=!inside;
      }
      if (inside) { tgtRoom = rname; break; }
    }

    const tgtCard = el("div", { class: "card", style: "border-color:#60a5fa" });
    tgtCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;color:#60a5fa;margin-bottom:6px" }, "Next Target"));
    tgtCard.appendChild(el("div", { style: "font-size:13px;margin-bottom:4px" },
      tgtRoom ? `Go to: ${tgtRoom}` : `Position: ${tgtXm.toFixed(1)}m, ${tgtYm.toFixed(1)}m`));
    tgtCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:12px" },
      "Walk to the blue crosshair. Stand still, then press the button below."));

    if (cs.collecting) {
      tgtCard.appendChild(_buildCollectionUI(ctx, el, cs));
    } else if (cs.readings) {
      const maps = ctx.state.maps?.list || [];
      const mapData = maps.find(m => m.id === cs.mapId);
      tgtCard.appendChild(_buildSavePanel(ctx, el, cs, calData, mapData));
    } else {
      const collectBtn = el("button", { class: "btn", style: "width:100%;font-size:15px;padding:12px" },
        `\u25b6  I'm Here \u2014 Collect (${cs.duration}s)`);
      collectBtn.addEventListener("click", () => {
        cs._pinXm = tgtXm;
        cs._pinYm = tgtYm;
        cs.pinRoom = tgtRoom || "";
        cs.pinLabel = tgtRoom ? `Roam: ${tgtRoom}` : "Roam point";
        // Derive legacy fracs for save compat
        cs.pinX = target.x_frac; cs.pinY = target.y_frac;
        const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
        _startCollection(ctx, cs, snap);
      });
      tgtCard.appendChild(collectBtn);
    }
    wrap.appendChild(tgtCard);
  } else {
    wrap.appendChild(el("div", { class: "card", style: "border-color:#52b788;text-align:center" }, [
      el("div", { style: "font-size:28px;margin-bottom:8px" }, "\ud83c\udf89"),
      el("div", { style: "font-weight:700;font-size:15px;color:#52b788;margin-bottom:6px" }, "Full Coverage!"),
      el("div", { class: "muted", style: "font-size:12px" }, "Every zone has calibration data. Check the Model tab."),
      el("button", { class: "btn", style: "margin-top:12px",
        onclick: () => { cs.tab = "model"; ctx.actions.renderRooms(); },
      }, "View Model \u2192"),
    ]));
  }

  return wrap;
}

// ── Model tab ─────────────────────────────────────────────────────────────────
function _modelTab(ctx, el, cs, calData) {
  const wrap = el("div", { style: "display:flex;flex-direction:column;gap:14px" });
  const pts  = calData.points || [];
  const model = calData.model || {};
  const maps  = ctx.state.maps?.list || [];

  // Compute button
  const computeCard = el("div", { class: "card" });
  computeCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:6px" }, "Model Computation"));
  computeCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
    "Fit path-loss curves and run cross-validation after adding new calibration points."));
  const computeWrap = el("div", { style: "display:flex;gap:8px;align-items:center" });
  const makeComputeBtn = () => {
    const b = el("button", { class: "btn" }, "Compute Model");
    b.addEventListener("click", async () => {
      computeWrap.innerHTML = "";
      computeWrap.appendChild(el("span", { class: "muted", style: "font-size:12px" }, "Computing…"));
      try {
        const result = await ctx.actions.calibrationComputeModel();
        ctx.state.calibration = await ctx.actions.calibrationGet();
        ctx.toast("Model computed.");
        ctx.actions.renderRooms();
      } catch (e) {
        ctx.toast("Compute failed: " + String(e), true);
        computeWrap.innerHTML = "";
        computeWrap.appendChild(makeComputeBtn());
      }
    });
    return b;
  };
  computeWrap.appendChild(makeComputeBtn());
  computeCard.appendChild(computeWrap);

  if (model.last_computed) {
    computeCard.appendChild(el("div", {
      class: "muted",
      style: "font-size:11px;margin-top:8px",
    }, `Last computed: ${model.last_computed}`));
  }
  wrap.appendChild(computeCard);

  if (!pts.length) {
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { class: "muted" }, "No calibration points yet. Use Tune, Beacon Tune, Pin & Listen, or Roam to collect data."),
    ]));
    return wrap;
  }

  // Summary stats
  const mapIds = [...new Set(pts.map(p => p.map_id))];
  const scanners = new Set();
  pts.forEach(p => p.scanner_readings?.forEach(r => scanners.add(r.source)));

  const summCard = el("div", { class: "card" });
  summCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:12px" }, "Summary"));
  const statGrid = el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px" });
  const stat = (label, value, color) => el("div", { style: "background:#0a150e;border:1px solid #1b3526;border-radius:8px;padding:10px;text-align:center" }, [
    el("div", { style: `font-size:22px;font-weight:900;color:${color || "#52b788"}` }, String(value)),
    el("div", { style: "font-size:11px;color:#78909c;margin-top:2px" }, label),
  ]);
  statGrid.appendChild(stat("Calibration Points", pts.length));
  statGrid.appendChild(stat("Scanners Seen", scanners.size));
  statGrid.appendChild(stat("Maps Calibrated", mapIds.length));

  const loo = model.loo_accuracy;
  if (loo) {
    statGrid.appendChild(stat("Est. Accuracy", `~${loo.mean_error_m_est}m`, loo.mean_error_m_est < 2 ? "#52b788" : "#f59e0b"));
  } else {
    statGrid.appendChild(stat("Accuracy", pts.length >= 4 ? "Compute →" : "Need ≥4 pts", "#78909c"));
  }
  summCard.appendChild(statGrid);
  wrap.appendChild(summCard);

  // Per-map coverage mini-maps
  for (const mid of mapIds) {
    const mapData = maps.find(m => m.id === mid);
    const mapPts  = pts.filter(p => p.map_id === mid);
    const grid = _computeCoverage(mapPts, GRID_N);
    const covered = grid.filter(v => v >= 0.5).length;
    const pct = Math.round(covered / (GRID_N * GRID_N) * 100);

    const mapCovCard = el("div", { class: "card" });
    mapCovCard.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px" }, [
      el("div", { style: "font-weight:700;font-size:13px" }, mapData?.name || mid),
      el("span", { class: "badge", style: "margin-left:auto" }, `${mapPts.length} pts`),
      el("span", { class: pct >= 70 ? "badge" : "badge warn" }, `${pct}%`),
    ]));

    if (mapData?.image?.filename) {
      const ar = (mapData.image.height || 600) / (mapData.image.width || 800);
      const vbH = ar * 100;
      const imgUrl = `/local/padspan_ha/maps/${mapData.image.filename}`;
      const cellW = 100 / GRID_N;
      const cellH = vbH / GRID_N;

      let gSvg = "";
      for (let cy = 0; cy < GRID_N; cy++) {
        for (let cx = 0; cx < GRID_N; cx++) {
          const v = grid[cy * GRID_N + cx];
          const op = Math.max(0, 0.55 * (1 - v)).toFixed(2);
          const col = v >= 0.5 ? "#52b788" : v >= 0.2 ? "#f59e0b" : "#dc2626";
          gSvg += `<rect x="${(cx * cellW).toFixed(1)}" y="${(cy * cellH).toFixed(1)}" width="${cellW.toFixed(1)}" height="${cellH.toFixed(1)}" fill="${col}" opacity="${op}" rx="0.5"/>`;
        }
      }
      const dotsSvg = mapPts.map(p =>
        `<circle cx="${(p.x_frac * 100).toFixed(1)}" cy="${(p.y_frac * vbH).toFixed(1)}" r="2" fill="#52b788" stroke="white" stroke-width="0.6" opacity="0.9"/>`
      ).join("");

      const miniDiv = el("div", { style: "border-radius:6px;overflow:hidden;border:1px solid #1b3526;margin-bottom:8px" });
      miniDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${vbH}" preserveAspectRatio="none" style="width:100%;display:block">
        <image href="${imgUrl}" x="0" y="0" width="100" height="${vbH}" preserveAspectRatio="none"/>
        ${gSvg}${dotsSvg}
      </svg>`;
      mapCovCard.appendChild(miniDiv);
    }

    // LOO accuracy for this map
    const mapLoo = model.coverage_by_map?.[mid]?.loo_accuracy;
    if (mapLoo) {
      mapCovCard.appendChild(el("div", { style: "font-size:12px;color:#94a3b8" },
        `Cross-validation accuracy: ~${mapLoo.mean_error_m_est}m mean · ${mapLoo.max_error_frac.toFixed(3)} frac max`));
    }
    wrap.appendChild(mapCovCard);
  }

  // Per-scanner path-loss stats
  if (model.path_loss && Object.keys(model.path_loss).length) {
    const plCard = el("div", { class: "card" });
    plCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:10px" }, "Path-Loss Fits"));
    plCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
      "RSSI = RSSI_1m − 10 · n · log₁₀(d). n > 3 = heavy attenuation (walls/floors). R² > 0.7 = reliable fit."));
    const tbody = el("tbody");
    for (const [src, fit] of Object.entries(model.path_loss)) {
      const rSqColor = fit.r_squared >= 0.7 ? "#52b788" : fit.r_squared >= 0.4 ? "#f59e0b" : "#dc2626";
      tbody.appendChild(el("tr", {}, [
        el("td", { style: "font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" },
          fit.scanner_name || src),
        el("td", { style: "font-family:monospace;font-size:11px" }, fit.n.toFixed(2)),
        el("td", { style: "font-family:monospace;font-size:11px" }, fit.rssi_1m + " dBm"),
        el("td", { style: `font-family:monospace;font-size:11px;color:${rSqColor}` }, fit.r_squared.toFixed(2)),
        el("td", { class: "muted", style: "font-size:11px" }, fit.point_count),
      ]));
    }
    plCard.appendChild(el("table", { class: "table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Scanner"), el("th", {}, "n"), el("th", {}, "RSSI@1m"), el("th", {}, "R²"), el("th", {}, "Pts"),
      ])),
      tbody,
    ]));
    wrap.appendChild(plCard);
  }

  // Per-scanner general stats
  if (model.scanner_stats && Object.keys(model.scanner_stats).length) {
    const ssCard = el("div", { class: "card" });
    ssCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:10px" }, "Scanner Coverage"));
    const tbody = el("tbody");
    for (const [src, st] of Object.entries(model.scanner_stats)) {
      tbody.appendChild(el("tr", {}, [
        el("td", { style: "font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" },
          st.name || src),
        el("td", { style: "font-family:monospace;font-size:11px" }, st.mean_rssi != null ? st.mean_rssi + " dBm" : "—"),
        el("td", { style: "font-family:monospace;font-size:11px" }, st.std_rssi != null ? "±" + st.std_rssi : "—"),
        el("td", { class: "muted", style: "font-size:11px" }, st.point_count),
      ]));
    }
    ssCard.appendChild(el("table", { class: "table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Scanner"), el("th", {}, "Mean RSSI"), el("th", {}, "Std"), el("th", {}, "Pts"),
      ])),
      tbody,
    ]));
    wrap.appendChild(ssCard);
  }

  // Calibration points list
  const ptsCard = el("div", { class: "card" });
  ptsCard.appendChild(el("div", { class: "row", style: "margin-bottom:10px" }, [
    el("div", { style: "font-weight:700;font-size:14px" }, "Calibration Points"),
    el("span", { class: "badge", style: "margin-left:8px" }, pts.length),
  ]));
  const ptsList = el("div", { style: "display:flex;flex-direction:column;gap:4px;max-height:320px;overflow-y:auto" });
  for (const pt of [...pts].reverse()) {
    const mapName = maps.find(m => m.id === pt.map_id)?.name || pt.map_id || "?";
    const sc = pt.scanner_readings?.length || 0;
    const rowWrap = el("div", {
      style: "display:flex;align-items:center;gap:8px;padding:6px 8px;background:#0a150e;border:1px solid #1b3526;border-radius:8px"
    });
    rowWrap.appendChild(el("div", { style: "flex:1;min-width:0" }, [
      el("div", { style: "font-size:12px;font-weight:600" }, pt.label || pt.room || "Unlabeled"),
      el("div", { style: "font-size:11px;color:#78909c" },
        `${mapName} · ${sc} scanner${sc !== 1 ? "s" : ""} · ${pt.collected_at?.slice(0, 10) || ""}`),
    ]));
    const delWrap = el("div");
    const makeDelBtn = () => {
      const b = el("button", { class: "btn tiny" }, "Delete");
      b.addEventListener("click", () => {
        delWrap.innerHTML = "";
        const yes = el("button", { class: "btn tiny", style: "background:#7f1d1d;border-color:#dc2626" }, "Yes");
        const no  = el("button", { class: "btn tiny" }, "No");
        yes.addEventListener("click", async () => {
          delWrap.innerHTML = "";
          try {
            await ctx.actions.calibrationDeletePoint(pt.id);
            ctx.state.calibration = await ctx.actions.calibrationGet();
            ctx.actions.renderRooms();
          } catch (e) {
            ctx.toast("Delete failed: " + String(e), true);
            delWrap.appendChild(makeDelBtn());
          }
        });
        no.addEventListener("click", () => { delWrap.innerHTML = ""; delWrap.appendChild(makeDelBtn()); });
        delWrap.appendChild(yes); delWrap.appendChild(no);
      });
      return b;
    };
    delWrap.appendChild(makeDelBtn());
    rowWrap.appendChild(delWrap);
    ptsList.appendChild(rowWrap);
  }
  ptsCard.appendChild(ptsList);
  wrap.appendChild(ptsCard);

  // Actions
  const actCard = el("div", { class: "card" });
  actCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:10px" }, "Actions"));

  // Export JSON
  const expBtn = el("button", { class: "btn inline" }, "Export JSON");
  expBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(calData, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "padspan_calibration.json";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  });
  actCard.appendChild(expBtn);

  // Clear all
  const clearWrap = el("div", { style: "margin-top:10px;display:flex;gap:8px;align-items:center" });
  const makeClearBtn = () => {
    const b = el("button", { class: "btn inline", style: "border-color:#dc2626;color:#fca5a5" },
      `Clear All (${pts.length})`);
    b.addEventListener("click", () => {
      clearWrap.innerHTML = "";
      const yes = el("button", { class: "btn", style: "background:#7f1d1d;border-color:#dc2626" },
        `Yes, delete all ${pts.length} points`);
      const no  = el("button", { class: "btn inline" }, "Cancel");
      yes.addEventListener("click", async () => {
        clearWrap.innerHTML = "";
        try {
          await ctx.actions.calibrationClear();
          ctx.state.calibration = { points: [], model: {} };
          ctx.toast("All calibration data cleared.");
          ctx.actions.renderRooms();
        } catch (e) {
          ctx.toast("Failed: " + String(e), true);
          clearWrap.appendChild(makeClearBtn());
        }
      });
      no.addEventListener("click", () => { clearWrap.innerHTML = ""; clearWrap.appendChild(makeClearBtn()); });
      clearWrap.appendChild(yes); clearWrap.appendChild(no);
    });
    return b;
  };
  clearWrap.appendChild(makeClearBtn());
  actCard.appendChild(clearWrap);
  wrap.appendChild(actCard);

  return wrap;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Find all BLE advertisements for the given device ID ───────────────────────
// Returns { myAds, perRadio, targetAddr } where perRadio is {source→{name,rssi,age_s}}.
// Handles MAC addresses, entity_id values, canonical_id (private_ble), and iBeacon keys.
function _findBeaconAds(snap, deviceId) {
  if (!snap || !deviceId) return { myAds: [], perRadio: {}, targetAddr: "" };
  const rawId = String(deviceId).trim();
  const upperId = rawId.toUpperCase();
  const objects = snap?.objects?.list || [];

  // Resolve device — collect ALL addresses (handles rotating-MAC private_ble devices)
  let targetAddr = "";
  const targetAddrs = new Set();

  // Helper: extract all addresses from an object
  const _collectAddrs = (obj) => {
    if (obj.address) targetAddrs.add(obj.address.toUpperCase());
    for (const a of (obj.all_addresses || [])) { if (a) targetAddrs.add(String(a).toUpperCase()); }
  };

  if (upperId.match(/^[0-9A-F:]{17}$/)) {
    // Direct MAC address
    targetAddr = upperId;
    targetAddrs.add(upperId);
    const obj = objects.find(o =>
      (o.address || "").toUpperCase() === upperId ||
      (o.all_addresses || []).some(a => String(a).toUpperCase() === upperId)
    );
    if (obj) _collectAddrs(obj);
  } else {
    // Try multiple resolution strategies:
    // 1) entity_id match
    let obj = objects.find(o =>
      (o.entity_id || "") === rawId || (o.entity_id || "").toUpperCase() === upperId
    );
    // 2) canonical_id match (private_ble phones)
    if (!obj) obj = objects.find(o => (o.canonical_id || "") === rawId);
    // 3) key match (ibeacon:uuid:major:minor)
    if (!obj) obj = objects.find(o => (o.key || "") === rawId);
    // 4) address match (iBeacon address field = uuid key)
    if (!obj) obj = objects.find(o => (o.address || "") === rawId);

    if (obj) {
      targetAddr = (obj.address || "").toUpperCase();
      _collectAddrs(obj);
    }

    // 5) If entity_id selected but no BLE address found, try matching via linked_entities.
    //    Bermuda tracker entities don't have a BLE MAC themselves, but may reference
    //    the same HA device as a BLE object that does have advertisements.
    if (!targetAddrs.size && rawId.includes(".")) {
      for (const o of objects) {
        if ((o.linked_entities || []).includes(rawId)) {
          _collectAddrs(o);
          if (!targetAddr && o.address) targetAddr = o.address.toUpperCase();
          break;
        }
      }
    }
  }

  // Build source → display name from snap.ble.radios
  // Include both device name and area for full context
  const radioNameMap = {};
  for (const r of (snap?.ble?.radios || [])) {
    if (!r.source) continue;
    const devName = r.name || r.source;
    const area = r.area_name || r.area || "";
    radioNameMap[r.source] = area && area !== devName ? `${devName} · ${area}` : devName;
  }

  // For private_ble devices, also collect the canonical_id so we can match via _xref
  let targetCanonical = "";
  if (targetAddrs.size > 0) {
    const cObj = objects.find(o => o.kind === "private_ble" && (
      (o.canonical_id || "") === rawId ||
      targetAddrs.has((o.address || "").toUpperCase()) ||
      (o.all_addresses || []).some(a => targetAddrs.has(String(a).toUpperCase()))
    ));
    if (cObj && cObj.canonical_id) targetCanonical = cObj.canonical_id;
  }

  // Filter raw advertisements by ANY known address for this device.
  // For private_ble (rotating MAC), also match via _xref.canonical_id on the ad
  // to catch addresses that rotated AFTER the object was built.
  const myAds = (snap?.ble?.advertisements || []).filter(ad => {
    const adAddr = (ad.address || "").toUpperCase();
    if (targetAddrs.size > 0 && targetAddrs.has(adAddr)) return true;
    if (targetCanonical && ad._xref && ad._xref.canonical_id === targetCanonical) return true;
    if (!targetAddrs.size && !targetCanonical && adAddr === upperId) return true;
    return false;
  });

  // Build per-radio map — keep strongest/most recent reading per radio
  const perRadio = {};
  for (const ad of myAds) {
    const src = String(ad.source || "");
    if (!src) continue;
    if (!perRadio[src] || (ad.rssi || -200) > (perRadio[src].rssi || -200)) {
      perRadio[src] = {
        name: radioNameMap[src] || src,
        rssi: ad.rssi,
        age_s: ad.age_s,
      };
    }
  }
  return { myAds, perRadio, targetAddr };
}

function _totalSamples(cs) {
  return Object.values(cs.readings || {}).reduce((t, r) => t + r.samples.length, 0);
}

function _rssiRow(el, name, rssi, samples, age_s, txPower) {
  const pct = Math.max(0, Math.min(100, ((rssi ?? -100) + 100) / 60 * 100));
  const color = pct >= 66 ? "#52b788" : pct >= 33 ? "#f59e0b" : "#dc2626";
  // Distance estimate: log-distance path loss  d = 10^((txPower - rssi) / (10 * n))
  // txPower = measured RSSI at 1m (default -59 dBm), n = path-loss exponent (default 2.5 for indoor)
  let distStr = null;
  if (rssi != null) {
    const tx = (typeof txPower === "number") ? txPower : -59;
    const n = 2.5;
    const d = Math.pow(10, (tx - rssi) / (10 * n));
    distStr = d < 10 ? `~${d.toFixed(1)}m` : `~${Math.round(d)}m`;
  }
  // Age label
  let ageStr = null;
  if (age_s != null && isFinite(age_s)) {
    ageStr = age_s < 60 ? `${Math.round(age_s)}s ago` : `${Math.floor(age_s / 60)}m ago`;
  }
  return el("div", {
    style: "display:flex;align-items:center;gap:8px;padding:4px 0"
  }, [
    el("div", { style: "font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94a3b8" }, name || "?"),
    ageStr
      ? el("div", { style: "font-size:10px;color:#78909c;width:40px;text-align:right;flex-shrink:0" }, ageStr)
      : null,
    el("div", { style: "width:80px;height:6px;background:#1b3526;border-radius:3px;overflow:hidden;flex-shrink:0" }, [
      el("div", { style: `width:${pct.toFixed(0)}%;height:100%;background:${color}` }),
    ]),
    el("div", { style: "font-family:monospace;font-size:11px;color:#e2e8f0;width:48px;text-align:right;flex-shrink:0" },
      rssi != null ? rssi + " dBm" : "—"),
    distStr
      ? el("div", { style: "font-size:10px;color:#78909c;width:38px;text-align:right;flex-shrink:0" }, distStr)
      : null,
    samples != null
      ? el("div", { style: "font-size:10px;color:#78909c;width:28px;text-align:right;flex-shrink:0" }, "×" + samples)
      : null,
  ].filter(Boolean));
}

function _computeCoverage(pts, gridN) {
  const grid = new Array(gridN * gridN).fill(0);
  for (const pt of pts) {
    const px = pt.x_frac * gridN;
    const py = pt.y_frac * gridN;
    for (let cy = 0; cy < gridN; cy++) {
      for (let cx = 0; cx < gridN; cx++) {
        const dist = Math.sqrt((cx + 0.5 - px) ** 2 + (cy + 0.5 - py) ** 2);
        const contrib = Math.exp(-(dist ** 2) / (2 * SIGMA_C ** 2));
        const idx = cy * gridN + cx;
        grid[idx] = Math.min(1, grid[idx] + contrib);
      }
    }
  }
  return grid;
}

function _nextTarget(grid, gridN) {
  let min = 2, bx = 0.5, by = 0.5;
  for (let cy = 0; cy < gridN; cy++) {
    for (let cx = 0; cx < gridN; cx++) {
      const v = grid[cy * gridN + cx];
      const edgePen = (cx === 0 || cx === gridN - 1 || cy === 0 || cy === gridN - 1) ? 0.05 : 0;
      if (v + edgePen < min) {
        min = v + edgePen;
        bx = (cx + 0.5) / gridN;
        by = (cy + 0.5) / gridN;
      }
    }
  }
  return { x_frac: bx, y_frac: by };
}

// ── Tune tab — 3D iso map with draggable receiver markers ──────────────────
// ══════════════════════════════════════════════════════════════════════════════
// Shared fabric floor editor — renders room geometry, scanners, beacons in
// metre space with drag support. Used by Tune and Beacon Tune tabs.
// ══════════════════════════════════════════════════════════════════════════════

function _fabricFloorEditor(ctx, el, floorId, opts) {
  // opts: { items: [{key, x_m, y_m, label, color, draggable}], onDrop(key, x_m, y_m), onDblClick(x_m, y_m), itemType }
  const geo = ctx.state.model?.room_geometry_m || {};
  const scanPos = ctx.state.model?.scanner_positions_m || {};
  const items = opts.items || [];

  // Compute bounding box from room geometry + items
  let mMinX = Infinity, mMinY = Infinity, mMaxX = -Infinity, mMaxY = -Infinity;
  for (const g of Object.values(geo)) {
    if (g.floor_id !== floorId) continue;
    if (g.type === "poly" && g.points_m) for (const p of g.points_m) { mMinX=Math.min(mMinX,p[0]); mMinY=Math.min(mMinY,p[1]); mMaxX=Math.max(mMaxX,p[0]); mMaxY=Math.max(mMaxY,p[1]); }
    else if (g.type === "circle") { mMinX=Math.min(mMinX,g.cx_m-g.r_m); mMinY=Math.min(mMinY,g.cy_m-g.r_m); mMaxX=Math.max(mMaxX,g.cx_m+g.r_m); mMaxY=Math.max(mMaxY,g.cy_m+g.r_m); }
  }
  for (const sp of Object.values(scanPos)) { if(sp.floor_id===floorId){mMinX=Math.min(mMinX,sp.x_m);mMinY=Math.min(mMinY,sp.y_m);mMaxX=Math.max(mMaxX,sp.x_m);mMaxY=Math.max(mMaxY,sp.y_m);}}
  for (const it of items) { if(it.x_m!=null){mMinX=Math.min(mMinX,it.x_m);mMinY=Math.min(mMinY,it.y_m);mMaxX=Math.max(mMaxX,it.x_m);mMaxY=Math.max(mMaxY,it.y_m);}}
  if (!isFinite(mMinX)) { mMinX=0; mMinY=0; mMaxX=20; mMaxY=15; }
  const mPad = Math.max(1, (mMaxX-mMinX)*0.1);
  mMinX-=mPad; mMinY-=mPad; mMaxX+=mPad; mMaxY+=mPad;
  const mW=mMaxX-mMinX||20, mH=mMaxY-mMinY||15;
  const vbW=100, vbH=(mH/mW)*vbW;
  const m2x = xm => ((xm-mMinX)/mW)*vbW;
  const m2y = ym => ((ym-mMinY)/mH)*vbH;
  const svg2m_x = sx => mMinX + (sx/vbW)*mW;
  const svg2m_y = sy => mMinY + (sy/vbH)*mH;

  // Grid
  let gridSvg = "";
  const gridStep = mW > 40 ? 10 : 5;
  for (let gx = Math.ceil(mMinX/gridStep)*gridStep; gx < mMaxX; gx += gridStep) {
    const sx=m2x(gx); gridSvg+=`<line x1="${sx.toFixed(2)}" y1="0" x2="${sx.toFixed(2)}" y2="${vbH.toFixed(2)}" stroke="#1a3a2a" stroke-width="0.15"/>`;
    gridSvg+=`<text x="${sx.toFixed(2)}" y="2" font-size="1.5" fill="#2d5a3d" fill-opacity="0.5">${gx.toFixed(0)}m</text>`;
  }
  for (let gy = Math.ceil(mMinY/gridStep)*gridStep; gy < mMaxY; gy += gridStep) {
    const sy=m2y(gy); gridSvg+=`<line x1="0" y1="${sy.toFixed(2)}" x2="${vbW}" y2="${sy.toFixed(2)}" stroke="#1a3a2a" stroke-width="0.15"/>`;
  }

  // Rooms
  let roomsSvg = "";
  const roomColorFn = ctx.helpers.roomColor || (() => "#52b788");
  for (const [rname, g] of Object.entries(geo)) {
    if (g.floor_id !== floorId) continue;
    const col = roomColorFn(rname);
    if (g.type === "poly" && g.points_m?.length >= 3) {
      roomsSvg += `<polygon points="${g.points_m.map(p=>`${m2x(p[0]).toFixed(2)},${m2y(p[1]).toFixed(2)}`).join(" ")}" fill="${col}" fill-opacity="0.12" stroke="${col}" stroke-width="0.4"/>`;
      const cx=g.points_m.reduce((s,p)=>s+p[0],0)/g.points_m.length, cy=g.points_m.reduce((s,p)=>s+p[1],0)/g.points_m.length;
      roomsSvg += `<text x="${m2x(cx).toFixed(2)}" y="${m2y(cy).toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-size="2.2" fill="${col}" fill-opacity="0.6" font-weight="600">${rname.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</text>`;
    } else if (g.type === "circle") {
      roomsSvg += `<circle cx="${m2x(g.cx_m).toFixed(2)}" cy="${m2y(g.cy_m).toFixed(2)}" r="${((g.r_m/mW)*vbW).toFixed(2)}" fill="${col}" fill-opacity="0.12" stroke="${col}" stroke-width="0.4"/>`;
      roomsSvg += `<text x="${m2x(g.cx_m).toFixed(2)}" y="${m2y(g.cy_m).toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-size="2.2" fill="${col}" fill-opacity="0.6" font-weight="600">${rname.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</text>`;
    }
  }

  // Scanner reference dots (non-draggable, for context)
  let scanSvg = "";
  if (opts.itemType !== "scanner") {
    for (const [src, sp] of Object.entries(scanPos)) {
      if (sp.floor_id !== floorId) continue;
      scanSvg += `<circle cx="${m2x(sp.x_m).toFixed(2)}" cy="${m2y(sp.y_m).toFixed(2)}" r="1.5" fill="#4db6ac" fill-opacity="0.5" stroke="white" stroke-width="0.3"/>`;
    }
  }

  // Draggable items
  let itemsSvg = "";
  for (const it of items) {
    if (it.x_m == null) continue;
    const sx = m2x(it.x_m), sy = m2y(it.y_m);
    const col = it.color || (opts.itemType === "scanner" ? "#4db6ac" : "#f59e0b");
    const r = it.draggable ? 2.5 : 1.8;
    itemsSvg += `<circle data-key="${it.key}" cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="${r}" fill="${col}" stroke="white" stroke-width="0.6" style="cursor:${it.draggable?"grab":"default"}" opacity="0.9"/>`;
    const lbl = it.label || it.key;
    const shortLbl = lbl.length > 15 ? lbl.slice(-12) : lbl;
    itemsSvg += `<text x="${sx.toFixed(2)}" y="${(sy+3.5).toFixed(2)}" text-anchor="middle" font-size="1.6" fill="${col}" fill-opacity="0.7">${shortLbl.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</text>`;
  }

  const wrap = el("div", { style: "position:relative;border-radius:10px;overflow:hidden;border:2px solid #1b3526;touch-action:none" });
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH.toFixed(2)}"
    preserveAspectRatio="xMidYMid meet" style="width:100%;display:block;cursor:crosshair;background:#0a1a10;min-height:250px">
    ${gridSvg}${roomsSvg}${scanSvg}${itemsSvg}
  </svg>`;

  // Drag + double-click handlers
  const svgEl = wrap.querySelector("svg");
  if (svgEl) {
    let _dragging = null; // {key, startX, startY}
    const _svgCoords = (ev) => {
      const rect = svgEl.getBoundingClientRect();
      const touch = (ev.changedTouches && ev.changedTouches[0]) || null;
      const cx = (touch ? touch.clientX : ev.clientX) - rect.left;
      const cy = (touch ? touch.clientY : ev.clientY) - rect.top;
      const svgX = (cx / rect.width) * vbW;
      const svgY = (cy / rect.height) * vbH;
      return [svg2m_x(svgX), svg2m_y(svgY)];
    };

    svgEl.addEventListener("mousedown", (ev) => {
      const tgt = ev.target.closest("circle[data-key]");
      if (tgt) { _dragging = { key: tgt.dataset.key, el: tgt }; ev.preventDefault(); }
    });
    svgEl.addEventListener("mousemove", (ev) => {
      if (!_dragging) return;
      const [xm, ym] = _svgCoords(ev);
      _dragging.el.setAttribute("cx", m2x(xm).toFixed(2));
      _dragging.el.setAttribute("cy", m2y(ym).toFixed(2));
    });
    const _endDrag = (ev) => {
      if (!_dragging) return;
      const [xm, ym] = _svgCoords(ev);
      if (opts.onDrop) opts.onDrop(_dragging.key, xm, ym);
      _dragging = null;
    };
    svgEl.addEventListener("mouseup", _endDrag);
    svgEl.addEventListener("mouseleave", _endDrag);

    // Touch drag
    svgEl.addEventListener("touchstart", (ev) => {
      const tgt = ev.target.closest("circle[data-key]");
      if (tgt) { _dragging = { key: tgt.dataset.key, el: tgt }; ev.preventDefault(); }
    }, { passive: false });
    svgEl.addEventListener("touchmove", (ev) => {
      if (!_dragging) return;
      ev.preventDefault();
      const [xm, ym] = _svgCoords(ev);
      _dragging.el.setAttribute("cx", m2x(xm).toFixed(2));
      _dragging.el.setAttribute("cy", m2y(ym).toFixed(2));
    }, { passive: false });
    svgEl.addEventListener("touchend", (ev) => {
      if (_dragging) { _endDrag(ev); ev.preventDefault(); }
    });

    // Double-click to place new item
    if (opts.onDblClick) {
      svgEl.addEventListener("dblclick", (ev) => {
        const [xm, ym] = _svgCoords(ev);
        opts.onDblClick(xm, ym);
      });
    }
  }

  return wrap;
}


// ══════════════════════════════════════════════════════════════════════════════
// Tune tab — fabric-based scanner position editor
// ══════════════════════════════════════════════════════════════════════════════

function _tuneTab(ctx, el, cs, calData) {
  const wrap = el("div", { style: "display:flex;flex-direction:column;gap:10px" });
  const floorId = cs._floorId || "main";
  const scanPos = ctx.state.model?.scanner_positions_m || {};

  // Check for fabric data
  const floorScanners = Object.entries(scanPos).filter(([,sp]) => sp.floor_id === floorId);
  const geo = ctx.state.model?.room_geometry_m || {};
  const hasFloorData = Object.values(geo).some(g => g.floor_id === floorId);

  if (!hasFloorData && !floorScanners.length) {
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { style: "font-weight:700;font-size:14px;margin-bottom:6px;color:#52b788" }, "No Floor Data"),
      el("div", { style: "font-size:12px;color:#94a3b8" },
        "Draw room boundaries in the Maps tab first, or migrate existing map data via the Health tab."),
    ]));
    return wrap;
  }

  // Explainer card
  wrap.appendChild(el("div", { class: "card", style: "border-color:#52b788" }, [
    el("div", { style: "font-weight:700;font-size:14px;margin-bottom:6px;color:#52b788" }, "Scanner Position Tuning"),
    el("div", { style: "font-size:12px;color:#94a3b8;line-height:1.5" },
      "Drag scanner markers to match their real-world positions on the floor. Double-click to place a new scanner. Changes save automatically to the fabric."),
  ]));

  // Live radios for placement
  const _snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const _liveRadios = _snap?.ble?.radios || [];

  // Build items from fabric scanner positions
  const scanItems = floorScanners.map(([src, sp]) => ({
    key: src, x_m: sp.x_m, y_m: sp.y_m, label: src, color: "#4db6ac", draggable: true,
  }));

  // Floor editor canvas
  const editorWrap = _fabricFloorEditor(ctx, el, floorId, {
    items: scanItems,
    itemType: "scanner",
    onDrop: async (key, xm, ym) => {
      try {
        await ctx.actions.callWS({ type: "padspan_ha/fabric_scanner_position_set", source: key, x_m: xm, y_m: ym, floor_id: floorId });
        ctx.actions.toast(`Scanner ${key.slice(-8)} moved to ${xm.toFixed(1)}m, ${ym.toFixed(1)}m`);
      } catch(e) { ctx.actions.toast("Save failed: " + (e.message||e)); }
    },
    onDblClick: (xm, ym) => {
      // Show list of unplaced live radios to choose from
      const placed = new Set(floorScanners.map(([s]) => s));
      const unplaced = _liveRadios.filter(r => r.source && !placed.has(r.source));
      if (!unplaced.length) { ctx.actions.toast("All live radios already placed"); return; }
      const items2 = unplaced.map(r => `${r.source} (${r.name||"?"})`);
      const choice = prompt("Place which scanner at this location?\\n\\n" + items2.join("\\n") + "\\n\\nEnter source ID:");
      if (choice) {
        const src = choice.trim();
        ctx.actions.callWS({ type: "padspan_ha/fabric_scanner_position_set", source: src, x_m: xm, y_m: ym, floor_id: floorId })
          .then(() => { ctx.actions.toast(`Placed ${src}`); ctx.actions.renderRooms(); })
          .catch(e => ctx.actions.toast("Failed: " + (e.message||e)));
      }
    },
  });
  wrap.appendChild(editorWrap);

  // Legend
  wrap.appendChild(el("div", { style: "font-size:11px;color:#78909c;text-align:center" },
    `${floorScanners.length} scanner(s) on this floor \u00b7 drag to reposition \u00b7 double-click to place new`));

  return wrap;
}

// Old tune tab 3D isometric code removed — replaced by fabric floor editor.
// Old beacon tune 3D isometric code removed — replaced by fabric floor editor.
// [dead tune code removed]

// ══════════════════════════════════════════════════════════════════════════════
// Beacon Tune tab — fabric-based beacon position editor
// ══════════════════════════════════════════════════════════════════════════════

function _beaconTuneTab(ctx, el, cs, calData) {
  const wrap = el("div", { style: "display:flex;flex-direction:column;gap:10px" });
  const floorId = cs._floorId || "main";
  const beaconPos = ctx.state.model?.beacon_positions_m || {};
  const geo = ctx.state.model?.room_geometry_m || {};
  const hasFloorData = Object.values(geo).some(g => g.floor_id === floorId);
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;

  // Explainer
  wrap.appendChild(el("div", { class: "card", style: "border-color:#f59e0b" }, [
    el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:6px" }, [
      el("span", { style: "background:#f59e0b;color:#000;font-weight:700;font-size:11px;padding:2px 8px;border-radius:4px" }, "EXPERIMENTAL"),
      el("span", { style: "font-weight:700;font-size:14px;color:#f59e0b" }, "Beacon Tune"),
    ]),
    el("div", { style: "font-size:12px;color:#94a3b8;line-height:1.5" },
      "Drag beacon markers to their real-world positions on the floor. Double-click to place a new beacon from live BLE objects. Positions save to the fabric in metres."),
  ]));

  if (!hasFloorData) {
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { class: "muted" }, "No room geometry for this floor. Draw room boundaries in the Maps tab first."),
    ]));
    return wrap;
  }

  // Build items from fabric beacon positions
  const floorBeacons = Object.entries(beaconPos).filter(([,bp]) => bp.floor_id === floorId);
  const beaconItems = floorBeacons.map(([key, bp]) => ({
    key, x_m: bp.x_m, y_m: bp.y_m, label: bp.label || key, color: "#f59e0b", draggable: true,
  }));

  const editorWrap = _fabricFloorEditor(ctx, el, floorId, {
    items: beaconItems,
    itemType: "beacon",
    onDrop: async (key, xm, ym) => {
      try {
        // Determine room from fabric geometry
        let room = "";
        for (const [rname, g] of Object.entries(geo)) {
          if (g.floor_id !== floorId || g.type !== "poly" || !g.points_m?.length) continue;
          let inside = false;
          const pts2 = g.points_m;
          for (let i = 0, j = pts2.length - 1; i < pts2.length; j = i++) {
            const [xi,yi]=pts2[i],[xj,yj]=pts2[j];
            if(((yi>ym)!==(yj>ym))&&(xm<(xj-xi)*(ym-yi)/(yj-yi)+xi)) inside=!inside;
          }
          if (inside) { room = rname; break; }
        }
        await ctx.actions.callWS({ type: "padspan_ha/fabric_beacon_position_set", key, x_m: xm, y_m: ym, floor_id: floorId, room });
        ctx.actions.toast(`Beacon moved to ${xm.toFixed(1)}m, ${ym.toFixed(1)}m${room ? " (" + room + ")" : ""}`);
      } catch(e) { ctx.actions.toast("Save failed: " + (e.message||e)); }
    },
    onDblClick: (xm, ym) => {
      // Show live BLE objects to pick from
      const objects = snap?.objects?.list || [];
      const beaconLike = objects.filter(o => o.kind === "ibeacon" || o.kind === "ble");
      if (!beaconLike.length) { ctx.actions.toast("No live BLE objects detected"); return; }
      const names = beaconLike.slice(0, 20).map(o => `${o.key} (${o.user_label || o.name || "?"})`);
      const choice = prompt("Place which beacon at this location?\\n\\n" + names.join("\\n") + "\\n\\nEnter key:");
      if (choice) {
        const key2 = choice.trim();
        const obj = beaconLike.find(o => o.key === key2);
        ctx.actions.callWS({ type: "padspan_ha/fabric_beacon_position_set", key: key2, x_m: xm, y_m: ym, floor_id: floorId, label: obj?.user_label || obj?.name || key2 })
          .then(() => { ctx.actions.toast(`Beacon placed`); ctx.actions.renderRooms(); })
          .catch(e => ctx.actions.toast("Failed: " + (e.message||e)));
      }
    },
  });
  wrap.appendChild(editorWrap);

  // Legend
  wrap.appendChild(el("div", { style: "font-size:11px;color:#78909c;text-align:center" },
    `${floorBeacons.length} beacon(s) on this floor \u00b7 drag to reposition \u00b7 double-click to place new`));

  return wrap;
}
// OLD BEACON TUNE CODE — dead, preserved for reference
// [dead beacon tune code removed]


function _pointInPoly(px, py, points) {
  let inside = false;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i][0], yi = points[i][1];
    const xj = points[j][0], yj = points[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
