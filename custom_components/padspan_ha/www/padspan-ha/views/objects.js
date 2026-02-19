export function renderTags(ctx, tagsList){
  const { el, esc } = ctx.helpers;
  const { roomTagMap, selectedRooms, mode, tagFilter } = ctx.state;

  if(!tagsList) return;
  tagsList.innerHTML = "";

  const rooms = (ctx.state.dataMode==="live" && ctx.state.live?.snapshot?.rooms_discovered?.length)
    ? [...ctx.state.live.snapshot.rooms_discovered].sort((a,b)=>a.localeCompare(b))
    : Object.keys(roomTagMap||{}).sort((a,b)=>a.localeCompare(b));

  // On first visit only, auto-select all rooms so the right pane isn't empty.
  if(!ctx.state._roomsInit && rooms.length && selectedRooms.size===0){
    rooms.forEach(r=>selectedRooms.add(r));
    ctx.state._roomsInit = true;
  }

  const selected = [...selectedRooms].filter(r=>roomTagMap && roomTagMap[r]);
  if(!selected.length){
    tagsList.appendChild(el("div",{class:"item"},"Select one or more rooms to see objects."));
    return;
  }

  // Build tag set
  let out = null;
  for(const room of selected){
    const s = new Set((roomTagMap[room]||[]).map(x=>String(x)));
    if(out === null){
      out = new Set(s);
      continue;
    }
    if(mode === "all"){
      out = new Set([...out].filter(x=>s.has(x)));
    } else {
      for(const x of s) out.add(x);
    }
  }
  if(out === null) out = new Set();

  let tags = [...out].sort((a,b)=>a.localeCompare(b));
  const f = String(tagFilter||"").trim().toLowerCase();
  if(f) tags = tags.filter(t=>t.toLowerCase().includes(f));

  if(!tags.length){
    tagsList.appendChild(el("div",{class:"item"},"No matching objects."));
    return;
  }

  for(const t of tags){
    const row = el("div",{class:"item"});
    row.appendChild(el("span",{}, esc(t)));
    tagsList.appendChild(row);
  }
}

export function render(ctx){
  const { el, esc, roomColor } = ctx.helpers;
  const { roomTagMap, selectedRooms, mode, tagFilter } = ctx.state;

  const root = el("section",{id:"objects"});
  root.className = ctx.state.view==="objects" ? "" : "hidden";

  const roomsList = el("div",{class:"rooms", id:"rooms"});
  const tagsList = el("div",{class:"tags", id:"tags"});

  const rooms = (ctx.state.dataMode==="live" && ctx.state.live?.snapshot?.rooms_discovered?.length)
    ? [...ctx.state.live.snapshot.rooms_discovered].sort((a,b)=>a.localeCompare(b))
    : Object.keys(roomTagMap||{}).sort((a,b)=>a.localeCompare(b));
  if(!rooms.length){
    roomsList.appendChild(el("div",{class:"item"},"No room data yet."));
  } else {
    for(const room of rooms){
      const count = (roomTagMap[room]||[]).length;
      const row = el("label",{class:"item"});
      const cb = el("input",{type:"checkbox"});
      cb.checked = selectedRooms.has(room);
      cb.addEventListener("change", ()=>{ cb.checked ? selectedRooms.add(room) : selectedRooms.delete(room); ctx.actions.renderTags(); });
      row.appendChild(cb);
      row.appendChild(el("span",{class:"roomdot", style:`background:${roomColor(room)}`}, ""));
      row.appendChild(el("span",{}, esc(room)));
      row.appendChild(el("span",{class:"muted"}, `(${count})`));
      roomsList.appendChild(row);
    }
  }

  const toolbarLeft = el("div",{class:"toolbar"},[
    el("button",{class:"btn", onclick:()=>{ rooms.forEach(r=>selectedRooms.add(r)); ctx.state._roomsInit = true; ctx.actions.renderRooms(); }},"All Rooms"),
    el("button",{class:"btn", onclick:()=>{ selectedRooms.clear(); ctx.state._roomsInit = true; ctx.actions.renderRooms(); }},"Clear"),
  ]);

  const modeSel = el("select",{class:"btn", id:"modeSel"});
  modeSel.style.maxWidth="420px";
  const optAll = el("option",{value:"all"},"Show tags in ALL selected rooms (intersection)");
  const optAny = el("option",{value:"any"},"Show tags in ANY selected room (union)");
  modeSel.appendChild(optAll); modeSel.appendChild(optAny);
  modeSel.value = mode;
  modeSel.addEventListener("change", ()=>{ ctx.state.mode = modeSel.value; ctx.actions.renderTags(); });

  const filter = el("input",{type:"text", id:"tagFilter", placeholder:"Filter tags… (e.g., keys)"});
  filter.value = tagFilter;
  filter.addEventListener("input", ()=>{ ctx.state.tagFilter = filter.value; ctx.actions.renderTags(); });

  const toolbarRight = el("div",{class:"toolbar"},[modeSel, filter]);

  const leftCard = el("div",{class:"card"},[
    el("div",{class:"muted"},"Select rooms"),
    toolbarLeft,
    roomsList,
  ]);

  const rightCard = el("div",{class:"card"},[
    el("div",{class:"muted"},"Object checklist from selected rooms"),
    toolbarRight,
    tagsList,
  ]);

  const grid = el("div",{class:"grid"},[leftCard,rightCard]);
  root.appendChild(grid);

  renderTags(ctx, tagsList);

  return root;
}
