export function render(ctx){
  const { el } = ctx.helpers;
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const root = el("section",{id:"qa"});

  root.appendChild(el("div",{style:"font-size:20px;font-weight:800;margin-bottom:16px"},"QA"));

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
    },
    {
      label: "Receivers on maps",
      pass: maps.some(m => (m.receivers || []).length > 0),
      detail: maps.some(m => (m.receivers || []).length > 0) ? "At least one map has receivers" : "No receivers placed on maps",
    },
    {
      label: "Rooms defined",
      pass: rooms.length > 0,
      detail: rooms.length > 0 ? `${rooms.length} room${rooms.length>1?"s":""}` : "No HA areas configured",
    },
    {
      label: "BLE scanners active",
      pass: radios.length > 0,
      detail: radios.length > 0 ? `${radios.length} scanner${radios.length>1?"s":""}` : "No BLE radios detected",
    },
    {
      label: "BLE feed healthy",
      pass: bleDiag.ok === true,
      detail: bleDiag.ok === true ? "OK" : (bleDiag.errors && bleDiag.errors.length ? bleDiag.errors[0] : "Unhealthy or no data"),
    },
    {
      label: "Objects tagged",
      pass: objects.some(o => o.user_label),
      detail: objects.filter(o => o.user_label).length + " tagged",
    },
    {
      label: "Snapshot available",
      pass: !!snap,
      detail: snap ? "Yes" : "No snapshot loaded",
    },
  ];

  const checkList = el("div",{style:"display:flex;flex-direction:column;gap:6px"});
  let passCount = 0;
  for(const c of checks){
    if(c.pass) passCount++;
    const icon = c.pass ? "\u2705" : "\u274C";
    const color = c.pass ? "#52b788" : "#ef5350";
    checkList.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;font-size:13px"},[
      el("span",{style:"flex-shrink:0"}, icon),
      el("span",{style:`color:${color};font-weight:600;min-width:140px`}, c.label),
      el("span",{class:"muted",style:"font-size:11px"}, c.detail),
    ]));
  }
  healthCard.appendChild(checkList);
  healthCard.appendChild(el("div",{style:"margin-top:10px;font-size:12px;font-weight:600;color:" + (passCount === checks.length ? "#52b788" : "#ffd54f")},
    `${passCount}/${checks.length} checks passed`));
  grid.appendChild(healthCard);

  // ── Data Consistency ──
  const consistCard = el("div",{class:"card"});
  consistCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Data Consistency"));

  const issues = [];

  // Orphaned objects (in rooms not in rooms_discovered)
  if(snap){
    const roomSet = new Set(rooms);
    const orphaned = objects.filter(o => o.room && !roomSet.has(o.room));
    if(orphaned.length > 0){
      issues.push({
        label: "Orphaned objects",
        detail: `${orphaned.length} object${orphaned.length>1?"s":""} in unknown rooms: ${orphaned.map(o=>o.user_label||o.name||o.address).slice(0,3).join(", ")}${orphaned.length>3?"...":""}`,
        severity: "warn",
      });
    }

    // Scanners not on any map
    const mappedSources = new Set();
    for(const m of maps) for(const r of (m.receivers||[])) mappedSources.add(r.source||r.name||r.id);
    const unmapped = radios.filter(r => !mappedSources.has(r.source) && !mappedSources.has(r.name));
    if(unmapped.length > 0){
      issues.push({
        label: "Unmapped scanners",
        detail: `${unmapped.length}: ${unmapped.map(s=>s.name||s.source).join(", ")}`,
        severity: "warn",
      });
    }

    // Rooms with no scanner
    const scannerRooms = new Set(radios.map(r=>r.area_name).filter(Boolean));
    const uncovered = rooms.filter(r => !scannerRooms.has(r));
    if(uncovered.length > 0){
      issues.push({
        label: "Rooms without scanner",
        detail: uncovered.join(", "),
        severity: "info",
      });
    }
  }

  if(issues.length === 0){
    consistCard.appendChild(el("div",{style:"font-size:13px;color:#52b788;font-weight:600"},"No data consistency issues found."));
  } else {
    const issueList = el("div",{style:"display:flex;flex-direction:column;gap:6px"});
    for(const iss of issues){
      const color = iss.severity === "warn" ? "#ffd54f" : "#90caf9";
      issueList.appendChild(el("div",{style:"font-size:12px"},[
        el("span",{style:`color:${color};font-weight:600`}, iss.label + ": "),
        el("span",{class:"muted"}, iss.detail),
      ]));
    }
    consistCard.appendChild(issueList);
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
