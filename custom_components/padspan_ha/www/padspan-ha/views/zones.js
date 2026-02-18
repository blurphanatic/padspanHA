export function render(ctx){
  const { el } = ctx.helpers;
  const { roomTagMap } = ctx.state;
  const root = el("section",{id:"zones"});
  root.className = ctx.state.view==="zones" ? "" : "hidden";
  const lines = Object.keys(roomTagMap||{}).sort((a,b)=>a.localeCompare(b)).map(r => `- ${r} (${(roomTagMap[r]||[]).length} objects)`).join("\n");
  root.appendChild(el("div",{class:"card"},[
    el("div",{class:"muted"},"Zones (rooms)"),
    el("div",{class:"mono"}, lines || "No zones yet.")
  ]));
  return root;
}
