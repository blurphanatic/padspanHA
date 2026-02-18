export function render(ctx){
  const { el } = ctx.helpers;
  const { roomTagMap } = ctx.state;

  const root = el("section",{id:"devices"});
  root.className = ctx.state.view==="devices" ? "" : "hidden";

  const rooms = Object.keys(roomTagMap||{}).sort((a,b)=>a.localeCompare(b));
  const roomLines = rooms.map(r => `${r}:\n  - ${(roomTagMap[r]||[]).slice().sort().join("\n  - ")}`).join("\n\n");

  const tagRooms = {};
  for(const r of rooms){
    for(const t of (roomTagMap[r]||[])){
      const k=String(t);
      tagRooms[k]=tagRooms[k]||[];
      tagRooms[k].push(r);
    }
  }
  Object.keys(tagRooms).forEach(k=>tagRooms[k].sort((a,b)=>a.localeCompare(b)));
  const tagLines = Object.keys(tagRooms).sort((a,b)=>a.localeCompare(b)).map(t => `${t}: ${tagRooms[t].join(", ")}`).join("\n");

  root.appendChild(el("div",{class:"grid"},[
    el("div",{class:"card"},[el("div",{class:"muted"},"Objects grouped by room"), el("div",{class:"mono"}, roomLines || "No data.")]),
    el("div",{class:"card"},[el("div",{class:"muted"},"Rooms by object"), el("div",{class:"mono"}, tagLines || "No data.")]),
  ]));
  return root;
}
