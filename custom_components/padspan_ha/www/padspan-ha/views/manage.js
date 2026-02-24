// PadSpan HA – Manage view
// Standalone sidebar tab: Data management + History + Events + Health + Diagnostics + Debug

export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"manage"});
  root.className = ctx.state.view==="manage" ? "" : "hidden";

  if(!ctx.state.manageTab) ctx.state.manageTab = "data";
  const mTab = ctx.state.manageTab;
  const setTab = (t) => { ctx.state.manageTab = t; ctx.actions.renderRooms(); };

  const TABS = [
    ["data","Data"],
    ["history","History"],
    ["events","Events"],
    ["health","Health"],
    ["diagnostics","Diagnostics"],
    ["debug","Debug"],
  ];

  const tabBar = el("div",{class:"tabs",style:"margin-bottom:12px;flex-wrap:wrap;gap:4px"});
  for(const [id,label] of TABS){
    tabBar.appendChild(el("button",{class:"tab"+(mTab===id?" active":""),onclick:()=>setTab(id)},label));
  }
  root.appendChild(tabBar);

  if(mTab === "history")     { root.appendChild(_history(ctx, el));     return root; }
  if(mTab === "events")      { root.appendChild(_events(ctx, el));      return root; }
  if(mTab === "health")      { root.appendChild(_health(ctx, el));      return root; }
  if(mTab === "diagnostics") { root.appendChild(_diagnostics(ctx, el)); return root; }
  if(mTab === "debug")       { root.appendChild(_debug(ctx, el));       return root; }

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
  const entCard = el("div",{class:"card"});
  entCard.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
    el("div",{style:"font-weight:700;font-size:14px"},"HA Entities"),
    el("span",{class:"badge warn",style:"margin-left:8px"},"Destructive"),
    el("span",{class:"badge",style:"margin-left:4px"},`${entityObjs.length} found`),
  ]));
  entCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:4px"},
    "Permanently remove entities from Home Assistant's entity registry. Use this to clean up stale or duplicate tracker entities. Automations that reference removed entities will break."
  ));
  entCard.appendChild(el("div",{style:"font-size:11px;color:#78909c;margin-bottom:10px;padding:6px 8px;background:#0a150e;border-radius:6px;border:1px solid #1b3526"},
    "⚠ Entities managed by active integrations (e.g. Bermuda) will be recreated on the next integration poll. To remove permanently, disable the device or integration in HA."
  ));
  if(entityObjs.length){
    const entSearch = el("input",{type:"text",placeholder:"Filter entities…",style:"margin-bottom:8px;width:100%;box-sizing:border-box"});
    const entList   = el("div",{style:"display:flex;flex-direction:column;gap:4px;max-height:360px;overflow-y:auto"});
    const renderEntList = (filter) => {
      entList.innerHTML = "";
      const filtered = entityObjs.filter(o => !filter || o.entity_id.toLowerCase().includes(filter.toLowerCase()) || (o.name||"").toLowerCase().includes(filter.toLowerCase()));
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
            statusDiv.textContent = "✓ Removed from registry";
            statusDiv.style.color = "#52b788";
            statusDiv.style.display = "";
            btnWrap.innerHTML = "";
            ctx.toast(`Deleted: ${o.entity_id}`);
            ctx.actions.refreshSnapshot().then(()=>ctx.actions.renderRooms()).catch(()=>{});
          } catch(e){
            const errMsg = String(e).includes("not_found")
              ? "Not found in entity registry (may be recreated by its integration)"
              : String(e).slice(0,80);
            statusDiv.textContent = "✗ " + errMsg;
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
            // inline 2-click confirm — no window.confirm() needed
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
    entCard.appendChild(el("div",{class:"muted",style:"font-size:12px"},"No entities found in snapshot. Switch to Live mode to see real entities."));
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
  ctrlCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:14px"},"Low-level control over the PadSpan HA integration."));
  const ctrlGrid = el("div",{style:"display:flex;flex-direction:column;gap:10px"});

  const reloadWrap = el("div",{style:"display:flex;gap:8px;align-items:center"});
  const makeReloadBtn = ()=>{
    const b = el("button",{class:"btn"},"Reload PadSpan HA integration");
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
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:6px"},"Forces HA to reinitialize PadSpan HA without a full HA restart. Useful after config changes."),
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

// ── Health sub-tab ────────────────────────────────────────────────────────────
function _health(ctx, el){
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const rooms  = (snap?.rooms_discovered?.length) ?? Object.keys(ctx.state.roomTagMap||{}).length;
  const tags   = (snap?.tags?.length) ?? Object.values(ctx.state.roomTagMap||{}).reduce((a,b)=>a+(b?.length||0),0);
  const radios = snap?.ble?.radios?.length ?? 0;

  const wrap = el("div",{class:"grid"});
  wrap.appendChild(el("div",{class:"card"},[
    el("div",{style:"font-weight:700"},"System"),
    el("div",{class:"mono"},`UI v${ctx.state.version} • build ${ctx.state.buildId}`),
    el("div",{class:"mono"},`Data mode: ${(ctx.state.dataMode||"").toUpperCase()}`),
    el("div",{class:"mono"},`Refresh: ${ctx.state.timing?.lastRefreshMs??"—"}ms`),
  ]));
  wrap.appendChild(el("div",{class:"card"},[
    el("div",{style:"font-weight:700"},"Discovery (best-effort)"),
    el("div",{class:"mono"},`Rooms: ${rooms}`),
    el("div",{class:"mono"},`Radios: ${radios}`),
    el("div",{class:"mono"},`Objects tracked: ${(snap?.objects?.list||[]).length}`),
    el("div",{class:"mono"},`Tags: ${tags}`),
    el("div",{class:"muted",style:"margin-top:8px"},"For deeper validation, open the Diagnostics tab and paste the JSON into chat."),
  ]));
  if(snap?.ble){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{style:"font-weight:700"},"Bluetooth"),
      el("div",{class:"mono"},`Scanners: ${(snap.ble.radios||[]).length}`),
      el("div",{class:"mono"},`Advertisements: ${(snap.ble.advertisements||[]).length}`),
    ]));
  }
  return wrap;
}

// ── Diagnostics sub-tab ───────────────────────────────────────────────────────
function _diagnostics(ctx, el){
  const payload = {
    ui: { version:ctx.state.version, buildId:ctx.state.buildId, view:ctx.state.view, dataMode:ctx.state.dataMode, timing:ctx.state.timing, wsCounts:ctx.state.wsCounts },
    backend: { versionInfo:ctx.state.versionInfo, status:ctx.state.status, roomTagMap:ctx.state.roomTagMap, liveSnapshot:ctx.state.live?.snapshot, liveSources:ctx.state.live?.sources, maps:ctx.state.maps?.list },
    autoDiagnostics: ctx.state.diag,
  };
  const text = JSON.stringify(payload,null,2);

  const ta = document.createElement("textarea");
  ta.className = "mono";
  ta.setAttribute("style","width:100%;height:420px;resize:vertical;white-space:pre;overflow:auto;");
  ta.readOnly = true;
  ta.value = text;

  const selectAll = ()=>{ ta.focus(); ta.select(); };
  const btnSelect = el("button",{class:"btn"},"Select All");
  btnSelect.addEventListener("click",()=>{ selectAll(); ctx.toast("Selected. Press Ctrl/Cmd+C to copy."); });

  const btnCopy = el("button",{class:"btn"},"Copy");
  btnCopy.addEventListener("click", async()=>{
    try { await navigator.clipboard.writeText(text); ctx.toast("Copied diagnostics."); return; } catch(e){}
    try {
      const tmp = document.createElement("textarea");
      tmp.value=text; tmp.setAttribute("readonly",""); tmp.style.position="fixed"; tmp.style.left="-9999px"; tmp.style.top="0";
      document.body.appendChild(tmp); tmp.focus(); tmp.select();
      const ok = document.execCommand && document.execCommand("copy");
      document.body.removeChild(tmp);
      if(ok){ ctx.toast("Copied diagnostics."); return; }
    } catch(e2){}
    selectAll(); ctx.toast("Copy blocked by browser. Press Ctrl/Cmd+C.", true);
  });

  const wrap = el("div",{class:"grid"});
  const diagCard = el("div",{class:"card"});
  diagCard.appendChild(el("div",{style:"display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"},[
    el("div",{},[
      el("div",{style:"font-weight:700"},"Diagnostics"),
      el("div",{class:"muted"},"Paste this back into chat when something breaks."),
    ]),
    el("div",{style:"display:flex;gap:8px;align-items:center"},[btnSelect,btnCopy]),
  ]));
  diagCard.appendChild(ta);
  wrap.appendChild(diagCard);
  wrap.appendChild(el("div",{class:"card"},[
    el("div",{style:"font-weight:700"},"Install Verification"),
    el("div",{class:"muted"},"If UI/Backend versions differ, HA is serving an older install or cached JS."),
    el("div",{class:"mono"},`UI: v${ctx.state.version} • build ${ctx.state.buildId}`),
    el("div",{class:"mono"},`Backend: ${ctx.state.versionInfo?JSON.stringify(ctx.state.versionInfo):"unknown"}`),
    el("div",{class:"muted",style:"margin-top:8px"},"If backend version differs from UI, you likely have multiple installs. Remove duplicates and restart HA."),
  ]));
  return wrap;
}

// ── Debug sub-tab ─────────────────────────────────────────────────────────────
function _debug(ctx, el){
  const pre = document.createElement("pre");
  pre.className = "mono";
  pre.setAttribute("style","max-height:520px;overflow:auto");
  pre.textContent = JSON.stringify(ctx.state,(k,v)=>{ if(v instanceof Set) return Array.from(v); return v; },2);
  const card = el("div",{class:"card"},[
    el("div",{style:"font-weight:700"},"Debug (panel state)"),
    el("div",{class:"muted"},"Useful for UI-side issues (dead buttons, missing views)."),
  ]);
  card.appendChild(pre);
  return el("div",{},[card]);
}
