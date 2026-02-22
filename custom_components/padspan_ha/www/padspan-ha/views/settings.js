export function render(ctx){
  const { el, roomColor, helpBtn } = ctx.helpers;
  const isBasic = ctx.state.complexity === "basic";
  const root = el("section",{id:"settings"});
  root.className = ctx.state.view==="settings" ? "" : "hidden";

  // Draft model (so users can edit and hit Save)
  if(!ctx.state._settingsDraft || ctx.state._settingsDraftBuild !== ctx.state.buildId){
    ctx.state._settingsDraft = JSON.parse(JSON.stringify(ctx.state.model || {floors:[], room_meta:{}}));
    if(!ctx.state._settingsDraft.floors || !ctx.state._settingsDraft.floors.length) ctx.state._settingsDraft.floors = [{id:"main", name:"Main"}];
    if(!ctx.state._settingsDraft.floors.find(f=>f.id==="main")) ctx.state._settingsDraft.floors.unshift({id:"main", name:"Main"});
    ctx.state._settingsDraftBuild = ctx.state.buildId;
  }
  const draft = ctx.state._settingsDraft;
  const haFloors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
  const haAreas  = (ctx.state.model && Array.isArray(ctx.state.model.areas))  ? ctx.state.model.areas  : [];

  // Basic mode: no tabs, just appearance
  if(isBasic){
    root.appendChild(_settingsAppearance(ctx, el, helpBtn, draft, haFloors, haAreas, roomColor, true));
    return root;
  }

  // Advanced mode: Appearance | Manage tabs
  if(!ctx.state.settingsTab) ctx.state.settingsTab = "appearance";
  const activeTab = ctx.state.settingsTab;
  const setTab = (t) => { ctx.state.settingsTab = t; ctx.actions.renderRooms(); };

  root.appendChild(el("div", {class:"tabs", style:"margin-bottom:12px"}, [
    el("button", {class:"tab"+(activeTab==="appearance"?" active":""), onclick:()=>setTab("appearance")}, "Appearance"),
    el("button", {class:"tab"+(activeTab==="manage"?" active":""), onclick:()=>setTab("manage")}, "Manage"),
  ]));

  if(activeTab === "manage"){
    root.appendChild(_settingsManage(ctx, el));
  } else {
    root.appendChild(_settingsAppearance(ctx, el, helpBtn, draft, haFloors, haAreas, roomColor, false));
  }
  return root;
}

// ── Appearance tab ─────────────────────────────────────────────────────────────
function _settingsAppearance(ctx, el, helpBtn, draft, haFloors, haAreas, roomColor, isBasic){
  const wrap = el("div",{});

  // Floors card (hidden in basic)
  if(!isBasic){
    const floorsCard = el("div",{class:"card"});
    floorsCard.appendChild(el("div",{style:"font-weight:700"},"Floors"));
    floorsCard.appendChild(el("div",{class:"muted", style:"font-size:12px;margin-top:4px"},
      "Floors are read from HA. Manage them in HA Settings → Areas & Zones."
    ));
    const floorPills = el("div",{style:"display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"});
    if(haFloors.length){
      for(const f of haFloors) floorPills.appendChild(el("span",{class:"pill"}, f.name || f.id));
    } else {
      floorPills.appendChild(el("span",{class:"muted", style:"font-size:12px"}, "No floors found in HA."));
    }
    floorsCard.appendChild(floorPills);
    wrap.appendChild(floorsCard);
  }

  // Rooms color card
  const roomsCard = el("div",{class:"card", style:"margin-top:12px"});
  roomsCard.appendChild(el("div",{class:"card-head"},[
    el("div",{style:"font-weight:700"}, isBasic ? "Room colours" : "Rooms"),
    helpBtn("settings_colors"),
  ]));
  roomsCard.appendChild(el("div",{class:"muted", style:"font-size:12px;margin-top:6px"},
    isBasic
      ? "Pick a colour for each room — this colour shows up on the Follow map and Overview."
      : "Assign each room to a floor and pick a color for sidebar + map overlays."
  ));

  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const rooms = (() => {
    const disc = snap && snap.rooms_discovered;
    if (disc && disc.length) return [...disc].sort((a,b) => a.localeCompare(b));
    return Object.keys(ctx.state.roomTagMap||{}).sort((a,b) => a.localeCompare(b));
  })();

  const table = el("div",{style:"margin-top:10px;display:flex;flex-direction:column;gap:8px"});
  for(const room of rooms){
    if(!draft.room_meta) draft.room_meta = {};
    if(!draft.room_meta[room]) draft.room_meta[room] = { floor_id: "main", color: _toHex(roomColor(room)) };
    const meta = draft.room_meta[room];
    const haArea = haAreas.find(a => a.name === room);
    const haFloorId = haArea?.floor_id || "";
    if(haFloorId) meta.floor_id = haFloorId;
    const haFloor = haFloors.find(f => f.id === meta.floor_id);
    const floorLabel = haFloor ? (haFloor.name || haFloor.id) : (meta.floor_id || "—");

    const row = el("div",{style:"display:grid;grid-template-columns:1fr 140px 90px;gap:10px;align-items:center;border:1px solid #1b3526;border-radius:12px;padding:10px;background:#0a150e"});
    row.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap"},[
      el("span",{class:"dot", style:`background:${meta.color || roomColor(room)};`}),
      el("div",{style:"font-weight:600"}, room),
    ]));
    row.appendChild(el("div",{style:"display:flex;flex-direction:column;gap:2px"},[
      el("div",{class:"muted", style:"font-size:10px"}, "Floor (HA)"),
      el("div",{style:"font-size:12px;font-weight:600;color:#94a3b8"}, floorLabel),
    ]));
    const col = document.createElement("input");
    col.type = "color";
    col.value = _toHex(meta.color || roomColor(room));
    col.addEventListener("input", ()=>{ meta.color = col.value; });
    row.appendChild(col);
    table.appendChild(row);
  }
  roomsCard.appendChild(table);
  wrap.appendChild(roomsCard);

  const saveCard = el("div",{class:"card", style:"margin-top:12px"});
  const saveBtn = el("button",{class:"btn primary", onclick:async()=>{
    await ctx.actions.modelUpdate({floors: draft.floors || [], room_meta: draft.room_meta || {}});
    alert("Saved ✔");
  }}, "Save floors & room settings");
  saveCard.appendChild(el("div",{class:"muted"},"These settings are stored locally in Home Assistant storage."));
  saveCard.appendChild(el("div",{style:"margin-top:10px"}, saveBtn));
  wrap.appendChild(saveCard);
  return wrap;
}

// ── Manage tab ─────────────────────────────────────────────────────────────────
function _settingsManage(ctx, el){
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const haAreas  = (ctx.state.model && Array.isArray(ctx.state.model.areas))  ? ctx.state.model.areas  : [];
  const haFloors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
  const dataMode = ctx.state.dataMode || "sample";

  const wrap = el("div", {style:"display:flex;flex-direction:column;gap:16px"});

  // ── DANGER WARNING BANNER ──────────────────────────────────────────────────
  wrap.appendChild(el("div", {style:"background:#3d0c0c;border:2px solid #dc2626;border-radius:12px;padding:16px"}, [
    el("div", {style:"font-weight:800;font-size:15px;color:#fca5a5;margin-bottom:6px"}, "⚠  Danger Zone — Read before proceeding"),
    el("div", {style:"font-size:13px;color:#fcd5d5;line-height:1.6"}, [
      "Actions in this tab directly modify Home Assistant. ",
      "Deleting areas, entities, or BLE labels cannot be undone. ",
      "Some actions may break automations, dashboards, or other integrations that depend on the same entities or areas. ",
      "Only proceed if you understand what you are changing.",
    ].join("")),
    dataMode !== "live"
      ? el("div", {style:"margin-top:10px;font-weight:700;color:#fbbf24"}, "⚡ Switch to Live mode to enable management actions.")
      : null,
  ].filter(Boolean)));

  const disabled = dataMode !== "live";

  // ── SECTION 1: BLE Tags ────────────────────────────────────────────────────
  const allObjs = snap?.objects?.list || [];
  const taggedObjs = allObjs.filter(o => o.kind === "ble" && o.user_label);

  const tagsCard = el("div", {class:"card"});
  tagsCard.appendChild(el("div", {class:"row", style:"margin-bottom:8px"}, [
    el("div", {style:"font-weight:700;font-size:14px"}, "BLE Device Labels"),
    el("span", {class:"badge", style:"margin-left:8px"}, `${taggedObjs.length} tagged`),
  ]));
  tagsCard.appendChild(el("div", {class:"muted", style:"font-size:12px;margin-bottom:10px"},
    "Remove user-assigned labels from BLE devices. The device stays in the snapshot — it just loses its friendly name."
  ));
  if(taggedObjs.length){
    const tbody = el("tbody");
    for(const o of taggedObjs){
      const addr = o.address || "";
      const ageTxt = o.age_s != null ? `${Math.round(o.age_s)}s ago` : "—";
      const untagBtn = el("button", {class:"btn tiny"+(disabled?" disabled":"")}, "Untag");
      if(disabled) untagBtn.disabled = true;
      untagBtn.addEventListener("click", async()=>{
        if(!confirm(`Remove label "${o.user_label}" from ${addr}?`)) return;
        try {
          await ctx.actions.objectLabelDelete(addr);
          ctx.toast("Label removed.");
          await ctx.actions.refreshSnapshot();
          ctx.actions.renderRooms();
        } catch(e){ ctx.toast("Failed: " + String(e), true); }
      });
      tbody.appendChild(el("tr",{},[
        el("td",{style:"font-family:monospace;font-size:11px"}, addr),
        el("td",{style:"font-weight:600"}, o.user_label),
        el("td",{class:"muted",style:"font-size:11px"}, ageTxt),
        el("td",{}, untagBtn),
      ]));
    }
    // Clear-all button
    const clearAllBtn = el("button",{class:"btn",style:"margin-top:10px"+(disabled?" opacity:.4":"")}, "Remove all labels");
    if(disabled) clearAllBtn.disabled = true;
    clearAllBtn.addEventListener("click", async()=>{
      if(!confirm(`Remove ALL ${taggedObjs.length} BLE labels? This cannot be undone.`)) return;
      let ok = 0, fail = 0;
      for(const o of taggedObjs){
        try { await ctx.actions.objectLabelDelete(o.address); ok++; } catch(e){ fail++; }
      }
      ctx.toast(`Removed ${ok} labels${fail ? ` (${fail} failed)` : ""}.`);
      await ctx.actions.refreshSnapshot();
      ctx.actions.renderRooms();
    });
    tagsCard.appendChild(el("table",{class:"table"},[
      el("thead",{},el("tr",{},[el("th",{},"Address"),el("th",{},"Label"),el("th",{},"Last seen"),el("th",{},"")])),
      tbody,
    ]));
    tagsCard.appendChild(clearAllBtn);
  } else {
    tagsCard.appendChild(el("div",{class:"muted",style:"font-size:12px"}, "No BLE devices have been tagged yet."));
  }
  wrap.appendChild(tagsCard);

  // ── SECTION 2: HA Entities ─────────────────────────────────────────────────
  const entityObjs = allObjs.filter(o => o.kind === "entity" && o.entity_id);
  const entCard = el("div", {class:"card"});
  entCard.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
    el("div",{style:"font-weight:700;font-size:14px"}, "HA Entities"),
    el("span",{class:"badge warn",style:"margin-left:8px"}, "Destructive"),
    el("span",{class:"badge",style:"margin-left:4px"}, `${entityObjs.length} found`),
  ]));
  entCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
    "Permanently remove entities from Home Assistant's entity registry. Use this to clean up stale or duplicate tracker entities. Automations that reference removed entities will break."
  ));
  if(entityObjs.length){
    const entSearch = el("input",{type:"text",placeholder:"Filter entities…",style:"margin-bottom:8px;width:100%;box-sizing:border-box"});
    const entList = el("div",{style:"display:flex;flex-direction:column;gap:4px;max-height:320px;overflow-y:auto"});
    const renderEntList = (filter) => {
      entList.innerHTML = "";
      const filtered = entityObjs.filter(o => !filter || o.entity_id.toLowerCase().includes(filter.toLowerCase()) || (o.name||"").toLowerCase().includes(filter.toLowerCase()));
      for(const o of filtered){
        const row = el("div",{style:"display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #1b3526;border-radius:8px;background:#0a150e"},[
          el("div",{style:"flex:1"},[
            el("div",{style:"font-size:12px;font-family:monospace;color:#94a3b8"}, o.entity_id),
            o.name ? el("div",{style:"font-size:11px;color:#e2e8f0"}, o.name) : null,
            o.room ? el("div",{style:"font-size:11px;color:#52b788"}, `room: ${o.room}`) : null,
          ].filter(Boolean)),
          (() => {
            const btn = el("button",{class:"btn tiny"+(disabled?" disabled":"")}, "Delete");
            if(disabled) btn.disabled = true;
            btn.addEventListener("click", async()=>{
              if(!confirm(`Delete entity "${o.entity_id}" from Home Assistant? Automations using this entity will break.`)) return;
              try {
                await ctx.actions.entityDelete(o.entity_id);
                ctx.toast(`Entity "${o.entity_id}" deleted.`);
                await ctx.actions.refreshSnapshot();
                ctx.actions.renderRooms();
              } catch(e){ ctx.toast("Failed: " + String(e), true); }
            });
            return btn;
          })(),
        ].filter(Boolean));
        entList.appendChild(row);
      }
      if(!filtered.length) entList.appendChild(el("div",{class:"muted",style:"font-size:12px"}, "No entities match."));
    };
    entSearch.addEventListener("input", ()=> renderEntList(entSearch.value));
    renderEntList("");
    entCard.appendChild(entSearch);
    entCard.appendChild(entList);
  } else {
    entCard.appendChild(el("div",{class:"muted",style:"font-size:12px"}, "No entities found in current snapshot. Switch to Live mode to see real entities."));
  }
  wrap.appendChild(entCard);

  // ── SECTION 3: HA Areas ─────────────────────────────────────────────────────
  const areasCard = el("div",{class:"card"});
  areasCard.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
    el("div",{style:"font-weight:700;font-size:14px"}, "HA Areas (Rooms)"),
    el("span",{class:"badge warn",style:"margin-left:8px"}, "Destructive"),
    el("span",{class:"badge",style:"margin-left:4px"}, `${haAreas.length} areas`),
  ]));
  areasCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
    "Delete areas from the HA Area Registry. All devices assigned to a deleted area will become unassigned. Room color settings for the area are also removed."
  ));
  if(haAreas.length){
    const tbody = el("tbody");
    for(const area of haAreas){
      const floor = haFloors.find(f => f.id === area.floor_id);
      const floorLabel = floor ? floor.name : (area.floor_id || "—");
      const delBtn = el("button",{class:"btn tiny"+(disabled?" disabled":"")}, "Delete");
      if(disabled) delBtn.disabled = true;
      delBtn.addEventListener("click", async()=>{
        if(!confirm(`Delete area "${area.name}" from Home Assistant? Devices assigned to this area will lose their area assignment.`)) return;
        try {
          await ctx.actions.areaDelete(area.id);
          await ctx.actions.modelRefresh();
          ctx.toast(`Area "${area.name}" deleted.`);
        } catch(e){ ctx.toast("Failed: " + String(e), true); }
      });
      tbody.appendChild(el("tr",{},[
        el("td",{style:"font-weight:600"}, area.name),
        el("td",{class:"muted"}, floorLabel),
        el("td",{style:"font-family:monospace;font-size:10px;color:#4a5568"}, area.id),
        el("td",{}, delBtn),
      ]));
    }
    areasCard.appendChild(el("table",{class:"table"},[
      el("thead",{},el("tr",{},[el("th",{},"Name"),el("th",{},"Floor"),el("th",{},"ID"),el("th",{},"")])),
      tbody,
    ]));
  } else {
    areasCard.appendChild(el("div",{class:"muted",style:"font-size:12px"}, "No areas found."));
  }
  wrap.appendChild(areasCard);

  // ── SECTION 4: Maps ────────────────────────────────────────────────────────
  const maps = ctx.state.maps?.list || [];
  if(maps.length){
    const mapsCard = el("div",{class:"card"});
    mapsCard.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
      el("div",{style:"font-weight:700;font-size:14px"}, "Uploaded Maps"),
      el("span",{class:"badge warn",style:"margin-left:8px"}, "Destructive"),
      el("span",{class:"badge",style:"margin-left:4px"}, `${maps.length} maps`),
    ]));
    mapsCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
      "Permanently delete uploaded floor plan images."
    ));
    const tbody = el("tbody");
    for(const m of maps){
      const delBtn = el("button",{class:"btn tiny"+(disabled?" disabled":"")}, "Delete");
      if(disabled) delBtn.disabled = true;
      delBtn.addEventListener("click", async()=>{
        if(!confirm(`Delete map "${m.name}"? This cannot be undone.`)) return;
        try {
          await ctx.actions.mapsDelete(m.id);
          ctx.toast(`Map "${m.name}" deleted.`);
        } catch(e){ ctx.toast("Failed: " + String(e), true); }
      });
      tbody.appendChild(el("tr",{},[
        el("td",{style:"font-weight:600"}, m.name || m.id),
        el("td",{class:"muted",style:"font-size:11px"}, m.filename || ""),
        el("td",{}, delBtn),
      ]));
    }
    mapsCard.appendChild(el("table",{class:"table"},[
      el("thead",{},el("tr",{},[el("th",{},"Name"),el("th",{},"File"),el("th",{},"")])),
      tbody,
    ]));
    wrap.appendChild(mapsCard);
  }

  // ── SECTION 5: Integration Controls ───────────────────────────────────────
  const ctrlCard = el("div",{class:"card"});
  ctrlCard.appendChild(el("div",{style:"font-weight:700;font-size:14px;margin-bottom:8px"}, "Integration Controls"));
  ctrlCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:14px"},
    "Low-level control over the PadSpan HA integration."
  ));

  const ctrlGrid = el("div",{style:"display:flex;flex-direction:column;gap:10px"});

  // Reload integration
  const reloadBtn = el("button",{class:"btn"}, "Reload PadSpan HA integration");
  reloadBtn.addEventListener("click", async()=>{
    if(!confirm("Reload the PadSpan HA config entry? This will briefly disconnect the panel.")) return;
    try {
      const res = await ctx.actions.integrationReload();
      ctx.toast(`Integration reloaded (${res?.reloaded ?? 0} entries).`);
    } catch(e){ ctx.toast("Reload failed: " + String(e), true); }
  });
  ctrlGrid.appendChild(el("div",{},[
    el("div",{style:"font-weight:600;margin-bottom:4px"}, "Reload integration"),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:6px"}, "Forces HA to reinitialize PadSpan HA without a full HA restart. Useful after config changes."),
    reloadBtn,
  ]));

  // Reset room color meta
  const resetColorsBtn = el("button",{class:"btn"}, "Reset room color settings");
  resetColorsBtn.addEventListener("click", async()=>{
    if(!confirm("Reset all room color customizations to defaults? Colors will regenerate automatically.")) return;
    try {
      await ctx.actions.modelUpdate({room_meta: {}});
      ctx.toast("Room color settings cleared.");
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast("Failed: " + String(e), true); }
  });
  ctrlGrid.appendChild(el("div",{},[
    el("div",{style:"font-weight:600;margin-bottom:4px"}, "Reset room colors"),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:6px"}, "Clears all custom room color picks. Colors regenerate from room names."),
    resetColorsBtn,
  ]));

  ctrlCard.appendChild(ctrlGrid);
  wrap.appendChild(ctrlCard);

  return wrap;
}

function _toHex(c){
  const s = String(c||"").trim();
  if(/^#[0-9a-f]{6}$/i.test(s)) return s;
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
