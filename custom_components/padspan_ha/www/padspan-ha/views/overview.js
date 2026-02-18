export function render(ctx){
  const { el, pill } = ctx.helpers;
  const { status, roomTagMap, diag } = ctx.state;
  const rooms = Object.keys(roomTagMap||{}).length;
  const tags = (()=>{ const s=new Set(); for(const r of Object.keys(roomTagMap||{})) for(const t of (roomTagMap[r]||[])) s.add(String(t)); return s.size; })();

  const root = el("section",{id:"overview"});
  root.className = ctx.state.view==="overview" ? "" : "hidden";

  const grid = el("div",{class:"grid"},[
    el("div",{class:"card"},[el("div",{class:"muted"},"Status"), el("div",{class:"kpi"}, status?.status || "unknown")]),
    el("div",{class:"card"},[el("div",{class:"muted"},"Rooms"), el("div",{class:"kpi"}, String(rooms))]),
    el("div",{class:"card"},[el("div",{class:"muted"},"Objects (unique)"), el("div",{class:"kpi"}, String(tags))]),
    el("div",{class:"card"},[el("div",{class:"muted"},"Last Error"), el("div",{}, status?.last_error || "—")]),
  ]);

  const badges = el("div",{class:"row"},[
    pill(`v${ctx.state.version}`),
    pill(status?.cloud_enabled ? "Cloud enabled" : "Cloud disabled"),
    pill(`Scan: ${status?.scan_interval ?? "—"}`),
    pill(diag?.summary ? `Checks: ${diag.summary.passed}/${diag.summary.total}` : "Checks: —"),
  ]);

  const summary = el("div",{class:"card"},[
    el("div",{class:"muted"},"Quick summary"),
    el("div",{}, rooms ? `Loaded ${rooms} rooms and ${tags} unique tags.` : "No room data yet (room_tag_map empty)."),
  ]);

  root.appendChild(badges);
  root.appendChild(grid);
  root.appendChild(summary);
  return root;
}
