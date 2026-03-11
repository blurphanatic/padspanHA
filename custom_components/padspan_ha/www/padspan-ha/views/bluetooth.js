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
  if (!ctx.state.btMax) ctx.state.btMax = 200;

  const radios = Array.isArray(ble.radios) ? ble.radios : [];
  const adsAll = Array.isArray(ble.advertisements) ? ble.advertisements : [];
  const diag = ble.diag || { ok: true, errors: [] };

  // Derived
  const filter = String(ctx.state.btFilter || "").trim().toLowerCase();
  const sourceSel = ctx.state.btSource || "all";
  const maxItems = Math.max(10, Math.min(1000, Number(ctx.state.btMax || 200)));

  const ads = adsAll
    .filter(a => {
      if (!a) return false;
      if (sourceSel !== "all" && String(a.source || "") !== sourceSel) return false;
      if (!filter) return true;
      const xr = a._xref || {};
      const hay = `${a.name || ""} ${a.address || ""} ${a.source || ""} ${a.company_name || ""} ${a.device_type || ""} ${(a.service_names||[]).join(" ")} ${xr.label || ""} ${xr.kind || ""} ${xr.room || ""} ${xr.canonical_id || ""} ${xr.ibeacon_uuid || ""}`.toLowerCase();
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
      el("div", { class: "kpi" }, [el("div", { class: "kpi-num" }, String(diag.unique_cached || 0)), el("div", { class: "kpi-lbl" }, "Unique MACs")]),
      el("div", { class: "kpi" }, [el("div", { class: "kpi-num" }, String(((snap?.objects?.summary?.resolver || {}).irk_devices) || 0)), el("div", { class: "kpi-lbl" }, "Private BLE IRKs")]),
      el("div", { class: "kpi" }, [el("div", { class: "kpi-num" }, String(((snap?.objects?.summary?.resolver || {}).resolved) || 0)), el("div", { class: "kpi-lbl" }, "RPAs resolved")]),
      el("div", { class: "kpi" }, [el("div", { class: "kpi-num" }, String((snap?.objects?.summary?.ibeacon) || 0)), el("div", { class: "kpi-lbl" }, "iBeacons")]),
    ]),
  ]);

  const _resolverDiag = (snap?.objects?.summary?.resolver) || {};
  const _resolverErrors = _resolverDiag.errors || [];
  const _callbackOk = diag.callback_active !== false;

  // ── Private BLE status card ─────────────────────────────────────────────────
  const _irkCount = _resolverDiag.irk_devices || 0;
  const _rpaCount = _resolverDiag.rpa_count || 0;
  const _resolvedCount = _resolverDiag.resolved || 0;
  const _privateBleCount = (snap?.objects?.summary?.private_ble) || 0;

  let privateBleCard = null;
  if (_rpaCount > 0 && _irkCount === 0) {
    // RPAs detected but no IRKs — user needs to set up Private BLE Device
    privateBleCard = el("div", { class: "card", style: "border-color:#f59e0b;background:rgba(245,158,11,.06)" }, [
      el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px" }, [
        el("span", { style: "font-size:20px" }, "\u{1F4F1}"),
        el("div", {}, [
          el("div", { style: "font-weight:700;font-size:14px" }, `${_rpaCount} rotating-MAC device${_rpaCount !== 1 ? "s" : ""} detected but unresolvable`),
          el("div", { class: "muted" }, "Phones and watches rotate their Bluetooth MAC address every ~15 min. To track them, you need to register their Identity Resolving Key (IRK)."),
        ]),
      ]),
      el("div", { style: "background:rgba(0,0,0,.2);border-radius:8px;padding:12px;margin-bottom:10px" }, [
        el("div", { style: "font-weight:700;margin-bottom:8px;font-size:13px" }, "Setup steps:"),
        el("ol", { style: "margin:0;padding-left:20px;font-size:13px;line-height:1.8" }, [
          el("li", {}, [
            el("span", {}, "Install the "),
            el("a", { href: "https://www.home-assistant.io/integrations/private_ble_device/", target: "_blank", rel: "noopener", style: "color:#60a5fa" }, "Private BLE Device"),
            el("span", {}, " integration in HA (Settings \u2192 Devices & Services \u2192 Add Integration \u2192 search \"Private BLE Device\")"),
          ]),
          el("li", {}, [
            el("span", {}, "Install the "),
            el("a", { href: "https://companion.home-assistant.io/", target: "_blank", rel: "noopener", style: "color:#60a5fa" }, "HA Companion App"),
            el("span", {}, " on each phone/watch you want to track"),
          ]),
          el("li", {}, "In the Companion App, go to Settings \u2192 Companion App \u2192 BLE Transmitter \u2192 enable it"),
          el("li", {}, "The app will show the device's IRK \u2014 copy it and paste it into the Private BLE Device integration config"),
          el("li", {}, "PadSpan will automatically detect the IRK within 5 minutes and start resolving rotating addresses"),
        ]),
      ]),
      el("div", { class: "muted", style: "font-size:12px" }, [
        el("span", {}, "Tip: Apple devices (iPhone, Apple Watch) share IRKs during Bluetooth pairing. Android devices expose the IRK via the Companion App. "),
        el("a", { href: "https://community.home-assistant.io/t/private-ble-device-apple-devices/546810", target: "_blank", rel: "noopener", style: "color:#60a5fa" }, "Community guide for Apple IRKs"),
      ]),
    ]);
  } else if (_irkCount > 0) {
    // IRKs configured — show success status
    privateBleCard = el("div", { class: "card", style: "border-color:#22c55e;background:rgba(34,197,94,.06)" }, [
      el("div", { style: "display:flex;align-items:center;gap:8px" }, [
        el("span", { style: "font-size:18px" }, "\u2705"),
        el("div", {}, [
          el("div", { style: "font-weight:700;font-size:13px" }, `Private BLE: ${_irkCount} IRK${_irkCount !== 1 ? "s" : ""} loaded \u2022 ${_resolvedCount} address${_resolvedCount !== 1 ? "es" : ""} resolved \u2022 ${_privateBleCount} device${_privateBleCount !== 1 ? "s" : ""} tracked`),
          _rpaCount > _resolvedCount
            ? el("div", { class: "muted", style: "font-size:12px" }, `${_rpaCount - _resolvedCount} additional RPA${_rpaCount - _resolvedCount !== 1 ? "s" : ""} seen but not matching any registered IRK \u2014 these may be neighbors' devices or unregistered phones`)
            : null,
        ].filter(Boolean)),
      ]),
    ]);
  }

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

  // Warn if BLE callback isn't active or resolver has errors
  const bleDiagCard = (!_callbackOk || _resolverErrors.length)
    ? el("div", { class: "card warn" }, [
        !_callbackOk ? el("div", { style: "margin-bottom:6px" }, [
          el("span", { style: "font-weight:700" }, "BLE callback not active"),
          el("div", { class: "muted" }, "No live BLE advertisements are being received. Only seeded data (from HA's discovered list) is shown. This means the bluetooth.async_register_callback() call failed — check HA logs for Bluetooth integration errors."),
        ]) : null,
        _resolverErrors.length ? el("div", {}, [
          el("span", { style: "font-weight:700" }, "Private BLE resolver errors"),
          el("pre", { class: "pre" }, _resolverErrors.join("\n")),
        ]) : null,
      ].filter(Boolean))
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
        max: 1000,
        value: String(ctx.state.btMax),
        oninput: e => {
          ctx.state.btMax = e.target.value;
          ctx.actions.renderRooms();
        },
      }),
    ]),
  ]);

  // ESPHome Configs tab is 100% static — skip full DOM rebuild on 5s poll
  if (ctx.state.btTab === "esphome_configs") {
    if (ctx.state._esphomeFullDom) return ctx.state._esphomeFullDom;
    const body = renderEsphomeConfigs(ctx);
    const out = el("div", { id: "bluetooth" }, [header, privateBleCard, diagCard, bleDiagCard, tabs, body]);
    ctx.state._esphomeFullDom = out;
    return out;
  }
  // Clear the cache when leaving the tab so it rebuilds on re-entry
  ctx.state._esphomeFullDom = null;
  ctx.state._esphomeConfigsDom = null;

  let body = null;
  if (ctx.state.btTab === "scanners") {
    body = renderScanners(ctx, radios, sources, adsAll);
  } else if (ctx.state.btTab === "monitor") {
    body = renderMonitor(ctx, ads, radios, objIndex);
  } else {
    body = renderVisualization(ctx, radios, ads, objIndex);
  }

  const out = el("div", { id: "bluetooth" }, [header, privateBleCard, diagCard, bleDiagCard, tabs, controls, body]);
  return out;
}

function renderScanners(ctx, radios, sources, adsAll) {
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
    { const _ss = ctx.helpers.scannerStatus; if(_ss){ const ss = _ss(r, adsAll); meta.push(`status: ${ss.label}`); } else if(r.scanning != null){ meta.push(`scanning: ${r.scanning ? "yes" : "no"}`); } }
    if (r.connectable != null) meta.push(`connectable: ${r.connectable ? "yes" : "no"}`);

    const nameRow = el("div", { style: "display:flex;align-items:center;gap:6px;flex-wrap:wrap" }, [
      sid ? el("span", { class: "pill", style: "font-family:monospace;font-weight:700;font-size:11px;padding:1px 6px", title: (name ? name + " \u00b7 " : "") + src }, sid) : null,
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
    div.title = "Click to see devices heard by this scanner";
    return div;
  };

  // ── Right panel: objects heard by selected scanner ──
  if (!ctx.state._scannerSel && radios.length) ctx.state._scannerSel = radios[0].source || "";
  const selSrc = ctx.state._scannerSel || "";

  // Highlight selected scanner in the left list
  const scannerListEl = el("div", { class: "bt-list" });
  for (const r of radios) {
    const rowEl = row(r);
    const src = String(r.source || "");
    if (src === selSrc) rowEl.style.cssText += ";border-left:3px solid #52b788;padding-left:8px;background:rgba(82,183,136,.08)";
    rowEl.addEventListener("click", (ev) => {
      if (ev.target.tagName === "BUTTON" || ev.target.tagName === "INPUT") return;
      ev.stopPropagation(); ev.preventDefault();
      ctx.state._scannerSel = src;
      ctx.actions.renderRooms();
    });
    scannerListEl.appendChild(rowEl);
  }

  // Build objects list for selected scanner from raw advertisements
  const objModel = snap && snap.objects ? snap.objects : null;
  const allObjects = objModel && Array.isArray(objModel.list) ? objModel.list : [];

  // Index objects by address for enrichment
  const objByAddr = new Map();
  for (const o of allObjects) {
    if (o.address) objByAddr.set(String(o.address).toUpperCase(), o);
    for (const a of (o.all_addresses || [])) { if (a) objByAddr.set(String(a).toUpperCase(), o); }
  }

  // Find all ads from this scanner
  const scannerAds = adsAll.filter(a => String(a.source || "") === selSrc);
  // Dedup by address, keep best RSSI
  const addrMap = new Map();
  for (const a of scannerAds) {
    const addr = (a.address || "").toUpperCase();
    if (!addr) continue;
    const prev = addrMap.get(addr);
    if (!prev || (a.rssi || -200) > (prev.rssi || -200)) addrMap.set(addr, a);
  }
  const uniqueAds = [...addrMap.values()].sort((a, b) => (b.rssi || -200) - (a.rssi || -200));

  const fmtAgo = (s) => {
    const v = Number(s); if (!isFinite(v)) return "—";
    if (v < 1) return "<1s"; if (v < 60) return `${Math.round(v)}s`;
    const m = Math.floor(v/60); if (m < 60) return `${m}m ${Math.round(v-m*60)}s`;
    const h = Math.floor(m/60); if (h < 24) return `${h}h ${m%60}m`;
    const d = Math.floor(h/24); return `${d}d ${h%24}h`;
  };

  const detailCard = el("div", { class: "card", style: "max-height:80vh;overflow-y:auto" });
  const selRadio = radios.find(r => String(r.source || "") === selSrc);
  const selName = selRadio ? (selRadio.name || selSrc) : selSrc;
  const _sid = ctx.helpers.radioShortId ? ctx.helpers.radioShortId(selSrc) : "";
  detailCard.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap" }, [
    _sid ? el("span", { class: "pill", style: "font-family:monospace;font-weight:700;font-size:11px;padding:1px 6px" }, _sid) : null,
    el("div", { class: "h2", style: "margin:0" }, selName),
    el("span", { class: "badge" }, `${_filteredAds.length} ${_quietMode ? "tracked" : "devices"}`),
  ].filter(Boolean)));
  detailCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" }, "All BLE devices heard by this scanner, sorted by signal strength."));

  // Quiet mode: filter per-scanner device list
  const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
  const _filteredAds = _quietMode
    ? uniqueAds.filter(a => {
        const addr = (a.address || "").toUpperCase();
        const obj = objByAddr.get(addr);
        if (obj && (obj.user_label || obj.identified)) return true;
        if (ctx.actions.followedHas && ctx.actions.followedHas(addr)) return true;
        return false;
      })
    : uniqueAds;

  if (!_filteredAds.length) {
    detailCard.appendChild(el("div", { class: "muted", style: "padding:12px 0" }, _quietMode ? "No tracked devices heard by this scanner." : "No devices heard by this scanner yet."));
  } else {
    const tbody = el("tbody");
    for (const a of _filteredAds) {
      const addr = (a.address || "").toUpperCase();
      const obj = objByAddr.get(addr);
      const displayName = obj ? (obj.user_label || obj.name || addr) : (a.name && a.name !== addr ? a.name : addr);
      const kindLabel = obj ? (obj.kind === "private_ble" ? "Private BLE" : obj.kind === "ibeacon" ? "iBeacon" : obj.identified ? "BLE" : "BLE?") : "";
      const pct = Math.max(0, Math.min(100, ((a.rssi || -100) + 100) / 60 * 100));
      const bar = el("div", { style: `width:${pct.toFixed(0)}%;height:5px;background:#52b788;border-radius:3px;min-width:2px` });

      const tr = el("tr", { style: "cursor:pointer" }, [
        el("td", { style: "max-width:200px" }, [
          el("div", { style: "font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" }, displayName),
          displayName !== addr ? el("div", { class: "muted", style: "font-size:10px;font-family:monospace" }, addr) : null,
        ].filter(Boolean)),
        el("td", {}, kindLabel ? el("span", { class: "badge", style: "font-size:9px;padding:1px 5px" }, kindLabel) : ""),
        el("td", { style: "white-space:nowrap" }, [
          el("div", { style: "width:60px;background:#1a2e1e;border-radius:3px" }, bar),
          el("div", { class: "muted", style: "font-size:10px" }, `${a.rssi || "?"} dBm`),
        ]),
        el("td", { class: "muted", style: "font-size:11px;white-space:nowrap" }, fmtAgo(a.age_s)),
      ]);
      if (obj) {
        tr.addEventListener("click", () => ctx.actions.showObjectDetail(obj));
      }
      tbody.appendChild(tr);
    }
    detailCard.appendChild(el("table", { class: "table" }, [
      el("thead", {}, el("tr", {}, [el("th",{},"Device"), el("th",{},"Kind"), el("th",{},"Signal"), el("th",{},"Age")])),
      tbody,
    ]));
  }

  return el("div", { class: "grid-2" }, [
    el("div", { class: "card" }, [el("div", { class: "h2" }, "Scanners"), el("div", { class: "muted", style: "margin-bottom:8px" }, "Select a scanner to see what it hears."), scannerListEl]),
    detailCard,
  ]);
}

function renderMonitor(ctx, ads, radios, objIndex) {
  const { el, esc } = ctx.helpers;
  const _rsid = ctx.helpers.radioShortId || (() => "");

  const selected = ctx.state.btSelectedAddr || null;

  if (!ads.length) {
    return el("div", { class: "card" }, [
      el("div", { style: "font-weight:700" }, "No advertisements in the window"),
      el("div", { class: "muted" }, "Try widening Max rows, clearing filters, or wait a moment for advertisements to arrive."),
    ]);
  }

  // ── helpers ──

  const rssiPill = rssi => {
    const v = Number(rssi);
    if (!isFinite(v)) return el("span", { class: "pill" }, "RSSI ?");
    let cls = "pill";
    if (v >= -60) cls += " good";
    else if (v >= -80) cls += " ok";
    else cls += " bad";
    return el("span", { class: cls }, `${v} dBm`);
  };

  const ageText = age_s => {
    const s = Number(age_s);
    if (!isFinite(s)) return "\u2014";
    if (s < 1) return "<1s";
    if (s < 60) return `${Math.round(s)}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${Math.round(s - m * 60)}s`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  };

  const badge = (text, bg, fg, border) => el("span", { style: `display:inline-block;font-size:10px;padding:1px 6px;border-radius:4px;background:${bg};color:${fg};border:1px solid ${border||bg};white-space:nowrap` }, text);

  const kindBadge = kind => {
    if (kind === "entity")      return badge("entity",      "#0a2a1a", "#86efac", "#2d6a4f");
    if (kind === "private_ble") return badge("private BLE",  "#0a1a3a", "#93c5fd", "#1e4976");
    if (kind === "ibeacon")     return badge("iBeacon",      "#2a1a00", "#fbbf24", "#92400e");
    if (kind === "ble")         return badge("BLE",          "#1a1a2a", "#c4b5fd", "#4c3d8f");
    return null;
  };

  // ── row renderer ──

  const row = a => {
    const addr = a.address || "";
    const src = a.source || "";
    const xr = a._xref || {};
    const obj = addr ? objIndex.get(String(addr).toUpperCase()) : null;
    const userLabel = xr.label || (obj && obj.user_label) || "";
    const displayName = userLabel || a.name || addr || "Unknown";
    const sid = _rsid(src);

    // Enrichment badges (inline, compact)
    const badges = [];
    if (xr.kind)          badges.push(kindBadge(xr.kind));
    if (a.company_name)   badges.push(badge(a.company_name, "#1a2a3a", "#7dd3fc", "#1e4976"));
    if (a.device_type)    badges.push(badge(a.device_type,  "#2a1a3a", "#c4b5fd", "#4c3d8f"));
    if (a.connectable)    badges.push(badge("connectable",  "#0a2a1a", "#86efac", "#2d6a4f"));

    // Service names as tiny pills (max 3)
    const svcNames = a.service_names || (obj && obj.service_names) || [];
    for (let i = 0; i < Math.min(3, svcNames.length); i++) {
      badges.push(badge(svcNames[i], "#1a3a2a", "#86efac", "#2d6a4f"));
    }
    if (svcNames.length > 3) badges.push(badge(`+${svcNames.length - 3}`, "#1a2a2a", "#94a3b8", "#334155"));

    // Sub-line: address • scanner (with short ID) • room
    const subParts = [];
    if (addr) subParts.push(addr);
    subParts.push(sid ? `${sid} ${src}` : (src || "\u2014"));
    if (xr.room) subParts.push(xr.room);
    if (xr.canonical_id) subParts.push("IRK-resolved");
    if (xr.ibeacon_uuid) subParts.push("iBeacon");

    const tagBtn = el("button", { class: "btn tiny" }, userLabel ? "Relabel" : "Tag");
    tagBtn.addEventListener("click", e => { e.stopPropagation(); ctx.actions.tagObjectPrompt(addr, userLabel); });

    const mainDiv = el("div", { class: "bt-adv-main" }, [
      el("div", { class: "bt-adv-name" }, displayName),
      el("div", { class: "bt-adv-sub" }, subParts.join(" \u2022 ")),
    ]);
    if (badges.length) {
      const bRow = el("div", { style: "display:flex;flex-wrap:wrap;gap:3px;margin-top:2px" }, badges.filter(Boolean));
      mainDiv.appendChild(bRow);
    }

    return el("div", {
      class: "bt-adv-row" + (selected === addr ? " active" : ""),
      onclick: () => { ctx.state.btSelectedAddr = selected === addr ? null : addr; ctx.actions.renderRooms(); },
    }, [
      mainDiv,
      el("div", { class: "bt-adv-right" }, [
        rssiPill(a.rssi),
        el("span", { class: "muted" }, ageText(a.age_s)),
        tagBtn,
      ]),
    ]);
  };

  // ── detail panel ──

  const details = (() => {
    if (!selected) return null;
    const a = ads.find(x => x && String(x.address || "") === selected) || null;
    if (!a) return null;
    const xr = a._xref || {};
    const obj = objIndex.get(selected.toUpperCase()) || null;
    const card = el("div", { class: "card" });

    // Header
    const hdrName = xr.label || a.name || selected;
    card.appendChild(el("div", { style: "font-weight:700;font-size:15px;margin-bottom:4px" }, hdrName));
    if (xr.kind) card.appendChild(el("div", { style: "margin-bottom:8px" }, [kindBadge(xr.kind)]));

    // Section helper
    const section = (title, rows) => {
      const s = el("div", { style: "margin-bottom:10px" });
      s.appendChild(el("div", { style: "font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;margin-bottom:4px" }, title));
      for (const [k, v] of rows) {
        if (v === null || v === undefined || v === "") continue;
        s.appendChild(el("div", { style: "display:flex;gap:8px;font-size:12px;line-height:1.6" }, [
          el("span", { style: "color:#64748b;min-width:120px;flex-shrink:0" }, k),
          el("span", { style: "color:#e2e8f0;word-break:break-all" }, String(v)),
        ]));
      }
      return s;
    };

    // Identity
    const idRows = [
      ["Address", a.address],
      ["Name", a.name || "\u2014"],
      ["User Label", xr.label || (obj?.user_label) || "\u2014"],
      ["Object Kind", xr.kind || "untracked"],
    ];
    if (xr.canonical_id) idRows.push(["Canonical ID", xr.canonical_id]);
    if (xr.entity_id)    idRows.push(["HA Entity", xr.entity_id]);
    if (xr.all_addresses && xr.all_addresses.length > 1) {
      idRows.push(["All Addresses", xr.all_addresses.join(", ")]);
    }
    if (xr.room) idRows.push(["Room", xr.room]);
    card.appendChild(section("Identity", idRows));

    // Signal
    const sigRows = [
      ["RSSI", a.rssi != null ? `${a.rssi} dBm` : "\u2014"],
      ["TX Power", a.tx_power != null ? `${a.tx_power} dBm` : "\u2014"],
      ["Age", ageText(a.age_s)],
      ["Scanner", (_rsid(a.source) ? _rsid(a.source) + " " : "") + (a.source || "\u2014")],
      ["Connectable", a.connectable ? "Yes" : "No"],
    ];
    card.appendChild(section("Signal", sigRows));

    // Manufacturer
    const md = a.manufacturer_data || {};
    const mdKeys = Object.keys(md);
    if (mdKeys.length || a.company_name || a.device_type) {
      const mfRows = [
        ["Company", a.company_name || "\u2014"],
        ["Device Type", a.device_type || "\u2014"],
      ];
      for (const cid of mdKeys) {
        mfRows.push(["Manuf ID " + cid, md[cid]]);
      }
      card.appendChild(section("Manufacturer", mfRows));
    }

    // Services
    const svcUuids = a.service_uuids || [];
    const svcMap = a.service_uuid_map || {};
    if (svcUuids.length) {
      const svcRows = svcUuids.map(u => [u, svcMap[u] || "Unknown service"]);
      card.appendChild(section("Services (" + svcUuids.length + ")", svcRows));
    }

    // Service data
    const sd = a.service_data || {};
    const sdKeys = Object.keys(sd);
    if (sdKeys.length) {
      const sdRows = sdKeys.map(k => [svcMap[k] || k, sd[k]]);
      card.appendChild(section("Service Data", sdRows));
    }

    // iBeacon
    if (xr.ibeacon_uuid) {
      card.appendChild(section("iBeacon", [
        ["UUID", xr.ibeacon_uuid],
        ["Major", xr.ibeacon_major],
        ["Minor", xr.ibeacon_minor],
      ]));
    }

    // Raw JSON (collapsible)
    const rawToggle = el("button", { class: "btn tiny", style: "margin-top:4px" }, "Show raw JSON");
    const rawPre = el("pre", { class: "pre", style: "display:none;margin-top:6px;max-height:300px;overflow:auto;font-size:11px" }, esc(JSON.stringify(a, null, 2)));
    rawToggle.addEventListener("click", () => {
      const vis = rawPre.style.display !== "none";
      rawPre.style.display = vis ? "none" : "block";
      rawToggle.textContent = vis ? "Show raw JSON" : "Hide raw JSON";
    });
    card.appendChild(rawToggle);
    card.appendChild(rawPre);

    // Object detail button
    const snap = ctx.state.live?.snapshot;
    const matchedObj = (snap?.objects?.list||[]).find(o =>
      o.address && o.address.toUpperCase() === selected.toUpperCase()
    );
    if (matchedObj) {
      card.appendChild(el("button", { class: "btn inline", style: "margin-top:8px",
        onclick: () => ctx.actions.showObjectDetail(matchedObj)
      }, "Full object details"));
    }

    return card;
  })();

  // Quiet mode: filter ad list to only tracked/identified devices
  const _qm = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
  const _monitorAds = _qm
    ? ads.filter(a => {
        const addr = String(a.address || "").toUpperCase();
        const xr = a._xref || {};
        const obj = addr ? objIndex.get(addr) : null;
        if (xr.label || (obj && (obj.user_label || obj.identified))) return true;
        if (ctx.actions.followedHas && ctx.actions.followedHas(addr)) return true;
        return false;
      })
    : ads;

  return el("div", { class: "grid-2" }, [
    el("div", { class: "card" }, [
      el("div", { class: "h2" }, "Advertisement monitor"),
      el("div", { class: "muted" }, _qm
        ? "Showing tracked devices only (quiet mode). Click a row to inspect."
        : "Click a row to inspect. Enrichment shows decoded manufacturer, services, and cross-references to tracked objects."),
      el("div", { class: "bt-list bt-adv-list" }, _monitorAds.map(row)),
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

  // Filter out scanner-to-scanner detections (scanners are infrastructure, not devices)
  const _isScanner = ctx.helpers.isScanner || (() => false);
  const filteredAds = ads.filter(a => {
    const addr = String(a.address || "").toUpperCase();
    return !_isScanner({address: addr, name: a.name || ""});
  });

  // Group devices by source
  const bySrc = {};
  for (const a of filteredAds) {
    const src = String(a.source || "");
    if (!bySrc[src]) bySrc[src] = [];
    bySrc[src].push(a);
  }

  // Dynamic height: 16px per device row, minimum 460, plus room for titles
  const DEV_ROW_H = 16;
  const totalDevCount = Object.values(bySrc).reduce((sum, arr) => sum + Math.min(arr.length, 24), 0);
  const scannerMinH = srcs.length * 20 + pad * 2 + 40;
  let h = Math.max(460, totalDevCount * DEV_ROW_H + pad * 3 + 30, scannerMinH);

  // Place scanners evenly along the left (initial pass, repositioned after devices)
  const _vizSid = ctx.helpers.radioShortId || (() => "");
  const scannerNodes = srcs.map((src, i) => {
    const y = pad + 20 + (i + 1) * ((h - pad * 2 - 20) / (srcs.length + 1));
    const sid = _vizSid(src);
    const name = radios.find(r => String(r.source || "") === src)?.name || src;
    return { id: src, label: (sid ? "[" + sid + "] " : "") + name, x: scannerNodeX, y };
  });

  // Place devices near their source scanner, then resolve overlaps
  const deviceNodes = [];
  for (const src of Object.keys(bySrc)) {
    const sIdx = srcIndex.has(src) ? srcIndex.get(src) : -1;
    const base = scannerNodes[Math.max(0, sIdx)] || { x: scannerNodeX, y: h / 2 };
    const list = bySrc[src].slice(0, 24);
    const blockH = list.length * DEV_ROW_H;
    const startY = base.y - blockH / 2;
    const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const addr = String(a.address || a.name || `${src}-${i}`);
      const obj = objIndex.get(addr.toUpperCase());
      // Quiet mode: only show identified/labeled/followed devices
      if (_quietMode && (!obj || (!obj.user_label && !obj.identified)) && !(ctx.actions.followedHas && ctx.actions.followedHas(addr))) continue;
      // Build a rich label: prefer user_label > object name > ad name > address
      let devLabel = "";
      if (obj) {
        devLabel = obj.user_label || obj.name || a.name || addr;
        const room = obj.room || a.area_name || "";
        if (room) devLabel += ` · ${room}`;
      } else {
        devLabel = a.name || addr;
        if (a.area_name) devLabel += ` · ${a.area_name}`;
      }
      if (a.rssi != null) devLabel += ` (${a.rssi})`;
      deviceNodes.push({
        id: addr,
        label: devLabel,
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
  // If devices overflow the bottom, shift entire column up as a block
  if (deviceNodes.length) {
    const lastDevY = deviceNodes[deviceNodes.length - 1].y;
    const maxDevY = h - pad - 10;
    if (lastDevY > maxDevY) {
      const shift = lastDevY - maxDevY;
      for (const d of deviceNodes) d.y -= shift;
    }
    // If top overflows after shifting, clamp top and accept that we need more height
    const topMin = pad + 20;
    if (deviceNodes[0].y < topMin) {
      const shift = topMin - deviceNodes[0].y;
      for (const d of deviceNodes) d.y += shift;
    }
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
  // Resolve scanner overlaps (minimum 20px apart — matches label font size)
  const SCAN_GAP = 20;
  scannerNodes.sort((a, b) => a.y - b.y);
  for (let i = 1; i < scannerNodes.length; i++) {
    if (scannerNodes[i].y - scannerNodes[i - 1].y < SCAN_GAP) {
      scannerNodes[i].y = scannerNodes[i - 1].y + SCAN_GAP;
    }
  }
  // If scanners overflow the bottom, shift them all up as a block
  if (scannerNodes.length) {
    const lastY = scannerNodes[scannerNodes.length - 1].y;
    const maxY = h - pad - 10;
    if (lastY > maxY) {
      const shift = lastY - maxY;
      for (const sn of scannerNodes) sn.y -= shift;
    }
    // Clamp top edge
    const topMin = pad + 20;
    if (scannerNodes[0].y < topMin) {
      const shift = topMin - scannerNodes[0].y;
      for (const sn of scannerNodes) sn.y += shift;
    }
  }

  // Expand SVG height if nodes extend beyond the initial estimate
  const allYs = [...deviceNodes.map(d => d.y), ...scannerNodes.map(s => s.y)];
  if (allYs.length) {
    const neededH = Math.max(...allYs) + pad + 20;
    if (neededH > h) h = neededH;
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
  s += `<style>.bt-viz-click:hover text{fill:#5eead4!important}.bt-viz-click:hover circle{opacity:.8;stroke:#5eead4;stroke-width:2}</style>`;

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

  // Scanner nodes + labels (left-aligned, growing rightward toward node) — clickable
  // Invisible hit-area rect behind each row so clicks land reliably on the <g>
  for (const sn of scannerNodes) {
    s += `<g class="bt-viz-click" data-type="scanner" data-id="${_escSvg(sn.id)}" style="cursor:pointer">`;
    s += `<rect x="${scannerLabelX - 4}" y="${sn.y - 10}" width="${sn.x - scannerLabelX + 18}" height="20" fill="transparent"/>`;
    s += `<circle cx="${sn.x}" cy="${sn.y}" r="7" class="bt-viz-node scanner"/>`;
    s += `<text x="${scannerLabelX}" y="${sn.y}" class="bt-viz-label" text-anchor="start" dominant-baseline="middle">${_escSvg(trunc(sn.label))}</text>`;
    s += `</g>`;
  }

  // Device nodes + labels (left-aligned, growing rightward from node) — clickable
  for (const d of deviceNodes) {
    const rc = rssiClass(d.rssi);
    s += `<g class="bt-viz-click" data-type="device" data-id="${_escSvg(d.id)}" style="cursor:pointer">`;
    s += `<rect x="${d.x - 8}" y="${d.y - 9}" width="${deviceLabelX - d.x + 18}" height="18" fill="transparent"/>`;
    s += `<circle cx="${d.x}" cy="${d.y}" r="5" class="bt-viz-node device ${rc}"/>`;
    s += `<text x="${d.x + 10}" y="${d.y}" class="bt-viz-label" font-size="11" text-anchor="start" dominant-baseline="middle">${_escSvg(trunc(d.label))}</text>`;
    s += `</g>`;
  }

  // Titles on top
  s += `<text x="${scannerLabelX}" y="${pad}" class="bt-viz-title" text-anchor="start" dominant-baseline="middle">Scanners</text>`;
  s += `<text x="${deviceNodeX + 10}" y="${pad}" class="bt-viz-title" text-anchor="start" dominant-baseline="middle">Devices</text>`;

  s += `</svg>`;

  const svgWrap = document.createElement("div");
  svgWrap.innerHTML = s;

  // Click handler — drill into scanner or device detail
  svgWrap.addEventListener("click", (e) => {
    const g = e.target.closest(".bt-viz-click");
    if (!g) return;
    const type = g.getAttribute("data-type");
    const id = g.getAttribute("data-id");
    if (!id) return;
    if (type === "scanner") {
      const radio = radios.find(r => String(r.source || "") === id);
      if (radio) ctx.actions.showScannerDetail(radio);
    } else if (type === "device") {
      // Try to find a full object from the snapshot for a rich detail modal
      const obj = objIndex.get(id.toUpperCase());
      if (obj) {
        ctx.actions.showObjectDetail(obj);
      } else {
        // Build a minimal object from the advertisement
        const ad = ads.find(a => String(a.address || "") === id || String(a.name || "") === id);
        if (ad) {
          ctx.actions.showObjectDetail({
            address: ad.address || id,
            name: ad.name || ad.address || id,
            kind: "ble",
            room: ad.area_name || "",
            rssi: ad.rssi,
            source: ad.source || "",
          });
        }
      }
    }
  });

  return el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Visualization"),
    el("div", { class: "muted", style: "margin-bottom:10px" }, "A simple scanner→device graph, grouped by the scanner source that reported the advertisement."),
    svgWrap,
    el("div", { class: "muted", style: "margin-top:10px" }, "Tip: use Source + Search filters above to narrow the graph. Click any scanner or device for details."),
  ]);
}

// ── ESPHome Config Library ─────────────────────────────────────────────────────

const ESPHOME_CONFIGS = [
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
    minimal: `# ── Add to your existing ESP32-S3 Ethernet ESPHome config ──────────
# Paste these sections into your YAML. If you already have sensor:
# or text_sensor: sections, merge the entries under the existing key.

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 300ms                 # 93.75% — max duty (no WiFi contention)
    active: false
    continuous: true

bluetooth_proxy:
  active: false

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
    minimal: `# ── Add to your existing ESP32-C6 ESPHome config ──────────────────
# Paste these sections. Single-core: add the on_client_connected
# block under your existing api: key to gate BLE on API connection.
# If you already have sensor:/text_sensor: sections, merge entries.

# Add under your existing api: section:
#  on_client_connected:
#    - esp32_ble_tracker.start_scan:
#        continuous: true
#  on_client_disconnected:
#    - esp32_ble_tracker.stop_scan:

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 100ms                 # ~31% duty — single-core safe
    active: false

bluetooth_proxy:
  active: false

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
    minimal: `# ── Add to your existing ESP32-S3 WiFi ESPHome config ─────────────
# Paste these sections into your YAML. If you already have sensor:
# or text_sensor: sections, merge the entries under the existing key.

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 100ms                 # ~31% — WiFi still needs airtime
    active: false
    continuous: true              # safe on dual-core S3

bluetooth_proxy:
  active: false

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
    minimal: `# ── Add to any existing ESP32 ESPHome config ─────────────────────
# Paste these sections into your YAML. Works on any ESP32 variant.
# If you already have sensor:/text_sensor: sections, merge entries.

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 100ms
    active: false
    continuous: true

bluetooth_proxy:
  active: false

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
  {
    id: "c3_wifi",
    chip: "ESP32-C3",
    connection: "WiFi",
    badge: "Not recommended",
    badgeColor: "#ef4444",
    description: "Single-core RISC-V. BLE and WiFi share the same core and radio — scan duty is low and real-world performance is worse than specs suggest. Use this config if you already own C3 boards, but buy S3 or C6 for new scanners.",
    notes: [
      "Scan duty ~31% nominal, but WiFi interruptions drop real duty to ~20-25%",
      "Single-core — BLE scanning blocks WiFi, causing missed advertisements",
      "Watchdog reset risk under heavy WiFi traffic — requires API-gated workaround",
      "Put C3 boards in low-priority rooms (hallways, garage) where missed readings matter less",
    ],
    yaml: `# PadSpan — ESP32-C3 WiFi Scanner
# NOT RECOMMENDED for new purchases. Use S3 or C6 instead.
# Single-core: BLE and WiFi compete for the same core and radio.
# This config gates scanning on API connection to prevent watchdog resets.

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
    window: 100ms                 # ~31% duty — safe for single-core WiFi
    active: false

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
    minimal: `# ── Add to your existing ESP32-C3 ESPHome config ─────────────────
# Paste these sections. Single-core: add the on_client_connected
# block under your existing api: key to gate BLE on API connection.
# If you already have sensor:/text_sensor: sections, merge entries.

# Add under your existing api: section:
#  on_client_connected:
#    - esp32_ble_tracker.start_scan:
#        continuous: true
#  on_client_disconnected:
#    - esp32_ble_tracker.stop_scan:

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 100ms                 # ~31% duty — single-core safe
    active: false

bluetooth_proxy:
  active: false

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
];

function renderEsphomeConfigs(ctx) {
  // Cache the entire config library DOM — it's 100% static content.
  // Without this, the 5s poll cycle rebuilds the DOM and flickers expanded YAML.
  if (ctx.state._esphomeConfigsDom) return ctx.state._esphomeConfigsDom;

  const { el } = ctx.helpers;

  // Floating copy-to-clipboard icon for code blocks (industry-standard top-right placement)
  function _makeCodeCopyIcon(text) {
    const btn = document.createElement("button");
    btn.title = "Copy to clipboard";
    btn.style.cssText = "position:absolute;top:8px;right:8px;background:#1a2e22;border:1px solid #2d5a3d;border-radius:6px;padding:5px 6px;cursor:pointer;opacity:0.6;transition:opacity 0.15s;display:flex;align-items:center;justify-content:center;z-index:1";
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
    btn.addEventListener("mouseleave", () => { if (btn.dataset.copied !== "1") btn.style.opacity = "0.6"; });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text).then(() => {
        btn.dataset.copied = "1";
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52b788" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        btn.style.opacity = "1";
        btn.style.borderColor = "#52b788";
        setTimeout(() => {
          btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
          btn.style.opacity = "0.6";
          btn.style.borderColor = "#2d5a3d";
          delete btn.dataset.copied;
        }, 1500);
      }).catch(() => {});
    });
    return btn;
  }

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

  // External antenna recommendation — auto-expires September 10, 2026
  const _antExpiry = new Date("2026-09-10T00:00:00Z").getTime();
  const antennaCard = Date.now() < _antExpiry ? el("div", { class: "card", style: "border:1px solid #f59e0b55;background:#1a1500" }, [
    el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap" }, [
      el("div", {}, [
        el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px" }, [
          el("span", { style: "font-weight:700;font-size:15px;color:#f59e0b" }, "The Single Biggest Improvement: External Antenna"),
          el("span", { class: "badge", style: "font-size:10px;background:#f59e0b22;color:#f59e0b" }, "#1 Upgrade"),
        ]),
        el("div", { class: "muted", style: "font-size:12px;line-height:1.7;max-width:650px" },
          "Adding an external antenna to your ESP32 scanner is the most impactful upgrade you can make. " +
          "The tiny PCB antennas on most boards have limited range and are easily blocked by enclosures. " +
          "An external antenna dramatically improves RSSI consistency, range, and positioning accuracy — " +
          "often doubling effective coverage per scanner."
        ),
      ]),
      (() => {
        const linkBtn = document.createElement("a");
        linkBtn.href = "https://www.aliexpress.com/item/1005003443721023.html";
        linkBtn.target = "_blank";
        linkBtn.rel = "noopener noreferrer";
        linkBtn.className = "btn tiny";
        linkBtn.style.cssText = "font-size:11px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;background:#1a1a0e;border-color:#f59e0b;color:#f59e0b;flex-shrink:0";
        linkBtn.textContent = "Example on AliExpress";
        return linkBtn;
      })(),
    ]),
    el("div", { style: "margin-top:8px;display:flex;flex-direction:column;gap:3px" }, [
      el("div", { style: "font-size:11px;color:#94a3b8;padding-left:12px;position:relative" }, [
        el("span", { style: "position:absolute;left:0;color:#f59e0b" }, "\u2022"),
        document.createTextNode("Look for boards with an IPEX/U.FL connector (most ESP32-S3 and ESP32 boards have one)"),
      ]),
      el("div", { style: "font-size:11px;color:#94a3b8;padding-left:12px;position:relative" }, [
        el("span", { style: "position:absolute;left:0;color:#f59e0b" }, "\u2022"),
        document.createTextNode("A simple 2.4 GHz antenna with IPEX connector is all you need — no soldering required"),
      ]),
      el("div", { style: "font-size:11px;color:#fbbf24;padding-left:12px;position:relative;font-weight:600" }, [
        el("span", { style: "position:absolute;left:0;color:#f59e0b" }, "\u26A0"),
        document.createTextNode("Connector types (IPEX, U.FL) vary between boards — verify your board's connector before ordering"),
      ]),
      el("div", { style: "font-size:11px;color:#94a3b8;padding-left:12px;position:relative" }, [
        el("span", { style: "position:absolute;left:0;color:#f59e0b" }, "\u2022"),
        document.createTextNode("Tested and working, but this is a third-party link provided as an example only"),
      ]),
    ]),
  ]) : null;

  // Hardware recommendation — auto-expires July 10, 2026
  const _recExpiry = new Date("2026-07-10T00:00:00Z").getTime();
  const recCard = Date.now() < _recExpiry ? (() => {
    const _recYaml = `esphome:
  name: ble-white3dprintedbox
  friendly_name: BLE-white3dprintedBOX
  min_version: 2025.11.0
  name_add_mac_suffix: false

esp32:
  variant: esp32s3
  framework:
    type: esp-idf

# ── Ethernet (W5500 over SPI) ──────────────────────────────
ethernet:
  type: W5500
  clk_pin: GPIO7
  mosi_pin: GPIO9
  miso_pin: GPIO8
  cs_pin: GPIO2
  interrupt_pin: GPIO10

# ── Home Assistant API ─────────────────────────────────────
api:
  encryption:
    key: "YOUR_KEY_HERE"

# ── OTA Updates ────────────────────────────────────────────
ota:
  - platform: esphome
    password: "YOUR_PASSWORD_HERE"

# ── Logging ────────────────────────────────────────────────
logger:
  level: WARN

# ── BLE Configuration ─────────────────────────────────────
esp32_ble:
  max_connections: 4

esp32_ble_tracker:
  scan_parameters:
    interval: 1100ms
    window: 1100ms
    active: true

# ── Bluetooth Proxy ───────────────────────────────────────
bluetooth_proxy:
  active: true
  connection_slots: 4

# ── Diagnostic Sensors ─────────────────────────────────────
sensor:
  - platform: uptime
    name: "Uptime"
    update_interval: 60s
    entity_category: diagnostic

  - platform: internal_temperature
    name: "ESP32 Temperature"
    update_interval: 60s
    entity_category: diagnostic

text_sensor:
  - platform: ethernet_info
    ip_address:
      name: "IP Address"
      entity_category: diagnostic

  - platform: version
    name: "ESPHome Version"
    entity_category: diagnostic

binary_sensor:
  - platform: status
    name: "Status"
    entity_category: diagnostic

# ── Control Buttons ────────────────────────────────────────
button:
  - platform: restart
    name: "Restart"
    entity_category: config

  - platform: safe_mode
    name: "Safe Mode Boot"
    entity_category: config

  - platform: factory_reset
    name: "Factory Reset"
    entity_category: config`;

    const yamlPre = document.createElement("pre");
    yamlPre.className = "pre";
    yamlPre.style.cssText = "margin-top:10px;font-size:11px;max-height:500px;overflow:auto;white-space:pre;tab-size:2;display:none";
    yamlPre.textContent = _recYaml;

    // Wrap pre in container with floating copy icon
    const _recPreWrap = document.createElement("div");
    _recPreWrap.style.cssText = "position:relative;display:none";
    const _recCopyIcon = _makeCodeCopyIcon(_recYaml);
    _recPreWrap.appendChild(yamlPre);
    _recPreWrap.appendChild(_recCopyIcon);
    yamlPre.style.display = "block"; // always visible inside wrapper
    yamlPre.style.marginTop = "0";

    const showBtn = el("button", { class: "btn tiny", style: "font-size:11px" }, "Show YAML");
    showBtn.addEventListener("click", () => {
      const show = _recPreWrap.style.display === "none";
      _recPreWrap.style.display = show ? "block" : "none";
      showBtn.textContent = show ? "Hide YAML" : "Show YAML";
    });
    const copyBtn = el("button", { class: "btn tiny", style: "font-size:11px" }, "Copy");
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(_recYaml).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
      }).catch(() => {
        _recPreWrap.style.display = "block";
        showBtn.textContent = "Hide YAML";
        copyBtn.textContent = "Copy manually";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
      });
    });

    const linkBtn = document.createElement("a");
    linkBtn.href = "https://www.aliexpress.com/item/1005009310322353.html";
    linkBtn.target = "_blank";
    linkBtn.rel = "noopener noreferrer";
    linkBtn.className = "btn tiny";
    linkBtn.style.cssText = "font-size:11px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;background:#1a2e0e;border-color:#52b788;color:#52b788";
    linkBtn.textContent = "View on AliExpress";

    return el("div", { class: "card", style: "border:1px solid #52b78855;background:#0a1a10" }, [
      el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap" }, [
        el("div", {}, [
          el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px" }, [
            el("span", { style: "font-weight:700;font-size:14px;color:#52b788" }, "Recommended: ESP32-S3 Ethernet Board"),
            el("span", { class: "badge", style: "font-size:10px;background:#10b98122;color:#10b981" }, "Tested & Working"),
          ]),
          el("div", { class: "muted", style: "font-size:12px;line-height:1.6;max-width:600px" },
            "ESP32-S3 with W5500 Ethernet in a compact 3D-printed case. Wired connection means zero WiFi contention — the BLE radio runs at full duty. " +
            "Affordable, reliable, and field-tested with PadSpan. Just flash the config below and plug in."
          ),
        ]),
        el("div", { style: "display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap" }, [linkBtn, showBtn, copyBtn]),
      ]),
      el("div", { style: "margin-top:8px;display:flex;flex-direction:column;gap:3px" }, [
        el("div", { style: "font-size:11px;color:#94a3b8;padding-left:12px;position:relative" }, [
          el("span", { style: "position:absolute;left:0;color:#52b788" }, "\u2022"),
          document.createTextNode("ESP32-S3 + W5500 Ethernet — no WiFi needed, maximum BLE scan duty"),
        ]),
        el("div", { style: "font-size:11px;color:#94a3b8;padding-left:12px;position:relative" }, [
          el("span", { style: "position:absolute;left:0;color:#52b788" }, "\u2022"),
          document.createTextNode("Active scanning with Bluetooth Proxy enabled (4 connection slots)"),
        ]),
        el("div", { style: "font-size:11px;color:#94a3b8;padding-left:12px;position:relative" }, [
          el("span", { style: "position:absolute;left:0;color:#52b788" }, "\u2022"),
          document.createTextNode("Replace API key and OTA password with your own values before flashing"),
        ]),
      ]),
      _recPreWrap,
    ]);
  })() : null;

  // Chip comparison table — auto-expires March 10, 2028 (hardware recs go stale)
  const _chipExpiry = new Date("2028-03-10T00:00:00Z").getTime();
  const chipTable = Date.now() < _chipExpiry ? el("div", { class: "card" }, [
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
          <tr style="border-bottom:1px solid #1a2e22"><td style="padding:6px 8px;font-weight:600;color:#10b981">ESP32-S3</td><td style="padding:6px 8px;color:#10b981">2 (Xtensa)</td><td style="padding:6px 8px">5.0</td><td style="padding:6px 8px">4 (b/g/n)</td><td style="padding:6px 8px;color:#10b981">~31% WiFi / 93.75% Eth</td><td style="padding:6px 8px;color:#10b981;font-weight:600">Best overall</td></tr>
          <tr style="border-bottom:1px solid #1a2e22"><td style="padding:6px 8px;font-weight:600">ESP32-C6</td><td style="padding:6px 8px">1 (RISC-V)</td><td style="padding:6px 8px;color:#8b5cf6">5.3</td><td style="padding:6px 8px;color:#8b5cf6">6 (ax)</td><td style="padding:6px 8px;color:#f59e0b">~31%</td><td style="padding:6px 8px">Future-proof, Wi-Fi 6</td></tr>
          <tr style="border-bottom:1px solid #1a2e22"><td style="padding:6px 8px;font-weight:600">ESP32 (original)</td><td style="padding:6px 8px">2 (Xtensa)</td><td style="padding:6px 8px">4.2</td><td style="padding:6px 8px">4 (b/g/n)</td><td style="padding:6px 8px;color:#f59e0b">~31%</td><td style="padding:6px 8px">Legacy installs</td></tr>
          <tr><td style="padding:6px 8px;font-weight:600;color:#ef4444">ESP32-C3</td><td style="padding:6px 8px">1 (RISC-V)</td><td style="padding:6px 8px">5.0</td><td style="padding:6px 8px">4 (b/g/n)</td><td style="padding:6px 8px;color:#ef4444">~20-25%</td><td style="padding:6px 8px;color:#ef4444">Not recommended — use existing only</td></tr>
        </tbody>
      </table>`;
      return wrap;
    })(),
  ]) : null;

  // Config cards
  const configCards = ESPHOME_CONFIGS.map(cfg => {
    const expandedFull = ctx.state[`_cfgExpand_${cfg.id}`] || false;
    const expandedMin  = ctx.state[`_cfgMinimal_${cfg.id}`] || false;

    const toggleBtn = el("button", { class: "btn tiny", style: "font-size:11px" }, expandedFull ? "Hide YAML" : "Full YAML");
    const minimalBtn = cfg.minimal
      ? el("button", { class: "btn tiny", style: "font-size:11px;border-color:#52b78840;color:#52b788" }, expandedMin ? "Hide Minimal" : "Add to Existing")
      : null;
    const copyBtn = el("button", { class: "btn tiny", style: "font-size:11px" }, "Copy");

    const headerRow = el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap" }, [
      el("div", {}, [
        el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px" }, [
          el("span", { style: "font-weight:700;font-size:14px" }, `${cfg.chip} — ${cfg.connection}`),
          el("span", { class: "badge", style: `font-size:10px;background:${cfg.badgeColor}22;color:${cfg.badgeColor}` }, cfg.badge),
        ]),
        el("div", { class: "muted", style: "font-size:12px;line-height:1.5;max-width:600px" }, cfg.description),
      ]),
      el("div", { style: "display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap" }, [minimalBtn, toggleBtn, copyBtn].filter(Boolean)),
    ]);

    const notesList = el("div", { style: "margin-top:8px;display:flex;flex-direction:column;gap:3px" },
      cfg.notes.map(n => el("div", { style: "font-size:11px;color:#94a3b8;padding-left:12px;position:relative" }, [
        el("span", { style: "position:absolute;left:0;color:#52b788" }, "•"),
        document.createTextNode(n),
      ]))
    );

    const yamlPre = document.createElement("pre");
    yamlPre.className = "pre";
    yamlPre.style.cssText = "font-size:11px;max-height:500px;overflow:auto;white-space:pre;tab-size:2";
    yamlPre.textContent = cfg.yaml;

    // Wrap full YAML pre with floating copy icon
    const yamlWrap = document.createElement("div");
    yamlWrap.style.cssText = "position:relative;margin-top:10px;display:" + (expandedFull ? "block" : "none");
    yamlWrap.appendChild(yamlPre);
    yamlWrap.appendChild(_makeCodeCopyIcon(cfg.yaml));

    const minPre = document.createElement("pre");
    let minWrap = null;
    if (cfg.minimal) {
      minPre.className = "pre";
      minPre.style.cssText = "font-size:11px;max-height:500px;overflow:auto;white-space:pre;tab-size:2;border:1px solid #52b78830";
      minPre.textContent = cfg.minimal;

      // Wrap minimal pre with floating copy icon
      minWrap = document.createElement("div");
      minWrap.style.cssText = "position:relative;margin-top:10px;display:" + (expandedMin ? "block" : "none");
      minWrap.appendChild(minPre);
      minWrap.appendChild(_makeCodeCopyIcon(cfg.minimal));
    }

    // Only one can be open at a time
    toggleBtn.addEventListener("click", () => {
      const show = !ctx.state[`_cfgExpand_${cfg.id}`];
      ctx.state[`_cfgExpand_${cfg.id}`] = show;
      ctx.state[`_cfgMinimal_${cfg.id}`] = false;
      yamlWrap.style.display = show ? "block" : "none";
      if (minWrap) minWrap.style.display = "none";
      toggleBtn.textContent = show ? "Hide YAML" : "Full YAML";
      if (minimalBtn) minimalBtn.textContent = "Add to Existing";
    });

    if (minimalBtn) {
      minimalBtn.addEventListener("click", () => {
        const show = !ctx.state[`_cfgMinimal_${cfg.id}`];
        ctx.state[`_cfgMinimal_${cfg.id}`] = show;
        ctx.state[`_cfgExpand_${cfg.id}`] = false;
        if (minWrap) minWrap.style.display = show ? "block" : "none";
        yamlWrap.style.display = "none";
        minimalBtn.textContent = show ? "Hide Minimal" : "Add to Existing";
        toggleBtn.textContent = "Full YAML";
      });
    }

    // Copy whichever is currently visible
    copyBtn.addEventListener("click", () => {
      const text = ctx.state[`_cfgMinimal_${cfg.id}`] ? cfg.minimal : cfg.yaml;
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
      }).catch(() => {
        const target = ctx.state[`_cfgMinimal_${cfg.id}`] ? (minWrap || yamlWrap) : yamlWrap;
        target.style.display = "block";
        const pre = target.querySelector("pre");
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        copyBtn.textContent = "Select failed — copy manually";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
      });
    });

    return el("div", { class: "card", style: "border:1px solid #1a2e22" }, [headerRow, notesList, minWrap, yamlWrap].filter(Boolean));
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

  const result = el("div", {}, [intro, antennaCard, recCard, chipTable, ...configCards, tips].filter(Boolean));
  ctx.state._esphomeConfigsDom = result;
  return result;
}

function _escSvg(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
