export function render(ctx){
  const { el } = ctx.helpers;
  const { roomTagMap } = ctx.state;
  const rooms = Object.keys(roomTagMap||{});

  const tagRooms = {};
  for(const r of rooms){
    for(const t of (roomTagMap[r]||[])){
      const k=String(t);
      tagRooms[k]=tagRooms[k]||new Set();
      tagRooms[k].add(r);
    }
  }

  const top = Object.keys(tagRooms)
    .map(t => ({t, n: tagRooms[t].size}))
    .sort((a,b)=>b.n-a.n || a.t.localeCompare(b.t))
    .slice(0, 25)
    .map(x => `${x.t}  •  rooms: ${x.n}`)
    .join("\n");

  const dens = rooms
    .map(r => ({r, n: (roomTagMap[r]||[]).length}))
    .sort((a,b)=>b.n-a.n || a.r.localeCompare(b.r))
    .map(x => `${x.r}  •  objects: ${x.n}`)
    .join("\n");

  const root = el("section",{id:"insights"});
  root.className = ctx.state.view==="insights" ? "" : "hidden";
  root.appendChild(el("div",{class:"grid"},[
    el("div",{class:"card"},[el("div",{class:"muted"},"Top objects (by room count)"), el("div",{class:"mono"}, top || "No insights yet.")]),
    el("div",{class:"card"},[el("div",{class:"muted"},"Room density"), el("div",{class:"mono"}, dens || "No insights yet.")]),
  ]));
  return root;
}
