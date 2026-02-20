// PadSpan HA – Bluetooth view
// A pragmatic clone of HA's Bluetooth page: scanners/adapters + advertisement monitor + simple visualization.

export function render(ctx) {
  const { el, esc } = ctx.helpers;

  const isLive = ctx.state.dataMode === "live";
  const snap = isLive ? (ctx.state.live && ctx.state.live.snapshot) : null;
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
  if (!isLive) {
    body = el("div", { class: "card" }, [
      el("div", { style: "font-weight:700" }, "Live mode required"),
      el("div", { class: "muted" }, "Bluetooth data is only available in live mode."),
    ]);
  } else if (ctx.state.btTab === "scanners") {
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
  const { el } = ctx.helpers;

  if (!radios.length) {
    return el("div", { class: "card" }, [
      el("div", { style: "font-weight:700" }, "No scanners reported"),
      el("div", { class: "muted" }, "If you expect scanners here, verify Settings → Devices & services → Bluetooth is enabled in Home Assistant."),
    ]);
  }

  const row = r => {
    const src = String(r.source || "");
    const name = String(r.name || "");
    const meta = [];
    if (r.adapter) meta.push(`adapter: ${r.adapter}`);
    if (r.scanning != null) meta.push(`scanning: ${r.scanning ? "yes" : "no"}`);
    if (r.connectable != null) meta.push(`connectable: ${r.connectable ? "yes" : "no"}`);

    return el("div", { class: "bt-scanner-row" }, [
      el("div", { class: "bt-scanner-main" }, [
        el("div", { class: "bt-scanner-name" }, name || src || "Scanner"),
        el("div", { class: "bt-scanner-src" }, src || "—"),
      ]),
      el("div", { class: "bt-scanner-meta" }, meta.join(" • ") || "—"),
    ]);
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
    return el("div", { class: "card" }, [
      el("div", { class: "h2" }, "Details"),
      el("div", { class: "muted", style: "margin-bottom:8px" }, "Raw advertisement record (trimmed to JSON-safe values)."),
      el("pre", { class: "pre" }, esc(JSON.stringify(a, null, 2))),
    ]);
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
  // Keep it simple + readable (similar spirit to HA Bluetooth visualization).
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
    const list = bySrc[src].slice(0, 18); // limit per scanner to keep readable
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

  const line = (x1, y1, x2, y2, cls) => el("line", { x1, y1, x2, y2, class: cls });
  const circle = (x, y, r, cls) => el("circle", { cx: x, cy: y, r, class: cls });
  const text = (x, y, value, cls, anchor = "start") =>
    el("text", { x, y, class: cls, "text-anchor": anchor, dominantBaseline: "middle" }, value);

  const rssiClass = rssi => {
    const v = Number(rssi);
    if (!isFinite(v)) return "rssi-unk";
    if (v >= -60) return "rssi-good";
    if (v >= -80) return "rssi-ok";
    return "rssi-bad";
  };

  const svg = el(
    "svg",
    { class: "bt-viz", viewBox: `0 0 ${w} ${h}` },
    [
      // Title
      text(pad, pad, "Scanners", "bt-viz-title", "start"),
      text(w - pad, pad, "Devices", "bt-viz-title", "end"),

      // Lines
      ...deviceNodes.map(d => {
        const sn = scannerNodes.find(s => s.id === d.src);
        if (!sn) return null;
        return line(sn.x + 10, sn.y, d.x - 10, d.y, `bt-viz-line ${rssiClass(d.rssi)}`);
      }).filter(Boolean),

      // Scanner nodes
      ...scannerNodes.flatMap(s => [
        circle(s.x, s.y, 7, "bt-viz-node scanner"),
        text(s.x + 14, s.y, s.label, "bt-viz-label", "start"),
      ]),

      // Device nodes
      ...deviceNodes.flatMap(d => [
        circle(d.x, d.y, 6, `bt-viz-node device ${rssiClass(d.rssi)}`),
        text(d.x - 12, d.y, d.label, "bt-viz-label", "end"),
      ]),
    ]
  );

  return el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Visualization"),
    el("div", { class: "muted", style: "margin-bottom:10px" }, "A simple scanner→device graph, grouped by the scanner source that reported the advertisement."),
    svg,
    el("div", { class: "muted", style: "margin-top:10px" }, "Tip: use Source + Search filters above to narrow the graph."),
  ]);
}
