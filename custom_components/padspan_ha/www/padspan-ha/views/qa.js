// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
export function render(ctx){
  const { el, esc, helpBtn, radioShortId } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const root = el("section",{id:"qa"});

  // Header
  root.appendChild(el("div",{class:"row",style:"align-items:center;gap:8px;margin-bottom:14px"},[
    el("h2",{},"QA"),
    helpBtn("qa"),
  ]));

  const grid = el("div",{class:"grid"});

  // ── Config Health ──
  const healthCard = el("div",{class:"card"});
  healthCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Config Health"));

  const maps = (ctx.state.maps && ctx.state.maps.list) || [];
  const rooms = snap ? (snap.rooms_discovered || []) : [];
  const radios = snap ? ((snap.ble && snap.ble.radios) || []) : [];
  const bleDiag = snap ? ((snap.ble && snap.ble.diag) || {}) : {};
  const objects = snap ? ((snap.objects && snap.objects.list) || []) : [];

  const checks = [
    {
      label: "Maps configured",
      pass: maps.length > 0,
      detail: maps.length > 0 ? `${maps.length} map${maps.length>1?"s":""}` : "No maps uploaded",
      fix: "Upload a floor plan in the Maps tab.",
      fixView: "maps",
    },
    {
      label: "Receivers on maps",
      pass: maps.some(m => (m.receivers || []).length > 0),
      detail: maps.some(m => (m.receivers || []).length > 0) ? "At least one map has receivers" : "No receivers placed on maps",
      fix: "Place scanners on your map in Maps \u2192 3D Stack.",
      fixView: "maps",
    },
    {
      label: "Rooms defined",
      pass: rooms.length > 0,
      detail: rooms.length > 0 ? `${rooms.length} room${rooms.length>1?"s":""}` : "No HA areas configured",
      fix: "Create areas in HA Settings \u2192 Areas & Zones.",
    },
    {
      label: "BLE scanners active",
      pass: radios.length > 0,
      detail: radios.length > 0 ? `${radios.length} scanner${radios.length>1?"s":""}` : "No BLE radios detected",
      fix: "Add Bluetooth scanner integrations to HA.",
    },
    {
      label: "BLE feed healthy",
      pass: bleDiag.ok === true,
      detail: bleDiag.ok === true ? "OK" : (bleDiag.errors && bleDiag.errors.length ? bleDiag.errors[0] : "Unhealthy or no data"),
      fix: "Restart HA (Settings \u2192 System \u2192 Restart).",
    },
    {
      label: "Objects tagged",
      pass: objects.some(o => o.user_label),
      detail: objects.filter(o => o.user_label).length + " tagged",
      fix: "Tag devices in the Objects tab.",
      fixView: "objects",
    },
    {
      label: "Snapshot available",
      pass: !!snap,
      detail: snap ? "Yes" : "No snapshot loaded",
      fix: "Switch to Live or Sample mode.",
    },
  ];

  const checkList = el("div",{style:"display:flex;flex-direction:column;gap:6px"});
  let passCount = 0;
  for(const c of checks){
    if(c.pass) passCount++;
    const icon = c.pass ? "\u2705" : "\u274C";
    const color = c.pass ? "#52b788" : "#ef5350";
    const row = el("div",{style:"display:flex;align-items:flex-start;gap:8px;font-size:13px"});
    row.appendChild(el("span",{style:"flex-shrink:0"}, icon));
    row.appendChild(el("div",{style:"flex:1"},[
      el("div",{style:"display:flex;align-items:center;gap:8px"},[
        el("span",{style:`color:${color};font-weight:600;min-width:140px`}, c.label),
        el("span",{class:"muted",style:"font-size:11px"}, c.detail),
      ]),
      !c.pass && c.fix ? el("div",{style:"font-size:11px;color:#90caf9;margin-top:2px;display:flex;align-items:center;gap:4px"},[
        el("span",{}, c.fix),
        c.fixView ? (() => {
          const link = el("span",{style:"cursor:pointer;text-decoration:underline;text-decoration-style:dotted;color:#5eead4"}, `Go \u2192`);
          link.addEventListener("click", ()=>{
            ctx.state.view = c.fixView;
            ctx.actions.renderRooms();
          });
          return link;
        })() : null,
      ].filter(Boolean)) : null,
    ].filter(Boolean)));
    checkList.appendChild(row);
  }
  healthCard.appendChild(checkList);
  healthCard.appendChild(el("div",{style:"margin-top:10px;font-size:12px;font-weight:600;color:" + (passCount === checks.length ? "#52b788" : "#ffd54f")},
    `${passCount}/${checks.length} checks passed`));
  grid.appendChild(healthCard);

  // ── Data Consistency ──
  const consistCard = el("div",{class:"card"});
  consistCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Data Consistency"));

  const issues = [];

  if(snap){
    // Orphaned objects
    const roomSet = new Set(rooms);
    const orphaned = objects.filter(o => o.room && !roomSet.has(o.room));
    if(orphaned.length > 0){
      const chips = el("div",{style:"display:flex;flex-wrap:wrap;gap:4px;margin-top:4px"});
      for(const o of orphaned.slice(0, 5)){
        const name = o.user_label || o.name || o.address;
        const chip = el("span",{style:"font-size:11px;color:#ffd54f;cursor:pointer;text-decoration:underline;text-decoration-style:dotted"}, name);
        chip.addEventListener("click", ()=>ctx.actions.showObjectDetail(o));
        chips.appendChild(chip);
      }
      if(orphaned.length > 5) chips.appendChild(el("span",{class:"muted",style:"font-size:11px"}, `+${orphaned.length-5} more`));
      issues.push(el("div",{style:"font-size:12px;margin-bottom:6px"},[
        el("span",{style:"color:#ffd54f;font-weight:600"}, `${orphaned.length} orphaned object${orphaned.length>1?"s":""} (in unknown rooms):`),
        chips,
      ]));
    }

    // Unmapped scanners
    const mappedSources = new Set();
    for(const m of maps) for(const r of (m.receivers||[])) mappedSources.add(r.source||r.name||r.id);
    const unmapped = radios.filter(r => !mappedSources.has(r.source) && !mappedSources.has(r.name));
    if(unmapped.length > 0){
      const chips = el("div",{style:"display:flex;flex-wrap:wrap;gap:4px;margin-top:4px"});
      for(const s of unmapped){
        const chip = el("span",{style:"font-size:11px;color:#ffd54f;cursor:pointer;text-decoration:underline;text-decoration-style:dotted"}, s.name||s.source);
        chip.addEventListener("click", ()=>ctx.actions.showScannerDetail(s));
        chips.appendChild(chip);
      }
      issues.push(el("div",{style:"font-size:12px;margin-bottom:6px"},[
        el("span",{style:"color:#ffd54f;font-weight:600"}, `${unmapped.length} unmapped scanner${unmapped.length>1?"s":""}:`),
        chips,
      ]));
    }

    // Rooms without scanner
    const scannerRooms = new Set(radios.map(r=>r.area_name).filter(Boolean));
    const uncovered = rooms.filter(r => !scannerRooms.has(r));
    if(uncovered.length > 0){
      const chips = el("div",{style:"display:flex;flex-wrap:wrap;gap:4px;margin-top:4px"});
      for(const r of uncovered){
        const chip = el("span",{style:"font-size:11px;color:#90caf9;cursor:pointer;text-decoration:underline;text-decoration-style:dotted"}, r);
        chip.addEventListener("click", ()=>ctx.actions.showRoomDetail(r));
        chips.appendChild(chip);
      }
      issues.push(el("div",{style:"font-size:12px;margin-bottom:6px"},[
        el("span",{style:"color:#90caf9;font-weight:600"}, `${uncovered.length} room${uncovered.length>1?"s":""} without scanner:`),
        chips,
      ]));
    }
  }

  if(issues.length === 0){
    consistCard.appendChild(el("div",{style:"font-size:13px;color:#52b788;font-weight:600"},"No data consistency issues found."));
  } else {
    for(const iss of issues) consistCard.appendChild(iss);
  }
  grid.appendChild(consistCard);

  // ── Radio Analysis ──
  const radioCard = el("div",{class:"card"});
  radioCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
    el("div",{style:"font-weight:700"},"Radio Analysis"),
    helpBtn("qa_radio_analysis"),
  ]));

  const ads = snap ? ((snap.ble && snap.ble.advertisements) || []) : [];

  if(radios.length === 0){
    radioCard.appendChild(el("div",{class:"muted"},"No radios detected."));
  } else {
    // Build per-radio device sets and ad lists from advertisements
    const radioDevSets = {};
    const radioAds = {};
    for(const r of radios){ radioDevSets[r.source] = new Set(); radioAds[r.source] = []; }
    for(const ad of ads){
      const src = ad.source || "";
      if(!radioDevSets[src]){ radioDevSets[src] = new Set(); radioAds[src] = []; }
      radioDevSets[src].add(ad.address);
      radioAds[src].push(ad);
    }

    // Compute per-radio analysis
    const analyses = radios.map(r => {
      const src = r.source || "";
      const devSet = radioDevSets[src] || new Set();
      const myAds = radioAds[src] || [];

      const totalDevices = devSet.size;
      const rssiValues = myAds.filter(a => a.rssi != null).map(a => a.rssi);
      const ageValues = myAds.filter(a => a.age_s != null).map(a => a.age_s);

      const strongestRssi = rssiValues.length ? Math.max(...rssiValues) : null;
      const weakestRssi = rssiValues.length ? Math.min(...rssiValues) : null;
      const avgRssi = rssiValues.length ? Math.round(rssiValues.reduce((a,b)=>a+b,0) / rssiValues.length) : null;
      const freshestAge = ageValues.length ? Math.min(...ageValues) : null;
      const stalestAge = ageValues.length ? Math.max(...ageValues) : null;

      // Tagged/identified devices visible from this scanner
      const taggedVisible = objects.filter(o =>
        (o.identified || o.user_label) &&
        (o.sources||[]).some(s => (typeof s === "string" ? s : s.source) === src)
      ).length;

      // Cross-scanner overlap
      const overlaps = [];
      for(const r2 of radios){
        if(r2.source === src) continue;
        const otherSet = radioDevSets[r2.source] || new Set();
        let shared = 0;
        for(const addr of devSet) if(otherSet.has(addr)) shared++;
        if(shared > 0) overlaps.push({ source: r2.source, name: r2.name || r2.source, shared });
      }
      overlaps.sort((a,b) => b.shared - a.shared);

      // Unique devices (only seen by this scanner)
      let uniqueDevices = 0;
      for(const addr of devSet){
        let seenElsewhere = false;
        for(const r2 of radios){
          if(r2.source === src) continue;
          if((radioDevSets[r2.source] || new Set()).has(addr)){ seenElsewhere = true; break; }
        }
        if(!seenElsewhere) uniqueDevices++;
      }

      // Health verdict
      let health, healthColor, healthIcon, reason;
      if(!r.scanning || r.lost || r.disabled){
        health = "Unhealthy"; healthColor = "#ef5350"; healthIcon = "\uD83D\uDD34";
        reason = r.lost ? "Radio marked as lost" : r.disabled ? "Radio is disabled" : "Not scanning";
      } else if(totalDevices === 0){
        health = "Unhealthy"; healthColor = "#ef5350"; healthIcon = "\uD83D\uDD34";
        reason = "No advertisements received";
      } else if(totalDevices <= 1 || (freshestAge != null && freshestAge > 30) || (avgRssi != null && avgRssi < -85)){
        health = "Degraded"; healthColor = "#ffd54f"; healthIcon = "\uD83D\uDFE1";
        const reasons = [];
        if(totalDevices <= 1) reasons.push(`only ${totalDevices} device${totalDevices===1?"":"s"}`);
        if(freshestAge != null && freshestAge > 30) reasons.push(`${Math.round(freshestAge)}s since last ad`);
        if(avgRssi != null && avgRssi < -85) reasons.push(`weak avg RSSI ${avgRssi} dBm`);
        reason = reasons.join(", ");
      } else {
        health = "Healthy"; healthColor = "#52b788"; healthIcon = "\uD83D\uDFE2";
        const parts = [];
        if(avgRssi != null && avgRssi >= -65) parts.push("strong signal");
        else if(avgRssi != null) parts.push("good signal");
        parts.push(`${totalDevices} device${totalDevices>1?"s":""}`);
        if(freshestAge != null) parts.push(`${Math.round(freshestAge)}s fresh`);
        reason = parts.join(", ");
      }

      return {
        radio: r, src, totalDevices, strongestRssi, weakestRssi, avgRssi,
        freshestAge, stalestAge, taggedVisible, overlaps, uniqueDevices,
        health, healthColor, healthIcon, reason,
        healthOrder: health === "Unhealthy" ? 0 : health === "Degraded" ? 1 : 2,
      };
    });

    analyses.sort((a,b) => a.healthOrder - b.healthOrder);

    // Expand state persists across 5s re-renders
    if(!ctx.state._qaExpandedRadios) ctx.state._qaExpandedRadios = new Set();
    const expanded = ctx.state._qaExpandedRadios;

    const kv = (label, value, valueColor) => el("div",{style:"display:flex;align-items:baseline;gap:8px;padding:3px 0;border-bottom:1px solid #0d1f12;font-size:12px"},[
      el("span",{class:"muted",style:"min-width:110px;flex-shrink:0"}, label + ":"),
      el("span",{style:"font-weight:600;word-break:break-all;" + (valueColor ? `color:${valueColor}` : "")}, String(value != null ? value : "\u2014")),
    ]);

    const list = el("div",{style:"display:flex;flex-direction:column;gap:6px"});

    for(const a of analyses){
      const r = a.radio;
      const isOpen = expanded.has(a.src);
      const borderCol = a.health==="Unhealthy" ? "#7f1d1d" : a.health==="Degraded" ? "#5c4b1f" : "#1a4228";
      const bgCol = a.health==="Unhealthy" ? "#1a0a0a" : a.health==="Degraded" ? "#1a1808" : "#0f1a12";

      // Collapsed summary row — 2 lines: name row + metrics row
      const summary = el("div",{style:`padding:8px 10px;cursor:pointer;border-radius:${isOpen?"8px 8px 0 0":"8px"};border:1px solid ${borderCol};background:${bgCol}`});

      // Line 1: arrow + health icon + SID + name
      const nameLink = el("span",{style:"font-weight:600;color:#e2e8f0;cursor:pointer;text-decoration:underline;text-decoration-style:dotted"}, esc(r.name || r.source));
      nameLink.addEventListener("click", (ev)=>{ ev.stopPropagation(); ctx.actions.showScannerDetail(r); });
      summary.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px"},[
        el("span",{style:`font-size:10px;color:#94a3b8;flex-shrink:0;transition:transform .15s;transform:rotate(${isOpen?"90":"0"}deg)`}, "\u25B6"),
        el("span",{style:"flex-shrink:0;font-size:14px"}, a.healthIcon),
        el("span",{class:"pill",style:"font-family:monospace;font-weight:700;font-size:11px;padding:1px 6px;flex-shrink:0"}, _sid(a.src)),
        nameLink,
      ]));

      // Line 2: metrics + health badge + reason
      const metricsLine = [
        el("span",{class:"muted",style:"font-size:11px"}, `${a.totalDevices} device${a.totalDevices!==1?"s":""}`),
      ];
      if(a.avgRssi != null) metricsLine.push(el("span",{class:"muted",style:"font-size:11px;font-family:monospace"}, `avg ${a.avgRssi} dBm`));
      if(r.area_name) metricsLine.push(el("span",{class:"muted",style:"font-size:11px"}, r.area_name));
      metricsLine.push(el("span",{style:`font-size:11px;font-weight:600;color:${a.healthColor}`}, a.health));
      metricsLine.push(el("span",{class:"muted",style:"font-size:10px"}, `\u2014 ${a.reason}`));
      summary.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px;padding-left:42px"}, metricsLine));

      summary.addEventListener("click", ()=>{
        if(expanded.has(a.src)) expanded.delete(a.src); else expanded.add(a.src);
        ctx.actions.renderRooms();
      });

      const wrapper = el("div",{});
      wrapper.appendChild(summary);

      // Expanded detail panel
      if(isOpen){
        const detail = el("div",{style:`padding:10px 12px;border:1px solid ${borderCol};border-top:none;border-radius:0 0 8px 8px;background:#091209`});

        // Identity & Network
        detail.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin-bottom:6px;color:#94a3b8"},"Identity & Network"));
        const netGrid = el("div",{});
        netGrid.appendChild(kv("Source ID", a.src));
        netGrid.appendChild(kv("Area", r.area_name || "Unassigned"));
        netGrid.appendChild(kv("Adapter", r.adapter || "\u2014"));
        netGrid.appendChild(kv("IP Address", r.ip || "not available"));
        netGrid.appendChild(kv("SSID", r.ssid || "not available"));
        netGrid.appendChild(kv("Connection", r.connection_type || "not available"));
        netGrid.appendChild(kv("WiFi Signal", r.wifi_signal != null ? `${r.wifi_signal} dBm` : "not available",
          r.wifi_signal != null && r.wifi_signal >= -50 ? "#52b788" : r.wifi_signal != null && r.wifi_signal < -70 ? "#ef5350" : null));
        detail.appendChild(netGrid);

        // Status badges
        const statusRow = el("div",{style:"display:flex;gap:6px;flex-wrap:wrap;margin:8px 0"});
        statusRow.appendChild(el("span",{class:r.scanning?"badge":"badge warn"}, r.scanning?"scanning":"not scanning"));
        statusRow.appendChild(el("span",{class:"badge"}, r.connectable?"connectable":"not connectable"));
        if(r.lost) statusRow.appendChild(el("span",{class:"badge warn",style:"background:rgba(245,158,11,.18)"}, "\u26A0 Lost"));
        if(r.disabled) statusRow.appendChild(el("span",{class:"badge warn",style:"background:rgba(148,100,220,.18);color:#c084fc"}, "\u2298 Disabled"));
        detail.appendChild(statusRow);

        // Activity Metrics
        detail.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin:10px 0 6px;color:#94a3b8"},"Activity Metrics"));
        const actGrid = el("div",{style:"display:grid;grid-template-columns:1fr 1fr;gap:0 20px"});
        actGrid.appendChild(kv("Total devices", a.totalDevices));
        actGrid.appendChild(kv("Tagged / identified", a.taggedVisible));
        actGrid.appendChild(kv("Strongest RSSI", a.strongestRssi != null ? `${a.strongestRssi} dBm` : "\u2014",
          a.strongestRssi != null && a.strongestRssi >= -60 ? "#52b788" : null));
        actGrid.appendChild(kv("Weakest RSSI", a.weakestRssi != null ? `${a.weakestRssi} dBm` : "\u2014",
          a.weakestRssi != null && a.weakestRssi < -80 ? "#ef5350" : null));
        actGrid.appendChild(kv("Avg RSSI", a.avgRssi != null ? `${a.avgRssi} dBm` : "\u2014"));
        actGrid.appendChild(kv("RSSI spread", (a.strongestRssi != null && a.weakestRssi != null) ? `${a.strongestRssi - a.weakestRssi} dB` : "\u2014"));
        actGrid.appendChild(kv("Freshest ad", a.freshestAge != null ? `${Math.round(a.freshestAge)}s` : "\u2014",
          a.freshestAge != null && a.freshestAge < 10 ? "#52b788" : a.freshestAge != null && a.freshestAge > 30 ? "#ef5350" : null));
        actGrid.appendChild(kv("Stalest ad", a.stalestAge != null ? `${Math.round(a.stalestAge)}s` : "\u2014"));
        detail.appendChild(actGrid);

        // Cross-Scanner Comparison
        detail.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin:10px 0 6px;color:#94a3b8"},"Cross-Scanner Comparison"));
        if(a.overlaps.length > 0){
          for(const ov of a.overlaps.slice(0, 5)){
            detail.appendChild(el("div",{style:"font-size:12px;padding:2px 0"},[
              el("span",{}, "Shares "),
              el("span",{style:"font-weight:600;color:#5eead4"}, String(ov.shared)),
              el("span",{}, ` device${ov.shared>1?"s":""} with `),
              el("span",{style:"font-weight:600"}, esc(ov.name)),
              el("span",{class:"muted",style:"font-size:10px;margin-left:4px"}, `[${_sid(ov.source)}]`),
            ]));
          }
        } else {
          detail.appendChild(el("div",{class:"muted",style:"font-size:12px"},"No device overlap with other scanners."));
        }
        detail.appendChild(kv("Unique devices (only this scanner)", a.uniqueDevices));

        // Health Verdict
        detail.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin:10px 0 6px;color:#94a3b8"},"Health Verdict"));
        detail.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px"},[
          el("span",{style:"font-size:16px"}, a.healthIcon),
          el("span",{style:`font-weight:700;color:${a.healthColor}`}, a.health),
          el("span",{class:"muted",style:"font-size:11px"}, `\u2014 ${a.reason}`),
        ]));

        wrapper.appendChild(detail);
      }

      list.appendChild(wrapper);
    }

    radioCard.appendChild(list);
  }
  grid.appendChild(radioCard);

  // ── Quick Actions ──
  const actionsCard = el("div",{class:"card"});
  actionsCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Quick Actions"));

  const btnRow = el("div",{style:"display:flex;gap:8px;flex-wrap:wrap"});

  const refreshBtn = el("button",{class:"btn"}, "Refresh Snapshot");
  refreshBtn.addEventListener("click", async ()=>{
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Refreshing\u2026";
    try { await ctx.actions.refreshSnapshot(); } catch(e){}
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh Snapshot";
  });
  btnRow.appendChild(refreshBtn);

  const exportBtn = el("button",{class:"btn inline"}, "Export State");
  exportBtn.addEventListener("click", ()=>{
    const data = {
      snapshot: snap,
      settings: ctx.state.settings,
      roomTagMap: ctx.state.roomTagMap,
      maps: ctx.state.maps,
      wsCounts: ctx.state.wsCounts,
      timing: ctx.state.timing,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `padspan-state-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ctx.toast("State exported.");
  });
  btnRow.appendChild(exportBtn);

  const diagBtn = el("button",{class:"btn inline"}, "Go to Diagnostics");
  diagBtn.addEventListener("click", ()=>{
    ctx.state.view = "diagnostics";
    ctx.actions.renderRooms();
  });
  btnRow.appendChild(diagBtn);

  actionsCard.appendChild(btnRow);
  grid.appendChild(actionsCard);

  root.appendChild(grid);
  return root;
}
