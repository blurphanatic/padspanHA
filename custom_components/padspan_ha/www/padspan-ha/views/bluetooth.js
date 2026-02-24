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

  const tabs = el("div", { class: "tabs" }, [tabButton("visualization", "Visualization"), tabButton("monitor", "Advertisement monitor"), tabButton("scanners", "Scanners")]);

  const controls = el("div", { class: "bt-controls" }, [
    el("div", { class: "field" }, [
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
    el("div", { class: "field" }, [
      el("div", { class: "label" }, "Source"),
      el(
        "select",
        {
          class: "select",
          value: ctx.state.btSource,
          onchange: e => {
            ctx.state.btSource = e.target.value;
            ctx.actions.renderRooms();
          },
        },
        sources.map(s => el("option", { value: s }, s === "all" ? "All scanners" : s))
      ),
    ]),
    el("div", { class: "field" }, [
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
  } else {
    body = renderVisualization(ctx, radios, ads, objIndex);
  }

  const out = el("div", { id: "bluetooth" }, [header, diagCard, tabs, controls, body]);
  return out;
}

function renderScanners(ctx, radios, sources) {
  const { el, radioShortId } = ctx.helpers;

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

    const subRow = el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:2px" }, [
      r.area_name ? el("span", { class: "pill", style: "font-size:10px" }, r.area_name) : el("span", { class: "muted", style: "font-size:10px" }, "no room"),
      el("div", { class: "bt-scanner-src", style: "font-size:10px" }, src || "—"),
    ]);

    const div = el("div", { class: "bt-scanner-row" + (r.lost || r.disabled ? " warn" : "") }, [
      el("div", { class: "bt-scanner-main" }, [ nameRow, subRow ]),
      el("div", { class: "bt-scanner-meta" }, meta.join(" • ") || "—"),
    ]);
    if(r.lost || r.disabled) div.style.opacity = "0.7";
    div.style.cursor = "pointer";
    div.title = "Click for scanner details";
    div.addEventListener("click", () => ctx.actions.showScannerDetail(r));
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

  // Layout: scanners on left, devices on right, lines between by source.
  const w = 920;
  const h = 460;
  const pad = 24;

  const srcs = Array.from(new Set(radios.map(r => String(r.source || "")).filter(Boolean))).sort();
  const srcIndex = new Map(srcs.map((s, i) => [s, i]));

  // Place scanners evenly along the left
  const scannerNodes = srcs.map((src, i) => {
    const y = pad + (i + 1) * ((h - pad * 2) / (srcs.length + 1));
    return { id: src, label: (radios.find(r => String(r.source || "") === src)?.name || src), x: pad + 110, y };
  });

  // Group devices by source, then place near their source band on the right
  const bySrc = {};
  for (const a of ads) {
    const src = String(a.source || "");
    if (!bySrc[src]) bySrc[src] = [];
    bySrc[src].push(a);
  }

  const deviceNodes = [];
  for (const src of Object.keys(bySrc)) {
    const sIdx = srcIndex.has(src) ? srcIndex.get(src) : -1;
    const base = scannerNodes[Math.max(0, sIdx)] || { x: pad + 110, y: h / 2 };
    const list = bySrc[src].slice(0, 18);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const y = base.y - 90 + (i * 18);
      deviceNodes.push({
        id: String(a.address || a.name || `${src}-${i}`),
        label: String(a.name || a.address || "Unknown"),
        x: w - pad - 220,
        y: Math.max(pad + 18, Math.min(h - pad - 18, y)),
        src,
        rssi: a.rssi,
      });
    }
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

  // Titles
  s += `<text x="${pad}" y="${pad}" class="bt-viz-title" text-anchor="start" dominant-baseline="middle">Scanners</text>`;
  s += `<text x="${w - pad}" y="${pad}" class="bt-viz-title" text-anchor="end" dominant-baseline="middle">Devices</text>`;

  // Lines
  for (const d of deviceNodes) {
    const sn = scannerNodes.find(n => n.id === d.src);
    if (!sn) continue;
    const rc = rssiClass(d.rssi);
    s += `<line x1="${sn.x + 10}" y1="${sn.y}" x2="${d.x - 10}" y2="${d.y}" class="bt-viz-line ${rc}"/>`;
  }

  // Scanner nodes
  for (const sn of scannerNodes) {
    s += `<circle cx="${sn.x}" cy="${sn.y}" r="7" class="bt-viz-node scanner"/>`;
    s += `<text x="${sn.x + 14}" y="${sn.y}" class="bt-viz-label" text-anchor="start" dominant-baseline="middle">${_escSvg(sn.label)}</text>`;
  }

  // Device nodes
  for (const d of deviceNodes) {
    const rc = rssiClass(d.rssi);
    s += `<circle cx="${d.x}" cy="${d.y}" r="6" class="bt-viz-node device ${rc}"/>`;
    s += `<text x="${d.x - 12}" y="${d.y}" class="bt-viz-label" text-anchor="end" dominant-baseline="middle">${_escSvg(d.label)}</text>`;
  }

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

function _escSvg(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
