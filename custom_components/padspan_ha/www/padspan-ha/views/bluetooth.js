// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
// PadSpan HA – Bluetooth view
// A pragmatic clone of HA's Bluetooth page: scanners/adapters + advertisement monitor + simple visualization.

export function render(ctx) {
  const { el, esc } = ctx.helpers;

  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const isLive = ctx.state.dataMode === "live";
  const ble = snap && snap.ble ? snap.ble : { radios: [], advertisements: [], diag: { ok: true, errors: [] } };

  // Build an address→object index from the same objects model used by the Objects view,
  // so identified/unidentified status is consistent across both views.
  const objModel = snap && snap.objects ? snap.objects : null;
  const objIndex = new Map();
  if (objModel && Array.isArray(objModel.list)) {
    for (const o of objModel.list) {
      if (o && o.address) objIndex.set(String(o.address).toUpperCase(), o);
    }
  }

  // View state (stored on ctx.state so it survives re-renders)
  if (!ctx.state.btTab) ctx.state.btTab = "visualization"; // visualization | monitor | scanners
  if (ctx.state.btFilter == null) ctx.state.btFilter = "";
  if (!ctx.state.btSource) ctx.state.btSource = "all"; // all | <scanner source>
  if (!ctx.state.btMax) ctx.state.btMax = 60;

  const radios = Array.isArray(ble.radios) ? ble.radios : [];
  const adsAll = Array.isArray(ble.advertisements) ? ble.advertisements : [];
  const diag = ble.diag || { ok: true, errors: [] };

  // Derived
  const filter = String(ctx.state.btFilter || "").trim().toLowerCase();
  const sourceSel = ctx.state.btSource || "all";
  const maxItems = Math.max(10, Math.min(400, Number(ctx.state.btMax || 60)));

  const ads = adsAll
    .filter(a => {
      if (!a) return false;
      if (sourceSel !== "all" && String(a.source || "") !== sourceSel) return false;
      if (!filter) return true;
      const hay = `${a.name || ""} ${a.address || ""} ${(a.source || "")}`.toLowerCase();
      return hay.includes(filter);
    })
    .slice(0, maxItems);

  const sources = ["all", ...Array.from(new Set(radios.map(r => String(r.source || "")).filter(Boolean))).sort()];

  const tabButton = (id, label) =>
    el(
      "button",
      {
        class: "tab" + (ctx.state.btTab === id ? " active" : ""),
        onclick: () => {
          ctx.state.btTab = id;
          ctx.actions.renderRooms();
        },
      },
      label
    );

  const header = el("div", { class: "row" }, [
    el("div", { class: "grow" }, [
      el("div", { class: "h1" }, "Bluetooth"),
      el(
        "div",
        { class: "muted" },
        "Scanners/adapters and recently seen advertisements (modeled after Home Assistant Settings → Bluetooth)."
      ),
    ]),
    el("div", { class: "bt-kpis" }, [
      el("div", { class: "kpi" }, [el("div", { class: "kpi-num" }, String(radios.length)), el("div", { class: "kpi-lbl" }, "Scanners")]),
      el("div", { class: "kpi" }, [el("div", { class: "kpi-num" }, String(adsAll.length)), el("div", { class: "kpi-lbl" }, "Recent ads")]),
    ]),
  ]);

  const diagCard =
    diag && (diag.ok === false || (diag.errors && diag.errors.length))
      ? el("div", { class: "card warn" }, [
          el("div", { style: "font-weight:700;margin-bottom:6px" }, "Bluetooth feed looks unhealthy"),
          el(
            "div",
            { class: "muted", style: "margin-bottom:8px" },
            "This usually means the HA Bluetooth integration isn't enabled, or the scanner API callback failed. The page will still render, but data may be empty."
          ),
          el("pre", { class: "pre" }, esc(JSON.stringify(diag, null, 2))),
        ])
      : null;

  const tabs = el("div", { class: "tabs" }, [tabButton("visualization", "Visualization"), tabButton("monitor", "Advertisement monitor"), tabButton("scanners", "Scanners"), tabButton("esphome_configs", "ESPHome Configs")]);

  const controls = el("div", { class: "bt-controls", style: "display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:12px" }, [
    el("div", { class: "field", style: "flex:2;min-width:160px" }, [
      el("div", { class: "label" }, "Search"),
      el("input", {
        class: "input",
        placeholder: "Name, address, or source…",
        value: ctx.state.btFilter,
        oninput: e => {
          ctx.state.btFilter = e.target.value;
          ctx.actions.renderRooms();
        },
      }),
    ]),
    el("div", { class: "field", style: "flex:1;min-width:140px" }, [
      el("div", { class: "label" }, "Source"),
      el(
        "select",
        {
          class: "select",
          onchange: e => {
            ctx.state.btSource = e.target.value;
            ctx.actions.renderRooms();
          },
        },
        sources.map(s => el("option", { value: s, ...(s === sourceSel ? { selected: "selected" } : {}) }, s === "all" ? "All scanners" : s))
      ),
    ]),
    el("div", { class: "field", style: "flex:0 0 90px" }, [
      el("div", { class: "label" }, "Max rows"),
      el("input", {
        class: "input",
        type: "number",
        min: 10,
        max: 400,
        value: String(ctx.state.btMax),
        oninput: e => {
          ctx.state.btMax = e.target.value;
          ctx.actions.renderRooms();
        },
      }),
    ]),
  ]);

  let body = null;
  if (ctx.state.btTab === "scanners") {
    body = renderScanners(ctx, radios, sources);
  } else if (ctx.state.btTab === "monitor") {
    body = renderMonitor(ctx, ads, radios, objIndex);
  } else if (ctx.state.btTab === "esphome_configs") {
    body = renderEsphomeConfigs(ctx);
  } else {
    body = renderVisualization(ctx, radios, ads, objIndex);
  }

  const showControls = ctx.state.btTab !== "esphome_configs";
  const out = el("div", { id: "bluetooth" }, [header, diagCard, tabs, showControls ? controls : null, body].filter(Boolean));
  return out;
}

function renderScanners(ctx, radios, sources) {
  const { el, radioShortId } = ctx.helpers;
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const scannerOffsets = (snap && snap.scanner_offsets) || (ctx.state.settings && ctx.state.settings.scanner_offsets) || {};

  if (!radios.length) {
    return el("div", { class: "card" }, [
      el("div", { style: "font-weight:700" }, "No scanners reported"),
      el("div", { class: "muted" }, "If you expect scanners here, verify Settings → Devices & services → Bluetooth is enabled in Home Assistant."),
    ]);
  }

  const row = r => {
    const src  = String(r.source || "");
    const name = String(r.name || "");
    const sid  = radioShortId ? radioShortId(src) : "";
    const meta = [];
    if (r.adapter) meta.push(`adapter: ${r.adapter}`);
    if (r.scanning != null) meta.push(`scanning: ${r.scanning ? "yes" : "no"}`);
    if (r.connectable != null) meta.push(`connectable: ${r.connectable ? "yes" : "no"}`);

    const nameRow = el("div", { style: "display:flex;align-items:center;gap:6px;flex-wrap:wrap" }, [
      sid ? el("span", { class: "pill", style: "font-family:monospace;font-weight:700;font-size:11px;padding:1px 6px" }, sid) : null,
      el("div", { class: "bt-scanner-name" }, name || src || "Scanner"),
      r.lost     ? el("span", { class: "badge warn", style: "font-size:10px;background:rgba(245,158,11,.18);color:#f59e0b" }, "⚠ Lost") : null,
      r.disabled ? el("span", { class: "badge warn", style: "font-size:10px;background:rgba(148,100,220,.18);color:#c084fc" }, "⊘ Disabled") : null,
    ].filter(Boolean));

    // Per-scanner RSSI offset control
    const currentOffset = Number(scannerOffsets[src] || 0);
    const offsetInput = el("input", {
      type: "number", min: "-30", max: "30", step: "1",
      value: String(currentOffset),
      title: "RSSI offset in dBm — positive = scanner reads weaker than reality; negative = reads stronger",
      style: "width:48px;text-align:center;background:#0a150e;border:1px solid #2d5a3d;border-radius:4px;color:#e2e8f0;padding:2px 4px;font-size:11px",
    });
    const offsetSaveBtn = el("button", { class: "btn tiny" }, "Set");
    offsetSaveBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const v = Math.max(-30, Math.min(30, parseFloat(offsetInput.value) || 0));
      try {
        await ctx.actions.scannerOffsetSet(src, v);
        ctx.toast(`Offset for ${name || src}: ${v > 0 ? "+" : ""}${v} dBm`);
      } catch(e) { ctx.toast("Failed to save offset", true); }
    });
    const offsetRow = el("div", { style: "display:flex;align-items:center;gap:4px;margin-top:3px" }, [
      el("span", { class: "muted", style: "font-size:10px" }, "RSSI offset:"),
      offsetInput,
      el("span", { class: "muted", style: "font-size:10px" }, "dBm"),
      offsetSaveBtn,
      currentOffset !== 0 ? el("span", { class: "badge", style: "font-size:10px;background:#1a3a2a;color:#52b788" }, `${currentOffset > 0 ? "+" : ""}${currentOffset} dBm active`) : null,
    ].filter(Boolean));

    // Reset radio button — two-step confirmation
    const resetWrap = document.createElement("div");
    resetWrap.style.cssText = "display:flex;align-items:center;gap:4px;margin-top:3px";
    const makeResetBtn = () => {
      resetWrap.innerHTML = "";
      const rb = document.createElement("button");
      rb.className = "btn tiny";
      rb.style.cssText = "font-size:10px;padding:1px 8px;color:#f87171;border-color:#f8717140";
      rb.textContent = "Reset radio";
      rb.title = "Clear all stored data for this radio (calibration, placement, offsets, fingerprints)";
      rb.addEventListener("click", (ev) => {
        ev.stopPropagation();
        resetWrap.innerHTML = "";
        const lbl2 = document.createElement("span");
        lbl2.style.cssText = "font-size:10px;color:#f87171";
        lbl2.textContent = "Erase all data?";
        const yesBtn = document.createElement("button");
        yesBtn.className = "btn tiny";
        yesBtn.style.cssText = "font-size:10px;padding:1px 8px;background:#7f1d1d;border-color:#dc2626;color:#fca5a5";
        yesBtn.textContent = "Yes, reset";
        const noBtn = document.createElement("button");
        noBtn.className = "btn tiny";
        noBtn.style.cssText = "font-size:10px;padding:1px 8px;color:#94a3b8;border-color:#94a3b840";
        noBtn.textContent = "No";
        yesBtn.addEventListener("click", async (ev2) => {
          ev2.stopPropagation();
          resetWrap.innerHTML = "";
          const spin = document.createElement("span");
          spin.style.cssText = "font-size:10px;color:#94a3b8";
          spin.textContent = "Resetting…";
          resetWrap.appendChild(spin);
          try {
            const res = await ctx.actions.radioReset(src);
            const sm = res?.summary || {};
            const parts = [];
            if (sm.maps?.receivers_removed) parts.push(`${sm.maps.receivers_removed} placement(s)`);
            if (sm.calibration?.readings_removed) parts.push(`${sm.calibration.readings_removed} cal reading(s)`);
            if (sm.adaptive?.room_pairs_removed) parts.push(`${sm.adaptive.room_pairs_removed} fingerprint(s)`);
            if (sm.settings?.offset_cleared) parts.push("offset cleared");
            const detail = parts.length ? ": " + parts.join(", ") : "";
            ctx.toast(`Radio reset${detail}`);
            ctx.actions.renderRooms();
          } catch (e) {
            ctx.toast("Reset failed: " + String(e), true);
            makeResetBtn();
          }
        });
        noBtn.addEventListener("click", (ev2) => {
          ev2.stopPropagation();
          makeResetBtn();
        });
        resetWrap.appendChild(lbl2);
        resetWrap.appendChild(yesBtn);
        resetWrap.appendChild(noBtn);
      });
      resetWrap.appendChild(rb);
    };
    makeResetBtn();

    const subParts = [
      r.area_name ? el("span", { class: "pill", style: "font-size:10px" }, r.area_name) : el("span", { class: "muted", style: "font-size:10px" }, "no room"),
      el("div", { class: "bt-scanner-src", style: "font-size:10px" }, src || "—"),
      r.ip ? el("span", { class: "muted", style: "font-family:monospace;font-size:10px" }, r.ip) : null,
      r.ssid ? el("span", { class: "muted", style: "font-size:10px" }, r.ssid) : null,
      (!r.ssid && r.connection_type) ? el("span", { class: "muted", style: "font-size:10px" }, r.connection_type) : null,
      r.wifi_signal != null ? el("span", { class: "muted", style: "font-size:10px" }, `WiFi ${r.wifi_signal} dBm`) : null,
    ].filter(Boolean);
    const subRow = el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:2px" }, subParts);

    const div = el("div", { class: "bt-scanner-row" + (r.lost || r.disabled ? " warn" : "") }, [
      el("div", { class: "bt-scanner-main" }, [ nameRow, subRow, offsetRow, resetWrap ]),
      el("div", { class: "bt-scanner-meta" }, meta.join(" • ") || "—"),
    ]);
    if(r.lost || r.disabled) div.style.opacity = "0.7";
    div.style.cursor = "pointer";
    div.title = "Click for scanner details";
    div.addEventListener("click", (ev) => { if(ev.target.tagName === "BUTTON" || ev.target.tagName === "INPUT") return; ctx.actions.showScannerDetail(r); });
    return div;
  };

  return el("div", { class: "grid-2" }, [
    el("div", { class: "card" }, [el("div", { class: "h2" }, "Scanners"), el("div", { class: "muted" }, "All currently registered scanners/adapters."), el("div", { class: "bt-list" }, radios.map(row))]),
    el("div", { class: "card" }, [
      el("div", { class: "h2" }, "Sources"),
      el("div", { class: "muted" }, "Unique scanner source IDs."),

      el("div", { class: "bt-pills" }, sources.filter(s => s !== "all").map(s => el("span", { class: "pill" }, s))),
    ]),
  ]);
}

function renderMonitor(ctx, ads, radios, objIndex) {
  const { el, esc } = ctx.helpers;

  const selected = ctx.state.btSelectedAddr || null;

  if (!ads.length) {
    return el("div", { class: "card" }, [
      el("div", { style: "font-weight:700" }, "No advertisements in the window"),
      el("div", { class: "muted" }, "Try widening Max rows, clearing filters, or wait a moment for advertisements to arrive."),
    ]);
  }

  const rssiPill = rssi => {
    const v = Number(rssi);
    if (!isFinite(v)) return el("span", { class: "pill" }, "RSSI ?");
    let cls = "pill";
    if (v >= -60) cls += " good";
    else if (v >= -80) cls += " ok";
    else cls += " bad";
    return el("span", { class: cls }, `RSSI ${v}`);
  };

  const statusPill = (addr) => {
    const o = addr ? objIndex.get(String(addr).toUpperCase()) : null;
    if (!o) return null;
    const cls = o.identified ? "badge" : "badge warn";
    const lbl = o.identified ? "identified" : "unidentified";
    return el("span", { class: cls }, lbl);
  };

  const ageText = age_s => {
    const s = Number(age_s);
    if (!isFinite(s)) return "—";
    if (s < 1) return "<1s";
    if (s < 60) return `${Math.round(s)}s`;
    const m = Math.floor(s / 60);
    const rs = Math.round(s - m * 60);
    return `${m}m ${rs}s`;
  };

  const row = a => {
    const name = a.name || "";
    const addr = a.address || "";
    const src = a.source || "";
    const services = Array.isArray(a.service_uuids) ? a.service_uuids.length : 0;
    const obj = addr ? objIndex.get(String(addr).toUpperCase()) : null;
    const userLabel = (obj && obj.user_label) ? obj.user_label : "";
    const displayName = userLabel || name || addr || "Unknown";

    const tagBtn = el("button", { class: "btn tiny" }, userLabel ? "Relabel" : "Tag");
    tagBtn.addEventListener("click", e => {
      e.stopPropagation();
      ctx.actions.tagObjectPrompt(addr, userLabel);
    });

    return el(
      "div",
      {
        class: "bt-adv-row" + (selected === addr ? " active" : ""),
        onclick: () => {
          ctx.state.btSelectedAddr = selected === addr ? null : addr;
          ctx.actions.renderRooms();
        },
      },
      [
        el("div", { class: "bt-adv-main" }, [
          el("div", { class: "bt-adv-name" }, displayName),
          el("div", { class: "bt-adv-sub" }, addr ? `${addr} • ${src || "—"}` : src || "—"),
        ]),
        el("div", { class: "bt-adv-right" }, [
          statusPill(addr),
          rssiPill(a.rssi),
          el("span", { class: "muted" }, ageText(a.age_s)),
          el("span", { class: "muted" }, services ? `${services} svc` : ""),
          tagBtn,
        ]),
      ]
    );
  };

  const details = (() => {
    if (!selected) return null;
    const a = ads.find(x => x && String(x.address || "") === selected) || null;
    if (!a) return null;
    const snap = ctx.state.live?.snapshot;
    const matchedObj = (snap?.objects?.list||[]).find(o =>
      o.address && o.address.toUpperCase() === selected.toUpperCase()
    );
    const card = el("div", { class: "card" }, [
      el("div", { class: "h2" }, "Details"),
      el("div", { class: "muted", style: "margin-bottom:8px" }, "Raw advertisement record (trimmed to JSON-safe values)."),
      el("pre", { class: "pre" }, esc(JSON.stringify(a, null, 2))),
    ]);
    if(matchedObj){
      card.appendChild(el("button", {class:"btn inline", style:"margin-top:8px",
        onclick:()=> ctx.actions.showObjectDetail(matchedObj)
      }, "Full object details"));
    }
    return card;
  })();

  return el("div", { class: "grid-2" }, [
    el("div", { class: "card" }, [
      el("div", { class: "h2" }, "Advertisement monitor"),
      el("div", { class: "muted" }, "Click a row to inspect details."),
      el("div", { class: "bt-list bt-adv-list" }, ads.map(row)),
    ]),
    details || el("div", { class: "card" }, [el("div", { class: "h2" }, "Details"), el("div", { class: "muted" }, "Select an advertisement on the left.")]),
  ]);
}

function renderVisualization(ctx, radios, ads, objIndex) {
  const { el } = ctx.helpers;

  if (!radios.length && !ads.length) {
    return el("div", { class: "card" }, [
      el("div", { style: "font-weight:700" }, "Nothing to visualize yet"),
      el("div", { class: "muted" }, "Waiting for scanner list + advertisements. If this stays empty, check the Diagnostics panel for BLE errors."),
    ]);
  }

  // Layout: labels on the outer edges, nodes in the middle, lines between nodes.
  //   [Scanner labels →]  (o)----line----(o)  [← Device labels]
  const w = 920;
  const pad = 24;
  const scannerLabelX = pad + 10;          // labels start here (left-aligned)
  const scannerNodeX = pad + 300;          // scanner circles — more room for labels
  const deviceNodeX = w - pad - 300;       // device circles — more room for labels
  const deviceLabelX = w - pad - 10;       // device labels end here

  const srcs = Array.from(new Set(radios.map(r => String(r.source || "")).filter(Boolean))).sort();
  const srcIndex = new Map(srcs.map((s, i) => [s, i]));

  // Group devices by source
  const bySrc = {};
  for (const a of ads) {
    const src = String(a.source || "");
    if (!bySrc[src]) bySrc[src] = [];
    bySrc[src].push(a);
  }

  // Dynamic height: 16px per device row, minimum 460, plus room for titles
  const DEV_ROW_H = 16;
  const totalDevCount = Object.values(bySrc).reduce((sum, arr) => sum + Math.min(arr.length, 24), 0);
  const h = Math.max(460, totalDevCount * DEV_ROW_H + pad * 3 + 30);

  // Place scanners evenly along the left (initial pass, repositioned after devices)
  const scannerNodes = srcs.map((src, i) => {
    const y = pad + 20 + (i + 1) * ((h - pad * 2 - 20) / (srcs.length + 1));
    return { id: src, label: (radios.find(r => String(r.source || "") === src)?.name || src), x: scannerNodeX, y };
  });

  // Place devices near their source scanner, then resolve overlaps
  const deviceNodes = [];
  for (const src of Object.keys(bySrc)) {
    const sIdx = srcIndex.has(src) ? srcIndex.get(src) : -1;
    const base = scannerNodes[Math.max(0, sIdx)] || { x: scannerNodeX, y: h / 2 };
    const list = bySrc[src].slice(0, 24);
    const blockH = list.length * DEV_ROW_H;
    const startY = base.y - blockH / 2;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      deviceNodes.push({
        id: String(a.address || a.name || `${src}-${i}`),
        label: String(a.name || a.address || "Unknown"),
        x: deviceNodeX,
        y: startY + i * DEV_ROW_H,
        src,
        rssi: a.rssi,
      });
    }
  }

  // Resolve vertical overlaps: sort by Y, push apart if too close
  deviceNodes.sort((a, b) => a.y - b.y);
  const MIN_GAP = DEV_ROW_H;
  for (let i = 1; i < deviceNodes.length; i++) {
    const gap = deviceNodes[i].y - deviceNodes[i - 1].y;
    if (gap < MIN_GAP) deviceNodes[i].y = deviceNodes[i - 1].y + MIN_GAP;
  }
  // Clamp all nodes within canvas bounds
  for (const d of deviceNodes) {
    d.y = Math.max(pad + 20, Math.min(h - pad - 10, d.y));
  }

  // Reposition each scanner to the vertical center of its device cluster
  for (const sn of scannerNodes) {
    const myDevs = deviceNodes.filter(d => d.src === sn.id);
    if (myDevs.length) {
      const minY = Math.min(...myDevs.map(d => d.y));
      const maxY = Math.max(...myDevs.map(d => d.y));
      sn.y = (minY + maxY) / 2;
    }
  }
  // Resolve scanner overlaps too (minimum 30px apart)
  scannerNodes.sort((a, b) => a.y - b.y);
  for (let i = 1; i < scannerNodes.length; i++) {
    if (scannerNodes[i].y - scannerNodes[i - 1].y < 30) {
      scannerNodes[i].y = scannerNodes[i - 1].y + 30;
    }
  }
  for (const sn of scannerNodes) {
    sn.y = Math.max(pad + 20, Math.min(h - pad - 10, sn.y));
  }

  const rssiClass = rssi => {
    const v = Number(rssi);
    if (!isFinite(v)) return "rssi-unk";
    if (v >= -60) return "rssi-good";
    if (v >= -80) return "rssi-ok";
    return "rssi-bad";
  };

  // Build SVG as an HTML string — avoids the HTML-namespace issue that makes
  // document.createElement("circle") / ("line") render as invisible elements.
  let s = `<svg class="bt-viz" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;

  // Lines first (back layer) — connect between the node circles only
  for (const d of deviceNodes) {
    const sn = scannerNodes.find(n => n.id === d.src);
    if (!sn) continue;
    const rc = rssiClass(d.rssi);
    s += `<line x1="${sn.x + 10}" y1="${sn.y}" x2="${d.x - 10}" y2="${d.y}" class="bt-viz-line ${rc}"/>`;
  }

  // Truncate helper — keeps SVG text from overflowing
  const MAX_LABEL = 38;
  const trunc = (s) => s.length > MAX_LABEL ? s.slice(0, MAX_LABEL - 1) + "…" : s;

  // Scanner nodes + labels (left-aligned, growing rightward toward node)
  for (const sn of scannerNodes) {
    s += `<circle cx="${sn.x}" cy="${sn.y}" r="7" class="bt-viz-node scanner"/>`;
    s += `<text x="${scannerLabelX}" y="${sn.y}" class="bt-viz-label" text-anchor="start" dominant-baseline="middle">${_escSvg(trunc(sn.label))}</text>`;
  }

  // Device nodes + labels (left-aligned, growing rightward from node)
  for (const d of deviceNodes) {
    const rc = rssiClass(d.rssi);
    s += `<circle cx="${d.x}" cy="${d.y}" r="5" class="bt-viz-node device ${rc}"/>`;
    s += `<text x="${d.x + 10}" y="${d.y}" class="bt-viz-label" font-size="11" text-anchor="start" dominant-baseline="middle">${_escSvg(trunc(d.label))}</text>`;
  }

  // Titles on top
  s += `<text x="${scannerLabelX}" y="${pad}" class="bt-viz-title" text-anchor="start" dominant-baseline="middle">Scanners</text>`;
  s += `<text x="${deviceNodeX + 10}" y="${pad}" class="bt-viz-title" text-anchor="start" dominant-baseline="middle">Devices</text>`;

  s += `</svg>`;

  const svgWrap = document.createElement("div");
  svgWrap.innerHTML = s;

  return el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Visualization"),
    el("div", { class: "muted", style: "margin-bottom:10px" }, "A simple scanner→device graph, grouped by the scanner source that reported the advertisement."),
    svgWrap,
    el("div", { class: "muted", style: "margin-top:10px" }, "Tip: use Source + Search filters above to narrow the graph."),
  ]);
}

// ── ESPHome Config Library ─────────────────────────────────────────────────────

const ESPHOME_CONFIGS = [
  {
    id: "c3_wifi",
    chip: "ESP32-C3",
    connection: "WiFi",
    badge: "Single-core",
    badgeColor: "#f59e0b",
    description: "Single-core RISC-V. BLE and WiFi share the radio, so scan duty must be kept low. Uses API-connection gating to pause scanning during WiFi traffic bursts.",
    notes: [
      "Scan duty ~31% (100 ms window / 320 ms interval)",
      "Single-core — BLE scanning blocks WiFi, so keep window short",
      "API-gated: scanning pauses during heavy API traffic to prevent watchdog resets",
    ],
    yaml: `# PadSpan — ESP32-C3 WiFi Scanner (optimised)
# Scan duty ~31%. Single-core workaround: gate scanning on API connection.

esphome:
  name: padspan-c3-wifi
  friendly_name: "PadSpan C3 WiFi"

esp32:
  board: esp32-c3-devkitm-1
  framework:
    type: esp-idf

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password
  power_save_mode: LIGHT          # balances power vs responsiveness
  output_power: 20dB
  fast_connect: true              # skip full scan on reconnect

api:
  encryption:
    key: !secret api_key
  on_client_connected:
    - esp32_ble_tracker.start_scan:
        continuous: true
  on_client_disconnected:
    - esp32_ble_tracker.stop_scan:

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms               # must be multiple of 0.625 ms
    window: 100ms                 # ~31% duty — safe for single-core WiFi
    active: false                 # passive only — less RF contention

bluetooth_proxy:
  active: false

# ── Diagnostic sensors (PadSpan reads these automatically) ──────────
sensor:
  - platform: wifi_signal
    name: "WiFi Signal"
    update_interval: 30s
  - platform: internal_temperature
    name: "CPU Temperature"
    update_interval: 60s
  - platform: uptime
    name: "Uptime"
    update_interval: 60s

text_sensor:
  - platform: wifi_info
    ip_address:
      name: "IP Address"
    ssid:
      name: "WiFi SSID"
    bssid:
      name: "WiFi BSSID"
    mac_address:
      name: "MAC Address"`,
  },
  {
    id: "c6_wifi",
    chip: "ESP32-C6",
    connection: "WiFi 6",
    badge: "BLE 5.3 + Wi-Fi 6",
    badgeColor: "#8b5cf6",
    description: "Single-core RISC-V with BLE 5.3 and Wi-Fi 6 (802.11ax). Better coexistence than C3 but still single-core — same scan duty limits apply.",
    notes: [
      "Scan duty ~31% (100 ms window / 320 ms interval)",
      "Wi-Fi 6 improves coexistence vs C3, but single-core still limits duty",
      "BLE 5.3 hardware — ESPHome does not yet expose Coded PHY scanning",
    ],
    yaml: `# PadSpan — ESP32-C6 WiFi 6 Scanner (optimised)
# Scan duty ~31%. Wi-Fi 6 + BLE 5.3 hardware, single-core RISC-V.

esphome:
  name: padspan-c6-wifi
  friendly_name: "PadSpan C6 WiFi"

esp32:
  board: esp32-c6-devkitc-1
  framework:
    type: esp-idf

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password
  power_save_mode: LIGHT
  output_power: 20dB
  fast_connect: true

api:
  encryption:
    key: !secret api_key
  on_client_connected:
    - esp32_ble_tracker.start_scan:
        continuous: true
  on_client_disconnected:
    - esp32_ble_tracker.stop_scan:

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 100ms                 # ~31% duty — single-core safe
    active: false

bluetooth_proxy:
  active: false

# ── Diagnostic sensors ──────────────────────────────────────────────
sensor:
  - platform: wifi_signal
    name: "WiFi Signal"
    update_interval: 30s
  - platform: internal_temperature
    name: "CPU Temperature"
    update_interval: 60s
  - platform: uptime
    name: "Uptime"
    update_interval: 60s

text_sensor:
  - platform: wifi_info
    ip_address:
      name: "IP Address"
    ssid:
      name: "WiFi SSID"
    bssid:
      name: "WiFi BSSID"
    mac_address:
      name: "MAC Address"`,
  },
  {
    id: "s3_wifi",
    chip: "ESP32-S3",
    connection: "WiFi",
    badge: "Dual-core — best WiFi",
    badgeColor: "#10b981",
    description: "Dual-core Xtensa with PSRAM. BLE runs on core 1 while WiFi runs on core 0, so continuous scanning is safe. Best general-purpose WiFi scanner.",
    notes: [
      "Scan duty ~31% (100 ms window / 320 ms interval) — WiFi still needs airtime",
      "Dual-core: BLE and WiFi run on separate cores — no watchdog risk",
      "continuous: true is safe on S3 (not on C3/C6)",
      "PSRAM available — handles large advertisement caches",
    ],
    yaml: `# PadSpan — ESP32-S3 WiFi Scanner (optimised)
# Dual-core: BLE on core 1, WiFi on core 0. Best WiFi scanner.

esphome:
  name: padspan-s3-wifi
  friendly_name: "PadSpan S3 WiFi"

esp32:
  board: esp32-s3-devkitc-1
  framework:
    type: esp-idf

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password
  power_save_mode: LIGHT
  output_power: 20dB
  fast_connect: true

api:
  encryption:
    key: !secret api_key

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 100ms                 # ~31% — WiFi still needs airtime
    active: false
    continuous: true              # safe on dual-core S3

bluetooth_proxy:
  active: false

# ── Diagnostic sensors ──────────────────────────────────────────────
sensor:
  - platform: wifi_signal
    name: "WiFi Signal"
    update_interval: 30s
  - platform: internal_temperature
    name: "CPU Temperature"
    update_interval: 60s
  - platform: uptime
    name: "Uptime"
    update_interval: 60s

text_sensor:
  - platform: wifi_info
    ip_address:
      name: "IP Address"
    ssid:
      name: "WiFi SSID"
    bssid:
      name: "WiFi BSSID"
    mac_address:
      name: "MAC Address"`,
  },
  {
    id: "s3_ethernet",
    chip: "ESP32-S3",
    connection: "Ethernet",
    badge: "Maximum performance",
    badgeColor: "#06b6d4",
    description: "Dual-core S3 with wired Ethernet. No WiFi means the radio is 100% available for BLE. Highest possible scan duty at 93.75%. Best for dedicated scanner deployments.",
    notes: [
      "Scan duty 93.75% (300 ms window / 320 ms interval) — the maximum",
      "No WiFi contention — the BLE radio has the full RF budget",
      "Ethernet: rock-solid connection, no WiFi dropouts",
      "Adjust the ethernet: section for your board (W5500, LAN8720, etc.)",
    ],
    yaml: `# PadSpan — ESP32-S3 Ethernet Scanner (maximum performance)
# Scan duty 93.75%. No WiFi = BLE radio has full RF budget.
# Adjust ethernet platform/pins for your board (W5500 SPI shown below).

esphome:
  name: padspan-s3-eth
  friendly_name: "PadSpan S3 Ethernet"

esp32:
  board: esp32-s3-devkitc-1
  framework:
    type: esp-idf

# ── Ethernet (W5500 SPI example — adjust pins for your board) ──────
ethernet:
  type: W5500
  clk_pin: GPIO12
  mosi_pin: GPIO11
  miso_pin: GPIO13
  cs_pin: GPIO10
  interrupt_pin: GPIO14
  reset_pin: GPIO15

api:
  encryption:
    key: !secret api_key

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 300ms                 # 93.75% duty — maximum scan coverage
    active: false
    continuous: true

bluetooth_proxy:
  active: false

# ── Diagnostic sensors ──────────────────────────────────────────────
sensor:
  - platform: internal_temperature
    name: "CPU Temperature"
    update_interval: 60s
  - platform: uptime
    name: "Uptime"
    update_interval: 60s

text_sensor:
  - platform: ethernet_info
    ip_address:
      name: "IP Address"`,
  },
  {
    id: "passive_minimal",
    chip: "Any ESP32",
    connection: "WiFi",
    badge: "Minimal / passive",
    badgeColor: "#94a3b8",
    description: "A stripped-down passive-only scanner that works on any ESP32 variant. Good starting point if you are unsure which board you have.",
    notes: [
      "Works on C3, C6, S3, and original ESP32",
      "Passive scanning only — less accurate name resolution but lower power",
      "Conservative 31% duty cycle — safe for any chip",
    ],
    yaml: `# PadSpan — Minimal Passive Scanner (any ESP32)
# Conservative settings that work on every ESP32 variant.

esphome:
  name: padspan-scanner
  friendly_name: "PadSpan Scanner"

esp32:
  board: esp32dev                 # change to your board
  framework:
    type: esp-idf

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password
  power_save_mode: LIGHT
  fast_connect: true

api:
  encryption:
    key: !secret api_key

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 100ms
    active: false
    continuous: true

bluetooth_proxy:
  active: false

# ── Diagnostic sensors ──────────────────────────────────────────────
sensor:
  - platform: wifi_signal
    name: "WiFi Signal"
    update_interval: 30s
  - platform: uptime
    name: "Uptime"
    update_interval: 60s

text_sensor:
  - platform: wifi_info
    ip_address:
      name: "IP Address"
    ssid:
      name: "WiFi SSID"`,
  },
];

function renderEsphomeConfigs(ctx) {
  const { el } = ctx.helpers;

  // Intro card
  const intro = el("div", { class: "card", style: "border:1px solid #2d5a3d" }, [
    el("div", { style: "font-weight:700;font-size:15px;margin-bottom:6px" }, "ESPHome Config Library"),
    el("div", { class: "muted", style: "line-height:1.6" },
      "Optimised ESPHome YAML for every ESP32 variant PadSpan supports. " +
      "Each config includes the diagnostic sensors PadSpan reads automatically (IP address, WiFi signal, SSID, temperature, uptime). " +
      "Copy the YAML into your ESPHome device configuration, adjust wifi/api secrets, and flash."
    ),
    el("div", { style: "margin-top:10px;display:flex;gap:12px;flex-wrap:wrap" }, [
      el("div", { style: "flex:1;min-width:200px;background:#0a150e;border-radius:8px;padding:10px 14px" }, [
        el("div", { style: "font-weight:600;font-size:12px;color:#52b788;margin-bottom:4px" }, "Scan Parameters Rule"),
        el("div", { class: "muted", style: "font-size:11px;line-height:1.5" },
          "interval and window must be multiples of 0.625 ms (one BLE time slot). " +
          "320 ms interval is the standard. WiFi scanners: window = 100 ms (31% duty). " +
          "Ethernet scanners: window = 300 ms (93.75% duty)."
        ),
      ]),
      el("div", { style: "flex:1;min-width:200px;background:#0a150e;border-radius:8px;padding:10px 14px" }, [
        el("div", { style: "font-weight:600;font-size:12px;color:#52b788;margin-bottom:4px" }, "Why Passive Scanning?"),
        el("div", { class: "muted", style: "font-size:11px;line-height:1.5" },
          "active: false means the scanner only listens — it never sends scan requests. " +
          "This reduces RF contention, saves power, and is all PadSpan needs for RSSI-based presence. " +
          "Active scanning is only needed if you want to connect to BLE devices."
        ),
      ]),
    ]),
  ]);

  // Chip comparison table
  const chipTable = el("div", { class: "card" }, [
    el("div", { style: "font-weight:700;margin-bottom:8px" }, "Chip Comparison"),
    (() => {
      const wrap = document.createElement("div");
      wrap.style.cssText = "overflow-x:auto";
      wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="border-bottom:1px solid #2d5a3d;text-align:left">
          <th style="padding:6px 8px">Chip</th>
          <th style="padding:6px 8px">Cores</th>
          <th style="padding:6px 8px">BLE</th>
          <th style="padding:6px 8px">WiFi</th>
          <th style="padding:6px 8px">Max Scan Duty</th>
          <th style="padding:6px 8px">Best For</th>
        </tr></thead>
        <tbody>
          <tr style="border-bottom:1px solid #1a2e22"><td style="padding:6px 8px;font-weight:600">ESP32-C3</td><td style="padding:6px 8px">1 (RISC-V)</td><td style="padding:6px 8px">5.0</td><td style="padding:6px 8px">4 (b/g/n)</td><td style="padding:6px 8px;color:#f59e0b">~31%</td><td style="padding:6px 8px">Budget scanners</td></tr>
          <tr style="border-bottom:1px solid #1a2e22"><td style="padding:6px 8px;font-weight:600">ESP32-C6</td><td style="padding:6px 8px">1 (RISC-V)</td><td style="padding:6px 8px;color:#8b5cf6">5.3</td><td style="padding:6px 8px;color:#8b5cf6">6 (ax)</td><td style="padding:6px 8px;color:#f59e0b">~31%</td><td style="padding:6px 8px">Future-proof, Wi-Fi 6</td></tr>
          <tr style="border-bottom:1px solid #1a2e22"><td style="padding:6px 8px;font-weight:600">ESP32-S3</td><td style="padding:6px 8px;color:#10b981">2 (Xtensa)</td><td style="padding:6px 8px">5.0</td><td style="padding:6px 8px">4 (b/g/n)</td><td style="padding:6px 8px;color:#10b981">~31% WiFi / 93.75% Eth</td><td style="padding:6px 8px;color:#10b981;font-weight:600">Best overall</td></tr>
          <tr><td style="padding:6px 8px;font-weight:600">ESP32 (original)</td><td style="padding:6px 8px">2 (Xtensa)</td><td style="padding:6px 8px">4.2</td><td style="padding:6px 8px">4 (b/g/n)</td><td style="padding:6px 8px;color:#f59e0b">~31%</td><td style="padding:6px 8px">Legacy installs</td></tr>
        </tbody>
      </table>`;
      return wrap;
    })(),
  ]);

  // Config cards
  const configCards = ESPHOME_CONFIGS.map(cfg => {
    const expanded = ctx.state[`_cfgExpand_${cfg.id}`] || false;

    const toggleBtn = el("button", { class: "btn tiny", style: "font-size:11px" }, expanded ? "Hide YAML" : "Show YAML");
    const copyBtn = el("button", { class: "btn tiny", style: "font-size:11px" }, "Copy YAML");

    const headerRow = el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap" }, [
      el("div", {}, [
        el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px" }, [
          el("span", { style: "font-weight:700;font-size:14px" }, `${cfg.chip} — ${cfg.connection}`),
          el("span", { class: "badge", style: `font-size:10px;background:${cfg.badgeColor}22;color:${cfg.badgeColor}` }, cfg.badge),
        ]),
        el("div", { class: "muted", style: "font-size:12px;line-height:1.5;max-width:600px" }, cfg.description),
      ]),
      el("div", { style: "display:flex;gap:6px;flex-shrink:0" }, [toggleBtn, copyBtn]),
    ]);

    const notesList = el("div", { style: "margin-top:8px;display:flex;flex-direction:column;gap:3px" },
      cfg.notes.map(n => el("div", { style: "font-size:11px;color:#94a3b8;padding-left:12px;position:relative" }, [
        el("span", { style: "position:absolute;left:0;color:#52b788" }, "•"),
        document.createTextNode(n),
      ]))
    );

    const yamlPre = document.createElement("pre");
    yamlPre.className = "pre";
    yamlPre.style.cssText = "margin-top:10px;font-size:11px;max-height:500px;overflow:auto;white-space:pre;tab-size:2;display:" + (expanded ? "block" : "none");
    yamlPre.textContent = cfg.yaml;

    toggleBtn.addEventListener("click", () => {
      ctx.state[`_cfgExpand_${cfg.id}`] = !ctx.state[`_cfgExpand_${cfg.id}`];
      const show = ctx.state[`_cfgExpand_${cfg.id}`];
      yamlPre.style.display = show ? "block" : "none";
      toggleBtn.textContent = show ? "Hide YAML" : "Show YAML";
    });

    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(cfg.yaml).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy YAML"; }, 1500);
      }).catch(() => {
        // Fallback: select text in pre
        const range = document.createRange();
        range.selectNodeContents(yamlPre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        yamlPre.style.display = "block";
        copyBtn.textContent = "Select failed — copy manually";
        setTimeout(() => { copyBtn.textContent = "Copy YAML"; }, 2000);
      });
    });

    return el("div", { class: "card", style: "border:1px solid #1a2e22" }, [headerRow, notesList, yamlPre]);
  });

  // Tips card at the bottom
  const tips = el("div", { class: "card", style: "border:1px solid #2d5a3d33" }, [
    el("div", { style: "font-weight:700;margin-bottom:6px" }, "Tips for Best Results"),
    el("div", { style: "display:flex;flex-direction:column;gap:6px;font-size:12px;color:#94a3b8;line-height:1.5" }, [
      el("div", {}, "1. Use Ethernet S3 boards for dedicated rooms — 3x the scan coverage of WiFi scanners."),
      el("div", {}, "2. Place scanners at chest height (1.2 m) for best RSSI consistency with carried devices."),
      el("div", {}, "3. After flashing, check Bluetooth → Scanners tab — PadSpan shows IP, WiFi signal, and SSID automatically from these configs."),
      el("div", {}, "4. The diagnostic sensors (IP, signal, temp) appear in HA as entities and PadSpan reads them with zero extra setup."),
      el("div", {}, "5. For Ethernet boards: adjust the ethernet: section pins to match your specific board (W5500, LAN8720, etc)."),
      el("div", {}, "6. All configs use active: false (passive scanning). PadSpan only needs RSSI — active scanning adds no benefit and wastes airtime."),
    ]),
  ]);

  return el("div", {}, [intro, chipTable, ...configCards, tips]);
}

function _escSvg(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
