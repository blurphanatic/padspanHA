export function render(ctx){
  const { el, roomColor } = ctx.helpers;
  const root = el("section",{id:"settings"});
  root.className = ctx.state.view==="settings" ? "" : "hidden";

  // Draft model (so users can edit and hit Save)
  if(!ctx.state._settingsDraft || ctx.state._settingsDraftBuild !== ctx.state.buildId){
    ctx.state._settingsDraft = JSON.parse(JSON.stringify(ctx.state.model || {floors:[], room_meta:{}}));

  // Ensure a stable default "main" floor exists.
  if(!ctx.state._settingsDraft.floors || !ctx.state._settingsDraft.floors.length) ctx.state._settingsDraft.floors = [{id:"main", name:"Main"}];
  if(!ctx.state._settingsDraft.floors.find(f=>f.id==="main")) ctx.state._settingsDraft.floors.unshift({id:"main", name:"Main"});

    ctx.state._settingsDraftBuild = ctx.state.buildId;
  }
  const draft = ctx.state._settingsDraft;

  const floorsCard = el("div",{class:"card"});
  floorsCard.appendChild(el("div",{style:"font-weight:700"},"Floors (map owners)"));
  floorsCard.appendChild(el("div",{class:"muted", style:"font-size:12px;margin-top:6px"},
    "Each uploaded map belongs to a floor. Rooms can be assigned to floors so only relevant rooms appear when editing that map."
  ));

  const addRow = el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-top:10px"});
  const newFloorName = el("input",{type:"text", placeholder:"New floor name (e.g., Basement)"});
  const addBtn = el("button",{class:"btn inline", onclick:()=>{
    const nm = (newFloorName.value||"").trim();
    if(!nm) return;
    const id = _slug(nm);
    if(!draft.floors) draft.floors = [];
    if(draft.floors.find(f=>f.id===id)){ newFloorName.value=""; return; }
    draft.floors.push({id, name:nm});
    newFloorName.value="";
    ctx.actions.renderRooms();
  }}, "Add floor");
  addRow.appendChild(newFloorName);
  addRow.appendChild(addBtn);
  floorsCard.appendChild(addRow);

  const list = el("div",{style:"margin-top:10px;display:flex;flex-direction:column;gap:8px"});
  for(const f of (draft.floors||[])){
    const row = el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;border:1px solid #2d4673;border-radius:12px;padding:10px;background:#0b1426"});
    const left = el("div",{style:"display:flex;gap:10px;align-items:center;flex-wrap:wrap"},[
      el("div",{class:"pill"}, f.id),
    ]);
    const nm = el("input",{type:"text", value:f.name||f.id, style:"min-width:220px"});
    nm.addEventListener("input", ()=>{ f.name = nm.value; });
    left.appendChild(nm);

    const del = el("button",{class:"btn inline", onclick:()=>{
      // Never delete main floor; keep it as a safe fallback
      if(f.id==="main"){ alert("Main floor can't be deleted."); return; }
      draft.floors = (draft.floors||[]).filter(x=>x.id!==f.id);
      // Reassign any rooms on this floor back to main
      for(const [room,meta] of Object.entries(draft.room_meta||{})){
        if(meta && meta.floor_id===f.id) meta.floor_id="main";
      }
      ctx.actions.renderRooms();
    }}, "Delete");
    row.appendChild(left);
    row.appendChild(del);
    list.appendChild(row);
  }
  floorsCard.appendChild(list);

  const roomsCard = el("div",{class:"card", style:"margin-top:12px"});
  roomsCard.appendChild(el("div",{style:"font-weight:700"},"Rooms"));
  roomsCard.appendChild(el("div",{class:"muted", style:"font-size:12px;margin-top:6px"},
    "Assign each room to a floor and pick a color for sidebar + map overlays."
  ));

  const rooms = Object.keys(ctx.state.roomTagMap||{}).sort();

  const table = el("div",{style:"margin-top:10px;display:flex;flex-direction:column;gap:8px"});
  for(const room of rooms){
    if(!draft.room_meta) draft.room_meta = {};
    if(!draft.room_meta[room]) draft.room_meta[room] = { floor_id: "main", color: _toHex(roomColor(room)) };

    const meta = draft.room_meta[room];
    const row = el("div",{style:"display:grid;grid-template-columns: 1fr 160px 90px;gap:10px;align-items:center;border:1px solid #2d4673;border-radius:12px;padding:10px;background:#0b1426"});
    row.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap"},[
      el("span",{class:"dot", style:`background:${meta.color || roomColor(room)};`}),
      el("div",{style:"font-weight:600"}, room),
    ]));

    const sel = document.createElement("select");
    sel.className = "select";
    for(const f of (draft.floors||[])){
      const o = document.createElement("option");
      o.value = f.id; o.textContent = f.name || f.id;
      sel.appendChild(o);
    }
    sel.value = meta.floor_id || "main";
    sel.addEventListener("change", ()=>{ meta.floor_id = sel.value; });
    row.appendChild(sel);

    const col = document.createElement("input");
    col.type = "color";
    col.value = _toHex(meta.color || roomColor(room));
    col.addEventListener("input", ()=>{ meta.color = col.value; });
    row.appendChild(col);

    table.appendChild(row);
  }
  roomsCard.appendChild(table);

  const saveCard = el("div",{class:"card", style:"margin-top:12px"});
  const saveBtn = el("button",{class:"btn primary", onclick:async ()=>{
    await ctx.actions.modelUpdate({floors: draft.floors || [], room_meta: draft.room_meta || {}});
    alert("Saved ✔");
  }}, "Save floors & room settings");

  saveCard.appendChild(el("div",{class:"muted"},"These settings are stored locally in Home Assistant storage."));
  saveCard.appendChild(el("div",{style:"margin-top:10px"}, saveBtn));

  root.appendChild(floorsCard);
  root.appendChild(roomsCard);
  root.appendChild(saveCard);

  return root;
}

function _slug(s){
  return String(s||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"") || "floor";
}

function _toHex(c){
  const s = String(c||"").trim();
  if(/^#[0-9a-f]{6}$/i.test(s)) return s;
  // Attempt browser parsing
  const tmp = document.createElement("div");
  tmp.style.color = s;
  document.body.appendChild(tmp);
  const rgb = getComputedStyle(tmp).color;
  tmp.remove();
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if(!m) return "#888888";
  const r = Number(m[1])|0, g=Number(m[2])|0, b=Number(m[3])|0;
  return "#" + [r,g,b].map(x=>x.toString(16).padStart(2,"0")).join("");
}
