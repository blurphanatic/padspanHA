export function render(ctx){
  const { el, pill } = ctx.helpers;
  const { status, roomTagMap, diag } = ctx.state;

  const rooms = Object.keys(roomTagMap||{}).length;
  const tags = (()=>{ const s=new Set(); for(const r of Object.keys(roomTagMap||{})) for(const t of (roomTagMap[r]||[])) s.add(String(t)); return s.size; })();

  const live = (ctx.state.dataMode==="live") ? (ctx.state.live && ctx.state.live.snapshot) : null;
  const radios = live && live.radios ? live.radios.length : 0;

  const root = el("section",{id:"overview"});
  root.className = ctx.state.view==="overview" ? "" : "hidden";

  const grid = el("div",{class:"grid"},[
    el("div",{class:"card"},[el("div",{class:"muted"},"Status"), el("div",{class:"kpi"}, status?.status || "unknown")]),
    el("div",{class:"card"},[el("div",{class:"muted"},"Rooms"), el("div",{class:"kpi"}, String(rooms))]),
    el("div",{class:"card"},[el("div",{class:"muted"},"Objects (unique)"), el("div",{class:"kpi"}, String(tags))]),
    el("div",{class:"card"},[el("div",{class:"muted"},"Radios (live)"), el("div",{class:"kpi"}, ctx.state.dataMode==="live" ? String(radios) : "—")]),
  ]);

  const badges = el("div",{class:"row"},[
    pill(`v${ctx.state.version}`),
    pill(`Data: ${ctx.state.dataMode==="live" ? "Live" : "Sample"}`),
    pill(status?.cloud_enabled ? "Cloud enabled" : "Cloud disabled"),
    pill(`Scan: ${status?.scan_interval ?? "—"}`),
    pill(diag?.summary ? `Checks: ${diag.summary.passed}/${diag.summary.total}` : "Checks: —"),
  ]);

  const summaryLines = [];
  summaryLines.push(rooms ? `Loaded ${rooms} rooms and ${tags} unique tags.` : "No room data yet (room_tag_map empty).");
  if(ctx.state.dataMode==="live"){
    if(live){
      summaryLines.push(`Live scan heuristic found ${radios} radio/receiver device(s) and ${(live.tags||[]).length} tag observation(s).`);
      summaryLines.push("Tip: if counts are low, confirm Bermuda is running and check that your tag entities report their current room/area as the entity state.");
    }else{
      summaryLines.push("Live mode enabled, but snapshot not available yet.");
    }
  }

  const summary = el("div",{class:"card"},[
    el("div",{class:"muted"},"Quick summary"),
    el("div",{}, summaryLines.join(" ")),
  ]);

  const liveCard = (() => {
    if(ctx.state.dataMode!=="live") return null;
    const c = el("div",{class:"card"},[
      el("div",{style:"display:flex;justify-content:space-between;align-items:center"},[
        el("div",{class:"muted"},"Live discovery (best effort)"),
        el("div",{class:"muted", style:"font-size:12px"}, live && live.sources ? JSON.stringify(live.sources) : "—")
      ]),
    ]);
    if(!live){
      c.appendChild(el("div",{class:"muted", style:"margin-top:8px"},"No live snapshot yet."));
      return c;
    }
    const list = el("div",{class:"mono", style:"margin-top:10px;white-space:pre-wrap"});
    const lines = [];
    lines.push("Rooms:");
    for(const r of (live.rooms||[])) lines.push(`- ${r.name}`);
    lines.push("");
    lines.push("Radios (heuristic):");
    for(const r of (live.radios||[]).slice(0,25)) lines.push(`- ${r.area ? r.area + " • " : ""}${r.name}${r.model ? " ("+r.model+")" : ""}`);
    if((live.radios||[]).length>25) lines.push(`… +${(live.radios||[]).length-25} more`);
    lines.push("");
    lines.push("Tags seen (room → tag):");
    for(const t of (live.tags||[]).slice(0,40)) lines.push(`- ${t.room} → ${t.id}`);
    if((live.tags||[]).length>40) lines.push(`… +${(live.tags||[]).length-40} more`);
    list.textContent = lines.join("\n");
    c.appendChild(list);
    return c;
  })();

  root.appendChild(badges);
  root.appendChild(grid);
  root.appendChild(summary);
  if(liveCard) root.appendChild(liveCard);
  return root;
}
