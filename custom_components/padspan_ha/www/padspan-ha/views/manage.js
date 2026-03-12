// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
// PadSpan HA – Manage view
// Standalone sidebar tab: Data management + History + Events + HA Entities

export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"manage"});
  root.className = ctx.state.view==="manage" ? "" : "hidden";

  if(!ctx.state.manageTab) ctx.state.manageTab = "data";
  const mTab = ctx.state.manageTab;
  const setTab = (t) => { ctx.state.manageTab = t; ctx.actions.renderRooms(); };

  const TABS = [
    ["data","Data"],
    ["ha_entities","HA Entities"],
    ["history","History"],
    ["events","Events"],
    ["logs","Logs"],
    ["factory_reset","Factory Reset"],
  ];

  const tabBar = el("div",{class:"tabs",style:"margin-bottom:12px;flex-wrap:wrap;gap:4px"});
  for(const [id,label] of TABS){
    tabBar.appendChild(el("button",{class:"tab"+(mTab===id?" active":""),onclick:()=>setTab(id)},label));
  }
  root.appendChild(tabBar);

  if(mTab === "ha_entities")   { root.appendChild(_haEntities(ctx, el));    return root; }
  if(mTab === "history")       { root.appendChild(_history(ctx, el));      return root; }
  if(mTab === "events")        { root.appendChild(_events(ctx, el));       return root; }
  if(mTab === "logs")          { root.appendChild(_logs(ctx, el));         return root; }
  if(mTab === "factory_reset") { root.appendChild(_factoryReset(ctx, el)); return root; }
  // ── Data tab ─────────────────────────────────────────────────────────────────
  const snap     = (ctx.state.live && ctx.state.live.snapshot) || null;
  const haAreas  = (ctx.state.model && Array.isArray(ctx.state.model.areas))  ? ctx.state.model.areas  : [];
  const haFloors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
  const dataMode = ctx.state.dataMode || "sample";

  // Danger banner
  root.appendChild(el("div",{style:"background:#3d0c0c;border:2px solid #dc2626;border-radius:12px;padding:16px"},[
    el("div",{style:"font-weight:800;font-size:15px;color:#fca5a5;margin-bottom:6px"},"⚠  Danger Zone — Read before proceeding"),
    el("div",{style:"font-size:13px;color:#fcd5d5;line-height:1.6"},
      "Actions here directly modify Home Assistant. Deleting areas, entities, or BLE labels cannot be undone. Only proceed if you understand what you are changing."
    ),
    dataMode !== "live"
      ? el("div",{style:"margin-top:10px;font-weight:700;color:#fbbf24"},"⚡ Switch to Live mode to enable management actions.")
      : null,
  ].filter(Boolean)));

  const disabled = dataMode !== "live";

  // ── Orphan Room Polygons ──────────────────────────────────────────────────────
  {
    const allMaps = ctx.state.maps?.list || [];
    const validRooms = new Set([
      ...(ctx.state.model?.areas || []).map(a => a.name),
      ...Object.keys(ctx.state.roomTagMap || {}),
    ]);

    const orphans = []; // {map, room, b}
    for(const m of allMaps){
      for(const [room, b] of Object.entries(m.room_bounds || {})){
        if(b && b.type === "poly" && !validRooms.has(room)){
          orphans.push({map: m, room, b});
        }
      }
    }

    if(orphans.length){
      const orphCard = el("div",{class:"card",style:"border-color:#f59e0b"});
      orphCard.appendChild(el("div",{class:"row",style:"margin-bottom:6px"},[
        el("div",{style:"font-weight:700;font-size:14px"},"Orphan Room Polygons"),
        el("span",{class:"badge warn",style:"margin-left:8px"},`${orphans.length} found`),
      ]));
      orphCard.appendChild(el("div",{style:"font-size:12px;color:#f59e0b;margin-bottom:10px"},
        "These room polygons are in your map data but the room name does not exist in your HA area registry. They are likely ghost entries from sample mode."
      ));

      const tbody = el("tbody");
      for(const {map, room, b} of orphans){
        const bw = el("div",{style:"display:flex;gap:4px"});
        const makeBtn = ()=>{
          const btn = el("button",{class:"btn tiny"+(disabled?" disabled":"")},"Delete");
          if(disabled) btn.disabled = true;
          btn.addEventListener("click", ()=>{
            bw.innerHTML = "";
            const yes = el("button",{class:"btn tiny",style:"background:#7f1d1d;border-color:#dc2626;white-space:nowrap"},"Yes, delete");
            const no  = el("button",{class:"btn tiny"},"No");
            yes.addEventListener("click", async()=>{
              bw.innerHTML = "";
              bw.appendChild(el("span",{class:"muted",style:"font-size:11px"},"Deleting…"));
              try {
                const newBounds = Object.fromEntries(
                  Object.entries(map.room_bounds || {}).filter(([r]) => r !== room)
                );
                await ctx.actions.mapsUpdate({
                  map_id: map.id,
                  receivers: map.receivers || [],
                  room_bounds: newBounds,
                  floor_id: map.floor_id || "",
                  calibration: map.calibration || {},
                  notes: map.notes || "",
                  stack: map.stack || {},
                });
                await ctx.actions.mapsRefresh();
                ctx.toast(`Deleted orphan "${room}" from ${map.name||map.id}`);
                ctx.actions.renderRooms();
              } catch(e){ bw.innerHTML = ""; bw.appendChild(makeBtn()); ctx.toast("Failed: "+String(e), true); }
            });
            no.addEventListener("click", ()=>{ bw.innerHTML = ""; bw.appendChild(makeBtn()); });
            bw.appendChild(yes); bw.appendChild(no);
          });
          return btn;
        };
        bw.appendChild(makeBtn());
        tbody.appendChild(el("tr",{},[
          el("td",{style:"font-weight:600;color:#f59e0b"},room),
          el("td",{class:"muted",style:"font-size:11px"},map.name||map.id),
          el("td",{class:"muted",style:"font-size:11px"},`${(b.points||[]).length} pts`),
          el("td",{},bw),
        ]));
      }
      orphCard.appendChild(el("table",{class:"table"},[
        el("thead",{},el("tr",{},[el("th",{},"Orphan room"),el("th",{},"Map"),el("th",{},"Points"),el("th",{},"")])),
        tbody,
      ]));

      if(orphans.length > 1){
        const delAllWrap = el("div",{style:"margin-top:10px;display:flex;gap:8px;align-items:center"});
        const makeDelAll = ()=>{
          const b = el("button",{class:"btn"+(disabled?" disabled":"")},"Delete ALL orphans");
          if(disabled) b.disabled = true;
          b.addEventListener("click", ()=>{
            delAllWrap.innerHTML = "";
            const yes = el("button",{class:"btn",style:"background:#7f1d1d;border-color:#dc2626"},`Yes, delete all ${orphans.length}`);
            const no  = el("button",{class:"btn inline"},"Cancel");
            yes.addEventListener("click", async()=>{
              delAllWrap.innerHTML = "";
              delAllWrap.appendChild(el("span",{class:"muted",style:"font-size:12px"},"Cleaning up…"));
              // Group by map so we do one update per map
              const byMap = new Map();
              for(const {map, room} of orphans){
                if(!byMap.has(map.id)) byMap.set(map.id, {map, rooms: []});
                byMap.get(map.id).rooms.push(room);
              }
              let fail = 0;
              for(const {map, rooms} of byMap.values()){
                try {
                  const newBounds = Object.fromEntries(
                    Object.entries(map.room_bounds || {}).filter(([r]) => !rooms.includes(r))
                  );
                  await ctx.actions.mapsUpdate({
                    map_id: map.id,
                    receivers: map.receivers || [],
                    room_bounds: newBounds,
                    floor_id: map.floor_id || "",
                    calibration: map.calibration || {},
                    notes: map.notes || "",
                    stack: map.stack || {},
                  });
                } catch(e){ fail++; }
              }
              await ctx.actions.mapsRefresh();
              ctx.toast(`Removed ${orphans.length} orphan polygon${orphans.length===1?"":"s"}${fail?` (${fail} maps failed)`:""}.`);
              ctx.actions.renderRooms();
            });
            no.addEventListener("click", ()=>{ delAllWrap.innerHTML = ""; delAllWrap.appendChild(makeDelAll()); });
            delAllWrap.appendChild(yes); delAllWrap.appendChild(no);
          });
          return b;
        };
        delAllWrap.appendChild(makeDelAll());
        orphCard.appendChild(delAllWrap);
      }

      root.appendChild(orphCard);
    }
  }

  // ── BLE Device Labels ────────────────────────────────────────────────────────
  const allObjs   = snap?.objects?.list || [];
  const taggedObjs = allObjs.filter(o => o.kind === "ble" && o.user_label);
  const tagsCard  = el("div",{class:"card"});
  tagsCard.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
    el("div",{style:"font-weight:700;font-size:14px"},"BLE Device Labels"),
    el("span",{class:"badge",style:"margin-left:8px"},`${taggedObjs.length} tagged`),
  ]));
  tagsCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
    "Remove user-assigned labels from BLE devices. The device stays in the snapshot — it just loses its friendly name."
  ));
  if(taggedObjs.length){
    const tbody = el("tbody");
    for(const o of taggedObjs){
      const addr = o.address || "";
      const ageTxt = o.age_s != null ? `${Math.round(o.age_s)}s ago` : "—";
      const untagBtnWrap = el("div",{style:"display:flex;gap:4px"});
      const makeUntagBtn = ()=>{
        const b = el("button",{class:"btn tiny"+(disabled?" disabled":"")}, "Untag");
        if(disabled) b.disabled = true;
        b.addEventListener("click", ()=>{
          untagBtnWrap.innerHTML = "";
          const yes = el("button",{class:"btn tiny",style:"background:#7f1d1d;border-color:#dc2626"},"Yes");
          const no  = el("button",{class:"btn tiny"},"No");
          yes.addEventListener("click", async()=>{
            untagBtnWrap.innerHTML = "";
            try {
              await ctx.actions.objectLabelDelete(addr);
              ctx.toast("Label removed.");
              await ctx.actions.refreshSnapshot();
              ctx.actions.renderRooms();
            } catch(e){ ctx.toast("Failed: "+String(e), true); untagBtnWrap.appendChild(makeUntagBtn()); }
          });
          no.addEventListener("click", ()=>{ untagBtnWrap.innerHTML = ""; untagBtnWrap.appendChild(makeUntagBtn()); });
          untagBtnWrap.appendChild(yes); untagBtnWrap.appendChild(no);
        });
        return b;
      };
      untagBtnWrap.appendChild(makeUntagBtn());
      tbody.appendChild(el("tr",{},[
        el("td",{style:"font-family:monospace;font-size:11px"},addr),
        el("td",{style:"font-weight:600"},o.user_label),
        el("td",{class:"muted",style:"font-size:11px"},ageTxt),
        el("td",{},untagBtnWrap),
      ]));
    }
    const clearAllWrap = el("div",{style:"margin-top:10px;display:flex;gap:8px;align-items:center"});
    const makeClearAllBtn = ()=>{
      const b = el("button",{class:"btn"+(disabled?" disabled":"")},"Remove all labels");
      if(disabled) b.disabled = true;
      b.addEventListener("click", ()=>{
        clearAllWrap.innerHTML = "";
        const yes = el("button",{class:"btn",style:"background:#7f1d1d;border-color:#dc2626"},`Yes, remove all ${taggedObjs.length}`);
        const no  = el("button",{class:"btn inline"},"Cancel");
        yes.addEventListener("click", async()=>{
          clearAllWrap.innerHTML = "";
          let ok=0, fail=0;
          for(const o of taggedObjs){ try { await ctx.actions.objectLabelDelete(o.address); ok++; } catch(e){ fail++; } }
          ctx.toast(`Removed ${ok} labels${fail?` (${fail} failed)`:""}.`);
          await ctx.actions.refreshSnapshot();
          ctx.actions.renderRooms();
        });
        no.addEventListener("click", ()=>{ clearAllWrap.innerHTML = ""; clearAllWrap.appendChild(makeClearAllBtn()); });
        clearAllWrap.appendChild(yes); clearAllWrap.appendChild(no);
      });
      return b;
    };
    clearAllWrap.appendChild(makeClearAllBtn());
    tagsCard.appendChild(el("table",{class:"table"},[
      el("thead",{},el("tr",{},[el("th",{},"Address"),el("th",{},"Label"),el("th",{},"Last seen"),el("th",{},"")])),
      tbody,
    ]));
    tagsCard.appendChild(clearAllWrap);
  } else {
    tagsCard.appendChild(el("div",{class:"muted",style:"font-size:12px"},"No BLE devices have been tagged yet."));
  }
  root.appendChild(tagsCard);

  // ── HA Entities ──────────────────────────────────────────────────────────────
  const entityObjs = allObjs.filter(o => o.kind === "entity" && o.entity_id);
  // Split into phantom (missing from HA state) vs real HA entities
  const phantomObjs = entityObjs.filter(o => o.missing === true);
  const realObjs    = entityObjs.filter(o => !o.missing);

  // Phantom entities card — these come from coord.room_tag_map with no HA state
  if(phantomObjs.length){
    const phantomCard = el("div",{class:"card",style:"border-color:#f59e0b"});
    phantomCard.appendChild(el("div",{class:"row",style:"margin-bottom:6px"},[
      el("div",{style:"font-weight:700;font-size:14px"},"Phantom Room Entries"),
      el("span",{class:"badge warn",style:"margin-left:8px"},`${phantomObjs.length} found`),
    ]));
    phantomCard.appendChild(el("div",{style:"font-size:12px;color:#f59e0b;margin-bottom:4px"},
      "These entity IDs appear in PadSpan's room map but do not exist in Home Assistant. They are typically leftover sample data or stale entries from a previous install."
    ));
    phantomCard.appendChild(el("div",{style:"font-size:11px;color:#78909c;margin-bottom:10px;padding:6px 8px;background:#0a150e;border-radius:6px;border:1px solid #2a1f00"},
      "Removing them clears the phantom entries from PadSpan's room tracking — no HA entities are modified or deleted."
    ));

    const phantomList = el("div",{style:"display:flex;flex-direction:column;gap:3px;max-height:200px;overflow-y:auto;margin-bottom:10px"});
    for(const o of phantomObjs){
      phantomList.appendChild(el("div",{style:"display:flex;align-items:center;gap:6px;padding:4px 8px;background:#0a150e;border:1px solid #2a1f00;border-radius:6px"},[
        el("span",{style:"font-family:monospace;font-size:11px;color:#94a3b8;flex:1"},o.entity_id),
        o.room ? el("span",{style:"font-size:11px;color:#f59e0b"},o.room) : null,
      ].filter(Boolean)));
    }
    phantomCard.appendChild(phantomList);

    const purgeWrap = el("div",{style:"display:flex;gap:8px;align-items:center"});
    const makePurgeBtn = ()=>{
      const b = el("button",{class:"btn"+(disabled?" disabled":"")},"Clear phantom room data");
      if(disabled) b.disabled = true;
      b.addEventListener("click", ()=>{
        purgeWrap.innerHTML = "";
        const yes = el("button",{class:"btn",style:"background:#7f1d1d;border-color:#dc2626;white-space:nowrap"},`Yes, remove ${phantomObjs.length} phantom entr${phantomObjs.length===1?"y":"ies"}`);
        const no  = el("button",{class:"btn inline"},"Cancel");
        yes.addEventListener("click", async()=>{
          purgeWrap.innerHTML = "";
          purgeWrap.appendChild(el("span",{class:"muted",style:"font-size:12px"},"Clearing…"));
          try {
            const result = await ctx.actions.roomTagPurgeMissing();
            await ctx.actions.refreshSnapshot();
            ctx.toast(`Cleared ${result?.removed ?? phantomObjs.length} phantom entr${(result?.removed??0)===1?"y":"ies"} from room map.`);
            ctx.actions.renderRooms();
          } catch(e){
            ctx.toast("Failed: "+String(e), true);
            purgeWrap.innerHTML = ""; purgeWrap.appendChild(makePurgeBtn());
          }
        });
        no.addEventListener("click", ()=>{ purgeWrap.innerHTML = ""; purgeWrap.appendChild(makePurgeBtn()); });
        purgeWrap.appendChild(yes); purgeWrap.appendChild(no);
      });
      return b;
    };
    purgeWrap.appendChild(makePurgeBtn());
    phantomCard.appendChild(purgeWrap);
    root.appendChild(phantomCard);
  }

  // Real HA entities card
  const entCard = el("div",{class:"card"});
  entCard.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
    el("div",{style:"font-weight:700;font-size:14px"},"HA Entities"),
    el("span",{class:"badge warn",style:"margin-left:8px"},"Destructive"),
    el("span",{class:"badge",style:"margin-left:4px"},`${realObjs.length} found`),
  ]));
  entCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:4px"},
    "Permanently remove entities from Home Assistant's entity registry. Use this to clean up stale or duplicate tracker entities. Automations that reference removed entities will break."
  ));
  entCard.appendChild(el("div",{style:"font-size:11px;color:#78909c;margin-bottom:10px;padding:6px 8px;background:#0a150e;border-radius:6px;border:1px solid #1b3526"},
    "⚠ Entities managed by active integrations (e.g. Bermuda) will be recreated on the next integration poll. To remove permanently, disable the device or integration in HA."
  ));
  if(realObjs.length){
    const entSearch = el("input",{type:"text",placeholder:"Filter entities…",style:"margin-bottom:8px;width:100%;box-sizing:border-box"});
    const entList   = el("div",{style:"display:flex;flex-direction:column;gap:4px;max-height:360px;overflow-y:auto"});
    const renderEntList = (filter) => {
      entList.innerHTML = "";
      const filtered = realObjs.filter(o => !filter || o.entity_id.toLowerCase().includes(filter.toLowerCase()) || (o.name||"").toLowerCase().includes(filter.toLowerCase()));
      for(const o of filtered){
        let row;
        const statusDiv = el("div",{style:"font-size:10px;margin-top:2px;display:none"});
        const btnWrap = el("div",{style:"display:flex;gap:4px;align-items:center;flex-shrink:0"});

        const doDelete = async ()=>{
          btnWrap.innerHTML = "";
          btnWrap.appendChild(el("span",{class:"muted",style:"font-size:11px"},"Deleting…"));
          try {
            await ctx.actions.entityDelete(o.entity_id);
            if(row){ row.style.opacity = "0.35"; row.style.transition = "opacity 0.4s"; }
            statusDiv.textContent = "✓ Removed from HA registry";
            statusDiv.style.color = "#52b788";
            statusDiv.style.display = "";
            btnWrap.innerHTML = "";
            ctx.toast(`Deleted: ${o.entity_id}`);
            ctx.actions.refreshSnapshot().then(()=>ctx.actions.renderRooms()).catch(()=>{});
          } catch(e){
            statusDiv.textContent = "✗ " + String(e).slice(0,80);
            statusDiv.style.color = "#f59e0b";
            statusDiv.style.display = "";
            btnWrap.innerHTML = "";
            btnWrap.appendChild(makeDelBtn());
            ctx.toast(`Delete failed: ${o.entity_id}`, true);
          }
        };

        const makeDelBtn = ()=>{
          const btn = el("button",{class:"btn tiny"+(disabled?" disabled":"")},"Delete");
          if(disabled) btn.disabled = true;
          btn.addEventListener("click", ()=>{
            btnWrap.innerHTML = "";
            const yesBtn = el("button",{class:"btn tiny",style:"background:#7f1d1d;border-color:#dc2626;white-space:nowrap"},"Yes, delete");
            const noBtn  = el("button",{class:"btn tiny"},"Cancel");
            yesBtn.addEventListener("click", doDelete);
            noBtn.addEventListener("click", ()=>{ btnWrap.innerHTML = ""; btnWrap.appendChild(makeDelBtn()); });
            btnWrap.appendChild(yesBtn);
            btnWrap.appendChild(noBtn);
          });
          return btn;
        };
        btnWrap.appendChild(makeDelBtn());

        row = el("div",{style:"display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #1b3526;border-radius:8px;background:#0a150e"},[
          el("div",{style:"flex:1;min-width:0"},[
            el("div",{style:"font-size:12px;font-family:monospace;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"},o.entity_id),
            o.name ? el("div",{style:"font-size:11px;color:#e2e8f0"},o.name) : null,
            o.room ? el("div",{style:"font-size:11px;color:#52b788"},`room: ${o.room}`) : null,
            statusDiv,
          ].filter(Boolean)),
          btnWrap,
        ]);
        entList.appendChild(row);
      }
      if(!filtered.length) entList.appendChild(el("div",{class:"muted",style:"font-size:12px"},"No entities match."));
    };
    entSearch.addEventListener("input",()=>renderEntList(entSearch.value));
    renderEntList("");
    entCard.appendChild(entSearch);
    entCard.appendChild(entList);
  } else {
    entCard.appendChild(el("div",{class:"muted",style:"font-size:12px"},"No HA entities found in snapshot. Switch to Live mode to see real entities."));
  }
  root.appendChild(entCard);

  // ── HA Areas (Rooms) ─────────────────────────────────────────────────────────
  const areasCard = el("div",{class:"card"});
  areasCard.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
    el("div",{style:"font-weight:700;font-size:14px"},"HA Areas (Rooms)"),
    el("span",{class:"badge warn",style:"margin-left:8px"},"Destructive"),
    el("span",{class:"badge",style:"margin-left:4px"},`${haAreas.length} areas`),
  ]));
  areasCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
    "Delete areas from the HA Area Registry. All devices assigned to a deleted area will become unassigned. Room color settings for the area are also removed."
  ));
  if(haAreas.length){
    const tbody = el("tbody");
    for(const area of haAreas){
      const floor = haFloors.find(f=>f.id===area.floor_id);
      const floorLabel = floor ? floor.name : (area.floor_id||"—");
      const areaBtnWrap = el("div",{style:"display:flex;gap:4px"});
      const makeAreaDelBtn = ()=>{
        const b = el("button",{class:"btn tiny"+(disabled?" disabled":"")},"Delete");
        if(disabled) b.disabled = true;
        b.addEventListener("click", ()=>{
          areaBtnWrap.innerHTML = "";
          const yes = el("button",{class:"btn tiny",style:"background:#7f1d1d;border-color:#dc2626;white-space:nowrap"},"Yes, delete");
          const no  = el("button",{class:"btn tiny"},"No");
          yes.addEventListener("click", async()=>{
            areaBtnWrap.innerHTML = "";
            areaBtnWrap.appendChild(el("span",{class:"muted",style:"font-size:11px"},"Deleting…"));
            try {
              await ctx.actions.areaDelete(area.id);
              await ctx.actions.modelRefresh();
              ctx.toast(`Area "${area.name}" deleted.`);
              ctx.actions.renderRooms();
            } catch(e){ areaBtnWrap.innerHTML = ""; areaBtnWrap.appendChild(makeAreaDelBtn()); ctx.toast("Failed: "+String(e), true); }
          });
          no.addEventListener("click", ()=>{ areaBtnWrap.innerHTML = ""; areaBtnWrap.appendChild(makeAreaDelBtn()); });
          areaBtnWrap.appendChild(yes); areaBtnWrap.appendChild(no);
        });
        return b;
      };
      areaBtnWrap.appendChild(makeAreaDelBtn());
      tbody.appendChild(el("tr",{},[
        el("td",{style:"font-weight:600"},area.name),
        el("td",{class:"muted"},floorLabel),
        el("td",{style:"font-family:monospace;font-size:10px;color:#4a5568"},area.id),
        el("td",{},areaBtnWrap),
      ]));
    }
    areasCard.appendChild(el("table",{class:"table"},[
      el("thead",{},el("tr",{},[el("th",{},"Name"),el("th",{},"Floor"),el("th",{},"ID"),el("th",{},"")])),
      tbody,
    ]));
  } else {
    areasCard.appendChild(el("div",{class:"muted",style:"font-size:12px"},"No areas found."));
  }
  root.appendChild(areasCard);

  // ── Uploaded Maps ────────────────────────────────────────────────────────────
  const maps = ctx.state.maps?.list || [];
  if(maps.length){
    const mapsCard = el("div",{class:"card"});
    mapsCard.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
      el("div",{style:"font-weight:700;font-size:14px"},"Uploaded Maps"),
      el("span",{class:"badge warn",style:"margin-left:8px"},"Destructive"),
      el("span",{class:"badge",style:"margin-left:4px"},`${maps.length} maps`),
    ]));
    mapsCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},"Permanently delete uploaded floor plan images."));
    const tbody = el("tbody");
    for(const m of maps){
      const mapBtnWrap = el("div",{style:"display:flex;gap:4px"});
      const makeMapDelBtn = ()=>{
        const b = el("button",{class:"btn tiny"+(disabled?" disabled":"")},"Delete");
        if(disabled) b.disabled = true;
        b.addEventListener("click", ()=>{
          mapBtnWrap.innerHTML = "";
          const yes = el("button",{class:"btn tiny",style:"background:#7f1d1d;border-color:#dc2626;white-space:nowrap"},"Yes, delete");
          const no  = el("button",{class:"btn tiny"},"No");
          yes.addEventListener("click", async()=>{
            mapBtnWrap.innerHTML = "";
            try { await ctx.actions.mapsDelete(m.id); ctx.toast(`Map "${m.name}" deleted.`); }
            catch(e){ mapBtnWrap.appendChild(makeMapDelBtn()); ctx.toast("Failed: "+String(e), true); }
          });
          no.addEventListener("click", ()=>{ mapBtnWrap.innerHTML = ""; mapBtnWrap.appendChild(makeMapDelBtn()); });
          mapBtnWrap.appendChild(yes); mapBtnWrap.appendChild(no);
        });
        return b;
      };
      mapBtnWrap.appendChild(makeMapDelBtn());
      tbody.appendChild(el("tr",{},[
        el("td",{style:"font-weight:600"},m.name||m.id),
        el("td",{class:"muted",style:"font-size:11px"},m.image?.filename||""),
        el("td",{},mapBtnWrap),
      ]));
    }
    mapsCard.appendChild(el("table",{class:"table"},[
      el("thead",{},el("tr",{},[el("th",{},"Name"),el("th",{},"File"),el("th",{},"")])),
      tbody,
    ]));
    root.appendChild(mapsCard);
  }

  // ── Integration Controls ─────────────────────────────────────────────────────
  const ctrlCard = el("div",{class:"card"});
  ctrlCard.appendChild(el("div",{style:"font-weight:700;font-size:14px;margin-bottom:8px"},"Integration Controls"));
  ctrlCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:14px"},"Low-level control over the PadSpan™ HA integration."));
  const ctrlGrid = el("div",{style:"display:flex;flex-direction:column;gap:10px"});

  const reloadWrap = el("div",{style:"display:flex;gap:8px;align-items:center"});
  const makeReloadBtn = ()=>{
    const b = el("button",{class:"btn"},"Reload PadSpan™ HA integration");
    b.addEventListener("click", ()=>{
      reloadWrap.innerHTML = "";
      const yes = el("button",{class:"btn",style:"background:#7f1d1d;border-color:#dc2626"},"Yes, reload");
      const no  = el("button",{class:"btn inline"},"Cancel");
      yes.addEventListener("click", async()=>{
        reloadWrap.innerHTML = "";
        reloadWrap.appendChild(el("span",{class:"muted",style:"font-size:12px"},"Reloading…"));
        try { const res = await ctx.actions.integrationReload(); ctx.toast(`Integration reloaded (${res?.reloaded??0} entries).`); reloadWrap.innerHTML = ""; reloadWrap.appendChild(makeReloadBtn()); }
        catch(e){ ctx.toast("Reload failed: "+String(e), true); reloadWrap.innerHTML = ""; reloadWrap.appendChild(makeReloadBtn()); }
      });
      no.addEventListener("click", ()=>{ reloadWrap.innerHTML = ""; reloadWrap.appendChild(makeReloadBtn()); });
      reloadWrap.appendChild(yes); reloadWrap.appendChild(no);
    });
    return b;
  };
  reloadWrap.appendChild(makeReloadBtn());
  ctrlGrid.appendChild(el("div",{},[
    el("div",{style:"font-weight:600;margin-bottom:4px"},"Reload integration"),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:6px"},"Forces HA to reinitialize PadSpan™ HA without a full HA restart. Useful after config changes."),
    reloadWrap,
  ]));

  const resetColorsWrap = el("div",{style:"display:flex;gap:8px;align-items:center"});
  const makeResetColorsBtn = ()=>{
    const b = el("button",{class:"btn"},"Reset room color settings");
    b.addEventListener("click", ()=>{
      resetColorsWrap.innerHTML = "";
      const yes = el("button",{class:"btn",style:"background:#7f1d1d;border-color:#dc2626"},"Yes, reset colors");
      const no  = el("button",{class:"btn inline"},"Cancel");
      yes.addEventListener("click", async()=>{
        resetColorsWrap.innerHTML = ""; resetColorsWrap.appendChild(makeResetColorsBtn());
        try { await ctx.actions.modelUpdate({room_meta:{}}); ctx.toast("Room color settings cleared."); ctx.actions.renderRooms(); }
        catch(e){ ctx.toast("Failed: "+String(e), true); }
      });
      no.addEventListener("click", ()=>{ resetColorsWrap.innerHTML = ""; resetColorsWrap.appendChild(makeResetColorsBtn()); });
      resetColorsWrap.appendChild(yes); resetColorsWrap.appendChild(no);
    });
    return b;
  };
  resetColorsWrap.appendChild(makeResetColorsBtn());
  ctrlGrid.appendChild(el("div",{},[
    el("div",{style:"font-weight:600;margin-bottom:4px"},"Reset room colors"),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:6px"},"Clears all custom room color picks. Colors regenerate from room names."),
    resetColorsWrap,
  ]));

  ctrlCard.appendChild(ctrlGrid);
  root.appendChild(ctrlCard);
  return root;
}

// ── HA Entities sub-tab ───────────────────────────────────────────────────────
function _haEntities(ctx, el){
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});
  const settings = ctx.state.settings || {};
  wrap.appendChild(_haEntitiesIntro(el));
  wrap.appendChild(_haEntityControls(ctx, el, settings));
  wrap.appendChild(_haEntityAudit(ctx, el));
  wrap.appendChild(_haEntityLibrary(ctx, el));
  wrap.appendChild(_haMqttSection(ctx, el, settings));
  return wrap;
}

function _haEntitiesIntro(el){
  return el("div",{class:"card",style:"border-color:#1b4a2e"},[
    el("div",{style:"font-weight:800;font-size:15px;color:#5eead4;margin-bottom:6px"},"PadSpan HA — Entity Reference"),
    el("div",{style:"font-size:13px;color:#94a3b8;line-height:1.6"},
      "PadSpan creates up to four HA entities for every labelled BLE device. This reference documents each entity type, its state values, attributes, and provides ready-to-paste automation examples."
    ),
    el("div",{style:"font-size:12px;color:#64748b;margin-top:6px"},
      "Tip: PadSpan's room_confidence and rssi_margin_confidence attributes let you build flicker-free automations that competing integrations cannot match."
    ),
  ]);
}

function _haEntityControls(ctx, el, settings){
  const card = el("div",{class:"card"});
  card.appendChild(el("div",{style:"font-weight:700;font-size:14px;margin-bottom:4px"},"Entity Publishing Controls"));
  card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:12px"},
    "Disable entity types you don't need. Existing entities will be disabled in the HA registry. New devices won't create disabled types. Re-enabling restores them. Requires integration reload for new devices."
  ));

  const types = [
    {key:"ha_entity_tracker_enabled", label:"device_tracker.padspan_{label}", desc:"Person-linkable tracker (home/room state)"},
    {key:"ha_entity_area_enabled", label:"sensor.padspan_{label}_area", desc:"Primary room sensor with confidence attributes"},
    {key:"ha_entity_distance_enabled", label:"sensor.padspan_{label}_distance", desc:"Distance to nearest scanner (metres)"},
    {key:"ha_entity_scanner_distance_enabled", label:"sensor.padspan_{label}_distance_{scanner}", desc:"Per-scanner distance for hyper-local triggers"},
  ];

  for(const t of types){
    const row = el("div",{style:"display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #1b3526"});
    const chk = el("input",{type:"checkbox"});
    chk.checked = settings[t.key] !== false;
    chk.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({[t.key]: chk.checked});
        ctx.toast(chk.checked ? `${t.label} enabled — reload integration for new devices.` : `${t.label} disabled. Existing entities disabled in HA registry.`);
      } catch(e){ ctx.toast("Failed: "+String(e), true); chk.checked = !chk.checked; }
    });
    row.appendChild(chk);
    row.appendChild(el("div",{style:"flex:1"},[
      el("div",{style:"font-family:monospace;font-size:12px;color:#5eead4"},t.label),
      el("div",{class:"muted",style:"font-size:11px"},t.desc),
    ]));
    card.appendChild(row);
  }
  return card;
}

function _haEntityAudit(ctx, el){
  const card = el("div",{class:"card"});
  const header = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"});
  header.appendChild(el("span",{style:"font-weight:700;font-size:14px"},"Live Entity Inventory"));
  card.appendChild(header);
  card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:12px"},
    "All PadSpan entities registered in Home Assistant with current state, health, and automation usage."
  ));

  // Placeholder that gets filled async
  const body = el("div",{});
  const loading = el("div",{class:"muted",style:"font-size:12px;padding:12px 0"},"Loading entity data…");
  body.appendChild(loading);
  card.appendChild(body);

  // Fire the WS call
  ctx.actions.wsCall("padspan_ha/ha_entities_audit", {}).then(res => {
    body.innerHTML = "";
    if(!res || !res.entities || !res.entities.length){
      body.appendChild(el("div",{class:"muted",style:"font-size:12px;padding:8px 0"},
        "No PadSpan entities found. Label a BLE device in the Objects tab and switch to Live mode."
      ));
      return;
    }
    const entities = res.entities;

    // ── Summary bar ──────────────────────────────────────────────────────
    const summary = el("div",{style:"display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px"});
    const _pill = (label, count, color) => el("div",{style:`display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;border:1px solid ${color};font-size:11px`},[
      el("span",{style:`color:${color};font-weight:700`},String(count)),
      el("span",{style:"color:#94a3b8"},label),
    ]);
    const bh = res.by_health || {};
    summary.appendChild(_pill("total", res.total, "#5eead4"));
    if(bh.good)        summary.appendChild(_pill("healthy", bh.good, "#52b788"));
    if(bh.stale)       summary.appendChild(_pill("stale", bh.stale, "#f59e0b"));
    if(bh.unavailable) summary.appendChild(_pill("unavailable", bh.unavailable, "#f87171"));
    if(bh.unknown)     summary.appendChild(_pill("unknown", bh.unknown, "#94a3b8"));
    if(bh.disabled)    summary.appendChild(_pill("disabled", bh.disabled, "#64748b"));
    summary.appendChild(_pill("used in automations", res.total_used_in_automations, "#8b5cf6"));
    body.appendChild(summary);

    // ── Type breakdown ──────────────────────────────────────────────────
    const bt = res.by_type || {};
    const typeBar = el("div",{style:"display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px"});
    const _typeColors = {tracker:"#8b5cf6", area:"#10b981", distance:"#f59e0b", scanner_distance:"#06b6d4"};
    const _typeLabels = {tracker:"device_tracker", area:"area sensor", distance:"distance sensor", scanner_distance:"scanner distance"};
    for(const [t, c] of Object.entries(bt)){
      typeBar.appendChild(el("div",{style:`font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid ${_typeColors[t]||"#64748b"};color:${_typeColors[t]||"#64748b"}`},
        `${c} ${_typeLabels[t]||t}`
      ));
    }
    body.appendChild(typeBar);

    // ── Entity table ─────────────────────────────────────────────────────
    const _healthIcon = (h) => {
      if(h === "good")        return {dot:"#52b788", label:"Healthy"};
      if(h === "stale")       return {dot:"#f59e0b", label:"Stale"};
      if(h === "unavailable") return {dot:"#f87171", label:"Unavailable"};
      if(h === "disabled")    return {dot:"#64748b", label:"Disabled"};
      if(h === "unknown")     return {dot:"#94a3b8", label:"Unknown"};
      return {dot:"#64748b", label:h};
    };
    const _ago = (iso) => {
      if(!iso) return "—";
      const d = new Date(iso);
      const sec = Math.floor((Date.now() - d.getTime()) / 1000);
      if(sec < 0) return "just now";
      if(sec < 60) return `${sec}s ago`;
      if(sec < 3600) return `${Math.floor(sec/60)}m ago`;
      if(sec < 86400) return `${Math.floor(sec/3600)}h ago`;
      return `${Math.floor(sec/86400)}d ago`;
    };

    const thead = el("thead",{},el("tr",{},[
      el("th",{style:"text-align:left"},"Health"),
      el("th",{style:"text-align:left"},"Entity"),
      el("th",{style:"text-align:left"},"Type"),
      el("th",{style:"text-align:left"},"State"),
      el("th",{style:"text-align:left"},"Last Changed"),
      el("th",{style:"text-align:left"},"Used By"),
      el("th",{style:"text-align:left"},"Hint"),
    ]));
    const tbody = el("tbody");

    for(const ent of entities){
      const hi = _healthIcon(ent.health);

      // Health dot + label
      const healthCell = el("td",{style:"white-space:nowrap"},[
        el("span",{style:`display:inline-block;width:8px;height:8px;border-radius:50%;background:${hi.dot};margin-right:4px;vertical-align:middle`}),
        el("span",{style:`font-size:10px;color:${hi.dot}`},hi.label),
      ]);

      // Entity ID (monospace) + device label
      const idCell = el("td",{},[
        el("div",{style:"font-family:monospace;font-size:11px;color:#5eead4;word-break:break-all"},ent.entity_id),
        ent.device_label ? el("div",{style:"font-size:10px;color:#64748b"},ent.device_label) : null,
      ].filter(Boolean));

      // Type badge
      const tc = _typeColors[ent.type] || "#64748b";
      const typeCell = el("td",{},
        el("span",{style:`font-size:10px;padding:1px 6px;border-radius:8px;border:1px solid ${tc};color:${tc};white-space:nowrap`},
          _typeLabels[ent.type] || ent.type
        )
      );

      // State
      const stateStyle = ent.state === "not_home" ? "color:#f87171" :
                         ent.state === "unavailable" ? "color:#64748b;font-style:italic" :
                         ent.state === "unknown" ? "color:#94a3b8;font-style:italic" :
                         "color:#e2e8f0";
      const stateCell = el("td",{},[
        el("div",{style:`font-size:12px;font-weight:600;${stateStyle};max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`},ent.state || "—"),
        ent.room_confidence != null ? el("div",{style:"font-size:10px;color:#64748b"},`conf: ${Math.round(ent.room_confidence * 100)}%`) : null,
      ].filter(Boolean));

      // Last changed
      const changedCell = el("td",{},[
        el("div",{style:"font-size:11px;color:#94a3b8;white-space:nowrap"},_ago(ent.last_changed)),
        ent.health === "stale" && ent.health_detail ? el("div",{style:"font-size:9px;color:#f59e0b"},ent.health_detail.replace(/— .*/,"")) : null,
      ].filter(Boolean));

      // Used by automations/scripts
      const usedParts = [];
      if(ent.automations.length){
        usedParts.push(el("div",{style:"font-size:10px;color:#8b5cf6"},`${ent.automations.length} automation${ent.automations.length>1?"s":""}`));
        for(const a of ent.automations.slice(0,2)){
          usedParts.push(el("div",{style:"font-size:9px;color:#64748b;padding-left:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px"},a));
        }
        if(ent.automations.length > 2) usedParts.push(el("div",{style:"font-size:9px;color:#64748b;padding-left:6px"},`+${ent.automations.length-2} more`));
      }
      if(ent.scripts.length){
        usedParts.push(el("div",{style:"font-size:10px;color:#06b6d4"},`${ent.scripts.length} script${ent.scripts.length>1?"s":""}`));
      }
      if(!usedParts.length){
        usedParts.push(el("div",{style:"font-size:10px;color:#64748b;font-style:italic"},"unused"));
      }
      const usedCell = el("td",{},usedParts);

      // Suggestion hint
      const hintCell = el("td",{});
      if(ent.suggestion){
        hintCell.appendChild(el("div",{style:"font-size:10px;color:#fbbf24;max-width:180px;line-height:1.3"},ent.suggestion));
      }

      tbody.appendChild(el("tr",{style:ent.health === "disabled" ? "opacity:0.45" : ""},[
        healthCell, idCell, typeCell, stateCell, changedCell, usedCell, hintCell,
      ]));
    }

    const table = el("table",{class:"table",style:"font-size:12px"},[thead, tbody]);
    const tableWrap = el("div",{style:"overflow-x:auto;max-height:500px;overflow-y:auto"});
    tableWrap.appendChild(table);
    body.appendChild(tableWrap);

    // ── Health insights ──────────────────────────────────────────────────
    const insights = [];
    const unusedCount = entities.filter(e => e.used_count === 0 && e.health !== "disabled").length;
    const staleCount = bh.stale || 0;
    const unavailCount = bh.unavailable || 0;

    if(unusedCount > 0 && unusedCount === entities.filter(e => e.health !== "disabled").length){
      insights.push({color:"#fbbf24", text:`None of your ${unusedCount} entities are used in automations yet. Scroll down to the Entity Type Library for ready-to-paste examples.`});
    } else if(unusedCount > 0){
      insights.push({color:"#fbbf24", text:`${unusedCount} entit${unusedCount===1?"y is":"ies are"} not used in any automation or script. Check the hints column for ideas.`});
    }
    if(staleCount > 0){
      insights.push({color:"#f59e0b", text:`${staleCount} entit${staleCount===1?"y hasn't":"ies haven't"} changed state in 24+ hours — likely away or out of scanner range.`});
    }
    if(unavailCount > 0){
      insights.push({color:"#f87171", text:`${unavailCount} entit${unavailCount===1?"y is":"ies are"} unavailable. Try reloading the integration from the Data tab.`});
    }
    const areaCount = (bt.area || 0);
    const trackerCount = (bt.tracker || 0);
    if(areaCount > 0 && trackerCount === 0){
      insights.push({color:"#8b5cf6", text:"You have area sensors but no device trackers. Enable device_tracker above to link devices to Person entities."});
    }
    if(res.total_used_in_automations > 0){
      insights.push({color:"#52b788", text:`${res.total_used_in_automations} entit${res.total_used_in_automations===1?"y is":"ies are"} actively used in automations — nice!`});
    }

    if(insights.length){
      const insightWrap = el("div",{style:"margin-top:10px;display:flex;flex-direction:column;gap:6px"});
      insightWrap.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin-bottom:2px"},"Insights"));
      for(const ins of insights){
        insightWrap.appendChild(el("div",{style:`font-size:11px;color:${ins.color};padding:4px 8px;background:#0a150e;border:1px solid #1b3526;border-radius:6px;line-height:1.4`},ins.text));
      }
      body.appendChild(insightWrap);
    }

  }).catch(err => {
    body.innerHTML = "";
    body.appendChild(el("div",{style:"font-size:12px;color:#f87171;padding:8px 0"},
      "Failed to load entity data: " + String(err?.message || err)
    ));
  });

  return card;
}

function _haEntityLibrary(ctx, el){
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});
  wrap.appendChild(el("div",{style:"font-weight:700;font-size:14px;color:#94a3b8;margin-bottom:2px"},"Entity Type Library"));

  // ── 1. device_tracker ───────────────────────────────────────────────────
  wrap.appendChild(_entityCard(el, {
    id: "device_tracker.padspan_{label}",
    badge: "Person-linkable",
    badgeColor: "#8b5cf6",
    state: "Room name when home (e.g. \"kitchen\"), \"not_home\" when away beyond timeout.",
    attrs: [
      ["address", "BLE MAC or iBeacon UUID"],
      ["rssi", "Latest smoothed RSSI (dBm), null when away"],
      ["age_s", "Seconds since last advertisement"],
      ["user_label", "Friendly name assigned in PadSpan"],
      ["home", "Boolean — true when seen within away timeout"],
    ],
    examples: [
      {
        title: "Link to a Person entity",
        desc: "Go to HA Settings → People → select person → under \"Track devices\", add device_tracker.padspan_{label}. HA will use PadSpan's room assignment for that person's location.",
        yaml: `# No YAML needed — this is configured in the HA UI:
# Settings → People → [person] → Track devices
# Add: device_tracker.padspan_alice_phone
#
# Once linked, person.alice will show the room name
# reported by PadSpan (e.g. "kitchen", "bedroom").
# Works alongside GPS trackers — HA merges both.`,
      },
    ],
  }));

  // ── 2. sensor._area ─────────────────────────────────────────────────────
  wrap.appendChild(_entityCard(el, {
    id: "sensor.padspan_{label}_area",
    badge: "Primary room sensor",
    badgeColor: "#10b981",
    state: "Current room name (e.g. \"living_room\"), \"unknown\" if no room assigned, \"not_home\" when away.",
    attrs: [
      ["room_confidence", "0.0–1.0 — fraction of vote window agreeing on this room (PadSpan-unique)"],
      ["rssi_margin_confidence", "0.0–1.0 — how much stronger the winning room's signal is vs runner-up (PadSpan-unique)"],
      ["kind", "\"ble\", \"private_ble\", or \"ibeacon\""],
      ["address", "BLE MAC address"],
      ["rssi", "Kalman-smoothed RSSI (dBm), null when away"],
      ["age_s", "Seconds since last BLE advertisement"],
      ["sources", "List of scanner names currently hearing this device"],
      ["home", "Boolean — true when within away timeout"],
      ["ibeacon_uuid", "iBeacon UUID (only for iBeacon devices)"],
      ["all_addresses", "All MAC addresses seen for this device (rotating BLE)"],
    ],
    examples: [
      {
        title: "Confidence-gated room lighting",
        desc: "Only turn on lights when PadSpan is confident about the room — avoids flicker from momentary signal bounces.",
        yaml: `automation:
  - alias: "Kitchen lights on — confidence gated"
    trigger:
      - platform: state
        entity_id: sensor.padspan_alice_phone_area
        to: "kitchen"
    condition:
      - condition: numeric_state
        entity_id: sensor.padspan_alice_phone_area
        attribute: room_confidence
        above: 0.75
    action:
      - service: light.turn_on
        target:
          area_id: kitchen`,
      },
      {
        title: "Multi-person room occupancy sensor",
        desc: "Template binary sensor that's ON when anyone is in a room. Uses Jinja to scan all PadSpan area sensors.",
        yaml: `template:
  - binary_sensor:
      - name: "Kitchen occupied"
        state: >-
          {{ states.sensor
             | selectattr('entity_id', 'search', 'padspan_.*_area')
             | map(attribute='state')
             | select('eq', 'kitchen')
             | list | length > 0 }}
        device_class: occupancy`,
      },
      {
        title: "Follow-me Sonos media",
        desc: "Move music to whatever room you walk into. Define a room→speaker mapping, then trigger on area change.",
        yaml: `automation:
  - alias: "Follow-me Sonos"
    trigger:
      - platform: state
        entity_id: sensor.padspan_alice_phone_area
    condition:
      - condition: numeric_state
        entity_id: sensor.padspan_alice_phone_area
        attribute: room_confidence
        above: 0.8
    action:
      - variables:
          speakers:
            kitchen: media_player.kitchen_sonos
            living_room: media_player.living_room_sonos
            bedroom: media_player.bedroom_sonos
      - condition: template
        value_template: >-
          {{ trigger.to_state.state in speakers }}
      - service: media_player.join
        target:
          entity_id: "{{ speakers[trigger.to_state.state] }}"
        data:
          group_members:
            - "{{ speakers[trigger.from_state.state] }}"`,
      },
      {
        title: "Room-based HVAC — flicker-free",
        desc: "Only heat occupied rooms. The confidence gate prevents the thermostat toggling when BLE signals fluctuate.",
        yaml: `automation:
  - alias: "Heat occupied rooms only"
    trigger:
      - platform: state
        entity_id: sensor.padspan_alice_phone_area
    condition:
      - condition: numeric_state
        entity_id: sensor.padspan_alice_phone_area
        attribute: room_confidence
        above: 0.8
    action:
      - service: climate.set_temperature
        target:
          area_id: "{{ trigger.to_state.state }}"
        data:
          temperature: 21
      - condition: template
        value_template: "{{ trigger.from_state.state != trigger.to_state.state }}"
      - service: climate.set_temperature
        target:
          area_id: "{{ trigger.from_state.state }}"
        data:
          temperature: 17`,
      },
      {
        title: "Dashboard Markdown card — all devices",
        desc: "Shows every tracked PadSpan device with its current room and confidence percentage.",
        yaml: `type: markdown
title: PadSpan Presence
content: >-
  {% set sensors = states.sensor
     | selectattr('entity_id', 'search', 'padspan_.*_area')
     | list %}
  | Device | Room | Confidence |
  |--------|------|------------|
  {% for s in sensors -%}
  | {{ s.name | replace(' Area','') }} | {{ s.state }} | {{ (s.attributes.room_confidence | default(0) * 100) | round }}% |
  {% endfor %}`,
      },
    ],
  }));

  // ── 3. sensor._distance ─────────────────────────────────────────────────
  wrap.appendChild(_entityCard(el, {
    id: "sensor.padspan_{label}_distance",
    badge: "Proximity metre",
    badgeColor: "#f59e0b",
    state: "Distance in metres to nearest scanner (float, e.g. 2.3). Unavailable when away.",
    attrs: [
      ["rssi", "Kalman-smoothed RSSI used for distance calculation"],
      ["tx_power", "Advertised TX power (dBm) from the BLE device, if available"],
      ["age_s", "Seconds since last advertisement"],
      ["room", "Current room assignment"],
    ],
    examples: [
      {
        title: "Wake desk PC when within 1.5 m",
        desc: "Uses numeric_state trigger to fire a Wake-on-LAN when you sit down at your desk.",
        yaml: `automation:
  - alias: "Wake desk PC on approach"
    trigger:
      - platform: numeric_state
        entity_id: sensor.padspan_alice_phone_distance
        below: 1.5
    condition:
      - condition: state
        entity_id: switch.desk_pc_wol
        state: "off"
    action:
      - service: wake_on_lan.send_magic_packet
        data:
          mac: "AA:BB:CC:DD:EE:FF"`,
      },
      {
        title: "Occupant counter — people within 3 m",
        desc: "Template sensor counting how many tracked people are within 3 metres of any scanner.",
        yaml: `template:
  - sensor:
      - name: "Nearby people"
        unit_of_measurement: "people"
        state: >-
          {{ states.sensor
             | selectattr('entity_id', 'search', 'padspan_.*_distance$')
             | selectattr('state', 'is_number')
             | map(attribute='state')
             | map('float')
             | select('lt', 3.0)
             | list | length }}`,
      },
    ],
  }));

  // ── 4. sensor._distance_{scanner} ──────────────────────────────────────
  wrap.appendChild(_entityCard(el, {
    id: "sensor.padspan_{label}_distance_{scanner}",
    badge: "Per-scanner hyper-local",
    badgeColor: "#06b6d4",
    state: "Distance in metres from this specific scanner to the device. Unavailable when not heard.",
    attrs: [
      ["scanner", "Name of the ESPresense / Bluetooth Proxy node"],
      ["rssi", "Kalman-smoothed RSSI from this specific scanner"],
      ["age_s", "Seconds since this scanner last heard the device"],
      ["room", "Current room assignment (from global scoring, not this scanner alone)"],
    ],
    examples: [
      {
        title: "Bedside lamp — zone within a room",
        desc: "Fire when you're within 1.2 m of the bedroom proxy. This creates a micro-zone inside a room — unique to per-scanner distance.",
        yaml: `automation:
  - alias: "Bedside lamp on approach"
    trigger:
      - platform: numeric_state
        entity_id: sensor.padspan_alice_phone_distance_bedroom_proxy
        below: 1.2
        for: "00:00:05"
    action:
      - service: light.turn_on
        target:
          entity_id: light.bedside_lamp
        data:
          brightness_pct: 30
  - alias: "Bedside lamp off on leave"
    trigger:
      - platform: numeric_state
        entity_id: sensor.padspan_alice_phone_distance_bedroom_proxy
        above: 2.0
        for: "00:00:10"
    action:
      - service: light.turn_off
        target:
          entity_id: light.bedside_lamp`,
      },
      {
        title: "Closest scanner template",
        desc: "Template sensor that reports which scanner is nearest. Useful for room override logic or debugging.",
        yaml: `template:
  - sensor:
      - name: "Alice closest scanner"
        state: >-
          {% set ns = namespace(best='unknown', dist=999) %}
          {% for s in states.sensor
             | selectattr('entity_id', 'search',
                 'padspan_alice_phone_distance_')
             | selectattr('state', 'is_number') %}
            {% if s.state | float < ns.dist %}
              {% set ns.dist = s.state | float %}
              {% set ns.best = s.attributes.scanner | default(
                 s.entity_id | replace(
                   'sensor.padspan_alice_phone_distance_','')) %}
            {% endif %}
          {% endfor %}
          {{ ns.best }}`,
      },
    ],
  }));

  return wrap;
}

function _entityCard(el, cfg){
  const card = el("div",{class:"card"});

  // Header
  const header = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap"});
  header.appendChild(el("span",{style:"font-family:monospace;font-size:13px;font-weight:700;color:#5eead4"},cfg.id));
  header.appendChild(el("span",{style:`font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid ${cfg.badgeColor};color:${cfg.badgeColor}`},cfg.badge));
  card.appendChild(header);

  // State
  card.appendChild(el("div",{style:"margin-bottom:8px"},[
    el("div",{style:"font-weight:600;font-size:12px;margin-bottom:2px"},"State"),
    el("div",{style:"font-size:12px;color:#94a3b8"},cfg.state),
  ]));

  // Attributes table
  if(cfg.attrs && cfg.attrs.length){
    card.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin-bottom:4px"},"Attributes"));
    const tbody = el("tbody");
    for(const [name, desc] of cfg.attrs){
      tbody.appendChild(el("tr",{},[
        el("td",{style:"font-family:monospace;font-size:11px;color:#5eead4;white-space:nowrap;padding-right:12px"},name),
        el("td",{style:"font-size:11px;color:#94a3b8"},desc),
      ]));
    }
    card.appendChild(el("table",{style:"width:100%;margin-bottom:10px;border-collapse:collapse"},[tbody]));
  }

  // Examples
  if(cfg.examples && cfg.examples.length){
    card.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin-bottom:6px"},"Automation Examples"));
    for(const ex of cfg.examples){
      card.appendChild(_exampleBlock(el, ex));
    }
  }

  return card;
}

function _exampleBlock(el, ex){
  const wrap = el("div",{style:"margin-bottom:8px;border:1px solid #1b3526;border-radius:8px;overflow:hidden"});

  const expanded = {v: false};
  const codeWrap = el("div",{style:"display:none"});

  const headerBtn = el("button",{style:"display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;background:#0a150e;border:none;cursor:pointer;text-align:left;color:#e2e8f0;font-size:12px"});
  const arrow = el("span",{style:"color:#5eead4;font-size:10px;transition:transform 0.15s"},"▶");
  headerBtn.appendChild(arrow);
  headerBtn.appendChild(el("span",{style:"font-weight:600;flex:1"},ex.title));
  headerBtn.appendChild(el("span",{style:"font-size:10px;color:#64748b;border:1px solid #334155;padding:1px 6px;border-radius:8px"},"YAML"));

  headerBtn.addEventListener("click",()=>{
    expanded.v = !expanded.v;
    codeWrap.style.display = expanded.v ? "block" : "none";
    arrow.style.transform = expanded.v ? "rotate(90deg)" : "";
  });
  wrap.appendChild(headerBtn);

  if(ex.desc){
    const descDiv = el("div",{style:"padding:4px 10px 6px 28px;font-size:11px;color:#64748b;background:#0a150e"});
    descDiv.textContent = ex.desc;
    wrap.appendChild(descDiv);
  }

  const pre = document.createElement("pre");
  pre.style.cssText = "margin:0;padding:10px 12px;font-size:11px;line-height:1.5;overflow-x:auto;background:#060d08;color:#a7f3d0;white-space:pre;";
  pre.textContent = ex.yaml;

  const copyBtn = el("button",{style:"position:absolute;top:4px;right:4px;background:#1b3526;border:1px solid #2d5a3e;color:#5eead4;font-size:10px;padding:2px 8px;border-radius:6px;cursor:pointer"},"Copy");
  copyBtn.addEventListener("click", async()=>{
    try { await navigator.clipboard.writeText(ex.yaml); copyBtn.textContent = "Copied!"; } catch(e){
      try {
        const tmp = document.createElement("textarea");
        tmp.value = ex.yaml; tmp.style.cssText = "position:fixed;left:-9999px";
        document.body.appendChild(tmp); tmp.select(); document.execCommand("copy");
        document.body.removeChild(tmp); copyBtn.textContent = "Copied!";
      } catch(e2){ copyBtn.textContent = "Failed"; }
    }
    setTimeout(()=>{ copyBtn.textContent = "Copy"; }, 1500);
  });

  const codeContainer = el("div",{style:"position:relative"});
  codeContainer.appendChild(pre);
  codeContainer.appendChild(copyBtn);
  codeWrap.appendChild(codeContainer);
  wrap.appendChild(codeWrap);

  return wrap;
}

function _haMqttSection(ctx, el, settings){
  const card = el("div",{class:"card",style:"border-color:#f59e0b"});

  const header = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:6px"});
  header.appendChild(el("span",{style:"font-weight:700;font-size:14px"},"MQTT Publishing"));
  header.appendChild(el("span",{style:"font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid #f59e0b;color:#f59e0b"},"Experimental"));
  card.appendChild(header);

  card.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;line-height:1.5;margin-bottom:10px"},
    "When enabled, PadSpan publishes device presence data to MQTT alongside HA entities. Useful for bridging to Node-RED, external dashboards, or non-HA systems."
  ));

  card.appendChild(el("div",{style:"font-size:11px;color:#64748b;margin-bottom:8px;padding:6px 8px;background:#1a1200;border:1px solid #3d2e00;border-radius:6px"},
    "Topics: padspan/devices/{label}/state • padspan/devices/{label}/area • padspan/devices/{label}/distance — Schema may change without notice."
  ));

  const chk = el("input",{type:"checkbox"});
  chk.checked = settings.mqtt_publish_enabled === true;
  chk.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({mqtt_publish_enabled: chk.checked});
      ctx.toast(chk.checked ? "MQTT publishing enabled." : "MQTT publishing disabled.");
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast("Failed: "+String(e), true); chk.checked = !chk.checked; }
  });
  card.appendChild(el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;margin-bottom:10px"},[
    chk, el("span",{},"Enable experimental MQTT publishing"),
  ]));

  if(settings.mqtt_publish_enabled){
    card.appendChild(el("div",{style:"font-size:12px;color:#f59e0b;margin-bottom:8px"},"MQTT publishing is active. Ensure MQTT integration is configured in HA."));
    card.appendChild(_exampleBlock(el, {
      title: "MQTT automation example",
      desc: "Trigger a Node-RED flow or external system when a device enters a room via MQTT.",
      yaml: `automation:
  - alias: "MQTT room arrival"
    trigger:
      - platform: mqtt
        topic: "padspan/devices/alice_phone/area"
    condition:
      - condition: template
        value_template: "{{ trigger.payload != 'not_home' }}"
    action:
      - service: notify.notify
        data:
          message: >-
            Alice's phone arrived in {{ trigger.payload }}`,
    }));
  }

  return card;
}

// ── History sub-tab ───────────────────────────────────────────────────────────
function _history(ctx, el){
  const { roomColor } = ctx.helpers;
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});
  wrap.appendChild(el("div",{class:"muted",style:"font-size:12px"},
    "Movement history tracked in this browser session. Reloading the page clears the history. Track a tag from the Follow tab to populate this."
  ));

  const followHistory = ctx.state.followHistory || {};
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const allObjects = (snap && snap.objects && Array.isArray(snap.objects.list)) ? snap.objects.list : [];
  const addrs = Object.keys(followHistory).filter(a => followHistory[a] && followHistory[a].length > 0);

  if(!addrs.length){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"No movement history yet. Open the Follow tab and track a tag to see its room transitions here."),
    ]));
    return wrap;
  }

  for(const addr of addrs){
    const history = followHistory[addr];
    const obj = allObjects.find(o => (o.address||o.entity_id||"")===addr);
    const label = (obj && (obj.user_label||obj.name||obj.entity_id)) || addr;
    const card = el("div",{class:"card"});
    card.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
      el("div",{style:"font-weight:700"},label),
      el("span",{class:"badge",style:"margin-left:8px"},`${history.length} transitions`),
    ]));
    const timeline = el("div",{style:"display:flex;flex-direction:column;gap:4px;max-height:280px;overflow-y:auto"});
    for(let i=history.length-1; i>=0; i--){
      const entry = history[i];
      const prev  = history[i-1];
      const timeStr = new Date(entry.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});
      const durSec  = prev ? Math.round((entry.ts-prev.ts)/1000) : null;
      const durStr  = durSec!=null ? (durSec>=60?`${Math.floor(durSec/60)}m ${durSec%60}s`:`${durSec}s`) : "";
      const isLatest = i===history.length-1;
      const rc = roomColor(entry.room||"");
      const row = el("div",{style:"display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;background:#0a150e;border:1px solid #1b3526"},[
        el("span",{style:"color:#94a3b8;font-size:11px;font-family:monospace;white-space:nowrap"},timeStr),
        el("span",{class:"dot",style:`background:${rc};flex-shrink:0`}),
        el("span",{style:"flex:1;font-weight:600"},entry.room||"(unknown)"),
        durStr ? el("span",{class:"muted",style:"font-size:11px;white-space:nowrap"},durStr) : null,
        isLatest ? el("span",{class:"badge",style:"margin-left:4px"},"current") : null,
      ].filter(Boolean));
      timeline.appendChild(row);
    }
    card.appendChild(timeline);
    wrap.appendChild(card);
  }
  return wrap;
}

// ── Events sub-tab ────────────────────────────────────────────────────────────
function _events(ctx, el){
  const { roomColor } = ctx.helpers;
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});

  // ── Email Notifications card ──────────────────────────────────────────────
  wrap.appendChild(_buildNotifications(ctx, el));

  wrap.appendChild(el("div",{class:"muted",style:"font-size:12px"},
    "Session event log — room transitions for all tracked tags, newest first. Clears on page reload."
  ));

  const followHistory = ctx.state.followHistory || {};
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const allObjects = (snap && snap.objects && Array.isArray(snap.objects.list)) ? snap.objects.list : [];
  const events = [];
  for(const [addr,history] of Object.entries(followHistory)){
    if(!history||!history.length) continue;
    const obj = allObjects.find(o=>(o.address||o.entity_id||"")===addr);
    const label = (obj&&(obj.user_label||obj.name||obj.entity_id))||addr;
    for(let i=history.length-1;i>=0;i--){
      events.push({ts:history[i].ts,room:history[i].room,label,isCurrent:i===history.length-1});
    }
  }
  events.sort((a,b)=>b.ts-a.ts);

  if(!events.length){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"No events recorded yet. Track tags in the Follow tab to generate movement events."),
    ]));
  } else {
    const card = el("div",{class:"card"});
    card.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
      el("div",{style:"font-weight:700"},"Room Transitions"),
      el("span",{class:"badge",style:"margin-left:8px"},`${events.length} events`),
    ]));
    const list = el("div",{style:"display:flex;flex-direction:column;gap:4px;max-height:400px;overflow-y:auto"});
    for(const ev of events){
      const timeStr = new Date(ev.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});
      const rc = roomColor(ev.room||"");
      const row = el("div",{style:"display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;background:#0a150e;border:1px solid #1b3526"},[
        el("span",{style:"color:#94a3b8;font-size:11px;font-family:monospace;white-space:nowrap"},timeStr),
        el("span",{class:"dot",style:`background:${rc};flex-shrink:0`}),
        el("span",{style:"flex:1;font-size:12px"},[
          el("span",{style:"color:#94a3b8"},ev.label+" → "),
          el("span",{style:"font-weight:600"},ev.room||"(unknown)"),
        ]),
        ev.isCurrent ? el("span",{class:"badge"},"now") : null,
      ].filter(Boolean));
      list.appendChild(row);
    }
    card.appendChild(list);
    wrap.appendChild(card);
  }

  const diag = ctx.state.diag;
  if(diag && Object.keys(diag).length){
    const diagCard = el("div",{class:"card"});
    diagCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:8px"},"System Diagnostics"));
    const pre = document.createElement("pre");
    pre.className = "mono";
    pre.setAttribute("style","max-height:200px;overflow:auto;font-size:11px");
    pre.textContent = JSON.stringify(diag,null,2);
    diagCard.appendChild(pre);
    wrap.appendChild(diagCard);
  }
  return wrap;
}

// ── Email Notification Configuration ──────────────────────────────────────────
function _buildNotifications(ctx, el){
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const snapObjects = (snap && snap.objects && Array.isArray(snap.objects.list)) ? snap.objects.list : [];

  // Merge all sources of tagged devices so list is complete:
  // 1. Live snapshot objects
  // 2. Saved alert configs (devices that had alerts configured previously)
  // 3. Followed addresses
  const configs = ctx.state.followAlertConfig || {};
  const seen = new Set();
  const allObjects = [];
  for(const o of snapObjects){
    const addr = o.address || o.entity_id || "";
    if(addr){ seen.add(addr); allObjects.push(o); }
  }
  // Add devices from saved alert configs that aren't in the snapshot
  for(const [addr, cfg] of Object.entries(configs)){
    if(!addr || seen.has(addr)) continue;
    seen.add(addr);
    allObjects.push({ address: addr, user_label: cfg._label || addr, kind: "ble", _fromConfig: true });
  }
  // Add followed devices that aren't in the snapshot
  for(const addr of (ctx.state.followedAddrs || [])){
    if(!addr || seen.has(addr)) continue;
    seen.add(addr);
    allObjects.push({ address: addr, user_label: addr, kind: "ble", _fromFollowed: true });
  }
  // Load labels from object store if available (async, will re-render)
  if(!ctx.state._objectLabelsLoaded){
    ctx.state._objectLabelsLoaded = true;
    ctx.actions.objectLabelList().then(r => {
      if(r && r.labels && Object.keys(r.labels).length){
        ctx.state._objectLabels = r.labels;
        ctx.actions.renderRooms();
      }
    }).catch(()=>{});
  }
  // Merge stored labels into allObjects
  const storedLabels = ctx.state._objectLabels || {};
  for(const [addr, info] of Object.entries(storedLabels)){
    if(!addr || seen.has(addr)) continue;
    seen.add(addr);
    const label = (typeof info === "string") ? info : (info && info.label) || addr;
    allObjects.push({ address: addr, user_label: label, kind: "ble", _fromStore: true });
  }

  const haAreas = (ctx.state.model && Array.isArray(ctx.state.model.areas)) ? ctx.state.model.areas : [];
  const dataMode = ctx.state.dataMode || "sample";
  const disabled = dataMode !== "live";

  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});

  // ── Saved Alerts summary table ──────────────────────────────────────────────
  const savedEntries = Object.entries(configs).filter(([,c]) => c && c.email);
  const savedCard = el("div",{class:"card"});
  const activeCount = savedEntries.filter(([,c]) => c.on_room_change).length;
  savedCard.appendChild(el("div",{class:"row",style:"margin-bottom:6px"},[
    el("div",{style:"font-weight:700;font-size:14px"},"Saved Alerts"),
    activeCount > 0
      ? el("span",{class:"badge",style:"margin-left:8px;border-color:#52b788;color:#52b788"},`${activeCount} active`)
      : el("span",{class:"badge",style:"margin-left:8px;border-color:#64748b;color:#64748b"},"none active"),
  ]));
  savedCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
    "All saved email alert configurations. Alerts fire when a device changes rooms (via HA notify service)."
  ));

  if(!savedEntries.length){
    savedCard.appendChild(el("div",{class:"muted",style:"font-size:12px;padding:8px 0"},
      "No alerts configured yet. Tag a device in Objects, then set up alerts below or in the Follow tab."
    ));
  } else {
    const thead = el("thead",{},el("tr",{},[
      el("th",{},"Device"),
      el("th",{},"Email"),
      el("th",{},"Service"),
      el("th",{},"Rooms"),
      el("th",{},"Status"),
      el("th",{style:"width:50px"},""),
    ]));
    const tbody = el("tbody");
    for(const [addr, cfg] of savedEntries){
      // Try to find a friendly name from live objects
      const obj = allObjects.find(o => (o.address||o.entity_id||"") === addr);
      const label = (obj && (obj.user_label || obj.name)) || addr;
      const svc = cfg.notify_service || "default";
      const rooms = (cfg.watch_rooms && cfg.watch_rooms.length) ? cfg.watch_rooms.join(", ") : "all";
      const active = cfg.on_room_change;

      const delBtn = el("button",{class:"btn tiny",style:"color:#ef5350;border-color:#7f1d1d;padding:2px 8px;font-size:11px"}, "Delete");
      delBtn.addEventListener("click", async ()=>{
        if(!confirm(`Delete alert for "${label}"?`)) return;
        delBtn.disabled = true; delBtn.textContent = "...";
        try {
          await ctx.actions.followAlertDelete(addr);
          ctx.toast(`Alert for ${label} deleted.`);
          ctx.actions.renderRooms();
        } catch(e){
          delBtn.disabled = false; delBtn.textContent = "Delete";
          ctx.toast("Delete failed: " + (e?.message || String(e)), true);
        }
      });

      tbody.appendChild(el("tr",{},[
        el("td",{style:"font-weight:600;font-size:12px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"},label),
        el("td",{style:"font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace"},cfg.email),
        el("td",{class:"muted",style:"font-size:11px"},svc),
        el("td",{class:"muted",style:"font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"},rooms),
        el("td",{},
          active
            ? el("span",{style:"color:#52b788;font-size:11px;font-weight:600"},"Active")
            : el("span",{style:"color:#64748b;font-size:11px"},"Off")
        ),
        el("td",{},[delBtn]),
      ]));
    }
    savedCard.appendChild(el("table",{class:"table"},[thead, tbody]));
  }
  wrap.appendChild(savedCard);

  // ── Per-device alert editor ─────────────────────────────────────────────────
  // Tagged BLE/iBeacon objects that can receive alerts
  const trackable = allObjects.filter(o =>
    (o.kind === "ble" || o.kind === "private_ble" || o.kind === "ibeacon") && o.user_label
  );

  const editCard = el("div",{class:"card"});
  editCard.appendChild(el("div",{style:"font-weight:700;font-size:14px;margin-bottom:4px"},"Configure Alerts"));
  editCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:14px"},
    "Set up or edit email alerts for tagged devices. You can also configure per-device alerts in the Follow tab."
  ));

  if(disabled){
    editCard.appendChild(el("div",{style:"font-size:12px;color:#fbbf24;margin-bottom:10px"},
      "Switch to Live mode to configure and save alert settings."
    ));
  }

  if(!trackable.length){
    editCard.appendChild(el("div",{class:"muted",style:"font-size:12px"},
      "No tagged BLE devices found. Tag devices in the Objects tab to set up notifications."
    ));
    wrap.appendChild(editCard);
    return wrap;
  }

  // Always refresh notify services (user may add SMTP mid-session)
  const _prevServices = JSON.stringify(ctx.state._notifyServices || []);
  if(!ctx.state._notifyServices) ctx.state._notifyServices = [];
  ctx.actions.wsCall("padspan_ha/notify_services_list", {}).then(r => {
    ctx.state._notifyServices = (r && r.services) || [];
    // Re-render if list changed (new service added, or still empty on first load)
    if(JSON.stringify(ctx.state._notifyServices) !== _prevServices){
      ctx.actions.renderRooms();
    }
  }).catch(() => {});

  // Service discovery info + refresh
  const _svcList = ctx.state._notifyServices || [];
  const refreshBtn = el("button",{class:"btn tiny",style:"margin-left:8px"}, "Refresh Services");
  refreshBtn.addEventListener("click", () => {
    ctx.state._notifyServices = null;
    ctx.actions.renderRooms();
  });
  if(_svcList.length === 0){
    editCard.appendChild(el("div",{style:"background:#1a0a0a;border:1px solid #7f1d1d;border-radius:8px;padding:12px 14px;margin-bottom:12px"},[
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
        el("div",{style:"font-weight:700;font-size:13px;color:#fca5a5"},"No notification services found"),
        refreshBtn,
      ]),
      el("div",{style:"font-size:12px;color:#fca5a5;line-height:1.5"},
        "PadSpan sends alerts via Home Assistant's notify integration. You need to set up a notification provider first:"
      ),
      el("div",{style:"font-size:11px;color:#94a3b8;margin-top:6px;line-height:1.6;padding-left:10px"},
        "1. Go to HA Settings \u2192 Devices & Services \u2192 Add Integration\n" +
        "2. Search for your notification provider (e.g. SMTP, Mobile App, Pushover, Telegram)\n" +
        "3. Configure it with your email/credentials\n" +
        "4. Restart HA, then click Refresh Services above"
      ),
    ]));
  } else {
    editCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap"},[
      el("span",{class:"badge",style:"border-color:#52b788;color:#52b788"},`${_svcList.length} service${_svcList.length>1?"s":""} found`),
      el("span",{class:"muted",style:"font-size:10px"}, _svcList.join(", ")),
      refreshBtn,
    ]));
  }

  const roomNames = haAreas.map(a => a.name).sort();
  const list = el("div",{style:"display:flex;flex-direction:column;gap:8px"});

  for(const obj of trackable){
    const addr = obj.address || obj.entity_id || "";
    if(!addr) continue;
    const name = obj.user_label || obj.name || addr;
    const cfg = configs[addr] || {on_room_change: true};
    if(!configs[addr]) configs[addr] = cfg;
    const isActive = !!(cfg.on_room_change && cfg.email);

    const row = el("div",{style:"padding:10px 12px;border:1px solid " + (isActive ? "#1b4a2e" : "#1b3526") + ";border-radius:8px;background:#0a150e"});

    // Header row: name + status
    row.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px"},[
      el("span",{style:"font-weight:600;font-size:13px;color:#5eead4"},name),
      el("span",{class:"muted",style:"font-size:10px;font-family:monospace"},addr),
      isActive
        ? el("span",{class:"badge",style:"margin-left:auto;border-color:#52b788;color:#52b788;font-size:10px"},"Active")
        : el("span",{class:"badge",style:"margin-left:auto;border-color:#64748b;color:#64748b;font-size:10px"},"Off"),
    ]));

    // Email + service row
    const emailInput = el("input",{
      class:"input", type:"email", placeholder:"email@example.com",
      value: cfg.email || "", style:"max-width:240px",
    });
    emailInput.addEventListener("input", e => {
      cfg.email = e.target.value;
      ctx.state.followAlertConfig[addr] = cfg;
    });

    const serviceSelect = el("select",{class:"input",style:"max-width:180px"});
    serviceSelect.appendChild(el("option",{value:""},"Default"));
    for(const svc of (ctx.state._notifyServices || [])){
      const opt = el("option",{value:svc},svc);
      if(cfg.notify_service === svc) opt.selected = true;
      serviceSelect.appendChild(opt);
    }
    serviceSelect.addEventListener("change", () => {
      cfg.notify_service = serviceSelect.value || undefined;
      ctx.state.followAlertConfig[addr] = cfg;
    });

    row.appendChild(el("div",{style:"display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:8px"},[
      el("div",{style:"display:flex;flex-direction:column;gap:2px"},[
        el("div",{class:"muted",style:"font-size:10px"},"Email"),
        emailInput,
      ]),
      el("div",{style:"display:flex;flex-direction:column;gap:2px"},[
        el("div",{class:"muted",style:"font-size:10px"},"Service"),
        serviceSelect,
      ]),
    ]));

    // On-change toggle
    const chkChange = el("input",{type:"checkbox"});
    if(cfg.on_room_change) chkChange.checked = true;
    chkChange.addEventListener("change", () => {
      cfg.on_room_change = chkChange.checked;
      ctx.state.followAlertConfig[addr] = cfg;
    });

    row.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;margin-bottom:8px"},[
      el("label",{style:"display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px"},[
        chkChange, el("span",{},"Alert on room change"),
      ]),
    ]));

    // Watch-rooms
    if(roomNames.length){
      const watchRooms = cfg.watch_rooms || [];
      const roomChecks = roomNames.map(room => {
        const chk = el("input",{type:"checkbox"});
        if(watchRooms.includes(room)) chk.checked = true;
        chk.addEventListener("change", () => {
          const wr = ctx.state.followAlertConfig[addr]?.watch_rooms || [];
          if(chk.checked){ if(!wr.includes(room)) wr.push(room); }
          else { const i = wr.indexOf(room); if(i >= 0) wr.splice(i, 1); }
          cfg.watch_rooms = wr;
          ctx.state.followAlertConfig[addr] = cfg;
        });
        return el("label",{style:"display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:11px"},[chk, el("span",{},room)]);
      });
      row.appendChild(el("div",{style:"margin-bottom:8px"},[
        el("div",{class:"muted",style:"font-size:10px;margin-bottom:3px"},"Only these rooms (unchecked = all):"),
        el("div",{style:"display:flex;flex-wrap:wrap;gap:6px"},roomChecks),
      ]));
    }

    // Save + Test
    const saveStatus = el("span",{class:"muted",style:"font-size:11px;max-width:300px;line-height:1.3"});
    const saveBtn = el("button",{class:"btn"+(disabled?" disabled":""),style:"background:#1b4a2e;border-color:#52b788;font-weight:700"}, "Save Alert");
    if(disabled) saveBtn.disabled = true;
    saveBtn.addEventListener("click", async () => {
      if(disabled){ saveStatus.textContent = "Live mode required."; saveStatus.style.color = "#fbbf24"; return; }
      if(cfg.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cfg.email)){
        saveStatus.textContent = "Invalid email format."; saveStatus.style.color = "#f87171"; return;
      }
      saveStatus.textContent = "Saving…"; saveStatus.style.color = "";
      try {
        await ctx.actions.followAlertSave({ addr, config: cfg });
        saveStatus.textContent = "Saved!"; saveStatus.style.color = "#52b788";
        ctx.actions.renderRooms();
      } catch(e){
        saveStatus.textContent = "Save failed: " + (e?.message || String(e)); saveStatus.style.color = "#f87171";
      }
    });

    const testBtn = el("button",{class:"btn tiny"+(disabled?" disabled":"")}, "Test Notification");
    if(disabled) testBtn.disabled = true;
    testBtn.addEventListener("click", async () => {
      if(disabled){ saveStatus.textContent = "Live mode required."; saveStatus.style.color = "#fbbf24"; return; }
      const testEmail = (emailInput.value || "").trim();
      saveStatus.textContent = "Sending test…"; saveStatus.style.color = "";
      testBtn.disabled = true;
      try {
        const svc = serviceSelect ? serviceSelect.value : "";
        const payload = { service: svc || undefined };
        if(testEmail) payload.email = testEmail;
        await ctx.actions.wsCall("padspan_ha/notify_test", payload);
        saveStatus.textContent = "Test sent — check your notification app/inbox."; saveStatus.style.color = "#52b788";
      } catch(e){
        const msg = (e?.message || String(e));
        saveStatus.textContent = msg.length > 120 ? msg.slice(0, 120) + "…" : msg;
        saveStatus.style.color = "#f87171";
      } finally { if(!disabled) testBtn.disabled = false; }
    });

    row.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px"},[saveBtn, testBtn, saveStatus]));
    list.appendChild(row);
  }

  editCard.appendChild(list);
  wrap.appendChild(editCard);
  return wrap;
}

// ── Logs tab ──────────────────────────────────────────────────────────────────
function _logs(ctx, el) {
  const wrap = el("div", {});
  if (!ctx.state._logsLevel) ctx.state._logsLevel = "DEBUG";
  if (!ctx.state._logsData) ctx.state._logsData = null;
  if (!ctx.state._logsLoading) ctx.state._logsLoading = false;

  const levelColors = { DEBUG: "#94a3b8", INFO: "#52b788", WARNING: "#fbbf24", ERROR: "#f87171", CRITICAL: "#f87171" };

  const fetchLogs = async () => {
    ctx.state._logsLoading = true;
    try {
      const res = await ctx.actions.callWS({ type: "padspan_ha/logs_get", level: ctx.state._logsLevel, limit: 300 });
      ctx.state._logsData = res;
    } catch (e) {
      ctx.state._logsData = { entries: [], total: 0, error: String(e) };
    }
    ctx.state._logsLoading = false;
    ctx.actions.renderRooms();
  };

  // Auto-fetch on first visit
  if (!ctx.state._logsData && !ctx.state._logsLoading) {
    fetchLogs();
  }

  // Level filter
  const levelSel = el("select", { class: "btn" });
  for (const lv of ["DEBUG", "INFO", "WARNING", "ERROR"]) {
    const opt = el("option", { value: lv }, lv);
    if (lv === ctx.state._logsLevel) opt.selected = true;
    levelSel.appendChild(opt);
  }
  levelSel.addEventListener("change", () => {
    ctx.state._logsLevel = levelSel.value;
    ctx.state._logsData = null;
    fetchLogs();
  });

  const refreshBtn = el("button", { class: "btn" }, "Refresh");
  refreshBtn.addEventListener("click", () => fetchLogs());

  const toolbar = el("div", { style: "display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap" }, [
    el("span", { style: "font-weight:600;font-size:13px" }, "Min level:"),
    levelSel,
    refreshBtn,
  ]);
  wrap.appendChild(toolbar);

  const data = ctx.state._logsData;
  if (ctx.state._logsLoading) {
    wrap.appendChild(el("div", { class: "muted" }, "Loading logs..."));
    return wrap;
  }
  if (!data) {
    wrap.appendChild(el("div", { class: "muted" }, "Fetching logs..."));
    return wrap;
  }
  if (data.error) {
    wrap.appendChild(el("div", { class: "card warn" }, [
      el("div", { style: "font-weight:700" }, "Failed to fetch logs"),
      el("div", { class: "muted" }, data.error),
    ]));
    return wrap;
  }

  const entries = data.entries || [];
  wrap.appendChild(el("div", { class: "muted", style: "margin-bottom:8px;font-size:12px" },
    `Showing ${entries.length} of ${data.total || 0} buffered entries (newest first). Buffer holds up to 500 entries since last restart.`));

  if (!entries.length) {
    wrap.appendChild(el("div", { class: "card" }, el("div", { class: "muted", style: "padding:12px 0" },
      `No ${ctx.state._logsLevel}+ log entries yet. PadSpan logs appear here as the integration runs.`)));
    return wrap;
  }

  const logList = el("div", { style: "display:flex;flex-direction:column;gap:1px;font-family:monospace;font-size:11px;max-height:70vh;overflow-y:auto;background:#0a150e;border:1px solid #1b3526;border-radius:8px;padding:4px" });

  for (const e of entries) {
    const ts = e.ts ? new Date(e.ts * 1000) : null;
    const timeStr = ts ? ts.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "??:??:??";
    const dateStr = ts ? ts.toLocaleDateString("en-CA") : "";
    const color = levelColors[e.level] || "#94a3b8";
    const bgColor = e.level === "ERROR" || e.level === "CRITICAL" ? "rgba(248,113,113,.08)" : e.level === "WARNING" ? "rgba(251,191,36,.05)" : "transparent";

    const row = el("div", { style: `display:flex;gap:8px;padding:3px 6px;background:${bgColor};border-radius:3px;align-items:flex-start` }, [
      el("span", { style: "color:#64748b;white-space:nowrap;min-width:68px" }, timeStr),
      el("span", { style: `color:${color};font-weight:700;min-width:56px` }, e.level),
      el("span", { style: "color:#64748b;min-width:90px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", title: e.logger || "" }, e.logger || ""),
      el("span", { style: "color:#e2e8f0;word-break:break-word;flex:1" }, e.message || ""),
    ]);
    row.title = `${dateStr} ${timeStr} [${e.level}] ${e.logger}: ${e.message}`;
    logList.appendChild(row);
  }

  wrap.appendChild(logList);
  return wrap;
}


// ── Factory Reset tab ─────────────────────────────────────────────────────────
function _factoryReset(ctx, el){
  const wrap = el("div",{class:"card",style:"max-width:640px"});

  const dataMode = ctx.state.dataMode || "sample";
  const disabled = dataMode !== "live";

  // Warning banner
  wrap.appendChild(el("div",{style:"background:#3d0c0c;border:3px solid #dc2626;border-radius:12px;padding:20px;margin-bottom:16px"},[
    el("div",{style:"font-weight:900;font-size:18px;color:#fca5a5;margin-bottom:10px"},"⚠  FACTORY RESET"),
    el("div",{style:"font-size:14px;color:#fcd5d5;line-height:1.7"},[
      "This will ",
      el("strong",{style:"color:#f87171"},"permanently delete ALL PadSpan data"),
      " and return the integration to a blank state. This includes:",
    ].filter(Boolean)),
    el("ul",{style:"color:#fcd5d5;font-size:13px;line-height:1.8;margin:10px 0 0 16px"},[
      el("li",{},"All calibration points and computed models"),
      el("li",{},"All uploaded floor maps, room polygons and receiver positions"),
      el("li",{},"Room model metadata (floor assignments, colors)"),
      el("li",{},"All BLE object labels and tag names"),
      el("li",{},"All follow alerts and notification settings"),
      el("li",{},"Movement history and traceback data"),
      el("li",{},"Adaptive learning fingerprints"),
      el("li",{},"All integration settings and scanner offsets"),
      el("li",{},"All backups stored within PadSpan"),
    ]),
  ]));

  wrap.appendChild(el("div",{style:"background:#1e293b;border:1px solid #334155;border-radius:8px;padding:14px;margin-bottom:16px;font-size:13px;color:#94a3b8;line-height:1.6"},[
    el("strong",{style:"color:#e2e8f0"},"What this does NOT delete: "),
    "Home Assistant areas, floors, entities, and devices are managed by HA itself and will not be touched. ",
    "You may want to remove those separately from Settings > Devices & Services after the reset.",
  ]));

  if(disabled){
    wrap.appendChild(el("div",{style:"font-weight:700;color:#fbbf24;font-size:14px;margin-bottom:12px"},
      "⚡ Switch to Live mode to enable factory reset."
    ));
    return wrap;
  }

  // Confirmation input — user must type FACTORY RESET
  const confirmWrap = el("div",{style:"margin-bottom:16px"});
  confirmWrap.appendChild(el("div",{style:"font-size:13px;color:#94a3b8;margin-bottom:6px"},
    'To confirm, type FACTORY RESET in the box below:'
  ));

  const input = el("input",{
    type:"text",
    placeholder:"Type FACTORY RESET here",
    autocomplete:"off",
    spellcheck:"false",
    style:"width:100%;max-width:300px;padding:8px 12px;background:#0f172a;border:2px solid #475569;border-radius:6px;color:#e2e8f0;font-size:14px;font-family:monospace",
  });
  confirmWrap.appendChild(input);
  wrap.appendChild(confirmWrap);

  // Button area
  const btnWrap = el("div",{style:"display:flex;gap:12px;align-items:center"});

  const resetBtn = el("button",{
    class:"btn",
    style:"background:#7f1d1d;border:2px solid #dc2626;color:#fca5a5;font-weight:800;padding:10px 24px;font-size:14px;opacity:0.4;cursor:not-allowed",
    disabled:true,
  },"Erase All Data & Reset");

  const status = el("span",{style:"font-size:13px;color:#64748b"});

  // Enable button only when input matches
  input.addEventListener("input", ()=>{
    const match = input.value.trim() === "FACTORY RESET";
    resetBtn.disabled = !match;
    resetBtn.style.opacity = match ? "1" : "0.4";
    resetBtn.style.cursor = match ? "pointer" : "not-allowed";
  });

  // ── Progress UI (hidden until reset starts) ──
  const progressWrap = el("div",{style:"display:none;margin-top:16px"});
  const progressBar = el("div",{style:"width:100%;height:8px;background:#1e293b;border-radius:4px;overflow:hidden;margin-bottom:10px"});
  const progressFill = el("div",{style:"width:0%;height:100%;background:#52b788;border-radius:4px;transition:width 0.3s ease"});
  progressBar.appendChild(progressFill);
  progressWrap.appendChild(progressBar);
  const stepLabel = el("div",{style:"font-size:13px;color:#94a3b8;min-height:20px"});
  progressWrap.appendChild(stepLabel);
  const stepLog = el("div",{style:"font-size:11px;color:#64748b;margin-top:6px;max-height:180px;overflow-y:auto;font-family:monospace;line-height:1.7"});
  progressWrap.appendChild(stepLog);

  const _setProgress = (pct, label, isError=false) => {
    progressFill.style.width = pct + "%";
    progressFill.style.background = isError ? "#dc2626" : "#52b788";
    stepLabel.textContent = label;
    stepLabel.style.color = isError ? "#f87171" : "#94a3b8";
  };
  const _logStep = (msg, ok=true) => {
    const line = el("div",{style:"color:"+(ok?"#4ade80":"#f87171")}, (ok?"✓ ":"✗ ") + msg);
    stepLog.appendChild(line);
    stepLog.scrollTop = stepLog.scrollHeight;
  };
  const _pause = (ms=400) => new Promise(r => setTimeout(r, ms));

  resetBtn.addEventListener("click", async ()=>{
    if(input.value.trim() !== "FACTORY RESET") return;

    const sure = confirm(
      "FINAL WARNING\\n\\n" +
      "You are about to permanently erase ALL PadSpan data.\\n" +
      "This cannot be undone.\\n\\n" +
      "Are you absolutely sure?"
    );
    if(!sure) return;

    resetBtn.disabled = true;
    resetBtn.textContent = "Resetting…";
    input.disabled = true;
    progressWrap.style.display = "block";
    stepLog.innerHTML = "";

    // Block poll-triggered re-renders from destroying our progress DOM
    ctx.state._factoryResetInProgress = true;

    // ── Step 1: Send factory reset to backend (clears all 11 stores) ──
    _setProgress(15, "Erasing all backend stores…");
    let res;
    try {
      res = await ctx.actions.factoryReset();
      if(res && res.ok){
        _logStep(`Backend: ${res.cleared}/${res.total} stores cleared`);
      } else {
        const errs = (res?.errors || []).join(", ");
        _logStep(`Backend: ${res?.cleared || 0}/${res?.total || "?"} stores — errors: ${errs}`, false);
      }
    } catch(err) {
      _setProgress(15, "Backend reset failed: " + (err.message||err), true);
      _logStep("Backend reset failed: " + (err.message||err), false);
      resetBtn.textContent = "Erase All Data & Reset";
      resetBtn.disabled = false;
      input.disabled = false;
      ctx.state._factoryResetInProgress = false;
      return;
    }

    await _pause();

    // ── Step 2: Restore data_mode to "live" ──
    // Factory reset sets DEFAULT_SETTINGS which has data_mode:"sample".
    // The user was in live mode to reach this page — put them back.
    _setProgress(30, "Restoring live data mode…");
    try {
      await ctx.actions.wsCall("padspan_ha/settings_set", { data_mode: "live" });
      ctx.state.dataMode = "live";
      _logStep("Data mode restored to live");
    } catch(e){
      _logStep("Could not restore live mode: " + e.message, false);
    }

    await _pause();

    // ── Step 3: Clear browser-side caches ──
    _setProgress(45, "Clearing browser caches…");
    try {
      localStorage.removeItem("padspan_followed");
      localStorage.removeItem("padspan_followAddr");
      localStorage.removeItem("padspan_hiddenMapIds");
      _logStep("Browser localStorage cleared");
    } catch(e){
      _logStep("localStorage clear failed: " + e.message, false);
    }

    await _pause();

    // ── Step 4: Reset frontend in-memory state ──
    _setProgress(55, "Resetting frontend state…");
    try {
      ctx.state.followedAddrs = new Set();
      ctx.state.followAddr = "";
      ctx.state.objSearch = "";
      ctx.state.objKind = "all";
      ctx.state.objStatus = "all";
      ctx.state.selectedRooms = [];
      ctx.state.tagFilter = "";
      ctx.state.mode = "all";
      _logStep("Cleared: followed list, filters, selections");
    } catch(e){
      _logStep("Frontend state reset error: " + e.message, false);
    }

    await _pause();

    // ── Step 5: Verify settings on server ──
    _setProgress(70, "Verifying server state…");
    try {
      const sRes = await ctx.actions.wsCall("padspan_ha/settings_get", {});
      if(sRes?.settings){
        ctx.state.settings = sRes.settings;
        const serverFollowed = sRes.settings.followed_addrs || [];
        ctx.state.followedAddrs = new Set(serverFollowed);
        const dm = (sRes.settings.data_mode || "sample").toLowerCase();
        ctx.state.dataMode = dm === "live" ? "live" : "sample";
        _logStep(`Server: data_mode=${dm}, followed=${serverFollowed.length}`);
        if(serverFollowed.length > 0){
          _logStep("WARNING: server still has followed addresses", false);
        }
      } else {
        _logStep("Settings response empty", false);
      }
    } catch(e){
      _logStep("Settings verify failed: " + e.message, false);
    }

    await _pause();

    // ── Step 6: Fetch fresh snapshot (without re-rendering the page) ──
    _setProgress(85, "Fetching fresh snapshot…");
    try {
      const snapRes = await ctx.actions.wsCall("padspan_ha/live_snapshot", {});
      if(snapRes?.snapshot){
        ctx.state.live.snapshot = snapRes.snapshot;
        ctx.state.live.error = null;
        const objCount = snapRes.snapshot?.objects?.summary?.total ?? 0;
        const labelCount = (snapRes.snapshot?.objects?.list || []).filter(o => o.user_label).length;
        _logStep(`Snapshot: ${objCount} objects, ${labelCount} labelled`);
        if(labelCount > 0){
          _logStep("WARNING: labelled objects remain in snapshot", false);
        }
      } else {
        _logStep("Snapshot empty (BLE cache was cleared — objects will return as scanners detect them)");
      }
    } catch(e){
      _logStep("Snapshot fetch failed: " + e.message, false);
    }

    // ── Done ──
    _setProgress(100, "Factory reset complete");
    _logStep("All done. Click Reload Page to start fresh.");
    resetBtn.textContent = "Reset Complete";
    resetBtn.style.background = "#14532d";
    resetBtn.style.borderColor = "#16a34a";
    resetBtn.style.color = "#4ade80";
    ctx.state._factoryResetInProgress = false;

    const reloadBtn = el("button",{
      class:"btn",
      style:"background:#1e40af;border-color:#3b82f6;color:#93c5fd;font-weight:700;padding:8px 20px;margin-top:12px",
    },"Reload Page");
    reloadBtn.addEventListener("click",()=>location.reload());
    btnWrap.appendChild(reloadBtn);
  });

  btnWrap.appendChild(resetBtn);
  wrap.appendChild(btnWrap);
  wrap.appendChild(progressWrap);

  return wrap;
}

