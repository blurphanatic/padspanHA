// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
export function render(ctx){
  const { el, helpBtn } = ctx.helpers;
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
