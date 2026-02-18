export function render(ctx){
  const { el } = ctx.helpers;
  const { roomTagMap } = ctx.state;

  const root = el("section",{id:"presence"});
  root.className = ctx.state.view==="presence" ? "" : "hidden";

  const tagRooms = {};
  for(const r of Object.keys(roomTagMap||{})){
    for(const t of (roomTagMap[r]||[])){
      const k=String(t);
      tagRooms[k]=tagRooms[k]||[];
      tagRooms[k].push(r);
    }
  }
  Object.keys(tagRooms).forEach(k=>tagRooms[k].sort((a,b)=>a.localeCompare(b)));

  const input = el("input",{type:"text", placeholder:"Enter object id (e.g., tag.keys)"});
  const out = el("div",{class:"mono"},"Enter an object id to see which rooms it appears in.");
  const btn = el("button",{class:"btn"}, "Find");

  btn.addEventListener("click", ()=>{
    const id = (input.value||"").trim();
    if(!id){ out.textContent="Enter an object id first."; return; }
    const rooms = tagRooms[id] || [];
    out.textContent = rooms.length ? `Object: ${id}\nSeen in rooms:\n- ${rooms.join("\n- ")}` : `No sightings for ${id}.`;
  });

  root.appendChild(el("div",{class:"card"},[
    el("div",{class:"muted"},"Presence model (derived from object↔room sightings)"),
    el("div",{class:"toolbar"},[input, btn]),
    out,
  ]));
  return root;
}
