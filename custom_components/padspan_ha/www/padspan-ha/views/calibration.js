// PadSpan HA — BLE Fingerprint Calibration
// Phone-based signal collection for precise indoor location modelling.
//
// Sub-tabs:
//   Setup       — pick your beacon device, collection settings
//   Pin & Listen — tap map to place pin, collect RSSI for N seconds
//   Roam        — guided coverage-maximising walk with live heatmap
//   Model       — quality stats, path-loss fits, LOO accuracy, export

const GRID_N    = 10;    // 10×10 coverage grid
const SIGMA_C   = 1.8;   // Gaussian sigma in cell units
const POLL_MS   = 2500;  // RSSI poll interval during collection

// ── Exports ──────────────────────────────────────────────────────────────────
export function render(ctx) {
  const { el } = ctx.helpers;
  const root = el("section", { id: "calibration" });
  root.className = ctx.state.view === "calibration" ? "" : "hidden";

  // Per-session UI state
  if (!ctx.state._calib) ctx.state._calib = {
    tab:        "setup",
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
    el("div", { style: "font-weight:700;font-size:16px;color:#52b788" }, "BLE Location Calibration"),
    el("div", { style: "font-size:12px;color:#78909c;margin-top:2px" },
      "Build a fingerprint database so PadSpan can pinpoint every beacon in 3D space."),
  ]));

  // Tab bar
  const TABS = [["setup","Setup"],["pin","Pin & Listen"],["roam","Roam"],["model","Model"]];
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

  return root;
}

// ── Setup tab ─────────────────────────────────────────────────────────────────
function _setup(ctx, el, cs, calData) {
  const wrap = el("div", { style: "display:flex;flex-direction:column;gap:14px" });
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;

  // How-it-works explainer
  wrap.appendChild(el("div", { class: "card", style: "border-color:#52b788" }, [
    el("div", { style: "font-weight:700;font-size:14px;margin-bottom:8px;color:#52b788" },
      "How Calibration Works"),
    el("div", { style: "font-size:13px;line-height:1.7;color:#b0c4b1" }, [
      el("div", {}, "1. Your phone broadcasts BLE. The house scanners hear it."),
      el("div", { style: "margin-top:4px" }, "2. You stand at a known spot on the map and tap it."),
      el("div", { style: "margin-top:4px" }, "3. PadSpan records the RSSI fingerprint — which scanners saw you and how strongly."),
      el("div", { style: "margin-top:4px" }, "4. Repeat at 10–20 locations spread across each floor."),
      el("div", { style: "margin-top:4px" }, "5. The Model tab shows location accuracy after enough points are collected."),
    ]),
  ]));

  // Device selector — merge objects.list + raw advertisements so the user can pick ANY BLE device
  const bleObjs = (snap?.objects?.list || [])
    .filter(o => o.kind === "ble" || o.kind === "entity")
    .sort((a, b) => (b.rssi || -100) - (a.rssi || -100));

  // Build unique-address map from raw advertisements (one entry per MAC)
  const adAddrMap = {};
  for (const ad of (snap?.ble?.advertisements || [])) {
    const addr = (ad.address || "").toUpperCase();
    if (!addr) continue;
    if (!adAddrMap[addr]) {
      adAddrMap[addr] = { address: addr, name: ad.name || addr, rssi: ad.rssi };
    } else if ((ad.rssi || -200) > (adAddrMap[addr].rssi || -200)) {
      adAddrMap[addr].rssi = ad.rssi;
    }
  }
  // Only show addresses not already covered by bleObjs
  const knownAddrs = new Set(bleObjs.map(o => (o.address || "").toUpperCase()));
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
    // Tracked objects
    for (const o of bleObjs) {
      const addr = o.address || o.entity_id || "";
      const opt = document.createElement("option");
      opt.value = addr;
      opt.textContent = (o.user_label || o.name || addr) + (o.rssi ? ` (${o.rssi} dBm)` : "");
      if (addr === cs.deviceId) opt.selected = true;
      sel.appendChild(opt);
    }
    // Raw advertisement devices not already in objects.list
    if (adOnlyDevices.length) {
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
      const obj = bleObjs.find(o => (o.address || o.entity_id || "") === sel.value);
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

  // Show selected device live data using advertisements for real per-radio RSSI
  if (cs.deviceId && snap) {
    const { perRadio, targetAddr } = _findBeaconAds(snap, cs.deviceId);
    const radioCount = Object.keys(perRadio).length;
    const obj = (snap?.objects?.list || []).find(o =>
      (o.address || "").toUpperCase() === (targetAddr || cs.deviceId).toUpperCase() ||
      (o.entity_id || "") === cs.deviceId
    );
    if (radioCount > 0) {
      const box = el("div", { style: "background:#0a150e;border:1px solid #1b3526;border-radius:8px;padding:10px;margin-top:6px" });
      box.appendChild(el("div", { style: "font-weight:600;font-size:13px;color:#52b788;margin-bottom:6px" },
        `✓ ${obj?.user_label || obj?.name || cs.deviceId} — seen by ${radioCount} radio${radioCount > 1 ? "s" : ""}`));
      if (obj?.room) box.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:6px" }, `Room: ${obj.room}`));
      box.appendChild(el("div", { style: "font-size:11px;color:#78909c;margin-bottom:4px" }, "Per-radio RSSI:"));
      const sorted = Object.entries(perRadio).sort((a, b) => (b[1].rssi || -200) - (a[1].rssi || -200));
      for (const [src, info] of sorted) {
        box.appendChild(_rssiRow(el, info.name || src, info.rssi));
      }
      deviceCard.appendChild(box);
    } else {
      deviceCard.appendChild(el("div", {
        style: "font-size:12px;color:#f59e0b;margin-top:6px;padding:8px;background:#0a150e;border-radius:6px"
      }, `⚠ "${cs.deviceId}" not seen in any radio advertisement. Make sure Bluetooth is on and the device is near a scanner.`));
    }
  }
  wrap.appendChild(deviceCard);

  // Map selector
  const maps = ctx.state.maps?.list || [];
  const mapCard = el("div", { class: "card" });
  mapCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:8px" }, "Floor Map"));
  mapCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
    "Select the floor plan you'll be calibrating. You can switch maps at any time."));
  if (maps.length) {
    const mapSel = document.createElement("select");
    mapSel.style.width = "100%";
    const mp0 = document.createElement("option");
    mp0.value = "";
    mp0.textContent = cs.mapId ? "" : "— choose map —";
    mapSel.appendChild(mp0);
    for (const m of maps) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name || m.id;
      if (m.id === cs.mapId) opt.selected = true;
      mapSel.appendChild(opt);
    }
    mapSel.addEventListener("change", () => { cs.mapId = mapSel.value; ctx.actions.renderRooms(); });
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
    "How long to sample RSSI at each calibration point. Longer = more samples = better accuracy. 15s is a good default."));
  const durRow = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap" });
  for (const d of [10, 15, 20, 30]) {
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
        const beaconHere = cs.deviceId ? ads.some(a =>
          a.source === r.source &&
          (a.address || "").toUpperCase() === (cs.deviceId || "").toUpperCase()
        ) : false;
        const row = el("div", { style: "display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid #0d1f12;flex-wrap:wrap" }, [
          el("span", { style: "font-size:12px;font-weight:600;flex:1;min-width:80px" }, r.name || r.source || "?"),
          r.scanning ? el("span", { class: "badge", style: "font-size:10px" }, "scanning") : el("span", { class: "badge warn", style: "font-size:10px" }, "idle"),
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
        (cs.mapId ? "✓" : "✗") + " Floor map selected"),
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
    const mapIds = [...new Set(pts.map(p => p.map_id))];
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { style: "font-weight:700;font-size:14px;margin-bottom:6px" }, "Calibration Progress"),
      el("div", { style: "font-size:13px;color:#94a3b8" },
        `${pts.length} point${pts.length > 1 ? "s" : ""} collected across ${mapIds.length} map${mapIds.length > 1 ? "s" : ""}.`),
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
        "Return to Setup and select your beacon device and floor map."),
      el("button", {
        class: "btn", style: "margin-top:10px",
        onclick: () => { cs.tab = "setup"; ctx.actions.renderRooms(); },
      }, "Go to Setup"),
    ]));
    return wrap;
  }

  const maps = ctx.state.maps?.list || [];
  const mapData = maps.find(m => m.id === cs.mapId);
  if (!mapData?.image?.filename) {
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { class: "muted" }, "Selected map has no image. Upload a floor plan in the Maps tab."),
    ]));
    return wrap;
  }

  // Instructions (collapsed after first point)
  const pts = calData.points || [];
  const mapPts = pts.filter(p => p.map_id === cs.mapId);
  if (!mapPts.length) {
    wrap.appendChild(el("div", { style: "font-size:12px;color:#78909c;padding:8px 4px;line-height:1.6" },
      "Tap anywhere on the map to place a calibration pin, then press Start Collecting. Stand still at that exact spot for the full duration."));
  }

  // ── Interactive map ──────────────────────────────────────────────────────
  const mapWrap = el("div", { style: "position:relative;border-radius:10px;overflow:hidden;border:2px solid #1b3526;touch-action:none" });
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;

  // Build SVG string
  const ar = (mapData.image.height || 600) / (mapData.image.width || 800);
  const imgUrl = `/local/padspan_ha/maps/${mapData.image.filename}`;
  const vbH = ar * 100;

  // Existing calibration points as dots
  let dotsSvg = mapPts.map(p => {
    const px = p.x_frac * 100;
    const py = p.y_frac * vbH;
    const sc = (p.scanner_readings || []).length;
    return `<circle cx="${px}" cy="${py}" r="3.5" fill="#52b788" stroke="white" stroke-width="1" opacity="0.85"/>
            <title>${p.room || p.label || ""} (${sc} scanners)</title>`;
  }).join("");

  // Current pin
  let pinSvg = "";
  if (cs.pinX !== null) {
    const px = cs.pinX * 100;
    const py = cs.pinY * vbH;
    pinSvg = `
      <circle cx="${px}" cy="${py}" r="10" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="3 2" opacity="0.8"/>
      <circle cx="${px}" cy="${py}" r="4" fill="#f59e0b" stroke="white" stroke-width="1.5"/>
      <line x1="${px}" y1="${py - 10}" x2="${px}" y2="${py - 16}" stroke="#f59e0b" stroke-width="1.5"/>`;
  }

  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${vbH}"
      preserveAspectRatio="none" style="width:100%;display:block;cursor:crosshair">
    <image href="${imgUrl}" x="0" y="0" width="100" height="${vbH}" preserveAspectRatio="none"/>
    ${dotsSvg}
    ${pinSvg}
  </svg>`;

  mapWrap.innerHTML = svgStr;

  // Tap handler — must attach after setting innerHTML
  const svgEl = mapWrap.querySelector("svg");
  if (svgEl && !cs.collecting) {
    const onTap = (ev) => {
      const rect = svgEl.getBoundingClientRect();
      // touchend: use changedTouches (the lifted finger); click: use clientX/Y directly
      const touch = (ev.changedTouches && ev.changedTouches[0]) || null;
      const clientX = touch ? touch.clientX : ev.clientX;
      const clientY = touch ? touch.clientY : ev.clientY;
      cs.pinX = (clientX - rect.left) / rect.width;
      cs.pinY = (clientY - rect.top) / rect.height;
      cs.readings = null;
      // Auto-detect room
      cs.pinRoom = _detectRoom(cs.pinX, cs.pinY, mapData) || "";
      ctx.actions.renderRooms();
    };
    svgEl.addEventListener("click", onTap);
    svgEl.addEventListener("touchend", (ev) => { ev.preventDefault(); onTap(ev); });
  }
  wrap.appendChild(mapWrap);

  // Map legend
  wrap.appendChild(el("div", { style: "font-size:11px;color:#78909c;text-align:center" },
    `${mapPts.length} point${mapPts.length !== 1 ? "s" : ""} on this map · tap to place pin`));

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
          `Position: ${(cs.pinX * 100).toFixed(1)}% × ${(cs.pinY * 100).toFixed(1)}%`),
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
      const signalBox = el("div", { style: `padding:8px 10px;border-radius:8px;margin-bottom:10px;background:#071008;border:1px solid ${pinRadioCount > 0 ? "#1b3526" : "#7d5c2b"}` });
      if (pinRadioCount > 0) {
        signalBox.appendChild(el("div", { style: "font-size:12px;color:#52b788;font-weight:600;margin-bottom:4px" },
          `✓ Beacon visible on ${pinRadioCount} radio${pinRadioCount > 1 ? "s" : ""}`));
        const sorted = Object.entries(pinPerRadio).sort((a, b) => (b[1].rssi || -200) - (a[1].rssi || -200));
        for (const [src, info] of sorted) {
          signalBox.appendChild(_rssiRow(el, info.name || src, info.rssi));
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
    scanDiv.appendChild(_rssiRow(elHelper, rd.name || src, Math.round(mean), rd.samples.length));
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
  ctx.actions.renderRooms();

  const endTime = Date.now() + cs.duration * 1000;

  const loop = async () => {
    if (cs.stopFlag) return;

    // Poll snapshot
    try { await ctx.actions.refreshSnapshot(); } catch (_) { /**/ }
    cs._pollCount = (cs._pollCount || 0) + 1;

    const snap = ctx.state.live?.snapshot;

    // ── Collect per-radio RSSI from BLE advertisements (primary source) ──────
    // snap.objects.list[].sources is just a list of source-ID strings, NOT RSSI data.
    // The real per-radio RSSI lives in snap.ble.advertisements, one entry per {device,radio}.
    const { perRadio } = _findBeaconAds(snap, cs.deviceId);
    for (const [src, info] of Object.entries(perRadio)) {
      if (typeof info.rssi !== "number") continue;
      if (!cs.readings[src]) {
        cs.readings[src] = { name: info.name || src, samples: [] };
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
          cs._scanEl.appendChild(_rssiRow(el, rd.name || src, Math.round(mean), rd.samples.length));
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
      wrap.appendChild(_rssiRow(el, rd.name || src, Math.round(mean), rd.samples.length));
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
        await ctx.actions.calibrationSavePoint({
          map_id:    cs.mapId,
          x_frac:    cs.pinX,
          y_frac:    cs.pinY,
          floor_id:  mapData.floor_id || "",
          room:      cs.pinRoom || "",
          label:     cs.pinLabel || "",
          device_id: cs.deviceId || "",
          duration_s: cs.duration,
          scanner_readings: scannerReadings,
        });
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
    cs.pinLabel = "";
    ctx.actions.renderRooms();
  });
  btnRow.appendChild(discardBtn);
  wrap.appendChild(btnRow);

  return wrap;
}

// ── Roam tab ──────────────────────────────────────────────────────────────────
function _roam(ctx, el, cs, calData) {
  const wrap = el("div", { style: "display:flex;flex-direction:column;gap:14px" });

  if (!cs.deviceId || !cs.mapId) {
    wrap.appendChild(el("div", { class: "card", style: "border-color:#f59e0b" }, [
      el("div", { style: "color:#f59e0b;font-weight:700" }, "Setup required"),
      el("button", {
        class: "btn", style: "margin-top:10px",
        onclick: () => { cs.tab = "setup"; ctx.actions.renderRooms(); },
      }, "Go to Setup"),
    ]));
    return wrap;
  }

  const maps = ctx.state.maps?.list || [];
  const mapData = maps.find(m => m.id === cs.mapId);
  if (!mapData?.image?.filename) {
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { class: "muted" }, "No map image available."),
    ]));
    return wrap;
  }

  const pts = calData.points || [];
  const mapPts = pts.filter(p => p.map_id === cs.mapId);

  // Compute coverage grid (JS side)
  const grid = _computeCoverage(mapPts, GRID_N);
  const covered = grid.filter(v => v >= 0.5).length;
  const pct = Math.round(covered / (GRID_N * GRID_N) * 100);
  const target = _nextTarget(grid, GRID_N);

  // Coverage progress bar
  const progCard = el("div", { class: "card" });
  progCard.appendChild(el("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:8px" }, [
    el("div", { style: "font-weight:700;font-size:14px" }, "Coverage"),
    el("span", { class: "badge", style: "margin-left:auto" }, `${mapPts.length} points`),
    el("span", { class: pct >= 70 ? "badge" : "badge warn" }, `${pct}%`),
  ]));
  const barOuter = el("div", { style: "height:10px;background:#1b3526;border-radius:5px;overflow:hidden" });
  const barInner = el("div", { style: `height:100%;width:${pct}%;background:${pct >= 70 ? "#52b788" : pct >= 40 ? "#f59e0b" : "#dc2626"};transition:width 0.5s` });
  barOuter.appendChild(barInner);
  progCard.appendChild(barOuter);
  progCard.appendChild(el("div", { class: "muted", style: "font-size:11px;margin-top:6px" },
    pct >= 80
      ? "✓ Excellent coverage — model should be highly accurate."
      : pct >= 50
      ? "Good progress. Keep adding points to improve accuracy."
      : "Keep going — more points needed for a reliable model."));
  wrap.appendChild(progCard);

  // Coverage heatmap map
  const ar = (mapData.image.height || 600) / (mapData.image.width || 800);
  const vbH = ar * 100;
  const imgUrl = `/local/padspan_ha/maps/${mapData.image.filename}`;
  const cellW = 100 / GRID_N;
  const cellH = vbH / GRID_N;

  // Coverage grid cells
  let gridSvg = "";
  for (let cy = 0; cy < GRID_N; cy++) {
    for (let cx = 0; cx < GRID_N; cx++) {
      const v = grid[cy * GRID_N + cx];
      const opacity = Math.max(0, 0.6 * (1 - v)).toFixed(2);
      const color = v >= 0.5 ? "#52b788" : v >= 0.2 ? "#f59e0b" : "#dc2626";
      gridSvg += `<rect x="${(cx * cellW).toFixed(2)}" y="${(cy * cellH).toFixed(2)}" width="${cellW.toFixed(2)}" height="${cellH.toFixed(2)}" fill="${color}" opacity="${opacity}" rx="0.5"/>`;
    }
  }

  // Existing calibration dots
  const dotsSvg = mapPts.map(p =>
    `<circle cx="${(p.x_frac * 100).toFixed(2)}" cy="${(p.y_frac * vbH).toFixed(2)}" r="2.5" fill="#52b788" stroke="white" stroke-width="0.8" opacity="0.9"/>`
  ).join("");

  // Next target crosshair
  const tx = (target.x_frac * 100).toFixed(2);
  const ty = (target.y_frac * vbH).toFixed(2);
  const targetSvg = `
    <circle cx="${tx}" cy="${ty}" r="7" fill="none" stroke="#60a5fa" stroke-width="2" stroke-dasharray="3 2"/>
    <circle cx="${tx}" cy="${ty}" r="2.5" fill="#60a5fa"/>
    <line x1="${tx}" y1="${(parseFloat(ty) - 7)}" x2="${tx}" y2="${(parseFloat(ty) - 13)}" stroke="#60a5fa" stroke-width="1.5"/>
    <line x1="${tx}" y1="${(parseFloat(ty) + 7)}" x2="${tx}" y2="${(parseFloat(ty) + 13)}" stroke="#60a5fa" stroke-width="1.5"/>
    <line x1="${(parseFloat(tx) - 7)}" y1="${ty}" x2="${(parseFloat(tx) - 13)}" y2="${ty}" stroke="#60a5fa" stroke-width="1.5"/>
    <line x1="${(parseFloat(tx) + 7)}" y1="${ty}" x2="${(parseFloat(tx) + 13)}" y2="${ty}" stroke="#60a5fa" stroke-width="1.5"/>`;

  const mapWrap = el("div", { style: "border-radius:10px;overflow:hidden;border:2px solid #1b3526" });
  mapWrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${vbH}"
      preserveAspectRatio="none" style="width:100%;display:block">
    <image href="${imgUrl}" x="0" y="0" width="100" height="${vbH}" preserveAspectRatio="none"/>
    ${gridSvg}
    ${dotsSvg}
    ${pct < 100 ? targetSvg : ""}
  </svg>`;
  wrap.appendChild(mapWrap);

  // Legend
  wrap.appendChild(el("div", { style: "display:flex;gap:14px;font-size:11px;color:#78909c;padding:0 4px" }, [
    el("span", {}, [el("span", { style: "color:#52b788" }, "■ "), "Covered"]),
    el("span", {}, [el("span", { style: "color:#f59e0b" }, "■ "), "Partial"]),
    el("span", {}, [el("span", { style: "color:#dc2626" }, "■ "), "Uncovered"]),
    el("span", {}, [el("span", { style: "color:#60a5fa" }, "⊕ "), "Target"]),
  ]));

  // Next target card
  if (pct < 100) {
    const tgtRoom = _detectRoom(target.x_frac, target.y_frac, mapData);
    const tgtCard = el("div", { class: "card", style: "border-color:#60a5fa" });
    tgtCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;color:#60a5fa;margin-bottom:6px" },
      "Next Target"));
    tgtCard.appendChild(el("div", { style: "font-size:13px;margin-bottom:4px" },
      tgtRoom ? `Go to: ${tgtRoom}` : `Position: ${(target.x_frac * 100).toFixed(0)}% × ${(target.y_frac * 100).toFixed(0)}%`));
    tgtCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:12px" },
      "Walk to the blue crosshair location on the map. Stand still, then press the button below."));

    if (cs.collecting) {
      tgtCard.appendChild(_buildCollectionUI(ctx, el, cs));
    } else if (cs.readings) {
      tgtCard.appendChild(_buildSavePanel(ctx, el, cs, calData, mapData));
    } else {
      const collectBtn = el("button", {
        class: "btn",
        style: "width:100%;font-size:15px;padding:12px",
      }, `▶  I'm Here — Collect (${cs.duration}s)`);
      collectBtn.addEventListener("click", () => {
        // Auto-set pin to target location
        cs.pinX     = target.x_frac;
        cs.pinY     = target.y_frac;
        cs.pinRoom  = tgtRoom || "";
        cs.pinLabel = tgtRoom ? `Roam: ${tgtRoom}` : "Roam point";
        const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
        _startCollection(ctx, cs, snap, mapData);
      });
      tgtCard.appendChild(collectBtn);
    }
    wrap.appendChild(tgtCard);
  } else {
    wrap.appendChild(el("div", { class: "card", style: "border-color:#52b788;text-align:center" }, [
      el("div", { style: "font-size:28px;margin-bottom:8px" }, "🎉"),
      el("div", { style: "font-weight:700;font-size:15px;color:#52b788;margin-bottom:6px" }, "Full Coverage!"),
      el("div", { class: "muted", style: "font-size:12px" },
        "Every zone has calibration data. Check the Model tab to see accuracy estimates."),
      el("button", {
        class: "btn", style: "margin-top:12px",
        onclick: () => { cs.tab = "model"; ctx.actions.renderRooms(); },
      }, "View Model →"),
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
      el("div", { class: "muted" }, "No calibration points yet. Use Pin & Listen or Roam to collect data."),
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
// Handles both MAC addresses and entity_id values.
function _findBeaconAds(snap, deviceId) {
  if (!snap || !deviceId) return { myAds: [], perRadio: {}, targetAddr: "" };
  const rawId = String(deviceId).trim();
  const upperId = rawId.toUpperCase();

  // If it looks like a MAC address, use it directly; otherwise resolve via objects.list
  let targetAddr = upperId.match(/^[0-9A-F:]{17}$/) ? upperId : "";
  if (!targetAddr) {
    const entity = (snap?.objects?.list || []).find(o =>
      (o.entity_id || "") === rawId ||
      (o.entity_id || "").toUpperCase() === upperId
    );
    targetAddr = (entity?.address || "").toUpperCase();
  }

  // Filter raw advertisements by address
  const myAds = (snap?.ble?.advertisements || []).filter(ad =>
    (ad.address || "").toUpperCase() === (targetAddr || upperId)
  );

  // Build per-radio map — keep strongest/most recent reading per radio
  const perRadio = {};
  for (const ad of myAds) {
    const src = String(ad.source || "");
    if (!src) continue;
    if (!perRadio[src] || (ad.rssi || -200) > (perRadio[src].rssi || -200)) {
      perRadio[src] = {
        name: ad.scanner_name || ad.name || src,
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

function _rssiRow(el, name, rssi, samples) {
  const pct = Math.max(0, Math.min(100, ((rssi ?? -100) + 100) / 60 * 100));
  const color = pct >= 66 ? "#52b788" : pct >= 33 ? "#f59e0b" : "#dc2626";
  return el("div", {
    style: "display:flex;align-items:center;gap:8px;padding:4px 0"
  }, [
    el("div", { style: "font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94a3b8" }, name || "?"),
    el("div", { style: "width:80px;height:6px;background:#1b3526;border-radius:3px;overflow:hidden;flex-shrink:0" }, [
      el("div", { style: `width:${pct.toFixed(0)}%;height:100%;background:${color}` }),
    ]),
    el("div", { style: "font-family:monospace;font-size:11px;color:#e2e8f0;width:48px;text-align:right;flex-shrink:0" },
      rssi != null ? rssi + " dBm" : "—"),
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

function _detectRoom(x, y, mapData) {
  const bounds = mapData?.room_bounds || {};
  for (const [room, b] of Object.entries(bounds)) {
    if (b.type === "poly" && _pointInPoly(x, y, b.points)) return room;
    if (b.type === "circle") {
      const dx = x - b.cx, dy = y - b.cy;
      if (Math.sqrt(dx * dx + dy * dy) <= b.r) return room;
    }
  }
  return "";
}

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
