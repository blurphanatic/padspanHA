// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html

// ── Maps View ────────────────────────────────────────────────────────────────
//
// This file implements the Maps view — the spatial foundation of PadSpan.
// Users upload floor plan images, place BLE scanner markers, draw room
// boundaries, align multiple floors into a unified 3D stack, and export
// the result.
//
// TABS:
//   Library   — browse uploaded maps, set/change master, delete with migration
//   Upload    — client-side image resize → PNG, crop tool, send base64 to backend
//   Edit      — place receivers (BLE scanners) + draw room boundary polygons
//   3D Stack  — floor assignment table, alignment overlay editor (drag/scale/
//               rotate), Point Align solver, tie-in system, 3D isometric preview
//   Lights    — hex-grid light control overlay on floor plans
//   Export    — download PNG/SVG/JSON backups, 3D building render
//   Help      — how-it-works reference
//
// KEY DESIGN DECISIONS:
//   • All coordinates are normalized 0–1 so they survive image resizing.
//   • The "master" map is the fixed alignment anchor — all other maps are
//     positioned relative to it via translate + rotate + scale transforms.
//   • Tie-ins are stored alignment snapshots that act as constraints; the
//     conflict resolver averages or warns when new alignment diverges.
//   • Point Align uses a 6-DOF affine least-squares solver to compute
//     transform from matched point pairs (see _solvePtAlign).
//   • _ptAlign.active gates the 5s poll re-render to prevent the side-by-side
//     panels from being destroyed mid-interaction.

// ── Main Render Entry Point ──────────────────────────────────────────────────
// Dispatches to the active tab. Called every 5s by the poll cycle and on
// user-initiated state changes.
export function render(ctx){
  const { el, esc, pill, helpBtn } = ctx.helpers;
  const isBasic = ctx.state.complexity === "basic";
  const root = el("section",{id:"maps"});
  root.className = ctx.state.view==="maps" ? "" : "hidden";

  const maps = (ctx.state.maps && ctx.state.maps.list) ? ctx.state.maps.list : [];
  const activeId = ctx.state.activeMapId || (maps[0] && maps[0].id) || null;
  const active = maps.find(m=>m.id===activeId) || null;

  const tab = ctx.state.mapsTab || "library";
  const setTab = (t)=>ctx.actions.setMapsTab(t);

  // Basic mode: only Library + Upload tabs
  const tabDefs = isBasic
    ? [["library","Library"],["upload","Upload"]]
    : [["library","Library"],["upload","Upload"],["edit","Edit"],["stack","3D Stack"],["lights","Lights"],["export","Export"],["help","Help"]];

  // If current tab is not in basic tab list, reset to library
  if(isBasic && tab !== "library" && tab !== "upload"){
    ctx.state.mapsTab = "library";
  }
  const activeTab = ctx.state.mapsTab || "library";

  const tabs = el("div",{class:"tabs"}, tabDefs.map(([id,label])=>_tabBtn(id,label,activeTab,setTab)));

  const header = el("div",{class:"card"},[
    el("div",{style:"display:flex;align-items:center;gap:10px;justify-content:space-between"},[
      el("div",{},[
        el("div",{class:"card-head"},[
          el("div",{style:"font-weight:700;font-size:16px"},"Mapping"),
          helpBtn("maps"),
        ]),
        el("div",{class:"muted"}, isBasic
          ? "Upload a photo of your floor plan to visualise where your Bluetooth scanners are placed."
          : "Upload floorplans (any image type), auto-size to PNG, then place BLE receivers. Export maps + receiver layout."),
      ]),
      el("div",{style:"display:flex;gap:8px;align-items:center"},[
        el("button",{class:"btn inline", onclick:()=>ctx.actions.mapsRefresh()}, "Refresh"),
      ])
    ]),
    tabs,
  ]);

  const body = el("div",{},[
    activeTab==="library" ? _library(ctx, maps, activeId, helpBtn, isBasic) :
    activeTab==="upload" ? _upload(ctx, helpBtn, isBasic) :
    activeTab==="edit" ? _edit(ctx, active) :
    activeTab==="stack" ? _stack(ctx, maps, helpBtn) :
    activeTab==="lights" ? _lightsTab(ctx, maps, active) :
    activeTab==="export" ? _export(ctx, active, maps) :
    _help(ctx),
  ]);

  root.appendChild(header);
  root.appendChild(body);
  return root;
}

// ── Tab Button Helper ─────────────────────────────────────────────────────────
function _tabBtn(id,label,active,setTab){
  const b = document.createElement("button");
  b.className = "tab" + (active===id ? " active" : "");
  b.textContent = label;
  b.addEventListener("click", ()=>setTab(id));
  return b;
}

// Sentinel floor_id for outdoor/exterior maps — treated specially in the
// 3D stack (fitted inside the indoor bounding box rather than its own slab).
const OUTSIDE_FLOOR_ID = "__outside__";
function _isOutsideMap(m) { return (m.floor_id || "") === OUTSIDE_FLOOR_ID; }

// Resolve a floor_id to a human-readable name from the HA floor registry.
function _floorName(ctx, floor_id){
  const floors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
  const id = String(floor_id || "").trim();
  if(!id) return "—";
  if(id === OUTSIDE_FLOOR_ID) return "Outside (Exp.)";
  const f = floors.find(x=>String(x.id)===id);
  return f ? (f.name || f.id) : id;
}

// ── Library Tab ──────────────────────────────────────────────────────────────
// Lists all uploaded maps with thumbnails, master badges, and action buttons.
// Masters sort to the top. Each row shows receiver count, dimensions, floor,
// and whether a coverage gap was detected. Includes the undo-migration banner
// and the Change Master wizard launcher.
function _library(ctx, maps, activeId, helpBtn, isBasic){
  const { el } = ctx.helpers;
  helpBtn = helpBtn || (()=>null);
  const wrap = el("div",{class:"card"},[
    el("div",{class:"card-head"},[
      el("div",{style:"display:flex;align-items:center;gap:10px"},[
        el("div",{class:"muted"}, isBasic ? "Your floor plans" : "Maps Library"),
        el("div",{class:"muted"},`${maps.length} map(s)`),
      ]),
      helpBtn("maps_library"),
    ]),
  ]);

  // Sample mode: always show the demo floor plan regardless of real map count
  if(ctx.state.dataMode !== "live"){
    return _sampleDemo(ctx);
  }

  if(!maps.length){
    wrap.appendChild(el("div",{class:"muted", style:"margin-top:10px"},"No maps yet. Go to Upload tab."));
    return wrap;
  }

  const libSnap = (ctx.state.live && ctx.state.live.snapshot) || null;

  // Undo migration banner — shown after a migrate+delete, lets user revert if things look bad
  const _mig = ctx.state._lastMapMigration;
  if(_mig && (Date.now() - _mig.timestamp < 600000)){ // show for 10 minutes
    const tgtMap = maps.find(m => m.id === _mig.targetMapId);
    if(tgtMap){
      const undoBanner = el("div",{style:"margin-top:8px;padding:10px 14px;border-radius:8px;background:#2a1a0a;border:1px solid #d97706;display:flex;align-items:center;gap:10px;flex-wrap:wrap"},[
        el("div",{style:"flex:1;min-width:200px"},[
          el("div",{style:"font-weight:600;color:#fbbf24;font-size:13px"}, `Data migrated from "${_mig.srcMapName}" to "${_mig.targetMapName}"`),
          el("div",{class:"muted",style:"font-size:11px"}, "Review the target map. If things look wrong, revert the migrated data."),
        ]),
        el("button",{class:"btn inline", style:"color:#52b788;border-color:#52b788", onclick:()=>{
          ctx.actions.mapsSetActive(_mig.targetMapId);
          ctx.actions.setMapsTab('edit');
        }}, "Review map"),
        el("button",{class:"btn danger", style:"font-size:12px", onclick:async ()=>{
          if(!confirm("Remove all migrated receivers, beacons, and room outlines from the target map?")) return;
          // Remove migrated items from target map
          const m = maps.find(x => x.id === _mig.targetMapId);
          if(!m){ ctx.toast("Target map not found", true); return; }
          const mig = _mig.migrated || {};
          const movedRxLabels = new Set(mig.receivers || []);
          const movedBkLabels = new Set(mig.beacons || []);
          const movedRooms = new Set(mig.rooms || []);
          const newRx = (m.receivers||[]).filter(r => !movedRxLabels.has(r.label || r.source || r.id || ""));
          const newBk = (m.beacons||[]).filter(b => !movedBkLabels.has(b.label || b.key || ""));
          const newBounds = {};
          for(const [k,v] of Object.entries(m.room_bounds||{})){
            if(!movedRooms.has(k)) newBounds[k] = v;
          }
          await ctx.actions.mapsUpdate({
            map_id: _mig.targetMapId,
            receivers: newRx,
            calibration: m.calibration || {},
            notes: m.notes || "",
            floor_id: m.floor_id || "",
            room_bounds: newBounds,
            stack: m.stack || {},
            beacons: newBk,
          });
          // Revert canvas extension if it was applied
          if(_mig.canvasExtended){
            try {
              await ctx.actions.callWS({ type:"padspan_ha/maps_revert_extend", map_id: _mig.targetMapId });
            } catch(e){ /* best effort */ }
          }
          delete ctx.state._lastMapMigration;
          ctx.toast("Migrated data reverted");
        }}, "Revert migration"),
        el("button",{class:"btn inline", style:"font-size:11px", onclick:async ()=>{
          delete ctx.state._lastMapMigration;
          await ctx.actions.mapsRefresh();
        }}, "Dismiss"),
      ]);
      wrap.appendChild(undoBanner);
    }
  }

  // Masters first, then by name
  const sortedMaps = [...maps].sort((a,b) => (b.stack?.is_master?1:0) - (a.stack?.is_master?1:0));
  const currentMaster = maps.find(m => !!(m.stack?.is_master)) || null;
  const list = el("div",{style:"margin-top:10px;display:flex;flex-direction:column;gap:8px"});
  const wizardContainer = el("div",{});
  for(const m of sortedMaps){
    const row = el("div",{class:"maprow" + (m.id===activeId ? " active" : "")});

    // Thumbnail with room bounds + recommendation overlay
    const reco = _recommendPlacement(m.receivers||[], m.room_bounds||{}, libSnap);
    const thumb = _libraryThumb(m, ctx, reco);

    const isMaster   = !!(m.stack?.is_master);
    const isEligible = !isMaster && _isMasterEligible(m);

    // Name row: master + outside badges inline
    const nameRow = el("div",{style:"display:flex;align-items:center;gap:6px"},[
      el("div",{style:"font-weight:700"}, m.name || m.id),
      ...(isMaster ? [el("span",{style:"padding:1px 7px;border-radius:10px;background:#1a3a0a;border:1px solid #52b788;font-size:10px;color:#86efac;font-weight:600"},"⭐ Master")] : []),
      ...(_isOutsideMap(m) ? [el("span",{style:"padding:1px 7px;border-radius:10px;background:#1a2a0a;border:1px solid #6b8e23;font-size:10px;color:#9acd32;font-weight:600"},"Outside (Exp.)")] : []),
    ]);

    const left = el("div",{style:"flex:1;min-width:0"},[
      nameRow,
      el("div",{class:"muted", style:"font-size:12px"}, `${m.image?.width||0}×${m.image?.height||0} • floor: ${(_floorName(ctx,m.floor_id))} • receivers: ${(m.receivers||[]).length}`),
      el("div",{class:"muted", style:"font-size:12px"}, `updated: ${m.updated || ""}` + (reco ? " • gap detected" : "") + (isMaster ? " • alignment anchor" : "")),
    ]);

    // Master set/unset button
    let masterBtn = null;
    if(isMaster){
      masterBtn = el("button",{class:"btn inline",style:"font-size:11px;color:#94a3b8", onclick: async()=>{
        if(!confirm(`Remove master status from "${m.name||m.id}"? It will no longer be protected from modification.`)) return;
        const newStk = Object.assign({}, m.stack||{}, { is_master: false });
        await ctx.actions.mapsUpdate({ map_id:m.id, receivers:m.receivers||[], calibration:m.calibration||{}, notes:m.notes||"", floor_id:m.floor_id||"", room_bounds:m.room_bounds||{}, stack:newStk });
        ctx.toast("Master status removed");
      }}, "Unset Master");
    } else if(isEligible){
      masterBtn = el("button",{class:"btn inline",style:"font-size:10px;padding:2px 6px;color:#6b7280;border-color:#334155", onclick: async()=>{
        const _doSet = async ()=>{
          const newStk = Object.assign({}, m.stack||{}, { is_master: true, master_set_date: new Date().toISOString().slice(0,10) });
          await ctx.actions.mapsUpdate({ map_id:m.id, receivers:m.receivers||[], calibration:m.calibration||{}, notes:m.notes||"", floor_id:m.floor_id||"", room_bounds:m.room_bounds||{}, stack:newStk });
          if(currentMaster){
            const oldStk = Object.assign({}, currentMaster.stack||{}, { is_master: false });
            await ctx.actions.mapsUpdate({ map_id:currentMaster.id, receivers:currentMaster.receivers||[], calibration:currentMaster.calibration||{}, notes:currentMaster.notes||"", floor_id:currentMaster.floor_id||"", room_bounds:currentMaster.room_bounds||{}, stack:oldStk });
          }
          ctx.toast("Map set as master — it is now your alignment anchor");
        };
        if(currentMaster){
          const body = el("div",{style:"display:flex;flex-direction:column;gap:12px"},[
            el("div",{style:"padding:10px 14px;border-radius:8px;background:#3b1010;border:1px solid #dc2626"},[
              el("div",{style:"font-weight:700;color:#fca5a5;font-size:14px;margin-bottom:4px"}, "Warning: A master map is already set"),
              el("div",{style:"color:#fca5a5;font-size:12px"}, `"${currentMaster.name||currentMaster.id}" is currently the master alignment anchor.`),
            ]),
            el("div",{style:"padding:10px 14px;border-radius:8px;background:#2a1a0a;border:1px solid #d97706"},[
              el("div",{style:"font-weight:600;color:#fbbf24;font-size:12px;margin-bottom:4px"}, "Changing the master map can break your 3D stack alignment."),
              el("div",{style:"color:#fbbf24;font-size:11px"}, "All other maps are positioned relative to the master. If you change it, you may need to re-align every map in the 3D stack."),
            ]),
            el("div",{style:"color:#94a3b8;font-size:12px"}, `This will remove master from "${currentMaster.name||currentMaster.id}" and set "${m.name||m.id}" as the new master.`),
            el("div",{style:"display:flex;gap:8px;justify-content:flex-end;margin-top:4px"},[
              el("button",{class:"btn inline", onclick:()=>ctx.actions.closeModal()}, "Cancel"),
              el("button",{class:"btn danger", onclick:async ()=>{
                await _doSet();
                ctx.actions.closeModal();
                await ctx.actions.mapsRefresh();
              }}, "Replace Master"),
            ]),
          ]);
          ctx.actions.openModal("Change Master Map?", body);
        } else {
          await _doSet();
          await ctx.actions.mapsRefresh();
        }
      }}, "Set Master");
    }

    let changeMasterBtn = null;
    if(isMaster && maps.length > 1){
      changeMasterBtn = el("button",{class:"btn inline",style:"font-size:11px;color:#f59e0b;border-color:#d97706", onclick:()=>{
        wizardContainer.innerHTML = "";
        wizardContainer.appendChild(_changeMasterWizard(ctx, maps, m));
      }}, "Change Master\u2026");
    }

    const actions = el("div",{style:"display:flex;gap:8px;align-items:center;flex-shrink:0;flex-wrap:wrap"});
    if(masterBtn) actions.appendChild(masterBtn);
    if(changeMasterBtn) actions.appendChild(changeMasterBtn);
    actions.appendChild(el("button",{class:"btn inline", onclick:()=>{ ctx.actions.mapsSetActive(m.id); ctx.actions.setMapsTab('edit'); }}, "Open"));
    actions.appendChild(el("button",{class:"btn inline danger", onclick:()=>{ _deleteMapModal(ctx, m, maps); }}, "Delete"));

    row.appendChild(thumb);
    row.appendChild(left);
    row.appendChild(actions);
    list.appendChild(row);
  }
  wrap.appendChild(list);
  wrap.appendChild(wizardContainer);
  return wrap;
}

// ── Delete Map Modal ─────────────────────────────────────────────────────────
// When a map has data (receivers, beacons, room outlines), offers the option
// to migrate that data to another same-floor map before deleting. Migration
// transforms coordinates from source → world → target coordinate space using
// each map's stack transform, and optionally extends the target canvas if
// migrated items would fall outside [0,1].
function _deleteMapModal(ctx, srcMap, allMaps){
  const { el } = ctx.helpers;

  const srcRx = srcMap.receivers || [];
  const srcBk = srcMap.beacons || [];
  const srcRooms = Object.keys(srcMap.room_bounds || {});
  const srcZ = (srcMap.stack || {}).z_level || 0;
  const hasData = srcRx.length || srcBk.length || srcRooms.length;

  // Find same-z_level maps (excluding the one being deleted)
  const sameFloorMaps = allMaps.filter(m => m.id !== srcMap.id && ((m.stack || {}).z_level || 0) === srcZ);

  // No data → simple delete
  if(!hasData){
    const body = el("div",{style:"display:flex;flex-direction:column;gap:12px"},[
      el("div",{}, `This map has no receivers, beacons, or room outlines.`),
      el("div",{style:"display:flex;gap:8px;justify-content:flex-end"},[
        el("button",{class:"btn inline", onclick:()=>ctx.actions.closeModal()}, "Cancel"),
        el("button",{class:"btn danger", onclick:async ()=>{
          await ctx.actions.mapsDelete(srcMap.id);
          ctx.actions.closeModal();
          ctx.toast(`Deleted "${srcMap.name||srcMap.id}"`);
        }}, "Delete"),
      ]),
    ]);
    ctx.actions.openModal(`Delete "${srcMap.name||srcMap.id}"?`, body);
    return;
  }

  // Build data summary
  const dataBadges = [];
  if(srcRx.length) dataBadges.push(`${srcRx.length} receiver(s)`);
  if(srcBk.length) dataBadges.push(`${srcBk.length} beacon(s)`);
  if(srcRooms.length) dataBadges.push(`${srcRooms.length} room outline(s)`);

  const summary = el("div",{style:"margin-bottom:10px"},[
    el("div",{style:"font-weight:600;margin-bottom:6px;color:#f59e0b"}, "This map has data that will be lost:"),
    el("div",{style:"display:flex;flex-wrap:wrap;gap:6px"},
      dataBadges.map(b => el("span",{class:"badge warn"}, b))
    ),
  ]);

  // No same-floor targets → can only delete outright
  if(!sameFloorMaps.length){
    const body = el("div",{style:"display:flex;flex-direction:column;gap:12px"},[
      summary,
      el("div",{class:"muted"}, "No other maps on this floor to migrate data to."),
      el("div",{style:"display:flex;gap:8px;justify-content:flex-end"},[
        el("button",{class:"btn inline", onclick:()=>ctx.actions.closeModal()}, "Cancel"),
        el("button",{class:"btn danger", onclick:async ()=>{
          await ctx.actions.mapsDelete(srcMap.id);
          ctx.actions.closeModal();
          ctx.toast(`Deleted "${srcMap.name||srcMap.id}" and all its data`);
        }}, "Delete anyway"),
      ]),
    ]);
    ctx.actions.openModal(`Delete "${srcMap.name||srcMap.id}"?`, body);
    return;
  }

  // Has same-floor targets → show migration option
  const targetSel = document.createElement("select");
  targetSel.style.cssText = "padding:6px 10px;border-radius:6px;border:1px solid #334;background:#0a1a10;color:#e2e8f0;width:100%";
  for(const tm of sameFloorMaps){
    const opt = document.createElement("option");
    opt.value = tm.id;
    opt.textContent = `${tm.name || tm.id} (${(tm.receivers||[]).length} receivers, ${Object.keys(tm.room_bounds||{}).length} rooms)`;
    targetSel.appendChild(opt);
  }

  // Canvas extension checkbox (shown when needed)
  const extendCheckbox = document.createElement("input");
  extendCheckbox.type = "checkbox";
  extendCheckbox.checked = false;
  extendCheckbox.disabled = true;
  extendCheckbox.id = "_mig_extend_cb";
  const extendLabel = el("label",{for:"_mig_extend_cb", style:"display:none;font-size:12px;color:#7dd3fc;cursor:pointer;align-items:center;gap:6px"},[
    extendCheckbox,
    el("span",{}, "Extend target map canvas to fit migrated data"),
  ]);
  const extendNote = el("div",{class:"muted", style:"display:none;font-size:11px;margin-top:2px"});

  // Preview what will migrate vs skip
  const previewDiv = el("div",{style:"margin-top:8px"});
  const updatePreview = () => {
    const tgtId = targetSel.value;
    const tgt = sameFloorMaps.find(m => m.id === tgtId);
    if(!tgt){ previewDiv.innerHTML = ""; return; }

    const tgtRxSources = new Set((tgt.receivers||[]).map(r=>r.source||r.id||"").filter(Boolean));
    const tgtBkKeys = new Set((tgt.beacons||[]).map(b=>b.key||"").filter(Boolean));
    const tgtRoomNames = new Set(Object.keys(tgt.room_bounds||{}));

    const willMove = [];
    const willSkip = [];

    for(const rx of srcRx){
      const k = rx.source || rx.id || "";
      const lbl = rx.label || k;
      if(k && tgtRxSources.has(k)) willSkip.push(`Receiver: ${lbl} (already on target)`);
      else willMove.push(`Receiver: ${lbl}`);
    }
    for(const bk of srcBk){
      const k = bk.key || "";
      const lbl = bk.label || k;
      if(k && tgtBkKeys.has(k)) willSkip.push(`Beacon: ${lbl} (already on target)`);
      else willMove.push(`Beacon: ${lbl}`);
    }
    for(const rm of srcRooms){
      if(tgtRoomNames.has(rm)) willSkip.push(`Room: ${rm} (already drawn on target)`);
      else willMove.push(`Room: ${rm}`);
    }

    // Check if any migrated coords would fall outside [0,1] on target
    // Transform source map coords → world coords → target map coords to check
    // if migrated items would fall outside the target's [0,1] canvas.
    // This mirrors the backend's coordinate transform pipeline.
    const srcStk = srcMap.stack || {};
    const tgtStk = tgt.stack || {};
    // Map-local (0–1) → world (shared coordinate space via stack transform)
    const _mapToWorld = (px, py, stk) => {
      const sc = stk.scale||1, sx = stk.scale_x_adj||1, ar = stk.ref_ar||1;
      const ox = stk.x_offset||0, oy = stk.y_offset||0;
      const r = (stk.rotation||0)*Math.PI/180;
      const dx=(px-0.5)*sc*sx, dy=(py-0.5)*sc*ar;
      return [(0.5+ox)+dx*Math.cos(r)-dy*Math.sin(r), ar*(0.5+oy)+dx*Math.sin(r)+dy*Math.cos(r)];
    };
    // World → map-local (inverse of _mapToWorld)
    const _worldToMap = (wx, wy, stk) => {
      const sc = stk.scale||1, sx = stk.scale_x_adj||1, ar = stk.ref_ar||1;
      const ox = stk.x_offset||0, oy = stk.y_offset||0;
      const r = (stk.rotation||0)*Math.PI/180;
      const rx2=wx-(0.5+ox), ry2=wy-ar*(0.5+oy);
      const dx2=rx2*Math.cos(-r)-ry2*Math.sin(-r);
      const dy2=rx2*Math.sin(-r)+ry2*Math.cos(-r);
      return [dx2/(sc*sx||1e-9)+0.5, dy2/(sc*ar||1e-9)+0.5];
    };

    let hasOutOfBounds = false;
    const allPts = [];
    for(const rx of srcRx){
      const k = rx.source || rx.id || "";
      if(k && tgtRxSources.has(k)) continue;
      const [wx,wy] = _mapToWorld(rx.x||0.5, rx.y||0.5, srcStk);
      allPts.push(_worldToMap(wx, wy, tgtStk));
    }
    for(const bk of srcBk){
      const k = bk.key || "";
      if(k && tgtBkKeys.has(k)) continue;
      const [wx,wy] = _mapToWorld(bk.x||0.5, bk.y||0.5, srcStk);
      allPts.push(_worldToMap(wx, wy, tgtStk));
    }
    for(const rm of srcRooms){
      if(tgtRoomNames.has(rm)) continue;
      const b = (srcMap.room_bounds||{})[rm];
      if(b && b.type === "poly" && b.points){
        for(const p of b.points){
          const [wx,wy] = _mapToWorld(p[0], p[1], srcStk);
          allPts.push(_worldToMap(wx, wy, tgtStk));
        }
      } else if(b && b.type === "circle"){
        const [wx,wy] = _mapToWorld(b.cx||0.5, b.cy||0.5, srcStk);
        allPts.push(_worldToMap(wx, wy, tgtStk));
      }
    }
    if(allPts.length){
      const xs = allPts.map(p=>p[0]), ys = allPts.map(p=>p[1]);
      hasOutOfBounds = Math.min(...xs) < -0.01 || Math.max(...xs) > 1.01 || Math.min(...ys) < -0.01 || Math.max(...ys) > 1.01;
    }

    previewDiv.innerHTML = "";
    if(willMove.length){
      previewDiv.appendChild(el("div",{style:"font-size:12px;color:#52b788;margin-bottom:4px;font-weight:600"}, `Will migrate (${willMove.length}):`));
      previewDiv.appendChild(el("div",{style:"font-size:11px;color:#86efac;max-height:120px;overflow-y:auto;padding-left:8px"},
        willMove.map(m => el("div",{}, m))
      ));
    }
    if(willSkip.length){
      previewDiv.appendChild(el("div",{style:"font-size:12px;color:#f59e0b;margin-top:6px;margin-bottom:4px;font-weight:600"}, `Will skip (${willSkip.length}):`));
      previewDiv.appendChild(el("div",{style:"font-size:11px;color:#fbbf24;max-height:80px;overflow-y:auto;padding-left:8px"},
        willSkip.map(m => el("div",{}, m))
      ));
    }
    if(!willMove.length && !willSkip.length){
      previewDiv.appendChild(el("div",{class:"muted"}, "Nothing to migrate."));
    }

    // Canvas extension notice
    if(hasOutOfBounds && willMove.length){
      extendCheckbox.checked = true;
      extendCheckbox.disabled = false;
      extendLabel.style.display = "flex";
      extendNote.textContent = "Some data falls outside the target map. The canvas will be extended to fit.";
      extendNote.style.display = "";
    } else {
      extendCheckbox.checked = false;
      extendCheckbox.disabled = true;
      extendLabel.style.display = "none";
      extendNote.style.display = "none";
    }
  };
  targetSel.addEventListener("change", updatePreview);
  // Initial preview
  setTimeout(updatePreview, 0);

  const statusDiv = el("div",{style:"min-height:20px"});

  const body = el("div",{style:"display:flex;flex-direction:column;gap:12px"},[
    summary,
    el("div",{},[
      el("div",{style:"font-weight:600;margin-bottom:6px"}, "Migrate data to:"),
      targetSel,
    ]),
    previewDiv,
    extendLabel,
    extendNote,
    statusDiv,
    el("div",{style:"display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"},[
      el("button",{class:"btn inline", onclick:()=>ctx.actions.closeModal()}, "Cancel"),
      el("button",{class:"btn danger", onclick:async ()=>{
        await ctx.actions.mapsDelete(srcMap.id);
        ctx.actions.closeModal();
        ctx.toast(`Deleted "${srcMap.name||srcMap.id}" — data was NOT migrated`);
      }}, "Delete without migrating"),
      el("button",{class:"btn", style:"background:#1a3a2a;border-color:#52b788;color:#52b788", onclick:async ()=>{
        const tgtId = targetSel.value;
        statusDiv.textContent = "Migrating...";
        try {
          const result = await ctx.actions.mapsDeleteMigrate(srcMap.id, tgtId, extendCheckbox.checked);
          const mig = (result && result.migrated) || {};
          const skip = (result && result.skipped) || {};
          const parts = [];
          if((mig.receivers||[]).length) parts.push(`${mig.receivers.length} receivers`);
          if((mig.beacons||[]).length) parts.push(`${mig.beacons.length} beacons`);
          if((mig.rooms||[]).length) parts.push(`${mig.rooms.length} rooms`);
          if(mig.calibration_points) parts.push(`${mig.calibration_points} cal points`);
          const skipParts = [];
          if((skip.receivers||[]).length) skipParts.push(`${skip.receivers.length} receivers`);
          if((skip.beacons||[]).length) skipParts.push(`${skip.beacons.length} beacons`);
          if((skip.rooms||[]).length) skipParts.push(`${skip.rooms.length} rooms`);

          // Store migration info for undo button
          const tgtMap = sameFloorMaps.find(m => m.id === tgtId);
          ctx.state._lastMapMigration = {
            targetMapId: tgtId,
            targetMapName: tgtMap ? (tgtMap.name||tgtMap.id) : tgtId,
            srcMapName: srcMap.name || srcMap.id,
            migrated: mig,
            canvasExtended: !!(result && result.canvas_extended),
            timestamp: Date.now(),
          };

          ctx.actions.closeModal();
          let msg = `Deleted "${srcMap.name||srcMap.id}"`;
          if(parts.length) msg += ` — migrated ${parts.join(", ")}`;
          if(result && result.canvas_extended) msg += " (canvas extended)";
          if(skipParts.length) msg += ` (skipped: ${skipParts.join(", ")})`;
          ctx.toast(msg);
        } catch(e) {
          statusDiv.textContent = `Error: ${e.message || e}`;
          statusDiv.style.color = "#f87171";
        }
      }}, "Migrate & Delete"),
    ]),
  ]);
  ctx.actions.openModal(`Delete "${srcMap.name||srcMap.id}"?`, body, "This map has data — migrate it to another map first?");
}

// ── Upload Tab ───────────────────────────────────────────────────────────────
// Accepts any image type (PNG/JPG/WebP/GIF/SVG), resizes client-side to a max
// dimension, converts to PNG via canvas, and sends base64 to the backend.
// Includes a drag-to-crop tool and floor selector (from HA Area Registry).
// The selected file is stored on ctx.state so it survives poll-triggered
// DOM rebuilds (the file input element gets destroyed on re-render).
function _upload(ctx, helpBtn, isBasic){
  helpBtn = helpBtn || (()=>null);
  const { el } = ctx.helpers;
  const card = el("div",{class:"card"});
  card.appendChild(el("div",{class:"card-head"},[
    el("div",{class:"h2"}, isBasic ? "Upload a floor plan" : "Upload floor plan"),
    helpBtn("maps_upload"),
  ]));

  // First-upload tip: shown only when no maps exist yet
  if(!(ctx.state.maps?.list||[]).length){
    card.appendChild(el("div",{style:"margin:10px 0 4px;padding:10px 12px;border-radius:8px;background:#0a1a0a;border:1px solid #52b788;font-size:12px;color:#86efac;line-height:1.6"},
      "💡 First map tip — Upload your most precise, to-scale floor plan first. " +
      "All other maps will be spatially anchored to it, so accuracy starts here. " +
      "After upload you can designate it as Master in the Library to protect it from accidental modification."
    ));
  }
  card.appendChild(el("div",{class:"muted",style:"margin-bottom:10px"}, isBasic
    ? "Take a photo of your house plan (or use any image). Give it a name and click Upload."
    : "Upload floorplan image (PNG/JPG/WebP/GIF/SVG). We'll auto-resize and store as optimized PNG for mapping."));

  const floors = (ctx.state.model && ctx.state.model.floors) ? ctx.state.model.floors : [];
  const floorSel = document.createElement("select");
  floorSel.className = "select";
  for(const f of floors){
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.name || f.id;
    floorSel.appendChild(opt);
  }
  // Always offer "Outside" option
  const _outsideOpt = document.createElement("option");
  _outsideOpt.value = OUTSIDE_FLOOR_ID; _outsideOpt.textContent = "Outside (Experimental)";
  floorSel.appendChild(_outsideOpt);
  if(!floorSel.value && floors[0]) floorSel.value = floors[0].id;

  const name = el("input",{type:"text", placeholder:"Map name (e.g., Main Floor)"});
  const maxw = el("input",{type:"text", placeholder:"Max size (e.g., 1600). Default 1600"});
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/*";

  const status = el("div",{class:"mono", style:"margin-top:10px"}, "\u2014");

  // ── Crop / trim tool ───────────────────────────────────────────────────────
  // Shown after a file is selected; drag on the preview to select a crop region.
  let cropRect = null; // {fx0,fy0,fx1,fy1} in 0-1 image-fraction, or null = full
  let _imgNatW = 0, _imgNatH = 0, _isDragging = false;
  let _dx0=0, _dy0=0, _dx1=0, _dy1=0;

  const previewOuter = el("div",{style:"display:none;margin-top:14px"});
  const previewWrap  = el("div",{style:"position:relative;display:inline-block;max-width:100%;border:1px solid #253e2e;border-radius:6px;overflow:hidden"});
  const previewImg   = document.createElement("img");
  previewImg.style.cssText = "display:block;max-width:100%;max-height:260px";
  const cropCanvas   = document.createElement("canvas");
  cropCanvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair";
  const cropInfo     = el("div",{class:"muted",style:"font-size:11px;margin-top:5px"}, "");
  const cropClearBtn = el("button",{class:"btn tiny",style:"margin-top:6px"}, "Reset Crop");

  function _ccFrac(clientX, clientY){
    const r = cropCanvas.getBoundingClientRect();
    return [Math.max(0,Math.min(1,(clientX-r.left)/r.width)), Math.max(0,Math.min(1,(clientY-r.top)/r.height))];
  }
  function _drawCropOverlay(){
    const cw=cropCanvas.width, ch=cropCanvas.height;
    if(!cw||!ch) return;
    const g2=cropCanvas.getContext("2d");
    g2.clearRect(0,0,cw,ch);
    if(cropRect){
      const {fx0,fy0,fx1,fy1}=cropRect;
      const px0=fx0*cw, py0=fy0*ch, pw=(fx1-fx0)*cw, ph=(fy1-fy0)*ch;
      g2.fillStyle="rgba(0,0,0,0.5)"; g2.fillRect(0,0,cw,ch);
      g2.clearRect(px0,py0,pw,ph);
      g2.strokeStyle="#52b788"; g2.lineWidth=Math.max(1,cw/400); g2.strokeRect(px0,py0,pw,ph);
      const hs=Math.max(4,cw/100);
      g2.fillStyle="#52b788";
      for(const [hx,hy] of [[px0,py0],[px0+pw,py0],[px0,py0+ph],[px0+pw,py0+ph]])
        g2.fillRect(hx-hs/2,hy-hs/2,hs,hs);
      cropInfo.textContent=`Crop: ${Math.round(_imgNatW*(fx1-fx0))}\u00d7${Math.round(_imgNatH*(fy1-fy0))} px  (original: ${_imgNatW}\u00d7${_imgNatH}) \u2014 drag to adjust`;
    } else {
      cropInfo.textContent=`Full image: ${_imgNatW}\u00d7${_imgNatH} px \u2014 drag to select a crop region`;
    }
  }
  function _updateCropFromDrag(){
    const fx0=Math.min(_dx0,_dx1), fy0=Math.min(_dy0,_dy1);
    const fx1=Math.max(_dx0,_dx1), fy1=Math.max(_dy0,_dy1);
    cropRect=(fx1-fx0>0.015&&fy1-fy0>0.015)?{fx0,fy0,fx1,fy1}:null;
    _drawCropOverlay();
  }
  cropCanvas.addEventListener("mousedown",  e=>{ _isDragging=true;  [_dx0,_dy0]=_ccFrac(e.clientX,e.clientY); _dx1=_dx0;_dy1=_dy0; e.preventDefault(); });
  cropCanvas.addEventListener("mousemove",  e=>{ if(!_isDragging)return; [_dx1,_dy1]=_ccFrac(e.clientX,e.clientY); _updateCropFromDrag(); });
  cropCanvas.addEventListener("mouseup",    ()=>{ _isDragging=false; });
  cropCanvas.addEventListener("mouseleave", ()=>{ _isDragging=false; });
  cropCanvas.addEventListener("touchstart", e=>{ const t=e.touches[0]; _isDragging=true; [_dx0,_dy0]=_ccFrac(t.clientX,t.clientY); _dx1=_dx0;_dy1=_dy0; e.preventDefault(); },{passive:false});
  cropCanvas.addEventListener("touchmove",  e=>{ if(!_isDragging)return; const t=e.touches[0]; [_dx1,_dy1]=_ccFrac(t.clientX,t.clientY); _updateCropFromDrag(); e.preventDefault(); },{passive:false});
  cropCanvas.addEventListener("touchend",   ()=>{ _isDragging=false; });
  cropClearBtn.addEventListener("click",    ()=>{ cropRect=null; _drawCropOverlay(); });

  // Capture selected file on ctx.state so it survives poll-triggered DOM rebuilds.
  // The file input DOM element gets destroyed on re-render, losing the selected file.
  // Also set _mapsUploadFile flag to block re-renders while file is selected.
  file.addEventListener("change", ()=>{
    if(!file.files||!file.files[0]) return;
    ctx.state._mapsUploadFile = file.files[0];
    if(!name.value) name.value=ctx.state._mapsUploadFile.name.replace(/\.[^.]+$/,"");
    const objUrl=URL.createObjectURL(ctx.state._mapsUploadFile);
    previewImg.onload=()=>{
      URL.revokeObjectURL(objUrl);
      _imgNatW=previewImg.naturalWidth; _imgNatH=previewImg.naturalHeight;
      const cs=Math.min(1,1600/Math.max(_imgNatW,_imgNatH));
      cropCanvas.width=Math.round(_imgNatW*cs); cropCanvas.height=Math.round(_imgNatH*cs);
      cropRect=null; _drawCropOverlay();
      previewOuter.style.display="";
    };
    previewImg.onerror=()=>{
      URL.revokeObjectURL(objUrl);
      ctx.state._mapsUploadFile = null;
      status.textContent = "Could not load image. Supported formats: PNG, JPG, GIF, BMP, WebP, SVG.";
      status.style.color = "#f87171";
    };
    previewImg.src=objUrl;
  });

  previewWrap.appendChild(previewImg);
  previewWrap.appendChild(cropCanvas);
  previewOuter.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:6px"},
    "Preview \u2014 drag to select a crop/trim region (optional):"));
  previewOuter.appendChild(previewWrap);
  previewOuter.appendChild(cropClearBtn);
  previewOuter.appendChild(cropInfo);

  const btn = el("button",{class:"btn inline", onclick: async ()=>{
    // Use file from ctx.state (survives re-renders), with file input as fallback
    const f = ctx.state._mapsUploadFile || (file.files && file.files[0]);
    if(!f){ status.textContent = "Pick an image file first. Supported: PNG, JPG, GIF, BMP, WebP, SVG."; return; }
    let floor_id = (floorSel.value||"").trim();
    if(!floor_id){ status.textContent = "Choose a floor before uploading."; return; }
    if(floor_id === OUTSIDE_FLOOR_ID){
      const existingMaps = ctx.state.maps?.list || [];
      if(existingMaps.some(m => m.floor_id === OUTSIDE_FLOOR_ID)){
        status.textContent = "Only one Outside map is allowed. Delete the existing one first.";
        return;
      }
    }
    status.textContent = "Reading\u2026";
    status.style.color = "";
    try{
      const max = parseInt((maxw.value||"").trim() || "1600", 10);
      const res = await _preparePng(f, isFinite(max) ? max : 1600, cropRect);
      status.textContent = `Uploading\u2026 (${res.width}\u00d7${res.height})`;
      const uploadRes = await ctx.actions.mapsUpload({
        name: (name.value||f.name||"Map"),
        filename: f.name,
        mime: f.type || "image/*",
        width: res.width,
        height: res.height,
        png_base64: res.pngBase64,
        floor_id,
      });
      status.textContent = "Uploaded \u2714";
      ctx.state._mapsUploadFile = null;
      // Open the newly uploaded map in the edit tab
      if(uploadRes?.map?.id) ctx.state.activeMapId = uploadRes.map.id;
      ctx.state.mapsTab = "edit";
      ctx.actions.renderRooms();
    }catch(e){
      status.textContent = "Upload failed: " + String(e);
    }
  }}, "Upload & Convert");

  card.appendChild(el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-top:10px"},[
    el("div",{},[ el("div",{class:"muted",style:"font-size:12px;margin-bottom:4px"},"Floor (from HA)"), floorSel ]),
    el("div",{class:"muted",style:"font-size:12px;align-self:flex-end;padding-bottom:4px"}, "Manage floors in HA Settings \u2192 Areas & Zones"),
  ]));

  card.appendChild(name);
  card.appendChild(maxw);
  card.appendChild(file);
  card.appendChild(previewOuter);
  card.appendChild(btn);
  card.appendChild(status);

  // Restore preview if a file was already selected from a previous render cycle
  if(ctx.state._mapsUploadFile && !previewImg.src){
    const f = ctx.state._mapsUploadFile;
    if(!name.value) name.value = f.name.replace(/\.[^.]+$/,"");
    const objUrl = URL.createObjectURL(f);
    previewImg.onload = ()=>{
      URL.revokeObjectURL(objUrl);
      _imgNatW=previewImg.naturalWidth; _imgNatH=previewImg.naturalHeight;
      const cs=Math.min(1,1600/Math.max(_imgNatW,_imgNatH));
      cropCanvas.width=Math.round(_imgNatW*cs); cropCanvas.height=Math.round(_imgNatH*cs);
      cropRect=null; _drawCropOverlay();
      previewOuter.style.display="";
    };
    previewImg.src = objUrl;
    status.textContent = `File selected: ${f.name} (${Math.round(f.size/1024)} KB)`;
  }

  card.appendChild(el("div",{class:"muted", style:"margin-top:12px;font-size:12px"},
    "Best practice: upload one map per floor. Floors let you keep room placement clean and avoid mixing levels."
  ));

  return card;
}


// ── Image Processing Helpers ─────────────────────────────────────────────────

// Reads a File object, optionally crops it, constrains to maxDim, and returns
// {width, height, pngBase64}. All image processing happens client-side via
// an offscreen <canvas> — no server round-trip for resize/convert.
async function _preparePng(file, maxDim, crop=null){
  const buf = await file.arrayBuffer();
  const blob = new Blob([buf], {type: file.type || "image/*"});
  const url = URL.createObjectURL(blob);
  try{
    const img = await _loadImage(url);
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;

    // Apply crop/trim if set (fx0,fy0,fx1,fy1 are 0-1 fractions of the image)
    let srcX=0, srcY=0, srcW=w, srcH=h;
    if(crop && crop.fx1>crop.fx0 && crop.fy1>crop.fy0){
      srcX = Math.round(w*crop.fx0);
      srcY = Math.round(h*crop.fy0);
      srcW = Math.max(1, Math.round(w*(crop.fx1-crop.fx0)));
      srcH = Math.max(1, Math.round(h*(crop.fy1-crop.fy0)));
    }

    // constrain to maxDim
    const scale = Math.min(1, maxDim / Math.max(srcW,srcH));
    const tw = Math.max(1, Math.round(srcW*scale));
    const th = Math.max(1, Math.round(srcH*scale));

    const canvas = document.createElement("canvas");
    canvas.width = tw; canvas.height = th;
    const g = canvas.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, tw, th);

    const pngBlob = await new Promise((resolve)=>canvas.toBlob(resolve, "image/png", 0.92));
    const ab = await pngBlob.arrayBuffer();
    const b64 = _arrayBufferToBase64(ab);
    return { width: tw, height: th, pngBase64: b64 };
  }finally{
    URL.revokeObjectURL(url);
  }
}

// Convert ArrayBuffer to base64 string. Processes in 32KB chunks to avoid
// exceeding the max argument count for String.fromCharCode.apply().
function _arrayBufferToBase64(buffer){
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for(let i=0;i<bytes.length;i+=chunkSize){
    const chunk = bytes.subarray(i, i+chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function _loadImage(url){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = ()=>resolve(img);
    img.onerror = (e)=>reject(new Error("Image decode failed"));
    img.src = url;
  });
}

// Like _preparePng but loads from a URL (for trim/bake operations on
// already-uploaded map images that are served by HA at /local/...).
async function _preparePngFromUrl(imgUrl, maxDim, crop=null){
  const img = await _loadImage(imgUrl);
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;

  let srcX=0, srcY=0, srcW=w, srcH=h;
  if(crop && crop.fx1>crop.fx0 && crop.fy1>crop.fy0){
    srcX = Math.round(w*crop.fx0);
    srcY = Math.round(h*crop.fy0);
    srcW = Math.max(1, Math.round(w*(crop.fx1-crop.fx0)));
    srcH = Math.max(1, Math.round(h*(crop.fy1-crop.fy0)));
  }

  const scale = Math.min(1, maxDim/Math.max(srcW,srcH));
  const tw = Math.max(1, Math.round(srcW*scale));
  const th = Math.max(1, Math.round(srcH*scale));

  const canvas = document.createElement("canvas");
  canvas.width=tw; canvas.height=th;
  const g=canvas.getContext("2d");
  g.imageSmoothingEnabled=true;
  g.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, tw, th);

  const pngBlob = await new Promise(r=>canvas.toBlob(r,"image/png",0.92));
  const ab = await pngBlob.arrayBuffer();
  const b64 = _arrayBufferToBase64(ab);
  return {width:tw, height:th, pngBase64:b64};
}

// ── Edit Tab ─────────────────────────────────────────────────────────────────
// Full map editor with two modes:
//   Receivers mode — double-click to place BLE scanner markers, drag to
//                    reposition, assign room from HA Area Registry, auto-detect
//                    live BLE radios for one-click placement.
//   Rooms mode    — click to draw polygon room boundaries, auto-circle fallback
//                    for rooms with assigned receivers but no polygon yet.
//
// Draft state is kept on ctx.state.maps._draft* so edits survive tab switches
// within the same session. Changes are only persisted on explicit "Save Layout".
// Also includes Trim Image and Rotate Image sub-panels.
function _edit(ctx, map){
  const { el, roomColor } = ctx.helpers;
  const card = el("div",{class:"card"});

  if(!map){
    card.appendChild(el("div",{class:"muted"},"No map selected. Go to Library or Upload tab."));
    return card;
  }

  const floors = (ctx.state.model && ctx.state.model.floors) ? ctx.state.model.floors : [];
  const floorById = (id)=>floors.find(f=>f.id===id) || null;

  // --- Draft state (per-map) ---
  // Reset drafts when switching to a different map. Drafts are mutable copies
  // of the map's saved data; the original is untouched until "Save Layout".
  if(!ctx.state.maps._draftReceivers || ctx.state.maps._draftMapId !== map.id){
    ctx.state.maps._draftReceivers = (map.receivers||[]).map(r=>({
      id: r.id||"",
      label: r.label||"",
      x: Number(r.x||0),
      y: Number(r.y||0),
      room: r.room || "",
      source: r.source || ""
    }));
    // Backfill: older receivers may lack a `source` field (MAC address).
    // Match by label against live BLE radios and persist the backfill so
    // future stale-receiver checks can work reliably.
    const _snap = (ctx.state.live && ctx.state.live.snapshot) || null;
    const _radios = (_snap && _snap.ble && Array.isArray(_snap.ble.radios)) ? _snap.ble.radios : [];
    if(_radios.length){
      let _backfilled = false;
      for(const dr of ctx.state.maps._draftReceivers){
        if(dr.source) continue;
        const match = _radios.find(r => (r.name && dr.label && r.name.toLowerCase() === dr.label.toLowerCase()) || r.source === dr.id);
        if(match){ dr.source = match.source; _backfilled = true; }
      }
      // Persist backfill to backend so it sticks
      if(_backfilled){
        const _bfRx = ctx.state.maps._draftReceivers;
        ctx.actions.mapsUpdate({ map_id: map.id, receivers: _bfRx, calibration: map.calibration||{}, notes: map.notes||"" }).catch(()=>{});
      }
    }
    ctx.state.maps._draftRoomBounds = JSON.parse(JSON.stringify(map.room_bounds||{}));
    ctx.state.maps._draftFloorId = map.floor_id || (floors[0] && floors[0].id) || "main";
    ctx.state.maps._draftMapId = map.id;
    ctx.state.maps._selectedRxId = null;
    ctx.state.maps._mode = "receivers"; // receivers | rooms
    ctx.state.maps._selectedRoom = "";
    ctx.state.maps._drawing = null; // {room, points:[]}
    ctx.state.maps._recommendPoly = null;
  }

  // Cache-buster: map.updated changes on every trim/replace so the browser fetches fresh content
  const _imgV = (map.updated||map.image?.sha256||'').replace(/[^a-zA-Z0-9]/g,'').slice(0,16);
  const url = map.image && map.image.filename
    ? `/local/padspan_ha/maps/${map.image.filename}${_imgV ? '?v='+_imgV : ''}`
    : null;

  // Rooms eligible for this map's floor
  const areaNames = (ctx.state.model?.areas || []).map(a => a.name);
  const tagMapNames = Object.keys(ctx.state.roomTagMap || {});
  const allRooms = [...new Set([...areaNames, ...tagMapNames])].sort();
  const mapFloorId = ctx.state.maps._draftFloorId || "main";
  const eligibleRooms = allRooms.filter(r=>{
    const meta = ctx.state.model?.room_meta?.[r];
    const fid = meta?.floor_id || mapFloorId;
    return fid === mapFloorId;
  });

  const titleBtns = el("div",{style:"display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end"},[
    el("div",{class:"muted", style:"font-size:12px"},"Floor:"),
    _floorSelect(floors, mapFloorId, async (fid)=>{
      ctx.state.maps._draftFloorId = fid;
      // If selected room is no longer eligible, clear it
      if(ctx.state.maps._selectedRoom && !eligibleRooms.includes(ctx.state.maps._selectedRoom)){
        ctx.state.maps._selectedRoom = "";
        ctx.state.maps._drawing = null;
      }
      ctx.actions.renderRooms();
    }),
    el("button",{class:"btn inline", onclick:()=>{ ctx.actions.mapsSetActive(map.id); ctx.actions.setMapsTab('library'); }}, "Back"),
  ]);
  const title = el("div",{style:"display:flex;justify-content:space-between;align-items:center;gap:10px"},[
    el("div",{},[
      el("div",{style:"font-weight:700"}, `Edit: ${map.name || map.id}`),
      el("div",{class:"muted", style:"font-size:12px"}, "Place receivers and then draw room boundaries. Save when done."),
    ]),
    titleBtns,
  ]);

  // --- Stage ---
  const stage = document.createElement("div");
  stage.className = "mapstage";

  const img = new Image();
  img.className = "mapimg";
  if(url) img.src = url;

  const overlay = document.createElement("div");
  overlay.className = "mapoverlay";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class","mapvector");
  svg.setAttribute("viewBox","0 0 1 1");
  svg.setAttribute("preserveAspectRatio","none");

  overlay.appendChild(svg);
  stage.appendChild(img);
  stage.appendChild(overlay);

  // --- Right panel (tools) ---
  const right = el("div",{class:"card", style:"margin-top:10px"},[]);
  const modeRow = el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center"},[
    el("button",{class:"btn inline"+(ctx.state.maps._mode==="receivers"?" primary":""), onclick:()=>{ ctx.state.maps._mode="receivers"; ctx.state.maps._drawing=null; renderAll(); renderTools(); }}, "Radios"),
    el("button",{class:"btn inline"+(ctx.state.maps._mode==="rooms"?" primary":""), onclick:()=>{ ctx.state.maps._mode="rooms"; ctx.state.maps._selectedRxId=null; renderAll(); renderTools(); }}, "Rooms"),
    el("span",{class:"muted", style:"font-size:12px"}, ctx.state.maps._mode==="receivers" ? "Double-click map to place radio; drag to reposition" : "Click map to add points; double-click to finish"),
  ]);

  const saveRow = el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;margin-top:10px"},[
    el("button",{class:"btn inline", onclick:async (e)=>{
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = "Saving…";
      try{
        await ctx.actions.mapsUpdate({
          map_id: map.id,
          receivers: ctx.state.maps._draftReceivers,
          room_bounds: ctx.state.maps._draftRoomBounds,
          floor_id: ctx.state.maps._draftFloorId,
          calibration: map.calibration||{},
          notes: map.notes||""
        });
        ctx.toast("Layout saved ✔");
      }catch(err){ ctx.toast("Save failed: "+String(err), true); }
      btn.disabled = false; btn.textContent = "Save Layout";
    }}, "Save Layout"),
    el("button",{class:"btn inline", onclick:()=>{
      // reset drafts from last saved map
      ctx.state.maps._draftReceivers = (map.receivers||[]).map(r=>({id:r.id||"", label:r.label||"", x:Number(r.x||0), y:Number(r.y||0), room:r.room||"", source:r.source||""}));
      ctx.state.maps._draftRoomBounds = JSON.parse(JSON.stringify(map.room_bounds||{}));
      ctx.state.maps._drawing = null;
      ctx.state.maps._selectedRxId = null;
      ctx.state.maps._selectedRoom = "";
      renderAll(); renderTools();
    }}, "Revert"),
  ]);

  const info = el("div",{class:"muted", style:"margin-top:10px;font-size:12px"},
    "Coordinates are stored normalized (0–1), so they stay correct if you re-upload a resized map with the same aspect ratio."
  );

  const list = el("div",{class:"mono", style:"margin-top:10px;white-space:pre-wrap"});

  const refreshList = ()=>{
    list.textContent = _layoutText(ctx.state.maps._draftReceivers, ctx.state.maps._draftRoomBounds);
  };

  // --- Rendering helpers ---
  const renderAll = ()=>{
    // SVG rooms
    while(svg.firstChild) svg.removeChild(svg.firstChild);

    // Draw saved polys first, then fallback circles (if receiver assigned but no poly yet)
    const rb = ctx.state.maps._draftRoomBounds || {};
    const roomToRx = _roomToReceivers(ctx.state.maps._draftReceivers);

    // Polygons
    for(const [room, b] of Object.entries(rb)){
      if(!b || b.type!=="poly" || !Array.isArray(b.points)) continue;
      const poly = document.createElementNS("http://www.w3.org/2000/svg","polygon");
      poly.setAttribute("points", b.points.map(p=>`${clamp01(p[0])},${clamp01(p[1])}`).join(" "));
      const c = roomColor(room);
      poly.setAttribute("fill", c);
      poly.setAttribute("fill-opacity","0.12");
      poly.setAttribute("stroke", c);
      poly.setAttribute("stroke-width","0.004");
      svg.appendChild(poly);

      const lab = document.createElementNS("http://www.w3.org/2000/svg","text");
      const centroid = _centroid(b.points);
      lab.setAttribute("x", centroid[0]);
      lab.setAttribute("y", centroid[1]);
      lab.setAttribute("font-size","0.04");
      lab.setAttribute("text-anchor","middle");
      lab.setAttribute("dominant-baseline","middle");
      lab.setAttribute("fill", c);
      lab.textContent = room;
      svg.appendChild(lab);
    }

    // Fallback circles
    for(const [room, rxs] of Object.entries(roomToRx)){
      if(rb[room] && rb[room].type==="poly") continue;
      const c = roomColor(room);
      const circ = _autoRoomCircle(rxs);
      if(!circ) continue;
      const cc = document.createElementNS("http://www.w3.org/2000/svg","circle");
      cc.setAttribute("cx", circ.cx);
      cc.setAttribute("cy", circ.cy);
      cc.setAttribute("r", circ.r);
      cc.setAttribute("fill","none");
      cc.setAttribute("stroke", c);
      cc.setAttribute("stroke-width","0.004");
      cc.setAttribute("stroke-dasharray","0.02 0.02");
      svg.appendChild(cc);
    }

    // Recommendation polygon overlay
    const recoPoly = ctx.state.maps._recommendPoly;
    if(recoPoly && Array.isArray(recoPoly.polygon) && recoPoly.polygon.length >= 3){
      const rpoly = document.createElementNS("http://www.w3.org/2000/svg","polygon");
      rpoly.setAttribute("points", recoPoly.polygon.map(p=>`${clamp01(p[0])},${clamp01(p[1])}`).join(" "));
      rpoly.setAttribute("fill","rgba(251,191,36,0.18)");
      rpoly.setAttribute("stroke","#fbbf24");
      rpoly.setAttribute("stroke-width","0.005");
      rpoly.setAttribute("stroke-dasharray","0.018 0.010");
      svg.appendChild(rpoly);
      const rcx = recoPoly.polygon.reduce((s,p)=>s+p[0],0)/recoPoly.polygon.length;
      const rcy = recoPoly.polygon.reduce((s,p)=>s+p[1],0)/recoPoly.polygon.length;
      const rlab = document.createElementNS("http://www.w3.org/2000/svg","text");
      rlab.setAttribute("x", clamp01(rcx));
      rlab.setAttribute("y", clamp01(rcy));
      rlab.setAttribute("font-size","0.045");
      rlab.setAttribute("text-anchor","middle");
      rlab.setAttribute("dominant-baseline","middle");
      rlab.setAttribute("fill","#fbbf24");
      rlab.setAttribute("stroke","#1a0f00");
      rlab.setAttribute("stroke-width","0.008");
      rlab.setAttribute("paint-order","stroke fill");
      rlab.setAttribute("font-family","system-ui,sans-serif");
      rlab.textContent = "Recommended zone";
      svg.appendChild(rlab);
    }

    // Draft drawing polyline
    if(ctx.state.maps._drawing && Array.isArray(ctx.state.maps._drawing.points) && ctx.state.maps._drawing.points.length){
      const pts = ctx.state.maps._drawing.points;
      const ln = document.createElementNS("http://www.w3.org/2000/svg","polyline");
      ln.setAttribute("points", pts.map(p=>`${clamp01(p[0])},${clamp01(p[1])}`).join(" "));
      const c = roomColor(ctx.state.maps._drawing.room || "Room");
      ln.setAttribute("fill","none");
      ln.setAttribute("stroke", c);
      ln.setAttribute("stroke-width","0.006");
      svg.appendChild(ln);
    }

    // Markers
    overlay.querySelectorAll(".marker").forEach(n=>n.remove());
    const _sid = ctx.helpers.radioShortId || (src => (src||"").slice(0,3).toUpperCase());
    for(const r of ctx.state.maps._draftReceivers){
      const mk = document.createElement("div");
      mk.className = "marker" + (ctx.state.maps._selectedRxId===r.id ? " selected" : "");
      mk.style.left = `${Math.round((r.x||0)*10000)/100}%`;
      mk.style.top  = `${Math.round((r.y||0)*10000)/100}%`;
      const sid = r.source ? _sid(r.source) : "";
      mk.title = (r.label || r.id || "receiver") + (sid ? ` [${sid}]` : "") + (r.room ? ` • ${r.room}` : "");
      mk.textContent = sid || (r.label || r.id || "R").slice(0,2).toUpperCase();
      mk.addEventListener("click", (ev)=>{
        ev.stopPropagation();
        if(ctx.state.maps._mode!=="receivers") return;
        ctx.state.maps._selectedRxId = r.id;
        renderAll(); renderTools();
      });
      _makeDraggable(mk, r, overlay, ()=>{ renderAll(); refreshList(); }, ()=>ctx.state.maps._mode==="receivers", (v)=>{ if(ctx.state.maps) ctx.state.maps._editDragging=v; });
      overlay.appendChild(mk);
    }
  };

  const renderTools = ()=>{
    right.innerHTML = "";
    right.appendChild(modeRow);

    // ── Suggest Placement button ──────────────────────────────────────────────
    {
      const polyRooms = Object.values(ctx.state.maps._draftRoomBounds||{})
        .filter(b=>b?.type==="poly" && Array.isArray(b.points) && b.points.length>=3);
      const hasData = polyRooms.length >= 1;
      const isActive = !!(ctx.state.maps._recommendPoly);
      const recoBtn = document.createElement("button");
      recoBtn.className = "btn inline" + (isActive ? " primary" : "");
      recoBtn.style.marginTop = "8px";
      recoBtn.disabled = !hasData;
      if(!hasData) recoBtn.style.opacity = "0.4";
      recoBtn.title = hasData
        ? "Analyse coverage gaps and highlight the best area to place a new scanner"
        : "Draw room boundaries first to enable coverage gap analysis";
      recoBtn.textContent = isActive ? "Clear Suggestion" : "Suggest Placement";
      recoBtn.addEventListener("click", ()=>{
        if(isActive){
          ctx.state.maps._recommendPoly = null;
          renderAll(); renderTools();
          return;
        }
        const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
        const result = _recommendPlacement(ctx.state.maps._draftReceivers, ctx.state.maps._draftRoomBounds, snap);
        if(!result){
          ctx.toast("All areas appear well-covered — no obvious placement gaps found.", false);
          return;
        }
        ctx.state.maps._recommendPoly = result;
        renderAll(); renderTools();
        const rNames = result.rooms.slice(0,3).join(", ");
        ctx.toast(`Coverage gap found near: ${rNames}${result.rooms.length>3?" +more":""}`, false);
      });
      right.appendChild(recoBtn);
    }

    if(ctx.state.maps._mode==="receivers"){
      right.appendChild(el("div",{class:"muted", style:"margin-top:10px;font-size:12px"}, "Receiver tools"));
      right.appendChild(el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;margin-top:8px"},[
        el("button",{class:"btn inline", onclick:()=>{
          const id = `rx_${Date.now().toString(16)}`;
          ctx.state.maps._draftReceivers.push({id, label:`Receiver ${ctx.state.maps._draftReceivers.length+1}`, x:0.5, y:0.5, room:""});
          ctx.state.maps._selectedRxId = id;
          renderAll(); refreshList(); renderTools();
        }}, "Add Receiver"),
        el("button",{class:"btn inline", onclick:()=>{
          if(!ctx.state.maps._draftReceivers.length) return;
          const last = ctx.state.maps._draftReceivers.pop();
          if(last && ctx.state.maps._selectedRxId===last.id) ctx.state.maps._selectedRxId=null;
          renderAll(); refreshList(); renderTools();
        }}, "Undo"),
      ]));

      const sel = ctx.state.maps._draftReceivers.find(x=>x.id===ctx.state.maps._selectedRxId) || null;
      if(sel){
        const lbl = el("input",{type:"text", value: sel.label||"", placeholder:"Receiver label"});
        lbl.addEventListener("input", ()=>{ sel.label = lbl.value; renderAll(); refreshList(); });

        const roomSel = document.createElement("select");
        roomSel.className = "select";
        const opt0 = document.createElement("option"); opt0.value=""; opt0.textContent="(no room)"; roomSel.appendChild(opt0);
        for(const r of eligibleRooms){
          const o = document.createElement("option");
          o.value = r; o.textContent = r;
          roomSel.appendChild(o);
        }
        roomSel.value = sel.room || "";
        roomSel.addEventListener("change", ()=>{
          sel.room = roomSel.value || "";
          renderAll(); refreshList();
        });

        right.appendChild(el("div",{style:"margin-top:10px"},[
          el("div",{class:"muted", style:"font-size:12px"},"Selected receiver"),
          el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:6px"},[
            el("div",{class:"pill"}, sel.id),
            el("div",{class:"muted", style:"font-size:12px"}, `x=${(sel.x||0).toFixed(3)} y=${(sel.y||0).toFixed(3)}`),
          ]),
          lbl,
          el("div",{class:"muted", style:"font-size:12px;margin-top:6px"},"Room"),
          roomSel,
          el("button",{class:"btn inline", style:"margin-top:8px", onclick:()=>{
            ctx.state.maps._draftReceivers = ctx.state.maps._draftReceivers.filter(x=>x.id!==sel.id);
            ctx.state.maps._selectedRxId = null;
            renderAll(); refreshList(); renderTools();
          }}, "Delete receiver"),
        ]));
      } else {
        right.appendChild(el("div",{class:"muted", style:"margin-top:10px;font-size:12px"}, "Tip: click a radio marker to edit its room assignment."));
      }

      // Live BLE Radios panel — shows actual HA BLE scanners for placement
      const snap2 = (ctx.state.live && ctx.state.live.snapshot) || null;
      const liveRadios = (snap2 && snap2.ble && Array.isArray(snap2.ble.radios)) ? snap2.ble.radios : [];
      const _sid = ctx.helpers.radioShortId || (src => src.slice(0,3).toUpperCase());
      right.appendChild(el("div",{class:"muted", style:"margin-top:14px;font-size:12px;font-weight:600"}, "Live BLE Radios"));
      if(liveRadios.length){
        right.appendChild(el("div",{class:"muted", style:"font-size:11px;margin-top:2px;margin-bottom:6px"}, "Click Add to place on map, then drag to position."));
        const radList = el("div",{style:"display:flex;flex-direction:column;gap:5px"});
        for(const radio of liveRadios){
          const alreadyPlaced = ctx.state.maps._draftReceivers.some(r => (r.source && r.source === radio.source) || (r.label && radio.name && r.label.toLowerCase() === radio.name.toLowerCase()) || r.id === radio.source);
          const sid = _sid(radio.source || "");
          const borderColor = radio.disabled ? "#5b3b7a" : radio.lost ? "#7d5c2b" : "#1b3526";
          const bg = radio.disabled ? "rgba(148,100,220,.06)" : radio.lost ? "rgba(245,158,11,.06)" : "#0a150e";
          const row = el("div",{style:`display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid ${borderColor};border-radius:6px;background:${bg};opacity:${(radio.lost||radio.disabled)?0.75:1}`});
          // ID pill
          row.appendChild(el("span",{style:"font-family:monospace;font-weight:700;font-size:10px;color:#94a3b8;white-space:nowrap"}, sid));
          // Name + room
          const info = el("div",{style:"flex:1;min-width:0"});
          info.appendChild(el("div",{style:"font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, radio.name || radio.source || "Unknown"));
          const _netParts = [radio.area_name || "no room"];
          if(radio.ip) _netParts.push(radio.ip);
          if(radio.ssid) _netParts.push(radio.ssid);
          else if(radio.connection_type) _netParts.push(radio.connection_type);
          info.appendChild(el("div",{class:"muted",style:"font-size:10px"}, _netParts.join(" · ")));
          row.appendChild(info);
          if(radio.disabled){
            row.appendChild(el("span",{style:"font-size:10px;color:#c084fc;white-space:nowrap"}, "⊘ Disabled"));
          } else if(radio.lost){
            row.appendChild(el("span",{style:"font-size:10px;color:#f59e0b;white-space:nowrap"}, "⚠ Lost"));
          } else if(alreadyPlaced){
            row.appendChild(el("span",{style:"font-size:10px;color:#52b788;white-space:nowrap"}, "✓ placed"));
          } else {
            row.appendChild(el("button",{class:"btn inline", style:"font-size:10px;padding:2px 8px;white-space:nowrap", onclick:()=>{
              const id = `rx_${Date.now().toString(16)}`;
              ctx.state.maps._draftReceivers.push({
                id, label: radio.name || radio.source || id,
                x: 0.5, y: 0.5,
                room: radio.area_name || "",
                source: radio.source || "",
              });
              ctx.state.maps._selectedRxId = id;
              renderAll(); refreshList(); renderTools();
            }}, "Add"));
          }
          radList.appendChild(row);
        }
        right.appendChild(radList);
      } else {
        right.appendChild(el("div",{class:"muted", style:"margin-top:4px;font-size:11px"},
          snap2 ? "No live BLE radios detected. Enable Bluetooth proxy in HA." : "Switch to Live mode to see your BLE scanners."));
      }
    } else {
      right.appendChild(el("div",{class:"muted", style:"margin-top:10px;font-size:12px"}, "Room boundary tools"));

      // Build lookup: rooms already placed on OTHER maps (for warning in dropdown)
      const _allMaps = (ctx.state.maps && ctx.state.maps.list) ? ctx.state.maps.list : [];
      const _roomPlacedOn = {}; // room name → map name
      for(const om of _allMaps){
        if(om.id === map.id) continue;
        for(const rn of Object.keys(om.room_bounds || {})){
          _roomPlacedOn[rn] = om.name || om.id;
        }
      }

      const roomSel = document.createElement("select");
      roomSel.className = "select";
      const opt = document.createElement("option"); opt.value=""; opt.textContent="Choose room…"; roomSel.appendChild(opt);
      for(const r of eligibleRooms){
        const o = document.createElement("option");
        o.value = r;
        o.textContent = _roomPlacedOn[r] ? `${r}  ⚠ on "${_roomPlacedOn[r]}"` : r;
        if(_roomPlacedOn[r]) o.style.color = "#fbbf24";
        roomSel.appendChild(o);
      }
      roomSel.value = ctx.state.maps._selectedRoom || "";
      roomSel.addEventListener("change", ()=>{
        ctx.state.maps._selectedRoom = roomSel.value || "";
        ctx.state.maps._drawing = null;
        renderAll(); renderTools();
      });

      const startBtn = el("button",{class:"btn inline", onclick:()=>{
        if(!ctx.state.maps._selectedRoom){ ctx.toast("Choose a room first.", true); return; }
        ctx.state.maps._drawing = { room: ctx.state.maps._selectedRoom, points: [] };
        renderAll(); renderTools();
      }}, "Start drawing");

      const undoPt = el("button",{class:"btn inline", onclick:()=>{
        if(!ctx.state.maps._drawing || !ctx.state.maps._drawing.points.length) return;
        ctx.state.maps._drawing.points.pop();
        renderAll(); renderTools();
      }}, "Undo point");

      const finishBtn = el("button",{class:"btn inline", onclick:()=>{
        const d = ctx.state.maps._drawing;
        if(!d || !Array.isArray(d.points) || d.points.length < 3){ ctx.toast("Need at least 3 points.", true); return; }
        ctx.state.maps._draftRoomBounds[d.room] = { type:"poly", points: d.points.map(p=>[clamp01(p[0]), clamp01(p[1])]) };
        ctx.state.maps._drawing = null;
        renderAll(); refreshList(); renderTools();
      }}, "Finish");

      const clearBtn = el("button",{class:"btn inline", onclick:()=>{
        const r = ctx.state.maps._selectedRoom;
        if(!r) return;
        delete ctx.state.maps._draftRoomBounds[r];
        ctx.state.maps._drawing = null;
        renderAll(); refreshList(); renderTools();
      }}, "Clear boundary");

      right.appendChild(roomSel);

      // Warning if selected room is already drawn on another map
      const _selRoom = ctx.state.maps._selectedRoom;
      if(_selRoom && _roomPlacedOn[_selRoom]){
        right.appendChild(el("div",{style:"margin-top:6px;padding:6px 10px;border-radius:6px;background:#2a1a0a;border:1px solid #d97706;font-size:11px;color:#fbbf24"},
          `This room already has a boundary on "${_roomPlacedOn[_selRoom]}". Drawing it here will create a duplicate.`));
      }

      right.appendChild(el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;margin-top:8px"},[
        startBtn, undoPt, finishBtn, clearBtn
      ]));

      const r = ctx.state.maps._selectedRoom;
      if(r){
        const hasPoly = ctx.state.maps._draftRoomBounds && ctx.state.maps._draftRoomBounds[r] && ctx.state.maps._draftRoomBounds[r].type==="poly";
        const hint = hasPoly ? "Boundary saved. You can re-draw to replace it." : "No boundary yet. If a receiver is assigned to this room, you will see a dashed auto-circle until you draw a polygon.";
        right.appendChild(el("div",{class:"muted", style:"margin-top:10px;font-size:12px"}, hint));
        // Tags list for the selected room (LIVE detected + configured-missing)
        const snap = ctx.state.live && ctx.state.live.snapshot;
        const liveTags = (snap && Array.isArray(snap.tags)) ? snap.tags.filter(t => t && t.room === r && !t.missing) : [];
        const missing = (snap && snap.room_tag_map_missing && snap.room_tag_map_missing[r]) ? snap.room_tag_map_missing[r] : [];

        const tagBox = el("div", { style: "margin-top:10px" });
        tagBox.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:4px" }, "Tags in this room (live):"));

        if (liveTags.length) {
          const list = el("div", { class: "list" });
          for (const t of liveTags) {
            const item = el("div", { class: "item" });
            const tw = el("div", { style: "display:flex;flex-direction:column;gap:2px;flex:1" });
            tw.appendChild(el("span", {}, String(t.name || t.entity_id)));
            tw.appendChild(el("span", { class: "muted" }, `${t.entity_id} • ${t.state}`));
            item.appendChild(tw);
            list.appendChild(item);
          }
          tagBox.appendChild(list);
        } else {
          tagBox.appendChild(el("div", { class: "muted", style: "font-size:12px" }, "No live tags detected for this room."));
        }

        if (missing && missing.length) {
          tagBox.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-top:6px" }, `Configured (missing): ${missing.length}`));
        }

        right.appendChild(tagBox);

      }

      // --- Polygon Layers ---
      const polyEntries = Object.entries(ctx.state.maps._draftRoomBounds || {}).filter(([,b]) => b && b.type === "poly");
      if(polyEntries.length){
        const layersDiv = el("div",{style:"margin-top:14px"});
        layersDiv.appendChild(el("div",{class:"muted",style:"font-size:12px;font-weight:600;margin-bottom:6px"},`Polygon layers (${polyEntries.length})`));
        for(const [room, b] of polyEntries){
          const isOrphan = !allRooms.includes(room);
          const c = roomColor(room);
          const delBtn = el("button",{class:"btn tiny"},"Delete");
          delBtn.addEventListener("click", ()=>{
            delete ctx.state.maps._draftRoomBounds[room];
            renderAll(); refreshList(); renderTools();
          });
          const row = el("div",{style:"display:flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid #1b3526;border-radius:6px;background:#0a150e;margin-bottom:4px"},[
            el("span",{style:`width:10px;height:10px;border-radius:50%;background:${c};flex-shrink:0`}),
            el("div",{style:"flex:1"},[
              el("div",{style:`font-size:12px;font-weight:600${isOrphan?";color:#f59e0b":""}`},room+(isOrphan?" ⚠ orphan":"")),
              el("div",{class:"muted",style:"font-size:10px"},`${(b.points||[]).length} points${isOrphan?" · not in room registry":""}`),
            ]),
            delBtn,
          ]);
          layersDiv.appendChild(row);
        }
        right.appendChild(layersDiv);
      }
    }

    right.appendChild(saveRow);
  };

  // --- Interactions on the stage ---
  stage.title = (ctx.state.maps._mode==="receivers") ? "Double-click to add receiver; drag to reposition" : "Click to add room points; double-click to finish";
  stage.addEventListener("dblclick", (ev)=>{
    if(ctx.state.maps._mode==="receivers"){
      const rect = overlay.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const y = (ev.clientY - rect.top) / rect.height;
      const id = `rx_${Date.now().toString(16)}`;
      ctx.state.maps._draftReceivers.push({id, label:`Receiver ${ctx.state.maps._draftReceivers.length+1}`, x: clamp01(x), y: clamp01(y), room:""});
      ctx.state.maps._selectedRxId = id;
      renderAll(); refreshList(); renderTools();
      return;
    }
    // rooms mode: dblclick finishes if currently drawing
    if(ctx.state.maps._mode==="rooms" && ctx.state.maps._drawing){
      const d = ctx.state.maps._drawing;
      if(d.points.length >= 3){
        ctx.state.maps._draftRoomBounds[d.room] = { type:"poly", points: d.points.map(p=>[clamp01(p[0]), clamp01(p[1])]) };
      }
      ctx.state.maps._drawing = null;
      renderAll(); refreshList(); renderTools();
    }
  });

  stage.addEventListener("click", (ev)=>{
    if(ctx.state.maps._mode!=="rooms") return;
    // ignore marker clicks (they stopPropagation already, but defensive)
    if(ev.target && ev.target.classList && ev.target.classList.contains("marker")) return;
    if(!ctx.state.maps._drawing){
      // start implicit drawing if room chosen
      if(!ctx.state.maps._selectedRoom) return;
      ctx.state.maps._drawing = { room: ctx.state.maps._selectedRoom, points: [] };
    }
    const rect = overlay.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    ctx.state.maps._drawing.points.push([clamp01(x), clamp01(y)]);
    renderAll(); renderTools();
  });

  // Initial render
  renderAll();
  refreshList();
  renderTools();

  // ── Trim Image Panel ────────────────────────────────────────────────────
  // Lets user crop the uploaded image in-place. Drag on the preview to select
  // a region; Apply Trim re-renders the cropped area as a new PNG and replaces
  // the map image on the backend. Receiver/room coordinates are remapped by
  // the backend's crop transform to stay aligned with the trimmed image.
  const trimPanel = el("div",{style:"display:none;margin-top:10px"});
  const trimStatus = el("div",{class:"mono",style:"font-size:12px;margin-top:6px"}, "\u2014");

  let _trimCrop = null;
  let _trimImgW = 0, _trimImgH = 0, _trimDrag = false;
  let _tdx0=0,_tdy0=0,_tdx1=0,_tdy1=0;

  const trimWrap   = el("div",{style:"position:relative;display:inline-block;max-width:100%;border:1px solid #253e2e;border-radius:6px;overflow:hidden"});
  const trimImg    = document.createElement("img");
  trimImg.style.cssText = "display:block;max-width:100%;max-height:320px";
  const trimCanvas = document.createElement("canvas");
  trimCanvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair";
  const trimInfo   = el("div",{class:"muted",style:"font-size:11px;margin-top:5px"}, "");
  const trimClearBtn = el("button",{class:"btn tiny",style:"margin-top:6px"}, "Reset Selection");

  function _tcFrac(cx,cy){ const r=trimCanvas.getBoundingClientRect(); return [Math.max(0,Math.min(1,(cx-r.left)/r.width)),Math.max(0,Math.min(1,(cy-r.top)/r.height))]; }
  function _drawTrimOverlay(){
    const cw=trimCanvas.width, ch=trimCanvas.height;
    if(!cw||!ch) return;
    const g2=trimCanvas.getContext("2d");
    g2.clearRect(0,0,cw,ch);
    if(_trimCrop){
      const {fx0,fy0,fx1,fy1}=_trimCrop;
      const px0=fx0*cw, py0=fy0*ch, pw=(fx1-fx0)*cw, ph=(fy1-fy0)*ch;
      g2.fillStyle="rgba(0,0,0,0.52)"; g2.fillRect(0,0,cw,ch);
      g2.clearRect(px0,py0,pw,ph);
      g2.strokeStyle="#52b788"; g2.lineWidth=Math.max(1,cw/400); g2.strokeRect(px0,py0,pw,ph);
      const hs=Math.max(4,cw/100); g2.fillStyle="#52b788";
      for(const [hx,hy] of [[px0,py0],[px0+pw,py0],[px0,py0+ph],[px0+pw,py0+ph]])
        g2.fillRect(hx-hs/2,hy-hs/2,hs,hs);
      trimInfo.textContent=`Keep: ${Math.round(_trimImgW*(fx1-fx0))}\u00d7${Math.round(_trimImgH*(fy1-fy0))} px  (original: ${_trimImgW}\u00d7${_trimImgH}) \u2014 drag to adjust`;
    } else {
      trimInfo.textContent=`Full image: ${_trimImgW}\u00d7${_trimImgH} px \u2014 drag to select region to keep`;
    }
  }
  function _updateTrimCrop(){
    const fx0=Math.min(_tdx0,_tdx1), fy0=Math.min(_tdy0,_tdy1);
    const fx1=Math.max(_tdx0,_tdx1), fy1=Math.max(_tdy0,_tdy1);
    _trimCrop=(fx1-fx0>0.015&&fy1-fy0>0.015)?{fx0,fy0,fx1,fy1}:null;
    _drawTrimOverlay();
  }
  trimCanvas.addEventListener("mousedown",  e=>{ _trimDrag=true;  [_tdx0,_tdy0]=_tcFrac(e.clientX,e.clientY); _tdx1=_tdx0;_tdy1=_tdy0; e.preventDefault(); });
  trimCanvas.addEventListener("mousemove",  e=>{ if(!_trimDrag)return; [_tdx1,_tdy1]=_tcFrac(e.clientX,e.clientY); _updateTrimCrop(); });
  trimCanvas.addEventListener("mouseup",    ()=>{ _trimDrag=false; });
  trimCanvas.addEventListener("mouseleave", ()=>{ _trimDrag=false; });
  trimCanvas.addEventListener("touchstart", e=>{ const t=e.touches[0]; _trimDrag=true; [_tdx0,_tdy0]=_tcFrac(t.clientX,t.clientY); _tdx1=_tdx0;_tdy1=_tdy0; e.preventDefault(); },{passive:false});
  trimCanvas.addEventListener("touchmove",  e=>{ if(!_trimDrag)return; const t=e.touches[0]; [_tdx1,_tdy1]=_tcFrac(t.clientX,t.clientY); _updateTrimCrop(); e.preventDefault(); },{passive:false});
  trimCanvas.addEventListener("touchend",   ()=>{ _trimDrag=false; });
  trimClearBtn.addEventListener("click", ()=>{ _trimCrop=null; _drawTrimOverlay(); });

  // Use trimImg itself to size the canvas — avoids a second image load and the
  // CORS-cache split that happened when a separate tmpImg loaded the same URL.
  trimImg.crossOrigin = "anonymous";
  trimImg.onload = ()=>{
    _trimImgW = trimImg.naturalWidth; _trimImgH = trimImg.naturalHeight;
    const cs = Math.min(1, 1600/Math.max(_trimImgW,_trimImgH));
    trimCanvas.width  = Math.round(_trimImgW*cs);
    trimCanvas.height = Math.round(_trimImgH*cs);
    _trimCrop = null; _drawTrimOverlay();
  };
  // If already cached and decoded, fire onload manually
  if(trimImg.complete && trimImg.naturalWidth) trimImg.onload();
  trimImg.src = url || "";
  trimWrap.appendChild(trimImg);
  trimWrap.appendChild(trimCanvas);

  const trimApplyBtn = el("button",{class:"btn inline", onclick: async ()=>{
    if(!_trimCrop){ trimStatus.textContent="Drag on the image to select the region to keep first."; return; }
    trimStatus.textContent="Processing\u2026";
    try{
      const res = await _preparePngFromUrl(url, 1600, _trimCrop);
      trimStatus.textContent=`Uploading\u2026 (${res.width}\u00d7${res.height})`;
      await ctx.actions.mapsReplaceImage({
        map_id: map.id,
        width: res.width,
        height: res.height,
        png_base64: res.pngBase64,
        crop: _trimCrop,
      });
      // Reset draft state so edit reloads from fresh map data
      ctx.state.maps._draftMapId = null;
      trimStatus.textContent="Trim applied \u2714";
      trimPanel.style.display="none";
      ctx.actions.renderRooms();
    }catch(e){
      trimStatus.textContent="Failed: "+String(e);
    }
  }}, "Apply Trim");

  const trimCancelBtn = el("button",{class:"btn inline", onclick:()=>{ trimPanel.style.display="none"; }}, "Cancel");

  trimPanel.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:6px"},"Drag to select the region to keep, then click Apply Trim:"));
  trimPanel.appendChild(trimWrap);
  trimPanel.appendChild(trimClearBtn);
  trimPanel.appendChild(trimInfo);
  trimPanel.appendChild(el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"},[trimApplyBtn, trimCancelBtn]));
  trimPanel.appendChild(trimStatus);

  // "Trim" toggle button in the title bar
  const trimToggleBtn = el("button",{class:"btn inline", onclick:()=>{
    trimPanel.style.display = trimPanel.style.display==="none" ? "" : "none";
    trimStatus.textContent="\u2014";
  }}, "Trim Image");

  // Insert Trim button into the existing title row buttons (direct reference — no fragile querySelector)
  titleBtns.insertBefore(trimToggleBtn, titleBtns.firstChild);

  // ── Rotate Image Panel ─────────────────────────────────────────────────
  // Bakes rotation directly into the image file (not a CSS transform) so all
  // downstream code sees a pre-rotated image. Disabled once the map has
  // tie-ins or is the master — rotating a connected map would invalidate all
  // alignment relationships. Fresh maps (x_offset=0, scale=1, no tie-ins)
  // don't count as "connected" and can still be rotated.
  // Receiver and room-boundary coordinates are remapped through the same
  // rotation matrix so they stay aligned with the rotated image.
  const _stk = map.stack || {};
  const _hasStackTieIns = Array.isArray(_stk.tie_ins) && _stk.tie_ins.length > 0;
  const _isMaster = !!_stk.is_master;
  const _canRotate = !_hasStackTieIns && !_isMaster;

  const rotatePanel = el("div",{style:"display:none;margin-top:10px"});
  if(_canRotate && url){
    let _rotAngle = 0;
    const rotStatus = el("div",{class:"mono",style:"font-size:12px;margin-top:6px"}, "0°");

    const rotWrap = el("div",{style:"position:relative;display:inline-block;max-width:100%;border:1px solid #253e2e;border-radius:6px;overflow:visible;background:#0a150e;padding:20px"});
    const rotImg = document.createElement("img");
    rotImg.src = url;
    rotImg.style.cssText = "display:block;max-width:100%;max-height:320px;transition:transform 0.3s ease";
    rotWrap.appendChild(rotImg);

    const _updatePreview = () => {
      rotImg.style.transform = `rotate(${_rotAngle}deg)`;
      rotStatus.textContent = `${_rotAngle}°`;
    };

    const rotBtns = el("div",{style:"display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center"});
    for(const [label, delta] of [["-90°",-90],["-15°",-15],["-5°",-5],["+5°",5],["+15°",15],["+90°",90]]){
      const b = el("button",{class:"btn tiny"}, label);
      b.addEventListener("click", ()=>{ _rotAngle = ((_rotAngle + delta) % 360 + 360) % 360; _updatePreview(); });
      rotBtns.appendChild(b);
    }
    const resetBtn = el("button",{class:"btn tiny"}, "0°");
    resetBtn.addEventListener("click", ()=>{ _rotAngle = 0; _updatePreview(); });
    rotBtns.appendChild(resetBtn);

    const applyStatus = el("div",{class:"mono",style:"font-size:12px;margin-top:6px"});
    const applyBtn = el("button",{class:"btn inline",style:"margin-top:8px"}, "Apply Rotation");
    applyBtn.addEventListener("click", async ()=>{
      if(_rotAngle === 0){ applyStatus.textContent = "No rotation to apply."; return; }
      applyBtn.disabled = true;
      applyStatus.textContent = "Rotating image…";
      try {
        const img = await _loadImage(url);
        const sw = img.naturalWidth || img.width;
        const sh = img.naturalHeight || img.height;
        const rad = _rotAngle * Math.PI / 180;
        const absCos = Math.abs(Math.cos(rad));
        const absSin = Math.abs(Math.sin(rad));
        const nw = Math.round(sw * absCos + sh * absSin);
        const nh = Math.round(sw * absSin + sh * absCos);
        const canvas = document.createElement("canvas");
        canvas.width = nw; canvas.height = nh;
        const g = canvas.getContext("2d");
        g.imageSmoothingEnabled = true;
        g.translate(nw/2, nh/2);
        g.rotate(rad);
        g.drawImage(img, -sw/2, -sh/2);
        const blob = await new Promise(r => canvas.toBlob(r, "image/png", 0.92));
        const ab = await blob.arrayBuffer();
        const b64 = _arrayBufferToBase64(ab);

        applyStatus.textContent = "Uploading rotated image…";

        // Remap receiver and room bound coordinates through the same rotation
        const _rotPoint = (px, py) => {
          // px, py are 0-1 fractions in the old image
          const ox = px * sw - sw/2;
          const oy = py * sh - sh/2;
          const rx = ox * Math.cos(rad) - oy * Math.sin(rad);
          const ry = ox * Math.sin(rad) + oy * Math.cos(rad);
          return [Math.max(0, Math.min(1, (rx + nw/2) / nw)),
                  Math.max(0, Math.min(1, (ry + nh/2) / nh))];
        };

        // Rotate receivers
        const newReceivers = (map.receivers || []).map(r => {
          const [nx, ny] = _rotPoint(r.x || 0, r.y || 0);
          return { ...r, x: nx, y: ny };
        });
        // Rotate beacons
        const newBeacons = (map.beacons || []).map(b => {
          const [nx, ny] = _rotPoint(b.x || 0, b.y || 0);
          return { ...b, x: nx, y: ny };
        });
        // Rotate room bounds
        const newBounds = {};
        for(const [room, b] of Object.entries(map.room_bounds || {})){
          if(b && b.type === "poly" && Array.isArray(b.points)){
            newBounds[room] = { ...b, points: b.points.map(p => { const [nx,ny] = _rotPoint(p[0],p[1]); return [nx,ny]; }) };
          } else if(b && b.type === "circle"){
            const [cx2,cy2] = _rotPoint(b.cx||0.5, b.cy||0.5);
            newBounds[room] = { ...b, cx: cx2, cy: cy2 };
          } else {
            newBounds[room] = b;
          }
        }

        await ctx.actions.mapsReplaceImage({ map_id: map.id, png_base64: b64, width: nw, height: nh });
        // Save rotated coordinates
        if(newReceivers.length || Object.keys(newBounds).length || newBeacons.length){
          await ctx.actions.mapsUpdate({
            map_id: map.id,
            receivers: newReceivers,
            calibration: map.calibration || {},
            notes: map.notes || "",
            room_bounds: newBounds,
            beacons: newBeacons,
          });
        }
        applyStatus.style.color = "#4ade80";
        applyStatus.textContent = `Rotated ${_rotAngle}° and saved. Reloading edit…`;
        _rotAngle = 0;
        // Short delay so the user sees the success message, then refresh
        await new Promise(r => setTimeout(r, 1200));
        await ctx.actions.mapsRefresh();
      } catch(e){
        applyStatus.style.color = "#f87171";
        applyStatus.textContent = "Failed: " + (e.message || e);
      }
      applyBtn.disabled = false;
    });

    const rotCancelBtn = el("button",{class:"btn inline", onclick:()=>{ rotatePanel.style.display="none"; _rotAngle=0; _updatePreview(); }}, "Cancel");

    rotatePanel.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:6px"},"Preview rotation, then click Apply to bake it into the image:"));
    if((map.receivers||[]).length || Object.keys(map.room_bounds||{}).length){
      rotatePanel.appendChild(el("div",{style:"font-size:11px;color:#fbbf24;margin-bottom:6px"},"Receivers and room boundaries will be remapped to match the rotated image."));
    }
    rotatePanel.appendChild(rotWrap);
    rotatePanel.appendChild(rotBtns);
    rotatePanel.appendChild(rotStatus);
    rotatePanel.appendChild(el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"},[applyBtn, rotCancelBtn]));
    rotatePanel.appendChild(applyStatus);

    const rotateToggleBtn = el("button",{class:"btn inline", onclick:()=>{
      rotatePanel.style.display = rotatePanel.style.display==="none" ? "" : "none";
    }}, "Rotate Image");
    titleBtns.insertBefore(rotateToggleBtn, titleBtns.firstChild);
  }

  card.appendChild(title);
  card.appendChild(rotatePanel);
  card.appendChild(trimPanel);
  card.appendChild(stage);
  card.appendChild(info);
  card.appendChild(right);
  card.appendChild(list);

  return card;
}

// ── Edit Tab Helpers ─────────────────────────────────────────────────────────

function _slug(s){
  return String(s||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"") || "floor";
}

function _floorSelect(floors, value, onChange){
  const sel = document.createElement("select");
  sel.className = "select";
  for(const f of floors){
    const o = document.createElement("option");
    o.value = f.id; o.textContent = f.name || f.id;
    sel.appendChild(o);
  }
  // Always offer "Outside" as a floor option
  const oOut = document.createElement("option");
  oOut.value = OUTSIDE_FLOOR_ID; oOut.textContent = "Outside (Experimental)";
  sel.appendChild(oOut);
  sel.value = value || (floors[0] && floors[0].id) || "main";
  sel.addEventListener("change", ()=>onChange(sel.value));
  return sel;
}

// Group receivers by their assigned room name → {room: [receivers]}.
// Used to generate auto-circle fallbacks for rooms without drawn polygons.
function _roomToReceivers(receivers){
  const out = {};
  for(const r of (receivers||[])){
    const room = (r.room||"").trim();
    if(!room) continue;
    out[room] = out[room] || [];
    out[room].push(r);
  }
  return out;
}

// Auto-circle fallback: if a room has assigned receivers but no drawn polygon,
// show a dashed circle centered on the average receiver position.
function _autoRoomCircle(rxs){
  if(!rxs || !rxs.length) return null;
  let cx=0, cy=0;
  for(const r of rxs){ cx += (r.x||0); cy += (r.y||0); }
  cx /= rxs.length; cy /= rxs.length;
  return {cx: clamp01(cx), cy: clamp01(cy), r: 0.12};
}

function _centroid(points){
  // Simple average (good enough for UI label)
  if(!points || !points.length) return [0.5,0.5];
  let x=0,y=0;
  for(const p of points){ x+=p[0]; y+=p[1]; }
  return [clamp01(x/points.length), clamp01(y/points.length)];
}

// Library thumbnail: composites the map image + room bounds SVG + optional
// coverage-gap recommendation polygon into a fixed-width preview.
function _libraryThumb(m, ctx, reco){
  const iw = m.image?.width  || 800;
  const ih = m.image?.height || 600;
  const ar = ih / iw;
  const TW = 96;
  const TH = Math.max(48, Math.round(TW * ar));

  const wrap = document.createElement("div");
  wrap.style.cssText = `position:relative;width:${TW}px;height:${TH}px;flex-shrink:0;`
    + `border-radius:6px;overflow:hidden;border:1px solid #1b3526;background:#071008`;

  if(m.image?.filename){
    const _tv = (m.updated||m.image?.sha256||'').replace(/[^a-zA-Z0-9]/g,'').slice(0,16);
    const img = document.createElement("img");
    img.src = `/local/padspan_ha/maps/${m.image.filename}${_tv ? '?v='+_tv : ''}`;
    img.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:fill";
    wrap.appendChild(img);
  }

  // SVG overlay: room bounds + receiver dots + recommendation polygon
  const roomColor = ctx.helpers.roomColor;
  const rb = m.room_bounds || {};
  let s = `<svg viewBox="0 0 1 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;width:100%;height:100%">`;
  for(const [room, b] of Object.entries(rb)){
    if(!b || b.type!=="poly" || !b.points?.length) continue;
    const pts = b.points.map(p=>`${p[0]},${p[1]}`).join(" ");
    const c = roomColor ? roomColor(room) : "#52b788";
    s += `<polygon points="${pts}" fill="${c}22" stroke="${c}" stroke-width="0.005"/>`;
  }
  for(const rx of (m.receivers||[])){
    s += `<circle cx="${rx.x||0}" cy="${rx.y||0}" r="0.022" fill="#52b788" opacity="0.9"/>`;
  }
  if(reco && Array.isArray(reco.polygon) && reco.polygon.length >= 3){
    const pts = reco.polygon.map(p=>`${p[0]},${p[1]}`).join(" ");
    s += `<polygon points="${pts}" fill="rgba(251,191,36,0.25)" stroke="#fbbf24" stroke-width="0.007" stroke-dasharray="0.018 0.01"/>`;
    const rcx = reco.polygon.reduce((t,p)=>t+p[0],0)/reco.polygon.length;
    const rcy = reco.polygon.reduce((t,p)=>t+p[1],0)/reco.polygon.length;
    // Dot at centroid of recommended zone
    s += `<circle cx="${rcx}" cy="${rcy}" r="0.025" fill="#fbbf24" opacity="0.85"/>`;
    s += `<line x1="${rcx}" y1="${rcy-0.04}" x2="${rcx}" y2="${rcy-0.01}" stroke="#fbbf24" stroke-width="0.012" stroke-linecap="round" opacity="0.85"/>`;
  }
  s += `</svg>`;

  const svgDiv = document.createElement("div");
  svgDiv.innerHTML = s;
  wrap.appendChild(svgDiv.firstChild);

  return wrap;
}

function _layoutText(receivers, roomBounds){
  const lines = [];
  lines.push("Receivers:");
  for(const r of (receivers||[])){
    lines.push(`- ${r.id}  ${String(r.label||"").padEnd(16)}  room=${r.room||"-"}  x=${(r.x||0).toFixed(3)} y=${(r.y||0).toFixed(3)}`);
  }
  lines.push("");
  lines.push("Room bounds:");
  for(const [room,b] of Object.entries(roomBounds||{})){
    if(!b) continue;
    if(b.type==="poly" && Array.isArray(b.points)){
      lines.push(`- ${room}: poly (${b.points.length} pts)`);
    } else if(b.type==="circle"){
      lines.push(`- ${room}: circle`);
    } else {
      lines.push(`- ${room}: (unknown)`);
    }
  }
  return lines.join("\n");
}


// Makes a receiver marker node draggable within its container. Updates the
// receiver's (x,y) coordinates in normalized 0–1 space as the user drags.
// onDragState callback sets ctx.state.maps._editDragging to suppress re-renders.
function _makeDraggable(node, receiver, container, onMoved=null, isEnabled=null, onDragState=null){
  let dragging = false;
  let rect = null;

  const onDown = (ev)=>{
    if(isEnabled && !isEnabled()) return;
    dragging = true;
    if(onDragState) onDragState(true);
    rect = container.getBoundingClientRect();
    ev.preventDefault();
  };
  const onMove = (ev)=>{
    if(!dragging || !rect) return;
    const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
    const x = (clientX - rect.left)/rect.width;
    const y = (clientY - rect.top)/rect.height;
    receiver.x = clamp01(x);
    receiver.y = clamp01(y);
    node.style.left = `${Math.round(receiver.x*10000)/100}%`;
    node.style.top  = `${Math.round(receiver.y*10000)/100}%`;
    if(onMoved) onMoved();
  };
  const onUp = ()=>{
    if(!dragging) return;
    dragging = false;
    if(onDragState) onDragState(false);
    rect = null;
    if(onMoved) onMoved();
  };

  node.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  node.addEventListener("touchstart", onDown, {passive:false});
  window.addEventListener("touchmove", onMove, {passive:false});
  window.addEventListener("touchend", onUp);
}

// Format receiver list as a numbered text summary (for debug display).
function _receiversText(receivers){
  if(!receivers || !receivers.length) return "No receivers placed yet.";
  return receivers.map((r,i)=>`${i+1}. ${r.label||r.id} @ (${(r.x||0).toFixed(3)}, ${(r.y||0).toFixed(3)})`).join("\n");
}

// Clamp a value to [0, 1] — all map coordinates are stored normalized.
function clamp01(x){
  if(!isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

// ─── Scanner Placement Recommender ───────────────────────────────────────────
// Analyses coverage gaps by scoring each room based on: distance from nearest
// receiver (primary driver), live traffic volume, and signal strength. Rooms
// scoring above a threshold are merged into a convex-hull "recommended zone"
// polygon, which is displayed as a yellow overlay on the map.

// Andrew's monotone chain convex hull — O(n log n).
function _convexHull(pts){
  if(pts.length < 3) return pts.slice();
  const s = pts.slice().sort((a,b)=> a[0]!==b[0] ? a[0]-b[0] : a[1]-b[1]);
  const cross = (O,A,B)=>(A[0]-O[0])*(B[1]-O[1])-(A[1]-O[1])*(B[0]-O[0]);
  const lo = [], hi = [];
  for(const p of s){
    while(lo.length>=2 && cross(lo[lo.length-2],lo[lo.length-1],p)<=0) lo.pop();
    lo.push(p);
  }
  for(let i=s.length-1;i>=0;i--){
    const p=s[i];
    while(hi.length>=2 && cross(hi[hi.length-2],hi[hi.length-1],p)<=0) hi.pop();
    hi.push(p);
  }
  lo.pop(); hi.pop();
  return lo.concat(hi);
}

// Inflate a convex hull outward from its centroid by `dist` (in 0–1 space).
// Gives the recommendation zone some padding for placement flexibility.
function _inflatePolygon(pts, dist){
  if(!pts.length) return pts;
  const cx = pts.reduce((s,p)=>s+p[0],0)/pts.length;
  const cy = pts.reduce((s,p)=>s+p[1],0)/pts.length;
  return pts.map(([x,y])=>{
    const dx=x-cx, dy=y-cy;
    const d=Math.sqrt(dx*dx+dy*dy)||1e-6;
    return [
      Math.max(0.01, Math.min(0.99, x + dx/d * dist)),
      Math.max(0.01, Math.min(0.99, y + dy/d * dist)),
    ];
  });
}

// Returns { polygon, rooms, topScore } or null if no meaningful gap found.
function _recommendPlacement(receivers, roomBounds, snap){
  const objects = snap?.objects ? Object.values(snap.objects) : [];

  // Only rooms with drawn polygons on this map
  const rooms = Object.entries(roomBounds)
    .filter(([,b])=> b && b.type==="poly" && Array.isArray(b.points) && b.points.length >= 3)
    .map(([room, b])=>({ room, points: b.points, centroid: _centroid(b.points) }));
  if(!rooms.length) return null;

  // Traffic and best RSSI per room from the live snapshot
  const trafficByRoom = {}, rssiByRoom = {};
  for(const obj of objects){
    const r = obj.room || ""; if(!r) continue;
    trafficByRoom[r] = (trafficByRoom[r]||0) + 1;
    const v = obj.rssi != null ? Number(obj.rssi) : null;
    if(v != null && (rssiByRoom[r] == null || v > rssiByRoom[r])) rssiByRoom[r] = v;
  }

  // Score each room: far from receivers = high need; traffic + weak signal add weight
  const scored = rooms.map(({room, points, centroid})=>{
    let minDist = receivers.length ? 2.0 : 1.0;
    for(const rx of receivers){
      const d = Math.hypot((rx.x||0)-centroid[0], (rx.y||0)-centroid[1]);
      if(d < minDist) minDist = d;
    }
    let score = Math.min(1.0, minDist * 2.0);      // geometric gap (primary driver)
    if((trafficByRoom[room]||0) > 0) score += 0.35; // live traffic bonus
    const rssi = rssiByRoom[room] ?? -100;
    if(rssi < -80) score += 0.15;                   // weak signal
    if(rssi < -88) score += 0.15;                   // very weak signal
    return {room, points, centroid, score, minDist};
  });

  scored.sort((a,b)=>b.score-a.score);
  const maxScore = scored[0]?.score ?? 0;
  if(maxScore < 0.3) return null; // everything looks well-covered

  // Include rooms scoring ≥55% of max — builds a generous candidate zone
  const threshold = maxScore * 0.55;
  const candidates = scored.filter(r=>r.score >= threshold);

  // Convex hull of all candidate room vertices, then inflate for placement flexibility
  const allPts = [];
  for(const c of candidates) allPts.push(...c.points);
  if(allPts.length < 3) return null;
  const hull = _convexHull(allPts);
  if(hull.length < 3) return null;
  const polygon = _inflatePolygon(hull, 0.13); // expand ~13% of map width outward

  return { polygon, rooms: candidates.map(c=>c.room), topScore: maxScore };
}

// ── Alignment Conflict & Tie-in Helpers ──────────────────────────────────────
// Tie-ins are stored alignment snapshots (x_offset, y_offset, scale, rotation)
// referencing a specific map. When the user drags a target map to a new
// position, these helpers detect whether the new position conflicts with
// previously recorded tie-in constraints.
//
// Conflict severity is computed as a weighted metric:
//   55% offset distance + 30% scale difference + 15% rotation difference.
// <5% → auto-average silently; 5–25% → offer Average & Save; >25% → warn.

// Returns array of conflict objects for any tie-ins that differ from the new position.
function _checkAlignConflicts(newX, newY, newScale, newRot, tgtMap, allMaps) {
  const tieIns = (tgtMap?.stack?.tie_ins) || [];
  if(!tieIns.length) return [];
  const conflicts = [];
  for(const ti of tieIns) {
    const refMap = allMaps.find(m=>m.id === ti.ref_map_id);
    const refName = refMap ? (refMap.name||refMap.id) : (ti.ref_map_id||"Unknown");
    const dx = newX - (ti.x_offset||0);
    const dy = newY - (ti.y_offset||0);
    const offPct   = Math.round(Math.sqrt(dx*dx + dy*dy) * 100);
    const scaleDiff = Math.abs(newScale - (ti.scale||1.0)) / Math.max(Math.abs(newScale), Math.abs(ti.scale||1.0), 0.001);
    const scalePct  = Math.round(scaleDiff * 100);
    const rotRaw    = Math.abs(((newRot||0) - (ti.rotation||0) + 540) % 360 - 180);
    const rotDiff   = Math.round(rotRaw * 10) / 10;
    // Weighted overall variance: offset 55%, scale 30%, rotation 15%
    const variancePct = Math.round(offPct * 0.55 + scalePct * 0.30 + (rotRaw / 180) * 100 * 0.15);
    if(offPct >= 3 || scalePct >= 3 || rotRaw >= 3) {
      conflicts.push({ ti, refName, offPct, scalePct, rotDiff, variancePct });
    }
  }
  return conflicts;
}

// Average the new alignment with all existing tie-in constraints equally.
// Used for auto-reconciliation when conflicts are minor (<5% variance).
function _averageAlignWithTieIns(newX, newY, newScale, newRot, tieIns) {
  const xs = [newX], ys = [newY], ss = [newScale], rs = [newRot||0];
  for(const ti of tieIns){
    xs.push(ti.x_offset||0); ys.push(ti.y_offset||0);
    ss.push(ti.scale||1.0);  rs.push(ti.rotation||0);
  }
  const avg = arr => arr.reduce((a,b)=>a+b,0) / arr.length;
  return { x_offset: avg(xs), y_offset: avg(ys), scale: avg(ss), rotation: avg(rs) };
}

// Returns true if a map qualifies for master designation. A map is eligible
// if it hasn't been moved/scaled/rotated from its default position — i.e.,
// it's still "pristine" and would make a natural alignment anchor.
function _isMasterEligible(m) {
  if(_isOutsideMap(m)) return false;  // Outside maps cannot be masters
  const s = m.stack || {};
  return Math.abs(s.x_offset||0)          < 0.05
      && Math.abs(s.y_offset||0)          < 0.05
      && Math.abs((s.scale||1.0) - 1.0)   < 0.05
      && Math.abs(s.rotation||0)          < 2.0
      && Math.abs((s.scale_x_adj||1.0) - 1.0) < 0.05
      && !s.ref_map_id;
}

// ── Change Master — Transform Helpers + Wizard ───────────────────────────────
// Changing the master is a destructive operation: the old master gets the
// inverse of the new master's transform, and all maps that referenced the old
// master are relinked via composed transforms. Floating-point rounding means
// the result may not match the original layout perfectly.

// Compute the inverse of a 2D similarity transform (translate + rotate + scale).
// If B maps master → new_master, then B⁻¹ maps new_master → master.
function _invertTransform(bx, by, bs, br_deg) {
  const br = (br_deg || 0) * Math.PI / 180;
  const invS = 1.0 / (bs || 1.0);
  return {
    x: Math.round(invS * (-(bx||0) * Math.cos(br) - (by||0) * Math.sin(br)) * 10000) / 10000,
    y: Math.round(invS * ( (bx||0) * Math.sin(br) - (by||0) * Math.cos(br)) * 10000) / 10000,
    scale: Math.round(invS * 10000) / 10000,
    rotation: Math.round(-(br_deg || 0) * 100) / 100,
  };
}

// Compose two 2D similarity transforms: result = outer ∘ inner.
// Used to relink maps that referenced the old master through the new master.
function _composeTransforms(outer, inner) {
  const or_rad = (outer.rotation || 0) * Math.PI / 180;
  const cos_r = Math.cos(or_rad);
  const sin_r = Math.sin(or_rad);
  const ix = inner.x || 0, iy = inner.y || 0;
  return {
    x: Math.round(((outer.x || 0) + (outer.scale || 1) * (ix * cos_r - iy * sin_r)) * 10000) / 10000,
    y: Math.round(((outer.y || 0) + (outer.scale || 1) * (ix * sin_r + iy * cos_r)) * 10000) / 10000,
    scale: Math.round((outer.scale || 1) * (inner.scale || 1) * 10000) / 10000,
    rotation: Math.round(((outer.rotation || 0) + (inner.rotation || 0)) * 100) / 100,
  };
}

// Execute the master swap: (1) new master → pristine origin, (2) old master →
// inverse transform referenced to new master, (3) relink all other maps that
// directly referenced old master via composed transforms.
async function _executeChangeMaster(ctx, oldMaster, newMaster, allMaps) {
  const ns = newMaster.stack || {};
  const bx = ns.x_offset || 0, by = ns.y_offset || 0;
  const bs = ns.scale || 1.0, br = ns.rotation || 0;
  const bsx = ns.scale_x_adj || 1.0;
  const inv = _invertTransform(bx, by, bs, br);

  // 1. New master → pristine origin
  await ctx.actions.mapsUpdate({
    map_id: newMaster.id, receivers: newMaster.receivers||[],
    calibration: newMaster.calibration||{}, notes: newMaster.notes||"",
    floor_id: newMaster.floor_id||"", room_bounds: newMaster.room_bounds||{},
    stack: Object.assign({}, ns, {
      is_master: true, x_offset: 0, y_offset: 0, scale: 1.0,
      rotation: 0, scale_x_adj: 1.0, ref_map_id: null, tie_ins: [],
    }),
  });

  // 2. Old master → inverse transform, referenced to new master
  const os = oldMaster.stack || {};
  await ctx.actions.mapsUpdate({
    map_id: oldMaster.id, receivers: oldMaster.receivers||[],
    calibration: oldMaster.calibration||{}, notes: oldMaster.notes||"",
    floor_id: oldMaster.floor_id||"", room_bounds: oldMaster.room_bounds||{},
    stack: Object.assign({}, os, {
      is_master: false, x_offset: inv.x, y_offset: inv.y,
      scale: inv.scale, rotation: inv.rotation,
      scale_x_adj: bsx ? (Math.round((1.0 / bsx) * 10000) / 10000) : 1.0,
      ref_map_id: newMaster.id, tie_ins: [],
    }),
  });

  // 3. Relink maps that directly referenced old master
  let relinked = 0;
  for (const m of allMaps) {
    if (m.id === oldMaster.id || m.id === newMaster.id) continue;
    const ms = m.stack || {};
    if (ms.ref_map_id !== oldMaster.id) continue;
    const comp = _composeTransforms(
      { x: inv.x, y: inv.y, scale: inv.scale, rotation: inv.rotation },
      { x: ms.x_offset||0, y: ms.y_offset||0, scale: ms.scale||1.0, rotation: ms.rotation||0 }
    );
    await ctx.actions.mapsUpdate({
      map_id: m.id, receivers: m.receivers||[], calibration: m.calibration||{},
      notes: m.notes||"", floor_id: m.floor_id||"", room_bounds: m.room_bounds||{},
      stack: Object.assign({}, ms, {
        x_offset: comp.x, y_offset: comp.y,
        scale: comp.scale, rotation: comp.rotation,
        ref_map_id: newMaster.id,
      }),
    });
    relinked++;
  }
  return relinked;
}

// Multi-step wizard for changing the master map. Step 1: risk warning.
// Step 2: select new master + verify its alignment to the current master.
// Step 3: execute swap and show result. The wizard enforces that the new
// master must be aligned to the current master before the swap proceeds.
function _changeMasterWizard(ctx, allMaps, currentMaster) {
  const { el } = ctx.helpers;
  const esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const container = el("div",{});
  let _newId = null;

  function _step(n, result) {
    container.innerHTML = "";
    if (n < 1) return;
    const card = el("div",{});

    if (n === 1) {
      // ── Warning ──
      card.style.cssText = "padding:16px;border-radius:10px;background:#1a0a00;border:2px solid #dc2626;margin-top:12px";
      card.appendChild(el("div",{style:"font-weight:700;font-size:15px;color:#fca5a5;margin-bottom:10px"}, "\u26A0 Change Master Map"));
      card.appendChild(el("div",{style:"font-size:13px;color:#fbbf24;font-weight:600;margin-bottom:8px;padding:8px 10px;background:#2a1500;border-radius:6px;border:1px solid #d97706"},
        "It is strongly recommended that you do not do this. There are no guarantees."));
      card.appendChild(el("div",{style:"font-size:12px;color:#e2e8f0;line-height:1.7;margin-bottom:10px"},
        "Changing the master map after other maps have been aligned to it is a destructive operation. " +
        "PadSpan will attempt to recompute alignment transforms, but floating-point rounding, rotation artifacts, " +
        "and cascading offsets mean the result may not match your current layout. You may need to manually re-align every map afterward."));
      const riskList = el("div",{style:"margin:8px 0 12px;padding:10px;background:#0f0000;border-radius:6px;font-size:12px;color:#fca5a5;line-height:1.8"});
      riskList.innerHTML = [
        "\u2022 <b>All alignments may break</b> \u2014 maps positioned relative to the old master are recomputed with best-effort math",
        "\u2022 <b>Calibration data drifts</b> \u2014 k-NN fingerprint positions are stored in the old master\u2019s coordinate system",
        "\u2022 <b>Room boundary authority shifts</b> \u2014 the master\u2019s room polygons take precedence for presence detection",
        "\u2022 <b>3D stack rearranges</b> \u2014 the isometric view anchors to the master as its base layer",
        "\u2022 <b>Tie-in history is lost</b> \u2014 tie-in constraints are cleared on both old and new master",
      ].join("<br>");
      card.appendChild(riskList);
      const btnRow = el("div",{style:"display:flex;gap:10px;flex-wrap:wrap"});
      btnRow.appendChild(el("button",{class:"btn inline danger",style:"font-weight:600", onclick:()=> _step(2)}, "I understand the risks \u2014 continue"));
      btnRow.appendChild(el("button",{class:"btn inline",style:"color:#94a3b8", onclick:()=> _step(0)}, "Cancel"));
      card.appendChild(btnRow);
    }

    else if (n === 2) {
      // ── Select + verify alignment ──
      card.style.cssText = "padding:16px;border-radius:10px;background:#1a0a00;border:2px solid #d97706;margin-top:12px";
      card.appendChild(el("div",{style:"font-weight:700;font-size:15px;color:#fbbf24;margin-bottom:10px"}, "\u26A0 Step 2 \u2014 Select & Verify Alignment"));
      const others = allMaps.filter(m => m.id !== currentMaster.id);
      if (!others.length) {
        card.appendChild(el("div",{class:"muted"}, "No other maps available."));
        card.appendChild(el("button",{class:"btn inline",style:"margin-top:8px;color:#94a3b8", onclick:()=> _step(0)}, "Cancel"));
        container.appendChild(card); return;
      }

      if (!_newId) _newId = others[0].id;
      const sel = document.createElement("select"); sel.className = "select"; sel.style.maxWidth = "300px";
      for (const om of others) {
        const o = document.createElement("option"); o.value = om.id; o.textContent = om.name || om.id;
        if (om.id === _newId) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => { _newId = sel.value; _step(2); });
      card.appendChild(el("div",{style:"margin-bottom:10px"},[ el("div",{style:"font-size:12px;color:#94a3b8;margin-bottom:4px"}, "New master:"), sel ]));

      const newM = allMaps.find(m => m.id === _newId);
      const ns = newM?.stack || {};
      const hasAlign = newM && ns.ref_map_id === currentMaster.id;

      const alignBox = el("div",{style:"margin:10px 0;padding:10px;border-radius:6px;font-size:12px;line-height:1.6"});
      if (hasAlign) {
        alignBox.style.cssText += ";background:#0a2a1a;border:1px solid #52b788;color:#86efac";
        alignBox.innerHTML = "\u2713 <b>" + esc(newM.name||newM.id) + "</b> is aligned to the current master.<br>" +
          '<span style="font-family:monospace;font-size:11px;color:#94a3b8">' +
          "Offset: (" + (ns.x_offset||0).toFixed(3) + ", " + (ns.y_offset||0).toFixed(3) + ")  Scale: " + (ns.scale||1).toFixed(3) + "  Rot: " + (ns.rotation||0).toFixed(1) + "\u00B0</span><br><br>" +
          "<b>Make sure this alignment is as accurate as possible before proceeding.</b> " +
          "If the two maps are not perfectly aligned, every other map\u2019s position will drift after the swap.";
      } else {
        alignBox.style.cssText += ";background:#1a0a00;border:1px solid #d97706;color:#fbbf24";
        alignBox.innerHTML = "\u26A0 <b>" + esc(newM?.name||newM?.id||"?") + "</b> is <b>not aligned</b> to the current master.<br><br>" +
          "You <b>must</b> align these two maps first. Go to the <b>Alignment</b> tab: set the current master (\u2B50) as Reference " +
          "and this map as Target. Drag, scale, and rotate until structural features (walls, stairwells) match perfectly. " +
          "Save the alignment, then return here.";
      }
      card.appendChild(alignBox);

      const btnRow = el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;margin-top:10px"});
      if (!hasAlign) {
        btnRow.appendChild(el("button",{class:"btn inline",style:"background:#1e3a5f;border-color:#3b82f6;color:#93c5fd", onclick:()=>{
          _step(0); ctx.actions.setMapsTab("alignment");
        }}, "Go to Alignment tab"));
      }
      if (hasAlign) {
        btnRow.appendChild(el("button",{class:"btn inline danger",style:"font-weight:600", onclick: async ()=>{
          btnRow.innerHTML = '<span style="color:#94a3b8;font-size:12px">Executing swap\u2026</span>';
          try {
            const relinked = await _executeChangeMaster(ctx, currentMaster, newM, allMaps);
            await ctx.actions.mapsRefresh();
            _step(3, { ok: true, relinked });
          } catch(e) { ctx.toast("Master swap failed: " + String(e), true); _step(3, { ok: false, err: String(e) }); }
        }}, "Execute Master Swap"));
      }
      btnRow.appendChild(el("button",{class:"btn inline",style:"color:#94a3b8", onclick:()=> _step(0)}, "Cancel"));
      card.appendChild(btnRow);
    }

    else if (n === 3) {
      // ── Result ──
      const ok = result?.ok;
      card.style.cssText = "padding:16px;border-radius:10px;margin-top:12px;background:" + (ok ? "#0a1a0a" : "#1a0a00") + ";border:2px solid " + (ok ? "#52b788" : "#dc2626");
      card.appendChild(el("div",{style:"font-weight:700;font-size:15px;color:" + (ok ? "#86efac" : "#fca5a5")}, ok ? "\u2713 Master Map Changed" : "\u26A0 Swap Failed"));
      if (ok) {
        card.appendChild(el("div",{style:"font-size:12px;color:#e2e8f0;line-height:1.7;margin-top:8px"},
          "The master has been transferred. The old master received an inverse transform. " +
          (result.relinked > 0 ? result.relinked + " other map(s) were recomputed to reference the new master. " : "") +
          "Please verify all map alignments in the 3D Stack and Alignment tabs. " +
          "If anything looks wrong, re-align the affected maps manually."));
      } else {
        card.appendChild(el("div",{style:"font-size:12px;color:#fca5a5;margin-top:8px"}, result?.err || "Unknown error"));
      }
      card.appendChild(el("button",{class:"btn inline",style:"margin-top:10px", onclick:()=> _step(0)}, "Close"));
    }

    container.appendChild(card);
  }

  _step(1);
  return container;
}

// ── Emergency Tie-in Recovery ─────────────────────────────────────────────────
// Scans all maps for inconsistent tie-ins and produces a recovery plan.
// Uses consensus clustering: each tie-in "votes" for a position, and outliers
// (those that agree with fewer than half the max-agreement cluster) are removed.
// The saved primary alignment is treated as an implicit vote.
// Returns array of { map, keptTieIns, removedTieIns, reason }.
function _emergencyRecoverTieIns(allMaps) {
  const OFF_T   = 0.20;   // normalized offset distance threshold
  const SCALE_T = 0.25;   // scale difference threshold
  const ROT_T   = 35;     // rotation degrees threshold
  const plans   = [];

  for(const m of allMaps){
    const tieIns = (m.stack?.tie_ins) || [];
    if(!tieIns.length) continue;

    // Primary saved alignment (if it exists) is treated as an implicit vote
    const hasPrimary = m.stack && (m.stack.x_offset !== undefined);
    const pv = hasPrimary ? {
      x: m.stack.x_offset ?? 0, y: m.stack.y_offset ?? 0,
      s: m.stack.scale ?? 1,    r: m.stack.rotation ?? 0,
      isPrimary: true,
    } : null;

    // Single tie-in: compare against primary only
    if(tieIns.length === 1){
      if(!pv) continue;
      const ti = tieIns[0];
      const dx = (ti.x_offset||0) - pv.x, dy = (ti.y_offset||0) - pv.y;
      const offDist  = Math.sqrt(dx*dx + dy*dy);
      const sDiff    = Math.abs((ti.scale||1) - pv.s);
      const rDiff    = Math.abs(((ti.rotation||0) - pv.r + 540) % 360 - 180);
      const varPct   = Math.round(offDist*100*0.55 + sDiff*100*0.30 + (rDiff/180)*100*0.15);
      if(offDist > OFF_T * 1.5 || sDiff > SCALE_T * 1.5 || rDiff > ROT_T * 1.5){
        plans.push({ map: m, keptTieIns: [], removedTieIns: tieIns,
          reason: `sole tie-in deviates ${varPct}% from saved position` });
      }
      continue;
    }

    // 2+ tie-ins: consensus cluster analysis
    // Each slot: tie-in index maps to allVotes index; primary (if present) appended at end
    const allVotes = [
      ...tieIns.map(ti => ({ x: ti.x_offset||0, y: ti.y_offset||0, s: ti.scale||1, r: ti.rotation||0 })),
      ...(pv ? [{ x: pv.x, y: pv.y, s: pv.s, r: pv.r }] : []),
    ];

    const agreeCount = allVotes.map((v, i) => {
      let n = 0;
      for(let j = 0; j < allVotes.length; j++){
        if(i === j) continue;
        const w = allVotes[j];
        const dx = v.x - w.x, dy = v.y - w.y;
        const rDiff = Math.abs((v.r - w.r + 540) % 360 - 180);
        if(Math.sqrt(dx*dx + dy*dy) <= OFF_T && Math.abs(v.s - w.s) <= SCALE_T && rDiff <= ROT_T) n++;
      }
      return n;
    });

    // Maximum agreements any single vote has
    const maxAgree = Math.max(...agreeCount);
    // Drop votes with fewer than half the max agreement (outliers)
    const keepMin  = Math.max(1, Math.ceil(maxAgree / 2));

    // Only tie-ins (not the primary vote) are removed
    const removedTieIns = tieIns.filter((_, i) => agreeCount[i] < keepMin);
    const keptTieIns    = tieIns.filter((_, i) => agreeCount[i] >= keepMin);

    if(removedTieIns.length > 0){
      plans.push({ map: m, keptTieIns, removedTieIns,
        reason: `${removedTieIns.length} outlier${removedTieIns.length>1?"s":""} outside consensus cluster` });
    }
  }
  return plans;
}

// ── Export Tab ───────────────────────────────────────────────────────────────
// Five export sections:
//   1. Floor Plan Image — raw PNG download
//   2. Room Drawing SVG — scalable room boundaries + receiver dots
//   3. Combined PNG — floor plan + room overlay composited via canvas
//   4. Full 3D Building — isometric SVG/PNG of all floors
//   5. Map Data Backup — full JSON backup/restore including base64 images
function _export(ctx, active, maps_list){
  const { el } = ctx.helpers;

  if(!maps_list || !maps_list.length){
    const card = el("div",{class:"card"});
    card.appendChild(el("div",{class:"muted",style:"margin-top:10px"},"No maps uploaded yet. Go to Upload tab."));
    return card;
  }

  // Map selector state
  if(!ctx.state.maps._exportMapId || !maps_list.find(m=>m.id===ctx.state.maps._exportMapId))
    ctx.state.maps._exportMapId = maps_list[0].id;
  const exportMap = maps_list.find(m=>m.id===ctx.state.maps._exportMapId) || maps_list[0];

  const card = el("div",{class:"card"});
  card.appendChild(el("div",{style:"font-weight:700;font-size:15px;margin-bottom:10px"},"Export"));

  // Map selector
  const mapSel = document.createElement("select");
  mapSel.className = "select";
  for(const m of maps_list){
    const o = document.createElement("option");
    o.value = m.id; o.textContent = m.name || m.id;
    if(m.id === exportMap.id) o.selected = true;
    mapSel.appendChild(o);
  }
  mapSel.addEventListener("change", () => { ctx.state.maps._exportMapId = mapSel.value; ctx.actions.renderRooms(); });
  card.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px"},[
    el("div",{class:"muted",style:"font-size:12px"},"Map:"), mapSel,
  ]));

  // ── 1: Floor Plan Image ───────────────────────────────────────────────────
  const sec1 = el("div",{class:"card",style:"margin-top:0"});
  sec1.appendChild(el("div",{style:"font-weight:600;margin-bottom:4px"},"1 · Floor Plan Image"));
  sec1.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:8px"},"Download the raw floor plan PNG as uploaded."));
  const pngUrl = exportMap.image?.filename ? `/local/padspan_ha/maps/${exportMap.image.filename}` : null;
  const dlPng = el("a",{class:"btn inline", href:pngUrl||"#", download:(exportMap.name||exportMap.id||"map")+".png"}, "Download PNG");
  if(!pngUrl) dlPng.setAttribute("disabled","disabled");
  const openPng = el("a",{class:"btn inline", href:pngUrl||"#", target:"_blank"}, "Open in new tab");
  if(!pngUrl) openPng.setAttribute("disabled","disabled");
  sec1.appendChild(el("div",{style:"display:flex;gap:8px;flex-wrap:wrap"},[dlPng, openPng]));
  card.appendChild(sec1);

  // ── 2: Room Drawing SVG ───────────────────────────────────────────────────
  const sec2 = el("div",{class:"card",style:"margin-top:10px"});
  sec2.appendChild(el("div",{style:"font-weight:600;margin-bottom:4px"},"2 · Room Drawing (SVG)"));
  sec2.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:8px"},"Scalable SVG of room boundaries and radio positions."));
  const dlSvgBtn = el("button",{class:"btn inline", onclick:()=>{
    const svgStr = _buildRoomBoundsSVG(exportMap, ctx, false);
    _downloadBlob(new Blob([svgStr], {type:"image/svg+xml"}), (exportMap.name||exportMap.id||"map")+"_rooms.svg");
  }}, "Download SVG");
  sec2.appendChild(dlSvgBtn);
  card.appendChild(sec2);

  // ── 3: Combined PNG ───────────────────────────────────────────────────────
  const sec3 = el("div",{class:"card",style:"margin-top:10px"});
  sec3.appendChild(el("div",{style:"font-weight:600;margin-bottom:4px"},"3 · Combined (Floor Plan + Rooms)"));
  sec3.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:8px"},"Floor plan image with room overlay rendered to PNG in your browser."));
  const combStatus = el("div",{class:"muted",style:"font-size:12px;min-height:16px"});
  const combBtn = el("button",{class:"btn inline", onclick:async()=>{
    combBtn.disabled = true; combStatus.textContent = "Rendering…";
    try{
      const blob = await _combinedMapPng(exportMap, ctx);
      _downloadBlob(blob, (exportMap.name||exportMap.id||"map")+"_combined.png");
      combStatus.textContent = "Downloaded ✓";
    }catch(e){ combStatus.textContent = "Render failed: "+String(e); }
    combBtn.disabled = false;
  }}, "Render & Download PNG");
  sec3.appendChild(el("div",{style:"display:flex;gap:10px;align-items:center;flex-wrap:wrap"},[combBtn, combStatus]));
  card.appendChild(sec3);

  // ── 4: Full 3D Building ───────────────────────────────────────────────────
  const sec4 = el("div",{class:"card",style:"margin-top:10px"});
  sec4.appendChild(el("div",{style:"font-weight:600;margin-bottom:4px"},"4 · Full 3D Building"));
  sec4.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:8px"},"Isometric rendering of all floors. Download as scalable SVG or browser-rendered PNG."));
  const haFloors2 = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
  const lvlOpts2 = haFloors2.length > 0
    ? haFloors2.slice().sort((a,b)=>(a.level??999)-(b.level??999)).map((f,i)=>({value:f.level??i,label:f.name||f.id}))
    : _LEVEL_NAMES.map((n,i)=>({value:i,label:n}));
  const isoSvgStr = _stackIsoSVG(maps_list, ctx, lvlOpts2, null, ctx.state.maps._stackFloorGap || 200, ctx.state.maps._stackHorizGap || 0);
  const isoStatus = el("div",{class:"muted",style:"font-size:12px;min-height:16px"});
  const dlIsoSvg = el("button",{class:"btn inline", onclick:()=>{
    _downloadBlob(new Blob([isoSvgStr], {type:"image/svg+xml"}), "building_3d.svg");
  }}, "Download SVG");
  const dlIsoPng = el("button",{class:"btn inline", onclick:async()=>{
    dlIsoPng.disabled = true; isoStatus.textContent = "Rendering PNG…";
    try{
      const _vb = isoSvgStr.match(/viewBox="0 0 (\d+) (\d+)"/);
      const _iw = _vb ? parseInt(_vb[1],10) : 780;
      const _ih = _vb ? parseInt(_vb[2],10) : 520;
      const blob = await _svgStringToPng(isoSvgStr, _iw, _ih);
      _downloadBlob(blob, "building_3d.png");
      isoStatus.textContent = "Downloaded ✓";
    }catch(e){ isoStatus.textContent = "Render failed: "+String(e); }
    dlIsoPng.disabled = false;
  }}, "Render PNG");
  sec4.appendChild(el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center"},[dlIsoSvg, dlIsoPng, isoStatus]));
  card.appendChild(sec4);

  // ── 5: Map Data Backup (JSON) ─────────────────────────────────────────────
  const secJ = el("div",{class:"card",style:"margin-top:10px"});
  secJ.appendChild(el("div",{style:"font-weight:600;margin-bottom:4px"},"5 · Map Data Backup (JSON)"));
  secJ.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:8px"},
    "Export a full backup of ALL maps including floor plan images. Use Restore to recover mapping data after reinstall."));

  // ── Backup button
  const backupStatus = el("div",{class:"muted",style:"font-size:12px;min-height:18px"});
  const backupBtn = el("button",{class:"btn inline", onclick:async()=>{
    backupBtn.disabled = true; backupStatus.textContent = "Building backup…";
    try{
      const allMaps = ctx.state.maps.list || [];
      const backupMaps = [];
      for(let i=0;i<allMaps.length;i++){
        const m = allMaps[i];
        backupStatus.textContent = `Fetching ${i+1}/${allMaps.length}: ${m.name||m.id}…`;
        const entry = JSON.parse(JSON.stringify(m));
        if(m.image?.filename){
          try{
            const resp = await fetch(`/local/padspan_ha/maps/${m.image.filename}`);
            if(resp.ok){
              const blob = await resp.blob();
              entry.png_base64 = await new Promise((res,rej)=>{
                const fr = new FileReader();
                fr.onload = ()=>res(fr.result.split(",")[1]);
                fr.onerror = rej; fr.readAsDataURL(blob);
              });
            }
          }catch(e2){ /* skip image if unavailable */ }
        }
        backupMaps.push(entry);
      }
      const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,"");
      const backup = { padspan_backup:"v1", exported_at:new Date().toISOString(), count:backupMaps.length, maps:backupMaps };
      _downloadBlob(new Blob([JSON.stringify(backup,null,2)],{type:"application/json"}), `maps_backup_${dateStr}.json`);
      backupStatus.textContent = `Backup downloaded (${backupMaps.length} map${backupMaps.length!==1?"s":""}) ✓`;
    }catch(e){ backupStatus.textContent = "Backup failed: "+String(e); }
    backupBtn.disabled = false;
  }}, "Backup All Maps (JSON)");
  secJ.appendChild(el("div",{style:"display:flex;gap:10px;align-items:center;flex-wrap:wrap"},[backupBtn, backupStatus]));

  // ── Restore from backup
  secJ.appendChild(el("div",{style:"margin-top:14px;border-top:1px solid #1b3526;padding-top:12px;font-weight:600;font-size:13px"},"Restore from Backup"));
  secJ.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:8px"},
    "Choose a maps_backup_*.json file. Maps whose names already exist will be skipped to prevent duplicates."));

  const restoreInput = document.createElement("input");
  restoreInput.type = "file"; restoreInput.accept = ".json,application/json"; restoreInput.style.display = "none";
  const restorePreview = el("div",{style:"font-size:12px;color:#94a3b8;min-height:18px;margin-top:6px"});
  const restoreStatus = el("div",{class:"muted",style:"font-size:12px;min-height:18px;margin-top:4px"});
  const restoreBtn = el("button",{class:"btn inline",style:"display:none"},"Restore Maps");
  let _restoreData = null;

  restoreInput.addEventListener("change", async()=>{
    const file = restoreInput.files?.[0]; if(!file) return;
    restorePreview.textContent = "Reading…"; restoreBtn.style.display = "none"; _restoreData = null;
    try{
      const parsed = JSON.parse(await file.text());
      if(!parsed.padspan_backup || !Array.isArray(parsed.maps)){
        restorePreview.textContent = "❌ Not a valid PadSpan backup file."; return;
      }
      const existingNames = new Set((ctx.state.maps.list||[]).map(m=>m.name));
      const toRestore = parsed.maps.filter(m=>!existingNames.has(m.name));
      const skipCount = parsed.maps.length - toRestore.length;
      restorePreview.textContent = `${parsed.maps.length} maps in backup: ${toRestore.length} to restore${skipCount ? `, ${skipCount} already exist (skipped)` : ""}.`;
      if(toRestore.length){ _restoreData = toRestore; restoreBtn.style.display = ""; }
    }catch(e){ restorePreview.textContent = "❌ Parse error: "+String(e); }
  });

  restoreBtn.addEventListener("click", async()=>{
    if(!_restoreData?.length) return;
    if(!confirm(`Restore ${_restoreData.length} map(s) into your system?`)) return;
    restoreBtn.disabled = true; let ok=0, fail=0;
    for(let i=0;i<_restoreData.length;i++){
      const bm = _restoreData[i];
      restoreStatus.textContent = `Restoring ${i+1}/${_restoreData.length}: ${bm.name}…`;
      try{
        await ctx.actions.mapsUpload({
          name: bm.name||"Restored Map",
          filename: bm.image?.filename||"map.png",
          mime: bm.image?.mime||"image/png",
          width: bm.image?.width||800,
          height: bm.image?.height||600,
          png_base64: bm.png_base64||"",
          floor_id: bm.floor_id||"",
        });
        // mapsUpload refreshes ctx.state.maps.list — find the new map by name
        const newMap = (ctx.state.maps.list||[]).find(m=>m.name===(bm.name||"Restored Map"));
        if(newMap){
          await ctx.actions.mapsUpdate({
            map_id: newMap.id,
            receivers: bm.receivers||[],
            calibration: bm.calibration||{},
            notes: bm.notes||"",
            floor_id: bm.floor_id||"",
            room_bounds: bm.room_bounds||{},
            stack: bm.stack||{},
          });
        }
        ok++;
      }catch(e){ fail++; console.error("Restore failed for",bm.name,e); }
    }
    restoreStatus.textContent = `Restored ${ok} map${ok!==1?"s":""}${fail?` (${fail} failed)`:""} ✓`;
    restoreBtn.disabled = false; _restoreData = null; restoreBtn.style.display = "none";
    await ctx.actions.mapsRefresh();
  });

  const chooseBtn = el("button",{class:"btn inline", onclick:()=>restoreInput.click()}, "Choose Backup File…");
  secJ.appendChild(el("div",{style:"display:flex;gap:8px;align-items:center;flex-wrap:wrap"},[chooseBtn, restoreBtn]));
  secJ.appendChild(restoreInput);
  secJ.appendChild(restorePreview);
  secJ.appendChild(restoreStatus);
  card.appendChild(secJ);

  return card;
}

function _help(ctx){
  const { el } = ctx.helpers;
  const card = el("div",{class:"card"});
  card.appendChild(el("div",{style:"font-weight:700"},"How this mapping system works"));
  card.appendChild(el("div",{class:"muted", style:"margin-top:8px;line-height:1.5"},[
    "• Upload any floorplan image; the UI converts it to optimized PNG and stores it under /config/www/padspan_ha/maps/ so HA can serve it at /local/padspan_ha/maps/.",
    el("br"),
    "• Place receivers as normalized coordinates (0–1). This is the common industry approach (web GIS, indoor positioning) because it survives resizing.",
    el("br"),
    "• Next step after this: calibration layers (physical/distortion maps) + per-room fit, then drag-and-drop tag trajectories to validate.",
  ]));
  return card;
}

// ─── Sample Mode Demo Floor Plan ────────────────────────────────────────────
// When in sample/demo mode, the Library tab shows a hardcoded "Smith Residence"
// SVG floor plan with fake rooms, scanners, and objects. This gives new users
// a fully-functional preview of the system without needing any real hardware.

function _sampleDemo(ctx){
  const { el } = ctx.helpers;
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const fp = (snap && snap.floor_plan) || null;

  const card = el("div",{class:"card"});
  card.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;margin-bottom:4px"},[
    el("div",{style:"font-weight:700;font-size:16px"}, "Demo Floor Plan — Smith Residence"),
    el("span",{class:"badge"}, "Sample"),
  ]));
  card.appendChild(el("div",{class:"muted",style:"margin-bottom:12px"},
    "This shows a fully-configured system. Switch to Live mode and upload your own floor plan to get started."));

  const svgWrap = el("div",{style:"overflow:auto;border-radius:8px;background:#071008;padding:8px"});
  svgWrap.innerHTML = _buildDemoSVG(fp);
  card.appendChild(svgWrap);

  // Legend
  const legend = el("div",{style:"display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:12px;color:#94a3b8"});
  [
    ["#52b788", "BLE Scanner"],
    ["#52b788", "HA Entity (phone/tracker)", "circle"],
    ["#5eead4", "Tagged BLE object", "square"],
    ["#f59e0b", "Unidentified BLE", "triangle"],
  ].forEach(([color, label, shape]) => {
    const icon = document.createElement("div");
    icon.style.cssText = `width:12px;height:12px;flex-shrink:0;background:${color};border-radius:${shape==="square"?"2px":shape==="triangle"?"0":"50%"};clip-path:${shape==="triangle"?"polygon(50% 0%,100% 100%,0% 100%)":"none"}`;
    legend.appendChild(el("div",{style:"display:flex;align-items:center;gap:6px"},[icon, el("span",{},label)]));
  });
  card.appendChild(legend);
  return card;
}

function _buildDemoSVG(fp){
  const rooms = (fp && fp.rooms) || [
    { id:"living_room",    name:"Living Room",    x:10,  y:10,  w:370, h:200, color:"#52b788" },
    { id:"kitchen",        name:"Kitchen",        x:390, y:10,  w:400, h:200, color:"#4caf50" },
    { id:"hallway",        name:"Hallway",        x:10,  y:220, w:780, h:40,  color:"#388e3c" },
    { id:"office",         name:"Office",         x:10,  y:270, w:230, h:160, color:"#43a047" },
    { id:"master_bedroom", name:"Master Bedroom", x:250, y:270, w:540, h:160, color:"#66bb6a" },
  ];
  const radios = (fp && fp.radios) || [
    { name:"Living Room Hub", x:185, y:95  },
    { name:"Bedroom Hub",     x:520, y:345 },
    { name:"Kitchen Hub",     x:590, y:95  },
  ];
  const objects = (fp && fp.objects) || [
    { name:"Alice's Phone",  x:140, y:155, type:"entity",       color:"#52b788" },
    { name:"Bob's Phone",    x:360, y:380, type:"entity",       color:"#52b788" },
    { name:"Car Keys",       x:280, y:75,  type:"tagged_ble",   color:"#5eead4" },
    { name:"Wallet",         x:90,  y:175, type:"tagged_ble",   color:"#5eead4" },
    { name:"Backpack",       x:555, y:155, type:"tagged_ble",   color:"#5eead4" },
    { name:"?? Unknown",     x:400, y:370, type:"unidentified", color:"#f59e0b" },
    { name:"?? Unknown",     x:210, y:45,  type:"unidentified", color:"#f59e0b" },
  ];

  let s = `<svg viewBox="0 0 810 460" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:520px;display:block;font-family:system-ui,sans-serif">`;

  // Background
  s += `<rect width="810" height="460" fill="#071008"/>`;

  // Room fills
  for(const r of rooms){
    s += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.color}12" stroke="${r.color}" stroke-width="2"/>`;
  }

  // Furniture — Living Room
  s += `<rect x="25" y="148" width="140" height="48" fill="#1a3525" stroke="#2a5038" stroke-width="1" rx="4"/>`; // sofa
  s += `<rect x="25" y="148" width="140" height="13" fill="#1d3d2a" stroke="#2a5038" stroke-width="0.5" rx="2"/>`; // sofa back
  s += `<rect x="60" y="118" width="85" height="32" fill="#111e17" stroke="#1c3225" stroke-width="1" rx="2"/>`; // coffee table
  s += `<rect x="335" y="18" width="32" height="85" fill="#1a3525" stroke="#2a5038" stroke-width="1" rx="2"/>`; // bookshelf

  // Furniture — Kitchen
  s += `<rect x="395" y="14" width="392" height="38" fill="#1a3525" stroke="#2a5038" stroke-width="1"/>`; // counter top
  s += `<rect x="395" y="14" width="38" height="192" fill="#1a3525" stroke="#2a5038" stroke-width="1"/>`; // counter left
  s += `<rect x="488" y="78" width="135" height="70" fill="#1a3525" stroke="#2a5038" stroke-width="1" rx="3"/>`; // island
  s += `<circle cx="555" cy="113" r="22" fill="none" stroke="#2a5038" stroke-width="1.5" stroke-dasharray="3,2"/>`; // cooktop

  // Furniture — Master Bedroom
  s += `<rect x="428" y="293" width="205" height="125" fill="#1a3525" stroke="#2a5038" stroke-width="1" rx="5"/>`; // bed
  s += `<rect x="432" y="297" width="88" height="42" fill="#1c3a28" stroke="#2a5038" stroke-width="0.5" rx="3"/>`; // pillow L
  s += `<rect x="548" y="297" width="81" height="42" fill="#1c3a28" stroke="#2a5038" stroke-width="0.5" rx="3"/>`; // pillow R
  s += `<rect x="397" y="293" width="26" height="26" fill="#111e17" stroke="#1c3225" stroke-width="1" rx="2"/>`; // nightstand L
  s += `<rect x="638" y="293" width="26" height="26" fill="#111e17" stroke="#1c3225" stroke-width="1" rx="2"/>`; // nightstand R
  s += `<rect x="258" y="278" width="78" height="48" fill="#1a3525" stroke="#2a5038" stroke-width="1" rx="2"/>`; // dresser

  // Furniture — Office
  s += `<rect x="14" y="278" width="210" height="32" fill="#1a3525" stroke="#2a5038" stroke-width="1"/>`; // desk top
  s += `<rect x="14" y="278" width="32" height="90" fill="#1a3525" stroke="#2a5038" stroke-width="1"/>`; // desk side
  s += `<rect x="80" y="318" width="36" height="36" fill="#111e17" stroke="#1c3225" stroke-width="1" rx="18"/>`; // chair seat
  s += `<rect x="88" y="350" width="20" height="12" fill="#1a3525" stroke="#2a5038" stroke-width="1" rx="2"/>`; // chair base

  // Room labels
  for(const r of rooms){
    const cx = r.x + r.w/2;
    const cy = r.y + (r.id === "hallway" ? 28 : 24);
    s += `<text x="${cx}" y="${cy}" text-anchor="middle" fill="${r.color}" font-size="${r.id==="hallway"?"11":"13"}" font-weight="600" opacity="0.85">${_escSVG(r.name)}</text>`;
  }

  // Doors (gap + arc swing)
  const doors = [
    {x:110,y:220,w:30,top:false}, // Living Room → Hallway
    {x:470,y:210,w:30,top:false}, // Kitchen → Hallway (side)
    {x:75, y:270,w:30,top:true},  // Office → Hallway
    {x:415,y:270,w:30,top:true},  // Bedroom → Hallway
  ];
  for(const d of doors){
    s += `<rect x="${d.x}" y="${d.y-3}" width="${d.w}" height="7" fill="#071008"/>`; // gap
    const sweep = d.top ? 0 : 1;
    s += `<path d="M${d.x},${d.y} a${d.w},${d.w} 0 0,${sweep} ${d.w},0" fill="none" stroke="#52b78855" stroke-width="1.5" stroke-dasharray="4,2"/>`;
    s += `<line x1="${d.x}" y1="${d.y}" x2="${d.x}" y2="${d.top?d.y-d.w:d.y+d.w}" stroke="#52b78888" stroke-width="1.5" stroke-dasharray="2,2"/>`;
  }

  // Windows on exterior walls
  const wins = [
    {x1:10,y1:45,x2:10,y2:85,v:true},
    {x1:10,y1:115,x2:10,y2:155,v:true},
    {x1:450,y1:10,x2:560,y2:10,v:false},
    {x1:640,y1:10,x2:750,y2:10,v:false},
    {x1:790,y1:60,x2:790,y2:140,v:true},
    {x1:300,y1:430,x2:410,y2:430,v:false},
    {x1:500,y1:430,x2:630,y2:430,v:false},
    {x1:40, y1:430,x2:120,y2:430,v:false},
  ];
  for(const w of wins){
    s += `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="#4caf50" stroke-width="4" stroke-linecap="round"/>`;
    const mx=(w.x1+w.x2)/2, my=(w.y1+w.y2)/2;
    if(w.v) s += `<line x1="${mx-3}" y1="${my}" x2="${mx+3}" y2="${my}" stroke="#4caf5088" stroke-width="1.5"/>`;
    else    s += `<line x1="${mx}" y1="${my-3}" x2="${mx}" y2="${my+3}" stroke="#4caf5088" stroke-width="1.5"/>`;
  }

  // Exterior outline (thick walls)
  s += `<rect x="10" y="10" width="780" height="420" fill="none" stroke="#52b788" stroke-width="3" rx="2"/>`;

  // BLE scanner markers (concentric rings)
  for(const r of radios){
    const {x,y,name} = r;
    s += `<circle cx="${x}" cy="${y}" r="50" fill="none" stroke="#52b788" stroke-width="0.5" opacity="0.1"/>`;
    s += `<circle cx="${x}" cy="${y}" r="32" fill="none" stroke="#52b788" stroke-width="0.8" opacity="0.2"/>`;
    s += `<circle cx="${x}" cy="${y}" r="18" fill="none" stroke="#52b788" stroke-width="1.2" opacity="0.45"/>`;
    s += `<circle cx="${x}" cy="${y}" r="8"  fill="#52b788" opacity="0.95"/>`;
    s += `<circle cx="${x}" cy="${y}" r="3.5" fill="#071008"/>`;
    s += `<text x="${x}" y="${y+28}" text-anchor="middle" fill="#52b788" font-size="9" opacity="0.8">${_escSVG(name)}</text>`;
  }

  // Objects
  for(const o of objects){
    const {x,y,color,name,type} = o;
    if(type === "entity"){
      s += `<circle cx="${x}" cy="${y}" r="9" fill="${color}" opacity="0.95"/>`;
      s += `<circle cx="${x}" cy="${y}" r="4" fill="#071008" opacity="0.6"/>`;
    } else if(type === "tagged_ble"){
      s += `<rect x="${x-8}" y="${y-8}" width="16" height="16" fill="${color}" opacity="0.95" rx="3"/>`;
      s += `<rect x="${x-3}" y="${y-3}" width="6" height="6" fill="#071008" opacity="0.5" rx="1"/>`;
    } else {
      s += `<polygon points="${x},${y-10} ${x+9},${y+5} ${x-9},${y+5}" fill="${color}" opacity="0.85"/>`;
    }
    s += `<text x="${x}" y="${y-13}" text-anchor="middle" fill="${color}" font-size="9" font-weight="500">${_escSVG(name)}</text>`;
  }

  // Title in top-right corner
  s += `<rect x="620" y="375" width="175" height="46" fill="#0a150e" stroke="#1b3526" stroke-width="1" rx="4"/>`;
  s += `<text x="632" y="391" fill="#52b788" font-size="10" font-weight="700">Smith Residence (Demo)</text>`;
  s += `<text x="632" y="404" fill="#94a3b8" font-size="8">3 scanners · 5 objects · 5 rooms</text>`;
  s += `<text x="632" y="415" fill="#52b78870" font-size="8">PadSpan™ HA Sample Mode</text>`;

  s += `</svg>`;
  return s;
}

// ─── 3D Stack Tab ─────────────────────────────────────────────────────────────
// The spatial backbone of PadSpan's multi-floor system. Three main sections:
//
// 1. FLOOR ASSIGNMENT TABLE — assign each map to an HA floor, set z_level
//    (stacking order), ceiling height, and visibility toggle.
//
// 2. ALIGNMENT OVERLAY EDITOR — two layers stacked: the reference map (fixed)
//    and the target map (semi-transparent, draggable). User drags/scales/rotates
//    the target to align structural features. CSS transform with
//    transform-origin:50% 50% means translate moves the centre point, then
//    rotate+scale happen around that translated centre. View Zoom scales the
//    entire stage (not the maps) so both maps fit on screen.
//
// 3. 3D ISOMETRIC PREVIEW — SVG render of all floors stacked in isometric
//    perspective. Floor spacing, L/R offset, and focus floor are adjustable
//    via sliders. Outside maps are fitted inside the indoor bounding box.
//
// Also includes: Point Align (side-by-side affine solver), tie-in system,
// dual-master conflict resolution, and emergency tie-in recovery.

const _LEVEL_NAMES = ["Basement", "Ground", "Level 1", "Level 2", "Level 3"];

function _stack(ctx, maps, helpBtn){
  const { el, esc } = ctx.helpers;
  helpBtn = helpBtn || (()=>null);

  // Init alignment state — outside maps are excluded from alignment because
  // they use a different coordinate model (fitted to indoor bounding box).
  const _alignableMaps = maps.filter(m => !_isOutsideMap(m));
  if(!ctx.state.maps._stackAlign){
    const firstTgt = _alignableMaps[1] || _alignableMaps[0] || null;
    ctx.state.maps._stackAlign = {
      refId:      _alignableMaps[0] ? _alignableMaps[0].id : null,
      targetId:   firstTgt ? firstTgt.id : null,
      x_offset:   firstTgt?.stack?.x_offset   ?? 0.0,
      y_offset:   firstTgt?.stack?.y_offset   ?? 0.0,
      scale:      firstTgt?.stack?.scale      ?? 1.0,
      rotation:   firstTgt?.stack?.rotation   ?? 0.0,
      scaleX_adj: firstTgt?.stack?.scale_x_adj ?? 1.0,
    };
  }
  const alignState = ctx.state.maps._stackAlign;
  if(alignState.rotation   === undefined) alignState.rotation   = 0.0;
  if(alignState.scaleX_adj === undefined) alignState.scaleX_adj = 1.0;

  // Guard: ensure saved refId/targetId still valid after map deletions
  if(alignState.refId && !maps.find(m=>m.id===alignState.refId))
    alignState.refId = maps[0]?.id || null;
  if(alignState.targetId && !maps.find(m=>m.id===alignState.targetId)){
    const newTgt = maps[1] || maps[0] || null;
    alignState.targetId  = newTgt?.id || null;
    alignState.x_offset  = newTgt?.stack?.x_offset  ?? 0.0;
    alignState.y_offset  = newTgt?.stack?.y_offset  ?? 0.0;
    alignState.scale     = newTgt?.stack?.scale     ?? 1.0;
    alignState.rotation  = newTgt?.stack?.rotation  ?? 0.0;
  }

  // Level options: use HA floor registry if available, fall back to hardcoded names
  const haFloors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
  const levelOptions = haFloors.length > 0
    ? haFloors
        .slice()
        .sort((a,b)=> (a.level ?? 999) - (b.level ?? 999) || (a.name||"").localeCompare(b.name||""))
        .map((f, i) => ({ value: f.level ?? i, label: f.name || f.id }))
    : _LEVEL_NAMES.map((name, i) => ({ value: i, label: name }));

  // View zoom scales the entire overlay stage (not individual maps) so both
  // reference and target are visible even when the target is offset far off.
  // Target opacity controls how transparent the draggable overlay is.
  if(ctx.state.maps._stackViewScale  === undefined) ctx.state.maps._stackViewScale  = 1.0;
  if(ctx.state.maps._stackTgtOpacity === undefined) ctx.state.maps._stackTgtOpacity = 0.55;
  if(ctx.state.maps._stackOutsideMode === undefined) ctx.state.maps._stackOutsideMode = false;

  const card = el("div",{class:"card"});
  card.appendChild(el("div",{class:"card-head"},[
    el("div",{style:"font-weight:700"},"3D Floor Stack"),
    helpBtn("maps_stack"),
  ]));

  if(!maps.length){
    card.appendChild(el("div",{class:"muted",style:"margin-top:10px"},"No maps uploaded yet. Go to Upload tab first."));
    return card;
  }

  // ── Section 1: Floor Assignment & Ceiling Height Table ───────────────────
  card.appendChild(el("div",{class:"muted",style:"margin-top:16px;font-size:13px;font-weight:600"},"Floor Assignment & Ceiling Heights"));
  card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-top:2px"},"Assign each map to an HA floor (auto-sets stack level) and set ceiling height."));

  if(!ctx.state.maps._hiddenMapIds){
    // Prefer HA settings store (persists across restarts); fall back to localStorage
    const savedIds = ctx.state.settings?.hidden_map_ids;
    if(Array.isArray(savedIds)){
      ctx.state.maps._hiddenMapIds = new Set(savedIds);
    } else {
      try{
        const stored = JSON.parse(localStorage.getItem("padspan_hiddenMapIds")||"[]");
        ctx.state.maps._hiddenMapIds = new Set(Array.isArray(stored)?stored:[]);
      }catch(e){ ctx.state.maps._hiddenMapIds = new Set(); }
    }
  }
  const hiddenIds = ctx.state.maps._hiddenMapIds;

  const tableWrap = el("div",{style:"overflow-x:auto;margin-top:8px"});
  const table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;font-size:13px";
  const thead = document.createElement("thead");
  thead.innerHTML = `<tr style="border-bottom:1px solid #1b3526">
    <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:500">Map</th>
    <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:500">HA Floor</th>
    <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:500">Stack Level</th>
    <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:500">Ceiling (m)</th>
    <th style="text-align:center;padding:6px 8px;color:#94a3b8;font-weight:500">Show</th>
    <th style="padding:6px 8px"></th>
  </tr>`;
  table.appendChild(thead);
  const tbody = document.createElement("tbody");

  for(const m of maps){
    const stk = m.stack || {z_level:0,ceiling_height_m:2.4};
    const tr = document.createElement("tr");
    tr.style.cssText = "border-bottom:1px solid #0f2017";

    const tdName = document.createElement("td");
    tdName.style.cssText = "padding:6px 8px;font-weight:500";
    tdName.textContent = m.name || m.id;
    tr.appendChild(tdName);

    // HA Floor dropdown
    const tdFloor = document.createElement("td");
    tdFloor.style.cssText = "padding:6px 8px";
    const floorSel2 = document.createElement("select");
    floorSel2.className = "select";
    floorSel2.style.minWidth = "120px";
    const flOpt0 = document.createElement("option"); flOpt0.value = ""; flOpt0.textContent = "— None —";
    floorSel2.appendChild(flOpt0);
    haFloors.forEach(f => {
      const o = document.createElement("option");
      o.value = f.id; o.textContent = f.name || f.id;
      if(f.id === (m.floor_id||"")) o.selected = true;
      floorSel2.appendChild(o);
    });
    // Always offer "Outside" option
    const _oOpt2 = document.createElement("option");
    _oOpt2.value = OUTSIDE_FLOOR_ID; _oOpt2.textContent = "Outside (Experimental)";
    if(m.floor_id === OUTSIDE_FLOOR_ID) _oOpt2.selected = true;
    floorSel2.appendChild(_oOpt2);
    tdFloor.appendChild(floorSel2);
    tr.appendChild(tdFloor);

    // Stack level: ↓ number ↑
    const tdLevel = document.createElement("td");
    tdLevel.style.cssText = "padding:6px 8px;white-space:nowrap";
    const zLevelInput = document.createElement("input");
    zLevelInput.type = "number"; zLevelInput.min = "0"; zLevelInput.max = "20"; zLevelInput.step = "1";
    zLevelInput.value = String(stk.z_level ?? 0);
    zLevelInput.style.cssText = "width:52px;background:#0a150e;border:1px solid #1b3526;color:#e2e8f0;padding:4px 6px;border-radius:4px;text-align:center";
    const zDn = document.createElement("button"); zDn.className = "btn inline"; zDn.textContent = "↓"; zDn.style.padding = "2px 6px";
    zDn.addEventListener("click", () => { zLevelInput.value = String(Math.max(0, parseInt(zLevelInput.value||"0",10)-1)); });
    const zUp = document.createElement("button"); zUp.className = "btn inline"; zUp.textContent = "↑"; zUp.style.padding = "2px 6px";
    zUp.addEventListener("click", () => { zLevelInput.value = String(Math.min(20, parseInt(zLevelInput.value||"0",10)+1)); });
    // When HA floor changes, auto-sync z_level from floor.level attribute
    floorSel2.addEventListener("change", () => {
      const fl = haFloors.find(f => f.id === floorSel2.value);
      if(fl && fl.level != null) zLevelInput.value = String(fl.level);
    });
    tdLevel.appendChild(zDn);
    tdLevel.appendChild(zLevelInput);
    tdLevel.appendChild(zUp);
    tr.appendChild(tdLevel);

    // Ceiling input
    const tdCeil = document.createElement("td");
    tdCeil.style.cssText = "padding:6px 8px";
    const ceilInput = document.createElement("input");
    ceilInput.type = "number"; ceilInput.min = "1.5"; ceilInput.max = "20"; ceilInput.step = "0.1";
    ceilInput.value = String(stk.ceiling_height_m || 2.4);
    ceilInput.style.cssText = "width:70px;background:#0a150e;border:1px solid #1b3526;color:#e2e8f0;padding:4px 6px;border-radius:4px";
    tdCeil.appendChild(ceilInput);
    tr.appendChild(tdCeil);

    const tdShow = document.createElement("td");
    tdShow.style.cssText = "padding:6px 8px;text-align:center";
    const showCb = document.createElement("input");
    showCb.type = "checkbox";
    showCb.checked = !hiddenIds.has(m.id);
    showCb.style.cssText = "width:16px;height:16px;accent-color:#52b788;cursor:pointer";
    showCb.addEventListener("change", () => {
      if(!showCb.checked) hiddenIds.add(m.id); else hiddenIds.delete(m.id);
      try{ localStorage.setItem("padspan_hiddenMapIds", JSON.stringify([...hiddenIds])); }catch(e){}
      // Persist to HA settings store (survives restarts); fire-and-forget
      ctx.actions.settingsSet({ hidden_map_ids: [...hiddenIds] }).catch(()=>{});
    });
    tdShow.appendChild(showCb);
    tr.appendChild(tdShow);

    const tdSave = document.createElement("td");
    tdSave.style.cssText = "padding:6px 8px";
    tdSave.appendChild(el("button",{class:"btn inline", onclick: async ()=>{
      const newStk = Object.assign({}, m.stack || {},{
        z_level: parseInt(zLevelInput.value, 10) || 0,
        ceiling_height_m: parseFloat(ceilInput.value) || 2.4,
      });
      await ctx.actions.mapsUpdate({
        map_id: m.id, receivers: m.receivers||[], calibration: m.calibration||{},
        notes: m.notes||"", floor_id: floorSel2.value || m.floor_id||"",
        room_bounds: m.room_bounds||{}, stack: newStk,
      });
      ctx.actions.mapsRefresh();
    }},"Save"));
    tr.appendChild(tdSave);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  card.appendChild(tableWrap);

  // ── Section 2: Alignment Overlay Editor ──────────────────────────────────
  const alignHdrRow = el("div",{style:"margin-top:24px;display:flex;align-items:center;justify-content:space-between"});
  alignHdrRow.appendChild(el("div",{class:"muted",style:"font-size:13px;font-weight:600"},"Alignment Overlay"));
  card.appendChild(alignHdrRow);
  card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-top:4px"},"Drag the target floor plan (semi-transparent) over the reference to align them spatially. Use Scale +/− to resize."));

  const selRow = el("div",{style:"display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-top:10px"});
  const refSel = document.createElement("select"); refSel.className = "select";
  const tgtSel = document.createElement("select"); tgtSel.className = "select";
  // Reference: masters sorted to top (they are the natural fixed reference); exclude Outside maps
  const mapsForRef = [..._alignableMaps].sort((a,b) => (b.stack?.is_master?1:0) - (a.stack?.is_master?1:0));
  for(const m of mapsForRef){
    const oR = document.createElement("option"); oR.value = m.id;
    oR.textContent = (m.stack?.is_master ? "⭐ " : "") + (m.name||m.id);
    if(m.id === alignState.refId) oR.selected = true;
    refSel.appendChild(oR);
  }
  // Target: show all except Outside maps, flag masters so user is aware
  for(const m of _alignableMaps){
    const oT = document.createElement("option"); oT.value = m.id;
    oT.textContent = (m.stack?.is_master ? "⭐ " : "") + (m.name||m.id);
    if(m.id === alignState.targetId) oT.selected = true;
    tgtSel.appendChild(oT);
  }
  selRow.appendChild(el("div",{},[el("div",{class:"muted",style:"font-size:11px;margin-bottom:3px"},"Reference (fixed)"), refSel]));
  selRow.appendChild(el("div",{},[el("div",{class:"muted",style:"font-size:11px;margin-bottom:3px"},"Target (draggable)"), tgtSel]));
  card.appendChild(selRow);
  // Warning shown when a master map is selected as target
  const masterWarnDiv = el("div",{style:"display:none;margin-top:6px;padding:8px 10px;border-radius:6px;background:#1a0a00;border:1px solid #d97706;font-size:12px;color:#fbbf24"},
    "⭐ This is a master map — your alignment anchor. Dragging or scaling it and saving will permanently revoke its master status.");
  card.appendChild(masterWarnDiv);
  const _updateMasterWarn = () => {
    const tgtCheck = maps.find(m=>m.id===tgtSel.value);
    masterWarnDiv.style.display = tgtCheck?.stack?.is_master ? "block" : "none";
  };
  tgtSel.addEventListener("change", _updateMasterWarn);
  _updateMasterWarn();

  // ── Dual-master conflict resolution ──
  // When both the reference and target maps are masters and scale/rotation has
  // been changed, only one can remain as master after saving. The user must
  // explicitly choose which to keep. 'ref' = keep reference as master and
  // revoke target, 'tgt' = keep target and revoke reference.
  const dualMasterWarnDiv = el("div",{style:"display:none;margin-top:6px;padding:10px 12px;border-radius:6px;background:#0f0a1a;border:1px solid #7c3aed;font-size:12px"});
  card.appendChild(dualMasterWarnDiv);
  let dualMasterChoice = null; // 'ref' | 'tgt' | null
  let _dmRefId = null, _dmTgtId = null;

  const _checkDualMaster = (refId, tgtId) => {
    const refM = maps.find(m=>m.id===refId);
    const tgtM = maps.find(m=>m.id===tgtId);
    const bothMaster = !!(refM?.stack?.is_master) && !!(tgtM?.stack?.is_master);
    const scaleRotChanged = Math.abs(alignState.scale - 1.0) > 0.02 || Math.abs(alignState.rotation||0) > 2.0;
    if(!bothMaster || !scaleRotChanged){
      dualMasterWarnDiv.style.display = "none";
      return;
    }
    // Reset choice if map pair changed
    if(dualMasterChoice !== null && (_dmRefId !== refId || _dmTgtId !== tgtId)){
      dualMasterChoice = null;
    }
    _dmRefId = refId; _dmTgtId = tgtId;
    const escD = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const rName = escD(refM.name||refM.id);
    const tName = escD(tgtM.name||tgtM.id);
    const refSel_ = `background:#0a2a1a;border-color:#52b788;color:#86efac;font-weight:700`;
    const tgtSel_ = `background:#0a2a1a;border-color:#52b788;color:#86efac;font-weight:700`;
    const inactive = `color:#94a3b8`;
    let html = `<div style="font-weight:600;color:#c084fc;margin-bottom:6px">⭐ Both maps are masters</div>`;
    html += `<div style="color:#cbd5e1;font-size:11px;margin-bottom:8px">Scale or rotation has been changed. Only one map can remain the alignment anchor after saving. Choose which to keep as master:</div>`;
    html += `<div style="display:flex;gap:8px;flex-wrap:wrap">`;
    html += `<button id="_dmRef" class="btn inline" style="${dualMasterChoice==='ref' ? refSel_ : inactive}">Keep ⭐ "${rName}"</button>`;
    html += `<button id="_dmTgt" class="btn inline" style="${dualMasterChoice==='tgt' ? tgtSel_ : inactive}">Keep ⭐ "${tName}"</button>`;
    html += `</div>`;
    dualMasterWarnDiv.innerHTML = html;
    dualMasterWarnDiv.style.display = "block";
    dualMasterWarnDiv.querySelector("#_dmRef").onclick = () => { dualMasterChoice = 'ref'; _checkDualMaster(refId, tgtId); };
    dualMasterWarnDiv.querySelector("#_dmTgt").onclick = () => { dualMasterChoice = 'tgt'; _checkDualMaster(refId, tgtId); };
  };

  const readoutDiv = el("div",{style:"margin-top:8px;font-size:12px;font-family:monospace;color:#94a3b8"});
  const updateReadout = ()=>{
    const xAdj = alignState.scaleX_adj || 1.0;
    const xStr = Math.abs(xAdj - 1.0) > 0.001 ? `  ScaleX: ${xAdj.toFixed(3)}` : "";
    readoutDiv.textContent = `X: ${alignState.x_offset.toFixed(3)}  Y: ${alignState.y_offset.toFixed(3)}  Scale: ${alignState.scale.toFixed(3)}  Rot: ${(alignState.rotation||0).toFixed(1)}°${xStr}`;
  };
  updateReadout();
  card.appendChild(readoutDiv);

  // stageOuter: scrollable canvas with 60px padding so the dragged target
  // remains visible when it overflows the reference map's bounding box.
  // stageWrap: the actual sized container. Its CSS transform:scale() is the
  // "View Zoom" — scaling the whole stage, not individual map layers.
  const stageOuter = el("div",{style:"margin-top:10px;overflow:auto;max-width:100%;border-radius:8px;background:#071008;padding:60px"});
  const stageWrap = el("div",{style:`position:relative;overflow:visible;border-radius:6px;background:#071008;width:100%;min-width:220px;transform:scale(${ctx.state.maps._stackViewScale||1.0});transform-origin:50% 50%`});
  stageOuter.appendChild(stageWrap);
  card.appendChild(stageOuter);

  let tgtLayerRef = null;
  let pinsLayerRef = null;
  let rebuildPins = () => {};  // forward ref — real impl assigned after buildStage
  let stageAr = 1.0;
  let applyCurrentTransform = ()=>{ updateReadout(); };
  // AbortController to clean up window listeners when buildStage() is called again
  let _dragAbort = null;

  const buildStage = ()=>{
    // Remove previous window listeners before attaching new ones
    if(_dragAbort){ _dragAbort.abort(); }
    _dragAbort = new AbortController();
    const { signal } = _dragAbort;

    stageWrap.innerHTML = "";
    const refId = refSel.value;
    const tgtId = tgtSel.value;

    // When target changes, reload its saved alignment
    if(tgtId !== alignState.targetId){
      const newTgt = maps.find(m=>m.id===tgtId);
      alignState.x_offset   = newTgt?.stack?.x_offset    ?? 0.0;
      alignState.y_offset   = newTgt?.stack?.y_offset    ?? 0.0;
      alignState.scale      = newTgt?.stack?.scale       ?? 1.0;
      alignState.rotation   = newTgt?.stack?.rotation    ?? 0.0;
      alignState.scaleX_adj = newTgt?.stack?.scale_x_adj ?? 1.0;
    }
    alignState.refId    = refId;
    alignState.targetId = tgtId;

    const refMap = maps.find(m=>m.id===refId) || null;
    const tgtMap = maps.find(m=>m.id===tgtId) || null;
    if(!refMap){ applyCurrentTransform = ()=>{ updateReadout(); }; return; }

    const iw = refMap.image?.width  || 800;
    const ih = refMap.image?.height || 600;
    const ar = ih / iw;
    stageAr = ar;

    stageWrap.style.paddingBottom = `${ar * 100}%`;
    stageWrap.style.height = "0";

    // Reference layer: image (if any) + SVG room bounds on top
    const refLayer = document.createElement("div");
    refLayer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none";
    const _refV = (refMap.updated||refMap.image?.sha256||'').replace(/[^a-zA-Z0-9]/g,'').slice(0,16);
    const refUrl = refMap.image?.filename ? `/local/padspan_ha/maps/${refMap.image.filename}${_refV ? '?v='+_refV : ''}` : null;
    if(refUrl){
      const ri = document.createElement("img");
      ri.src = refUrl;
      ri.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:fill;display:block";
      refLayer.appendChild(ri);
    }
    const refSvgDiv = document.createElement("div");
    refSvgDiv.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%";
    refSvgDiv.innerHTML = _stackMapSVGStr(refMap, ctx, false, !refUrl);
    refLayer.appendChild(refSvgDiv);
    // Apply reference map's own saved stack transform so it appears in its true aligned position.
    // Without this, a map that was previously aligned rotated/scaled shows flat in the overlay.
    const refStk = refMap.stack || {};
    if(refStk.x_offset || refStk.y_offset || refStk.rotation || refStk.scale_x_adj || (refStk.scale && refStk.scale !== 1.0)){
      const rsx = (refStk.scale || 1.0) * (refStk.scale_x_adj || 1.0);
      const rsy = refStk.scale || 1.0;
      refLayer.style.transformOrigin = "50% 50%";
      refLayer.style.transform = `translate(${(refStk.x_offset||0)*100}%,${(refStk.y_offset||0)*100}%) rotate(${refStk.rotation||0}deg) scale(${rsx},${rsy})`;
    }
    stageWrap.appendChild(refLayer);

    if(tgtMap && tgtMap.id !== refMap.id){
      const tgtLayer = document.createElement("div");
      tgtLayer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;cursor:grab;transform-origin:50% 50%";

      // Target layer: image (if any) + SVG room bounds on top
      const _tgtV = (tgtMap.updated||tgtMap.image?.sha256||'').replace(/[^a-zA-Z0-9]/g,'').slice(0,16);
      const tgtUrl = tgtMap.image?.filename ? `/local/padspan_ha/maps/${tgtMap.image.filename}${_tgtV ? '?v='+_tgtV : ''}` : null;
      if(tgtUrl){
        const ti = document.createElement("img");
        ti.src = tgtUrl;
        ti.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:fill;display:block";
        tgtLayer.appendChild(ti);
      }
      const tgtSvgDiv = document.createElement("div");
      tgtSvgDiv.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%";
      tgtSvgDiv.innerHTML = _stackMapSVGStr(tgtMap, ctx, true, !tgtUrl);
      tgtLayer.appendChild(tgtSvgDiv);

      tgtLayer.style.opacity = String(ctx.state.maps._stackTgtOpacity || 0.55);
      tgtLayerRef = tgtLayer;

      applyCurrentTransform = ()=>{
        // CSS transform chain: translate → rotate → scale.
        // With transform-origin:50% 50%, rotate and scale happen around the
        // element's centre. translate() shifts that centre point by
        // (x_offset, y_offset) as a percentage of the stage dimensions.
        // scaleX_adj allows non-uniform stretch (X differs from Y).
        const sx = (alignState.scale || 1.0) * (alignState.scaleX_adj || 1.0);
        const sy = alignState.scale || 1.0;
        tgtLayer.style.transform = `translate(${alignState.x_offset*100}%,${alignState.y_offset*100}%) rotate(${alignState.rotation||0}deg) scale(${sx},${sy})`;
        updateReadout();
        _checkDualMaster(refId, tgtId);
      };
      applyCurrentTransform();

      let dragging = false, dragStartX = 0, dragStartY = 0, startOffX = 0, startOffY = 0;
      const stageRect = ()=>stageWrap.getBoundingClientRect();
      const _setDrag = (v)=>{ dragging=v; if(ctx.state.maps) ctx.state.maps._stackDragging=v; };

      tgtLayer.addEventListener("mousedown",(ev)=>{
        _setDrag(true); dragStartX=ev.clientX; dragStartY=ev.clientY;
        startOffX=alignState.x_offset; startOffY=alignState.y_offset;
        tgtLayer.style.cursor="grabbing"; ev.preventDefault();
      });
      tgtLayer.addEventListener("touchstart",(ev)=>{
        if(!ev.touches[0]) return;
        _setDrag(true); dragStartX=ev.touches[0].clientX; dragStartY=ev.touches[0].clientY;
        startOffX=alignState.x_offset; startOffY=alignState.y_offset;
        ev.preventDefault();
      },{passive:false});
      window.addEventListener("mousemove",(ev)=>{
        if(!dragging) return;
        const r = stageRect(); if(!r.width) return;
        alignState.x_offset = startOffX + (ev.clientX - dragStartX)/r.width;
        alignState.y_offset = startOffY + (ev.clientY - dragStartY)/r.height;
        applyCurrentTransform();
      }, { signal });
      window.addEventListener("touchmove",(ev)=>{
        if(!dragging||!ev.touches[0]) return;
        const r = stageRect(); if(!r.width) return;
        alignState.x_offset = startOffX + (ev.touches[0].clientX - dragStartX)/r.width;
        alignState.y_offset = startOffY + (ev.touches[0].clientY - dragStartY)/r.height;
        applyCurrentTransform();
      },{ passive:false, signal });
      window.addEventListener("mouseup",()=>{ _setDrag(false); tgtLayer.style.cursor="grab"; }, { signal });
      window.addEventListener("touchend",()=>{ _setDrag(false); }, { signal });

      stageWrap.appendChild(tgtLayer);
    } else {
      applyCurrentTransform = ()=>{ updateReadout(); };
      applyCurrentTransform();
    }

    // Persistent pins overlay — always on top, never captures pointer events
    const pinsDiv = document.createElement("div");
    pinsDiv.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none";
    pinsLayerRef = pinsDiv;
    rebuildPins();
    stageWrap.appendChild(pinsDiv);
  };

  // Real rebuildPins — updates only the pins SVG layer without rebuilding the whole stage
  rebuildPins = () => {
    if(!pinsLayerRef) return;
    if(!ctx.state.maps._persistentPins){ pinsLayerRef.innerHTML = ""; return; }
    const refId = refSel.value;
    const refMap = maps.find(m=>m.id===refId) || null;
    if(!refMap){ pinsLayerRef.innerHTML = ""; return; }
    const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
    const awayObjs = snap?.objects
      ? Object.values(snap.objects).filter(o =>
          o.user_label && o.room && o.room !== "unknown" && o.room !== "not_home" &&
          typeof o.age_s === "number" && o.age_s > 30)
      : [];
    pinsLayerRef.innerHTML = _persistent2dPinsSVGStr(refMap.room_bounds||{}, awayObjs);
  };

  refSel.addEventListener("change", buildStage);
  tgtSel.addEventListener("change", buildStage);
  buildStage();

  const ctrlRow = el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px"});

  // Scale controls
  if(ctx.state.maps._stackArLocked === undefined) ctx.state.maps._stackArLocked = true;

  const xMinusBtn = el("button",{class:"btn inline",title:"Stretch left/right only (horizontal squeeze/stretch)"},"X −");
  const xPlusBtn  = el("button",{class:"btn inline",title:"Stretch left/right only (horizontal squeeze/stretch)"},"X +");
  const _setXBtnState = (locked)=>{
    xMinusBtn.disabled = locked; xMinusBtn.style.opacity = locked ? "0.3" : "";
    xPlusBtn.disabled  = locked; xPlusBtn.style.opacity  = locked ? "0.3" : "";
  };
  _setXBtnState(ctx.state.maps._stackArLocked);
  xMinusBtn.onclick = ()=>{
    alignState.scaleX_adj = Math.max(0.1, Math.round(((alignState.scaleX_adj||1.0) - 0.05)*1000)/1000);
    applyCurrentTransform();
  };
  xPlusBtn.onclick = ()=>{
    alignState.scaleX_adj = Math.min(5.0, Math.round(((alignState.scaleX_adj||1.0) + 0.05)*1000)/1000);
    applyCurrentTransform();
  };

  const lockArBtn = el("button",{
    class:"btn inline",
    title:"Lock aspect ratio: Scale +/− resizes both axes equally. Unlock to enable X-only stretch.",
  }, ctx.state.maps._stackArLocked ? "Lock AR ✓" : "Lock AR");
  lockArBtn.style.cssText = ctx.state.maps._stackArLocked
    ? "background:#52b788;color:#071008;font-weight:700"
    : "color:#94a3b8";
  lockArBtn.onclick = ()=>{
    ctx.state.maps._stackArLocked = !ctx.state.maps._stackArLocked;
    const lk = ctx.state.maps._stackArLocked;
    lockArBtn.style.background = lk ? "#52b788" : "";
    lockArBtn.style.color      = lk ? "#071008" : "#94a3b8";
    lockArBtn.style.fontWeight = lk ? "700"     : "";
    lockArBtn.textContent      = lk ? "Lock AR ✓" : "Lock AR";
    _setXBtnState(lk);
  };

  ctrlRow.appendChild(el("span",{class:"muted",style:"font-size:11px;white-space:nowrap"},"Scale:"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    const outside = ctx.state.maps._stackOutsideMode;
    const step = outside ? 0.5 : 0.05;
    const maxScale = outside ? 100.0 : 5.0;
    alignState.scale = Math.min(maxScale, Math.round((alignState.scale + step) * 1000) / 1000);
    applyCurrentTransform();
  }},"Scale +"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    const outside = ctx.state.maps._stackOutsideMode;
    const step = outside ? 0.5 : 0.05;
    const minScale = outside ? 0.01 : 0.1;
    alignState.scale = Math.max(minScale, Math.round((alignState.scale - step) * 1000) / 1000);
    applyCurrentTransform();
  }},"Scale −"));
  ctrlRow.appendChild(lockArBtn);
  ctrlRow.appendChild(xPlusBtn);
  ctrlRow.appendChild(xMinusBtn);

  // Outside map toggle — lifts scale limits for very large or outdoor spaces
  const outsideBtn = el("button",{
    class:"btn inline",
    style: ctx.state.maps._stackOutsideMode
      ? "background:#52b788;color:#071008;font-weight:700"
      : "color:#94a3b8",
    title: "Outside map mode: larger scale range (0.01–100×) and bigger steps (0.5 per click)",
    onclick: ()=>{
      ctx.state.maps._stackOutsideMode = !ctx.state.maps._stackOutsideMode;
      outsideBtn.style.background = ctx.state.maps._stackOutsideMode ? "#52b788" : "";
      outsideBtn.style.color      = ctx.state.maps._stackOutsideMode ? "#071008" : "#94a3b8";
      outsideBtn.style.fontWeight = ctx.state.maps._stackOutsideMode ? "700"     : "";
      outsideBtn.textContent      = ctx.state.maps._stackOutsideMode ? "Outside ✓" : "Outside map";
    }
  }, ctx.state.maps._stackOutsideMode ? "Outside ✓" : "Outside map");
  ctrlRow.appendChild(outsideBtn);

  // Rotate controls
  ctrlRow.appendChild(el("span",{class:"muted",style:"font-size:11px;white-space:nowrap;margin-left:8px"},"Rotate:"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{ alignState.rotation = Math.round((alignState.rotation||0) - 15); applyCurrentTransform(); }},"−15°"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{ alignState.rotation = Math.round((alignState.rotation||0) + 15); applyCurrentTransform(); }},"﹢15°"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{ alignState.rotation = 0; applyCurrentTransform(); }},"0°"));

  // View zoom controls (scales stage content so both maps are visible — zooming out reveals overflowed target maps)
  ctrlRow.appendChild(el("span",{class:"muted",style:"font-size:11px;white-space:nowrap;margin-left:8px"},"View:"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    ctx.state.maps._stackViewScale = Math.max(0.2, Math.round(((ctx.state.maps._stackViewScale||1.0)-0.1)*100)/100);
    stageWrap.style.transform = `scale(${ctx.state.maps._stackViewScale})`;
  }},"Zoom −"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    ctx.state.maps._stackViewScale = 1.0;
    stageWrap.style.transform = "scale(1)";
  }},"100%"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    ctx.state.maps._stackViewScale = Math.min(2.0, Math.round(((ctx.state.maps._stackViewScale||1.0)+0.1)*100)/100);
    stageWrap.style.transform = `scale(${ctx.state.maps._stackViewScale})`;
  }},"Zoom +"));

  // Opacity controls (how transparent the draggable target layer is)
  ctrlRow.appendChild(el("span",{class:"muted",style:"font-size:11px;white-space:nowrap;margin-left:8px"},"Opacity:"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    ctx.state.maps._stackTgtOpacity = Math.max(0.05, Math.round(((ctx.state.maps._stackTgtOpacity||0.55)-0.1)*100)/100);
    if(tgtLayerRef) tgtLayerRef.style.opacity = String(ctx.state.maps._stackTgtOpacity);
  }},"▼"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    ctx.state.maps._stackTgtOpacity = 0.55;
    if(tgtLayerRef) tgtLayerRef.style.opacity = "0.55";
  }},"50%"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    ctx.state.maps._stackTgtOpacity = Math.min(0.95, Math.round(((ctx.state.maps._stackTgtOpacity||0.55)+0.1)*100)/100);
    if(tgtLayerRef) tgtLayerRef.style.opacity = String(ctx.state.maps._stackTgtOpacity);
  }},"▲"));

  // Reset all alignment
  ctrlRow.appendChild(el("button",{class:"btn inline",style:"margin-left:8px", onclick:()=>{ alignState.x_offset=0.0; alignState.y_offset=0.0; alignState.scale=1.0; alignState.rotation=0; alignState.scaleX_adj=1.0; applyCurrentTransform(); }},"Reset"));

  // ── Point Align ────────────────────────────────────────────────────────────
  // Opens a MODAL OVERLAY (position:fixed) for side-by-side point matching.
  // Completely decoupled from the maps view render cycle — no re-render guard
  // needed. The modal manages its own DOM and state; on Compute or Cancel it
  // simply removes itself and writes results to alignState.

  // ── Gaussian Elimination Helper ────────────────────────────────────────────
  // Solves the normal equations AᵀA·x = Aᵀb via partial-pivot Gaussian elim.
  // Returns solution array of length K, or null if singular.
  const _gaussSolve = (ATA, ATb) => {
    const K = ATA.length;
    const M = ATA.map((r, i) => [...r, ATb[i]]);
    for (let col = 0; col < K; col++) {
      let maxR = col;
      for (let r = col + 1; r < K; r++)
        if (Math.abs(M[r][col]) > Math.abs(M[maxR][col])) maxR = r;
      [M[col], M[maxR]] = [M[maxR], M[col]];
      if (Math.abs(M[col][col]) < 1e-12) return null;
      for (let r = col + 1; r < K; r++) {
        const f = M[r][col] / M[col][col];
        for (let c2 = col; c2 <= K; c2++) M[r][c2] -= f * M[col][c2];
      }
    }
    const x = Array(K).fill(0);
    for (let r = K - 1; r >= 0; r--) {
      x[r] = M[r][K];
      for (let c2 = r + 1; c2 < K; c2++) x[r] -= M[r][c2] * x[c2];
      x[r] /= M[r][r];
    }
    return x;
  };

  // ── Affine Transform Solver (_solvePtAlign) ───────────────────────────────
  //
  // Given N >= 3 matched point pairs (ref[i], tgt[i]) in normalised [0,1]²
  // coordinates, solves for the 6-DOF affine that maps target → reference.
  //
  // IMPORTANT: Works in the SAME normalised coordinate space as CSS transforms
  // (no aspect-ratio correction). Both panels in the Point Align modal share
  // the reference map's AR, so click coords are already in a consistent space.
  // The solver output (dx, dy, scale, rotation, scaleX_adj) maps directly to
  // CSS translate/rotate/scale without any conversion.
  //
  // MODEL (centred at 0.5, 0.5):
  //   ref_x - 0.5 = a·(tgt_x - 0.5) + b·(tgt_y - 0.5) + dx
  //   ref_y - 0.5 = c·(tgt_x - 0.5) + d·(tgt_y - 0.5) + dy
  //
  // Returns {x_offset, y_offset, scale, rotation, scaleX_adj, residual}
  const _solvePtAlign = (refPts, tgtPts) => {
    const n = Math.min(refPts.length, tgtPts.length);
    if (n < 3) return null;
    const cx = 0.5, cy = 0.5;
    const K = 6;
    const ATA = Array.from({ length: K }, () => Array(K).fill(0));
    const ATb = Array(K).fill(0);
    for (let i = 0; i < n; i++) {
      const u = tgtPts[i].x - cx, v = tgtPts[i].y - cy;
      const bx = refPts[i].x - cx, by = refPts[i].y - cy;
      const r1 = [u, v, 0, 0, 1, 0];
      const r2 = [0, 0, u, v, 0, 1];
      for (let j = 0; j < K; j++) {
        for (let k = 0; k < K; k++) ATA[j][k] += r1[j] * r1[k] + r2[j] * r2[k];
        ATb[j] += r1[j] * bx + r2[j] * by;
      }
    }
    const x = _gaussSolve(ATA, ATb);
    if (!x) return null;
    const a = x[0], b = x[1], c = x[2], d = x[3], dx = x[4], dy = x[5];
    // Decompose [[a,b],[c,d]] → rotation + scale + stretch
    const sx = Math.sqrt(a * a + c * c);
    const sy = Math.sqrt(b * b + d * d);
    const rotation = Math.atan2(c, a) * 180 / Math.PI;
    const scale = sy;
    const scaleX_adj = sx > 0 && sy > 0 ? sx / sy : 1.0;
    // RMS residual in normalised coords
    let res = 0;
    for (let i = 0; i < n; i++) {
      const u = tgtPts[i].x - cx, v = tgtPts[i].y - cy;
      const predX = a * u + b * v + cx + dx;
      const predY = c * u + d * v + cy + dy;
      res += (predX - refPts[i].x) ** 2 + (predY - refPts[i].y) ** 2;
    }
    return { x_offset: dx, y_offset: dy, scale, rotation, scaleX_adj, residual: Math.sqrt(res / n) };
  };

  // ── Similarity Transform Solver (_solvePtAlignRigid) ──────────────────────
  //
  // 4-DOF rigid similarity: translation + rotation + uniform scale only.
  // No skew/stretch — output is always a rectangle, never a parallelogram.
  //
  // Works in the same normalised [0,1]² space as CSS (no AR correction).
  //
  // MODEL (centred at 0.5, 0.5):
  //   ref_x - 0.5 = a·(tgt_x - 0.5) - b·(tgt_y - 0.5) + dx
  //   ref_y - 0.5 = b·(tgt_x - 0.5) + a·(tgt_y - 0.5) + dy
  //
  // where a = s·cos(θ), b = s·sin(θ). 4 unknowns [a, b, dx, dy].
  //
  // Returns same shape as _solvePtAlign with scaleX_adj = 1.0.
  const _solvePtAlignRigid = (refPts, tgtPts) => {
    const n = Math.min(refPts.length, tgtPts.length);
    if (n < 2) return null;
    const cx = 0.5, cy = 0.5;
    const K = 4;
    const ATA = Array.from({ length: K }, () => Array(K).fill(0));
    const ATb = Array(K).fill(0);
    for (let i = 0; i < n; i++) {
      const u = tgtPts[i].x - cx, v = tgtPts[i].y - cy;
      const bx = refPts[i].x - cx, by = refPts[i].y - cy;
      const r1 = [u, -v, 1, 0];
      const r2 = [v,  u, 0, 1];
      for (let j = 0; j < K; j++) {
        for (let k = 0; k < K; k++) ATA[j][k] += r1[j] * r1[k] + r2[j] * r2[k];
        ATb[j] += r1[j] * bx + r2[j] * by;
      }
    }
    const x = _gaussSolve(ATA, ATb);
    if (!x) return null;
    const a = x[0], b = x[1], dx = x[2], dy = x[3];
    const scale = Math.sqrt(a * a + b * b);
    const rotation = Math.atan2(b, a) * 180 / Math.PI;
    // RMS residual
    let res = 0;
    for (let i = 0; i < n; i++) {
      const u = tgtPts[i].x - cx, v = tgtPts[i].y - cy;
      const predX = a * u - b * v + cx + dx;
      const predY = b * u + a * v + cy + dy;
      res += (predX - refPts[i].x) ** 2 + (predY - refPts[i].y) ** 2;
    }
    return { x_offset: dx, y_offset: dy, scale, rotation, scaleX_adj: 1.0, residual: Math.sqrt(res / n) };
  };

  // ── Point Align Modal ─────────────────────────────────────────────────────
  // Opens a full-screen fixed overlay for side-by-side point matching.
  // Completely self-contained — owns its own DOM, state, and lifecycle.
  // No re-render guard needed; the modal sits on top of everything and
  // removes itself on Compute or Cancel. The maps view never knows it existed.
  const _openPointAlignModal = () => {
    const refMap = maps.find(m => m.id === refSel.value);
    const tgtMap = maps.find(m => m.id === tgtSel.value);
    if (!refMap) { ctx.toast("Select a reference map first", true); return; }
    if (!tgtMap || tgtMap.id === refMap.id) { ctx.toast("Select a different target map", true); return; }

    // ── Local state (lives only while modal is open) ──
    const refPts = [];
    const tgtPts = [];
    let phase = "ref";
    let bake = false;
    let fullTransform = false; // OFF = rigid (no skew); ON = full affine (can lean)

    // ── Modal root (position:fixed covers the viewport) ──
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;" +
      "background:#0a0f0a;display:flex;flex-direction:column;color:#e2e8f0;" +
      "font-family:var(--ha-font-family,Roboto,sans-serif);font-size:13px";

    // Helper: get map image URL with cache-buster
    const _mapUrl = (map) => {
      if (!map.image || !map.image.filename) return null;
      const v = (map.updated || map.image.sha256 || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
      return "/local/padspan_ha/maps/" + map.image.filename + (v ? "?v=" + v : "");
    };

    // Helper: close modal
    const _close = () => { try { overlay.remove(); } catch (_e) {} };

    // ── Toolbar (top bar) ──
    const toolbar = document.createElement("div");
    toolbar.style.cssText = "padding:10px 16px;background:#071210;border-bottom:1px solid #1e4976;" +
      "display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0";

    // Reference aspect ratio — used for BOTH panels so coordinates share the same space.
    const _refIW = refMap.image?.width || 800;
    const _refIH = refMap.image?.height || 600;
    const _refAR = _refIW / _refIH;  // width/height ratio (e.g. 1.33 for 800x600)

    // ── Map panels container ──
    const panelsRow = document.createElement("div");
    panelsRow.style.cssText = "flex:1;display:flex;gap:8px;padding:8px;overflow:hidden;min-height:0;align-items:start";

    // ── Rebuild UI (called after every point click, undo, clear) ──
    const _rebuild = () => {
      // -- Toolbar --
      toolbar.innerHTML = "";
      const pairs = Math.min(refPts.length, tgtPts.length);
      const placing = phase === "ref" ? "Reference" : "Target";
      const nextPt = phase === "ref" ? refPts.length + 1 : tgtPts.length + 1;
      const phaseColor = phase === "ref" ? "#52b788" : "#f59e0b";

      const title = document.createElement("span");
      title.style.cssText = "font-weight:700;font-size:14px;color:#7dd3fc";
      title.textContent = "Point Align";
      toolbar.appendChild(title);

      const status = document.createElement("span");
      status.style.cssText = "font-size:12px;font-weight:600;color:" + phaseColor;
      status.textContent = "Place point " + nextPt + " on " + placing;
      toolbar.appendChild(status);

      const badge = document.createElement("span");
      badge.style.cssText = "font-size:10px;padding:2px 8px;border-radius:4px;background:#1a2e1a;color:#52b788";
      badge.textContent = pairs + " pair" + (pairs !== 1 ? "s" : "");
      toolbar.appendChild(badge);

      // Spacer
      const spacer = document.createElement("div");
      spacer.style.cssText = "flex:1";
      toolbar.appendChild(spacer);

      // Undo button
      const undoBtn = document.createElement("button");
      undoBtn.className = "btn inline";
      undoBtn.style.cssText = "font-size:11px;padding:3px 10px;color:#e2e8f0;background:#162016;border:1px solid #2d5a2d;border-radius:4px;cursor:pointer";
      undoBtn.textContent = "Undo";
      undoBtn.onclick = () => {
        if (phase === "ref" && refPts.length > 0) refPts.pop();
        else if (phase === "tgt" && tgtPts.length > 0) tgtPts.pop();
        else if (refPts.length >= tgtPts.length && refPts.length > 0) refPts.pop();
        else if (tgtPts.length > 0) tgtPts.pop();
        _rebuild();
      };
      toolbar.appendChild(undoBtn);

      // Clear button
      const clearBtn = document.createElement("button");
      clearBtn.className = "btn inline";
      clearBtn.style.cssText = "font-size:11px;padding:3px 10px;color:#e2e8f0;background:#162016;border:1px solid #2d5a2d;border-radius:4px;cursor:pointer";
      clearBtn.textContent = "Clear";
      clearBtn.onclick = () => { refPts.length = 0; tgtPts.length = 0; phase = "ref"; _rebuild(); };
      toolbar.appendChild(clearBtn);

      // Bake checkbox
      const bakeLabel = document.createElement("label");
      bakeLabel.style.cssText = "display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#94a3b8;cursor:pointer;user-select:none";
      const bakeCb = document.createElement("input");
      bakeCb.type = "checkbox";
      bakeCb.checked = bake;
      bakeCb.style.cssText = "width:14px;height:14px;accent-color:#52b788;cursor:pointer";
      bakeCb.onchange = () => { bake = bakeCb.checked; };
      bakeLabel.appendChild(bakeCb);
      bakeLabel.appendChild(document.createTextNode("Bake"));
      toolbar.appendChild(bakeLabel);

      // Full transform checkbox — OFF (default) = rigid (translate + rotate + scale only),
      // ON = full 6-DOF affine (allows non-uniform stretch / skew / "leaning" output)
      const ftLabel = document.createElement("label");
      ftLabel.style.cssText = "display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#94a3b8;cursor:pointer;user-select:none";
      const ftCb = document.createElement("input");
      ftCb.type = "checkbox";
      ftCb.checked = fullTransform;
      ftCb.style.cssText = "width:14px;height:14px;accent-color:#f59e0b;cursor:pointer";
      ftCb.onchange = () => { fullTransform = ftCb.checked; };
      ftLabel.appendChild(ftCb);
      ftLabel.appendChild(document.createTextNode("Full transform"));
      toolbar.appendChild(ftLabel);

      // Compute button
      const canCompute = pairs >= 3;
      const computeBtn = document.createElement("button");
      computeBtn.style.cssText = "font-size:12px;padding:4px 16px;font-weight:600;border-radius:4px;cursor:pointer;border:1px solid " +
        (canCompute ? "#52b788;background:#1b4a2e;color:#e2e8f0" : "#333;background:#1a1a1a;color:#555");
      computeBtn.disabled = !canCompute;
      computeBtn.textContent = canCompute ? "Compute (" + pairs + " pairs)" : "Need 3+ pairs";
      computeBtn.onclick = () => {
        try {
          computeBtn.disabled = true;
          computeBtn.textContent = "Computing...";
          const result = fullTransform
            ? _solvePtAlign(refPts, tgtPts)       // 6-DOF affine (allows skew)
            : _solvePtAlignRigid(refPts, tgtPts); // 4-DOF rigid (no skew)
          if (!result) {
            ctx.toast("Could not compute — points may be collinear", true);
            computeBtn.disabled = false;
            computeBtn.textContent = "Compute (" + pairs + " pairs)";
            return;
          }
          // Sanitize
          const _sane = (v, def, lo, hi) => { const nn = Number(v); return (isFinite(nn) && nn >= lo && nn <= hi) ? nn : def; };
          const rScale    = _sane(Math.round(result.scale * 10000) / 10000, 1.0, 0.01, 100);
          const rRotation = _sane(Math.round(result.rotation * 100) / 100, 0, -360, 360);
          const rStretch  = _sane(Math.round((result.scaleX_adj || 1.0) * 10000) / 10000, 1.0, 0.01, 100);
          const rDx       = _sane(Math.round(result.x_offset * 10000) / 10000, 0, -10, 10);
          const rDy       = _sane(Math.round(result.y_offset * 10000) / 10000, 0, -10, 10);
          const resPct    = _sane(Math.round((result.residual || 0) * 1000) / 10, 0, 0, 999);

          console.log("[PtAlign] Result: dx=" + rDx + " dy=" + rDy + " scale=" + rScale +
            " rot=" + rRotation + " stretch=" + rStretch + " residual=" + resPct + "%");

          // ── Show preview instead of immediately applying ──
          _showPreview(rDx, rDy, rScale, rRotation, rStretch, resPct, pairs);
        } catch (err) {
          console.error("[PtAlign] Compute error:", err);
          ctx.toast("Compute error: " + String(err), true);
          computeBtn.disabled = false;
          computeBtn.textContent = "Compute (" + pairs + " pairs)";
        }
      };
      toolbar.appendChild(computeBtn);

      // Cancel button
      const cancelBtn = document.createElement("button");
      cancelBtn.style.cssText = "font-size:11px;padding:3px 10px;color:#f87171;background:#1a0808;border:1px solid #7f1d1d;border-radius:4px;cursor:pointer";
      cancelBtn.textContent = "Cancel";
      cancelBtn.onclick = _close;
      toolbar.appendChild(cancelBtn);

      // -- Panels --
      panelsRow.innerHTML = "";

      const _buildPanel = (map, label, color, pts, which) => {
        const panel = document.createElement("div");
        panel.style.cssText = "flex:1;display:flex;flex-direction:column;border:2px solid " + color +
          ";border-radius:8px;overflow:hidden;min-width:200px;background:#071008";

        // Header
        const hdr = document.createElement("div");
        hdr.style.cssText = "padding:6px 10px;background:" + color + "15;display:flex;align-items:center;gap:8px;flex-shrink:0";
        const lbl = document.createElement("span");
        lbl.style.cssText = "font-weight:700;font-size:12px;color:" + color;
        lbl.textContent = label;
        hdr.appendChild(lbl);
        const nm = document.createElement("span");
        nm.style.cssText = "font-size:11px;color:#94a3b8";
        nm.textContent = map.name || map.id;
        hdr.appendChild(nm);
        if (phase === which) {
          const arrow = document.createElement("span");
          arrow.style.cssText = "font-size:10px;color:" + color + ";font-weight:700;border:1px solid " + color + ";padding:1px 6px;border-radius:4px";
          arrow.textContent = "Click here";
          hdr.appendChild(arrow);
        }
        panel.appendChild(hdr);

        // Map stage — BOTH panels use the REFERENCE map's aspect ratio so
        // click coordinates share the same coordinate space for the solver.
        // Images are stretched with object-fit:fill to match.
        const stage = document.createElement("div");
        stage.style.cssText = "position:relative;width:100%;aspect-ratio:" + _refAR +
          ";max-height:calc(100vh - 100px);background:#071008";

        // Image — stretched to fill the shared-AR container
        const url = _mapUrl(map);
        if (url) {
          const img = document.createElement("img");
          img.src = url;
          img.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:fill;display:block;pointer-events:none";
          stage.appendChild(img);
        }

        // Point markers — simple numbered circles using absolutely positioned divs
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const marker = document.createElement("div");
          marker.style.cssText = "position:absolute;width:20px;height:20px;border-radius:50%;" +
            "background:" + color + "44;border:2px solid " + color + ";display:flex;align-items:center;" +
            "justify-content:center;font-size:10px;font-weight:700;color:" + color + ";pointer-events:none;" +
            "transform:translate(-50%,-50%);left:" + (p.x * 100) + "%;top:" + (p.y * 100) + "%";
          marker.textContent = String(i + 1);
          stage.appendChild(marker);
        }

        // Click catcher — covers the stage exactly
        const catcher = document.createElement("div");
        catcher.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair;z-index:5";
        catcher.addEventListener("click", (ev) => {
          const rect = catcher.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          const px = (ev.clientX - rect.left) / rect.width;
          const py = (ev.clientY - rect.top) / rect.height;
          if (px < 0 || px > 1 || py < 0 || py > 1) return;
          if (which === "ref") {
            if (refPts.length >= 8) { ctx.toast("Max 8 points"); return; }
            refPts.push({ x: px, y: py });
            phase = "tgt";
          } else {
            if (tgtPts.length >= 8) { ctx.toast("Max 8 points"); return; }
            tgtPts.push({ x: px, y: py });
            phase = "ref";
          }
          _rebuild();
        });
        stage.appendChild(catcher);

        panel.appendChild(stage);
        return panel;
      };

      panelsRow.appendChild(_buildPanel(refMap, "Reference", "#52b788", refPts, "ref"));
      panelsRow.appendChild(_buildPanel(tgtMap, "Target", "#f59e0b", tgtPts, "tgt"));

      // Help text at the bottom of toolbar
      const help = document.createElement("div");
      help.style.cssText = "width:100%;font-size:10px;color:#64748b;margin-top:4px";
      help.textContent = "Click the same real-world point on both maps. Auto-alternates. 3+ pairs required to Compute.";
      toolbar.appendChild(help);
    };

    // ── Preview screen — shows the computed alignment before applying ──────
    const _showPreview = (rDx, rDy, rScale, rRotation, rStretch, resPct, pairs) => {
      // Replace the point-picking UI with a preview of the result
      toolbar.innerHTML = "";
      panelsRow.innerHTML = "";

      // -- Toolbar: result summary + Apply/Discard buttons --
      const title = document.createElement("span");
      title.style.cssText = "font-weight:700;font-size:14px;color:#7dd3fc";
      title.textContent = "Preview";
      toolbar.appendChild(title);

      const stats = document.createElement("span");
      stats.style.cssText = "font-size:11px;color:#94a3b8";
      stats.textContent = pairs + " pairs | residual " + resPct + "% | scale " +
        rScale.toFixed(3) + " | rot " + rRotation.toFixed(1) + "\u00b0" +
        (Math.abs(rStretch - 1.0) > 0.005 ? " | stretch " + Math.round(rStretch * 100) + "%" : "");
      toolbar.appendChild(stats);

      // Residual quality badge
      const qBadge = document.createElement("span");
      const qColor = resPct < 2 ? "#52b788" : resPct < 5 ? "#f59e0b" : "#f87171";
      const qLabel = resPct < 2 ? "Excellent" : resPct < 5 ? "Fair" : "Poor";
      qBadge.style.cssText = "font-size:10px;padding:2px 8px;border-radius:4px;background:" + qColor + "22;color:" + qColor + ";border:1px solid " + qColor + "44";
      qBadge.textContent = qLabel;
      toolbar.appendChild(qBadge);

      const spacer = document.createElement("div");
      spacer.style.cssText = "flex:1";
      toolbar.appendChild(spacer);

      // Back button — go back to point placement
      const backBtn = document.createElement("button");
      backBtn.style.cssText = "font-size:11px;padding:3px 12px;color:#e2e8f0;background:#162016;border:1px solid #2d5a2d;border-radius:4px;cursor:pointer";
      backBtn.textContent = "Back";
      backBtn.onclick = () => _rebuild();
      toolbar.appendChild(backBtn);

      // Apply button
      const applyBtn = document.createElement("button");
      applyBtn.style.cssText = "font-size:12px;padding:4px 16px;font-weight:600;border-radius:4px;cursor:pointer;" +
        "border:1px solid #52b788;background:#1b4a2e;color:#e2e8f0";
      applyBtn.textContent = bake ? "Bake & Apply" : "Apply";
      applyBtn.onclick = () => {
        if (bake && tgtMap.image && tgtMap.image.filename) {
          alignState.x_offset = rDx; alignState.y_offset = rDy;
          alignState.scale = 1.0; alignState.rotation = 0; alignState.scaleX_adj = 1.0;
          _close();
          buildStage();
          const bakeImg = new Image();
          bakeImg.crossOrigin = "anonymous";
          bakeImg.onload = () => {
            try {
              const ow = bakeImg.naturalWidth, oh = bakeImg.naturalHeight;
              const rad = rRotation * Math.PI / 180;
              const cosA = Math.abs(Math.cos(rad)), sinA = Math.abs(Math.sin(rad));
              const bsx = rScale * rStretch, bsy = rScale;
              const nw = Math.ceil(ow * bsx * cosA + oh * bsy * sinA);
              const nh = Math.ceil(ow * bsx * sinA + oh * bsy * cosA);
              const canvas = document.createElement("canvas");
              canvas.width = nw; canvas.height = nh;
              const cc = canvas.getContext("2d");
              cc.translate(nw / 2, nh / 2); cc.rotate(rad); cc.scale(bsx, bsy);
              cc.drawImage(bakeImg, -ow / 2, -oh / 2);
              const b64 = canvas.toDataURL("image/png").split(",")[1];
              ctx.actions.mapsReplaceImage({ map_id: tgtMap.id, png_base64: b64, width: nw, height: nh })
                .then(() => ctx.toast("Baked (" + pairs + " pairs, residual " + resPct + "%)"))
                .catch(e => ctx.toast("Bake upload failed: " + e, true));
            } catch (de) { ctx.toast("Bake draw failed: " + de, true); }
          };
          bakeImg.onerror = () => ctx.toast("Bake failed — image load error", true);
          bakeImg.src = _mapUrl(tgtMap);
        } else {
          alignState.x_offset   = rDx;
          alignState.y_offset   = rDy;
          alignState.scale      = rScale;
          alignState.rotation   = rRotation;
          alignState.scaleX_adj = rStretch;
          _close();
          buildStage();
          ctx.toast("Aligned (" + pairs + " pairs, residual " + resPct + "%)");
        }
      };
      toolbar.appendChild(applyBtn);

      // Discard button
      const discardBtn = document.createElement("button");
      discardBtn.style.cssText = "font-size:11px;padding:3px 10px;color:#f87171;background:#1a0808;border:1px solid #7f1d1d;border-radius:4px;cursor:pointer";
      discardBtn.textContent = "Discard";
      discardBtn.onclick = _close;
      toolbar.appendChild(discardBtn);

      // -- Preview panel: both maps overlaid with the computed transform --
      const previewPanel = document.createElement("div");
      previewPanel.style.cssText = "flex:1;display:flex;flex-direction:column;align-items:center;" +
        "justify-content:center;padding:16px;overflow:hidden;min-height:0";

      const previewStage = document.createElement("div");
      previewStage.style.cssText = "position:relative;width:100%;max-width:900px;aspect-ratio:" + _refAR +
        ";max-height:calc(100vh - 120px);background:#071008;border:2px solid #1e4976;border-radius:8px;overflow:hidden";

      // Reference map layer (bottom)
      const refUrl = _mapUrl(refMap);
      if (refUrl) {
        const ri = document.createElement("img");
        ri.src = refUrl;
        ri.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:fill;display:block;pointer-events:none;opacity:0.6";
        previewStage.appendChild(ri);
      }
      const refLabel = document.createElement("div");
      refLabel.style.cssText = "position:absolute;top:4px;left:6px;font-size:10px;color:#52b788;font-weight:700;z-index:3;background:#071008aa;padding:1px 6px;border-radius:3px";
      refLabel.textContent = "Ref: " + (refMap.name || refMap.id);
      previewStage.appendChild(refLabel);

      // Target map layer (top, with computed transform)
      const tgtUrl = _mapUrl(tgtMap);
      if (tgtUrl) {
        const tgtLayer = document.createElement("div");
        tgtLayer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;" +
          "transform-origin:50% 50%;opacity:0.55;pointer-events:none";
        const csssx = rScale * rStretch;
        const csssy = rScale;
        tgtLayer.style.transform = "translate(" + (rDx * 100) + "%," + (rDy * 100) + "%) rotate(" + rRotation + "deg) scale(" + csssx + "," + csssy + ")";
        const ti = document.createElement("img");
        ti.src = tgtUrl;
        ti.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:fill;display:block";
        tgtLayer.appendChild(ti);
        previewStage.appendChild(tgtLayer);
      }
      const tgtLabel = document.createElement("div");
      tgtLabel.style.cssText = "position:absolute;top:4px;right:6px;font-size:10px;color:#f59e0b;font-weight:700;z-index:3;background:#071008aa;padding:1px 6px;border-radius:3px";
      tgtLabel.textContent = "Tgt: " + (tgtMap.name || tgtMap.id);
      previewStage.appendChild(tgtLabel);

      previewPanel.appendChild(previewStage);

      // Parameter readout below preview
      const readout = document.createElement("div");
      readout.style.cssText = "margin-top:8px;font-size:11px;color:#64748b;text-align:center;font-family:monospace";
      readout.textContent = "X:" + rDx.toFixed(4) + "  Y:" + rDy.toFixed(4) +
        "  Scale:" + rScale.toFixed(4) + "  Rot:" + rRotation.toFixed(1) + "\u00b0" +
        (Math.abs(rStretch - 1.0) > 0.005 ? "  Stretch:" + rStretch.toFixed(4) : "");
      previewPanel.appendChild(readout);

      panelsRow.appendChild(previewPanel);
    };

    // Assemble modal and render
    overlay.appendChild(toolbar);
    overlay.appendChild(panelsRow);
    _rebuild();

    // Escape key closes modal
    const _onKey = (e) => { if (e.key === "Escape") { _close(); document.removeEventListener("keydown", _onKey); } };
    document.addEventListener("keydown", _onKey);

    // Attach to the nearest shadow root (HA custom panel) or body as fallback
    const root = card.getRootNode();
    if (root && root !== document) {
      root.appendChild(overlay);
    } else {
      document.body.appendChild(overlay);
    }
  };

  // Point Align button — opens the modal overlay
  const ptAlignBtn = el("button",{class:"btn inline",style:"background:#0a1a2a;border-color:#1e4976;color:#7dd3fc;font-size:11px;padding:3px 12px", onclick: _openPointAlignModal}, "Point Align");
  alignHdrRow.appendChild(ptAlignBtn);

  // Conflict warning div (created early so save/tie-in closures can reference it)
  const warnDiv = el("div",{style:"display:none;margin-top:12px;padding:12px;border-radius:8px;background:#1a0d00;border:1px solid #d97706;font-size:12px"});

  // Tie-in list div
  const tieInListDiv = el("div",{style:"margin-top:6px"});

  // Core save helper: saves the given (or current) alignment values to the backend
  const performSave = async (overX, overY, overScale, overRot) => {
    const tId = alignState.targetId || tgtSel.value;
    const tM  = (ctx.state.maps.list||[]).find(m=>m.id===tId) || maps.find(m=>m.id===tId);
    if(!tM) throw new Error("No target map selected");
    const rId  = alignState.refId || refSel.value;
    const rM2  = (ctx.state.maps.list||[]).find(m=>m.id===rId) || maps.find(m=>m.id===rId);
    const x = overX   ?? alignState.x_offset;
    const y = overY   ?? alignState.y_offset;
    const s = overScale ?? alignState.scale;
    const r = overRot ?? (alignState.rotation || 0);
    const tgtWasMaster = !!(tM.stack?.is_master);
    // Dual-master choice: 'tgt' = keep target as master, revoke reference instead
    const keepTgt = dualMasterChoice === 'tgt' && tgtWasMaster && !!(rM2?.stack?.is_master);
    const newStk = Object.assign({}, tM.stack||{}, {
      x_offset: x, y_offset: y, scale: s, rotation: r,
      scale_x_adj: alignState.scaleX_adj || 1.0,
      ref_map_id: rId||null,
      ref_ar: rM2 ? (rM2.image?.height||600)/(rM2.image?.width||800) : undefined,
      ...(tgtWasMaster && !keepTgt ? { is_master: false } : {}),
    });
    await ctx.actions.mapsUpdate({
      map_id: tM.id, receivers: tM.receivers||[], calibration: tM.calibration||{},
      notes: tM.notes||"", floor_id: tM.floor_id||"", room_bounds: tM.room_bounds||{},
      stack: newStk,
    });
    // If user chose to keep target, also revoke master on the reference map
    if(keepTgt && rM2){
      const refStk2 = Object.assign({}, rM2.stack||{}, { is_master: false });
      await ctx.actions.mapsUpdate({
        map_id: rM2.id, receivers: rM2.receivers||[], calibration: rM2.calibration||{},
        notes: rM2.notes||"", floor_id: rM2.floor_id||"", room_bounds: rM2.room_bounds||{},
        stack: refStk2,
      });
    }
    const saved = (ctx.state.maps.list||[]).find(m=>m.id===tId);
    if(saved?.stack) alignState.rotation = saved.stack.rotation ?? alignState.rotation;
    warnDiv.style.display = "none";
    masterWarnDiv.style.display = "none";
    dualMasterWarnDiv.style.display = "none";
    dualMasterChoice = null;
    return keepTgt ? false : tgtWasMaster; // true = target's master was revoked
  };

  // Render tie-in chips below ctrlRow
  const renderTieIns = () => {
    tieInListDiv.innerHTML = "";
    const tId2 = alignState.targetId || tgtSel.value;
    const tM2  = (ctx.state.maps.list||[]).find(m=>m.id===tId2) || maps.find(m=>m.id===tId2);
    const tieIns2 = (tM2?.stack?.tie_ins)||[];
    if(!tieIns2.length) return;
    const allM2 = ctx.state.maps.list||maps;
    const row2 = el("div",{style:"display:flex;gap:6px;flex-wrap:wrap;align-items:center"});
    row2.appendChild(el("span",{style:"font-size:11px;color:#64748b;white-space:nowrap"},"Tie-ins:"));
    for(const ti of tieIns2){
      const rM3 = allM2.find(m=>m.id===ti.ref_map_id);
      const rN  = rM3 ? (rM3.name||rM3.id) : (ti.ref_map_id||"?");
      const chip = el("span",{style:"display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:#0a2a1a;border:1px solid #2d6a4f;border-radius:12px;font-size:11px;color:#52b788"});
      chip.appendChild(document.createTextNode("Tied: "+rN));
      const delX = el("button",{style:"background:none;border:none;color:#64748b;cursor:pointer;font-size:11px;padding:0 0 0 4px;line-height:1",
        onclick: async(ev3)=>{
          ev3.stopPropagation();
          const tId3 = alignState.targetId || tgtSel.value;
          const tM3  = (ctx.state.maps.list||[]).find(m=>m.id===tId3) || maps.find(m=>m.id===tId3);
          if(!tM3) return;
          const newTIs = ((tM3?.stack?.tie_ins)||[]).filter(t=>t.ref_map_id !== ti.ref_map_id);
          const newStk3 = Object.assign({}, tM3.stack||{}, { tie_ins: newTIs });
          try {
            await ctx.actions.mapsUpdate({
              map_id: tM3.id, receivers: tM3.receivers||[], calibration: tM3.calibration||{},
              notes: tM3.notes||"", floor_id: tM3.floor_id||"", room_bounds: tM3.room_bounds||{},
              stack: newStk3,
            });
            ctx.toast("Tie-in removed");
            renderTieIns();
          } catch(e3){ ctx.toast("Failed: "+String(e3), true); }
        }},"×");
      chip.appendChild(delX);
      row2.appendChild(chip);
    }
    tieInListDiv.appendChild(row2);
  };

  // Save alignment — checks upstream conflicts and lists downstream dependents
  const saveAlignBtn = el("button",{class:"btn inline", onclick: async (ev)=>{
    const btn = ev.currentTarget;
    const tId = alignState.targetId || tgtSel.value;
    const tM  = (ctx.state.maps.list||[]).find(m=>m.id===tId) || maps.find(m=>m.id===tId);
    if(!tM){ ctx.toast("No target map selected.", true); return; }
    const allM = ctx.state.maps.list||maps;
    const escN = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

    // Dual-master guard: both maps are masters + scale/rotation changed + no choice made yet
    const rId0 = alignState.refId || refSel.value;
    const rM0  = allM.find(m=>m.id===rId0);
    const srChanged = Math.abs(alignState.scale - 1.0) > 0.02 || Math.abs(alignState.rotation||0) > 2.0;
    if(rM0?.stack?.is_master && tM?.stack?.is_master && srChanged && dualMasterChoice === null){
      ctx.toast("Both maps are masters — choose which one keeps master status before saving.", true);
      dualMasterWarnDiv.scrollIntoView?.({behavior:"smooth", block:"nearest"});
      return;
    }

    // Upstream: tie-ins stored on this map pointing to reference maps
    const conflicts = _checkAlignConflicts(
      alignState.x_offset, alignState.y_offset,
      alignState.scale, alignState.rotation||0, tM, allM
    );
    // Downstream: other maps that have a tie-in pointing TO this map
    const downstream = allM.filter(m =>
      m.id !== tM.id && (m.stack?.tie_ins||[]).some(ti => ti.ref_map_id === tM.id)
    );
    const downstreamNames = downstream.map(m => m.name||m.id);

    // Note about master revocation; keepTgt means reference lost master (not target)
    const _mNote = wasM => {
      if(!wasM) return "";
      const rId0b = alignState.refId || refSel.value;
      const rM0b  = allM.find(m=>m.id===rId0b);
      if(dualMasterChoice === 'tgt' && rM0b) return `\n⭐ "${rM0b.name||rM0b.id}" master status revoked`;
      return `\n⭐ Master status revoked`;
    };
    // No upstream conflicts — save immediately, note downstream if any
    if(!conflicts.length){
      btn.disabled = true; btn.textContent = "Saving…";
      try {
        const wasM = await performSave();
        const note = (downstreamNames.length
          ? `Alignment saved ✔\n↳ Downstream maps may need re-checking: ${downstreamNames.join(", ")}`
          : "Alignment saved ✔") + _mNote(wasM);
        ctx.toast(note);
      }
      catch(e){ ctx.toast("Save failed: "+String(e), true); }
      finally { try{ btn.disabled=false; btn.textContent="Save Alignment"; }catch(_){} }
      return;
    }
    // All tiny (<5%) — auto-average silently, note downstream if any
    if(conflicts.every(c=>c.variancePct < 5)){
      btn.disabled = true; btn.textContent = "Saving…";
      try {
        const tIns = (tM?.stack?.tie_ins)||[];
        const avg = _averageAlignWithTieIns(alignState.x_offset, alignState.y_offset, alignState.scale, alignState.rotation||0, tIns);
        const wasM = await performSave(avg.x_offset, avg.y_offset, avg.scale, avg.rotation);
        const note = (downstreamNames.length
          ? `Alignment saved ✔ (minor variance averaged)\n↳ Downstream maps may need re-checking: ${downstreamNames.join(", ")}`
          : "Alignment saved ✔ (minor variance averaged with tie-ins)") + _mNote(wasM);
        ctx.toast(note);
      } catch(e){ ctx.toast("Save failed: "+String(e), true); }
      finally { try{ btn.disabled=false; btn.textContent="Save Alignment"; }catch(_){} }
      return;
    }
    // Show full warning: upstream conflicts + downstream note
    const hasModerate = conflicts.some(c=>c.variancePct < 25);
    let html = `<div style="font-weight:600;color:#f59e0b;margin-bottom:8px">⚠ Alignment Conflicts Detected</div>`;
    html += `<div style="color:#cbd5e1;margin-bottom:8px;font-size:11px">This position differs from stored tie-in relationships for <strong>${escN(tM.name||tM.id)}</strong>:</div>`;
    html += `<ul style="margin:0 0 10px 14px;padding:0;color:#94a3b8;font-size:11px">`;
    for(const c of conflicts){
      const sev = c.variancePct >= 25 ? "color:#f87171" : "color:#fbbf24";
      html += `<li style="margin-bottom:3px">Tied to <strong style="color:#e2e8f0">"${escN(c.refName)}"</strong>: `
        + `offset ${c.offPct}%, scale ${c.scalePct}%, rotation ${c.rotDiff}° `
        + `— <span style="${sev}">${c.variancePct}% overall variance</span></li>`;
    }
    html += `</ul>`;
    // Downstream note (informational, not blocking)
    if(downstreamNames.length){
      html += `<div style="margin-bottom:10px;padding:7px 10px;border-radius:6px;background:#0a1a2a;border:1px solid #2563eb;font-size:11px;color:#93c5fd">`;
      html += `<strong>↓ Downstream maps tied to "${escN(tM.name||tM.id)}":</strong> `;
      html += downstreamNames.map(n=>`<strong>${escN(n)}</strong>`).join(", ");
      html += `<div style="color:#64748b;margin-top:3px">Moving this map will invalidate their tie-in constraints. Re-check and update them after saving.</div>`;
      html += `</div>`;
    }
    html += `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">`;
    if(hasModerate) html += `<button id="_wAvgBtn" class="btn inline" style="background:#0a2a1a;border-color:#52b788">Average &amp; Save</button>`;
    html += `<button id="_wOvrBtn" class="btn inline" style="background:#7f1d1d;border-color:#dc2626">Override &amp; Save</button>`;
    html += `<button id="_wCxlBtn" class="btn inline">Cancel</button>`;
    html += `</div>`;
    warnDiv.innerHTML = html;
    warnDiv.style.display = "block";
    // Override
    warnDiv.querySelector("#_wOvrBtn").onclick = async()=>{
      warnDiv.style.display="none";
      btn.disabled=true; btn.textContent="Saving…";
      try{
        const wasM = await performSave();
        const note = (downstreamNames.length
          ? `Alignment saved ✔ (override)\n↳ Update downstream maps: ${downstreamNames.join(", ")}`
          : "Alignment saved ✔ (override)") + _mNote(wasM);
        ctx.toast(note);
      }
      catch(e){ ctx.toast("Save failed: "+String(e), true); }
      finally{ try{ btn.disabled=false; btn.textContent="Save Alignment"; }catch(_){} }
    };
    // Average (only when hasModerate)
    const avgBtn = warnDiv.querySelector("#_wAvgBtn");
    if(avgBtn) avgBtn.onclick = async()=>{
      warnDiv.style.display="none";
      btn.disabled=true; btn.textContent="Saving…";
      try{
        const tIns = (tM?.stack?.tie_ins)||[];
        const avg = _averageAlignWithTieIns(alignState.x_offset, alignState.y_offset, alignState.scale, alignState.rotation||0, tIns);
        const wasM = await performSave(avg.x_offset, avg.y_offset, avg.scale, avg.rotation);
        const note = (downstreamNames.length
          ? `Alignment saved ✔ (averaged)\n↳ Update downstream maps: ${downstreamNames.join(", ")}`
          : "Alignment saved ✔ (averaged with tie-ins)") + _mNote(wasM);
        ctx.toast(note);
      } catch(e){ ctx.toast("Save failed: "+String(e), true); }
      finally{ try{ btn.disabled=false; btn.textContent="Save Alignment"; }catch(_){} }
    };
    // Cancel
    warnDiv.querySelector("#_wCxlBtn").onclick = ()=>{ warnDiv.style.display="none"; };
  }},"Save Alignment");
  ctrlRow.appendChild(saveAlignBtn);

  // ── Add Tie-in Button ──
  // Tie-ins are stored alignment snapshots that serve as persistent constraints.
  // Each tie-in records (x_offset, y_offset, scale, rotation) relative to a
  // specific reference map + a date stamp. Multiple tie-ins from different
  // reference maps create a constraint network. When the user saves a new
  // alignment that conflicts with existing tie-ins, the conflict resolver
  // either auto-averages (minor variance) or warns (significant variance).
  const addTieInBtn = el("button",{class:"btn inline",style:"margin-left:4px;background:#0a2a1a;border-color:#2d6a4f",
    onclick: async()=>{
      const tId = alignState.targetId || tgtSel.value;
      const tM  = (ctx.state.maps.list||[]).find(m=>m.id===tId) || maps.find(m=>m.id===tId);
      if(!tM){ ctx.toast("No target map selected.", true); return; }
      const rId = alignState.refId || refSel.value;
      const existing = (tM?.stack?.tie_ins)||[];
      // Replace any existing tie-in for the same ref
      const filtered = existing.filter(ti=>ti.ref_map_id !== rId);
      const newTieIns = [...filtered, {
        ref_map_id: rId,
        x_offset:  alignState.x_offset,
        y_offset:  alignState.y_offset,
        scale:     alignState.scale,
        rotation:  alignState.rotation||0,
        date:      new Date().toISOString().slice(0,10),
      }];
      const newStk = Object.assign({}, tM.stack||{}, { tie_ins: newTieIns });
      try {
        await ctx.actions.mapsUpdate({
          map_id: tM.id, receivers: tM.receivers||[], calibration: tM.calibration||{},
          notes: tM.notes||"", floor_id: tM.floor_id||"", room_bounds: tM.room_bounds||{},
          stack: newStk,
        });
        ctx.toast("Tie-in added ✔");
        renderTieIns();
      } catch(e){ ctx.toast("Failed: "+String(e), true); }
    }},"+ Tie-in");
  ctrlRow.appendChild(addTieInBtn);

  card.appendChild(ctrlRow);
  card.appendChild(warnDiv);
  card.appendChild(tieInListDiv);
  renderTieIns();

  // ── Emergency Tie-in Recovery ──────────────────────────────────────────────
  const recovDetailPanel = el("div",{style:"display:none;margin-top:8px;padding:12px;border-radius:8px;background:#140800;border:1px solid #7f1d1d;font-size:12px"});
  const recovBtn = el("button",{class:"btn inline",
    style:"margin-top:10px;background:#1a0800;border-color:#7f1d1d;color:#fca5a5",
    onclick: ()=>{
      const allM = ctx.state.maps.list||maps;
      const plans = _emergencyRecoverTieIns(allM);
      if(!plans.length){
        recovDetailPanel.style.display = "none";
        ctx.toast("No inconsistent tie-ins found — network looks healthy ✔");
        return;
      }
      const escR = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      const totalRemoved = plans.reduce((s,p)=>s+p.removedTieIns.length, 0);
      let html = `<div style="font-weight:600;color:#f87171;margin-bottom:8px">🚑 Emergency Tie-in Recovery</div>`;
      html += `<div style="color:#cbd5e1;margin-bottom:10px;font-size:11px">Found <strong>${totalRemoved}</strong> inconsistent tie-in${totalRemoved>1?"s":""} across <strong>${plans.length}</strong> map${plans.length>1?"s":""}. Only the most consistent cluster will be kept.</div>`;
      html += `<div style="margin-bottom:10px">`;
      for(const p of plans){
        const mapName = escR(p.map.name||p.map.id);
        html += `<div style="padding:7px 0;border-bottom:1px solid #2a1000">`;
        html += `<div style="color:#e2e8f0;font-weight:600">${mapName}</div>`;
        html += `<div style="color:#94a3b8;font-size:11px;margin-top:2px">${p.reason}</div>`;
        if(p.removedTieIns.length){
          const rmN = p.removedTieIns.map(ti=>{ const rm=allM.find(x=>x.id===ti.ref_map_id); return `"${escR(rm?rm.name||rm.id:ti.ref_map_id||"?")}"`;});
          html += `<div style="color:#f87171;font-size:11px;margin-top:2px">✕ Remove: ${rmN.join(", ")}</div>`;
        }
        if(p.keptTieIns.length){
          const kpN = p.keptTieIns.map(ti=>{ const km=allM.find(x=>x.id===ti.ref_map_id); return `"${escR(km?km.name||km.id:ti.ref_map_id||"?")}"`;});
          html += `<div style="color:#52b788;font-size:11px;margin-top:2px">✔ Keep: ${kpN.join(", ")}</div>`;
        } else {
          html += `<div style="color:#f59e0b;font-size:11px;margin-top:2px">All tie-ins removed (all conflict with saved position)</div>`;
        }
        html += `</div>`;
      }
      html += `</div>`;
      html += `<div style="display:flex;gap:8px;align-items:center">`;
      html += `<button id="_rConfBtn" class="btn inline" style="background:#7f1d1d;border-color:#dc2626">Confirm Recovery</button>`;
      html += `<button id="_rCxlBtn" class="btn inline">Cancel</button>`;
      html += `</div>`;
      recovDetailPanel.innerHTML = html;
      recovDetailPanel.style.display = "block";
      recovDetailPanel.querySelector("#_rCxlBtn").onclick = ()=>{ recovDetailPanel.style.display="none"; };
      recovDetailPanel.querySelector("#_rConfBtn").onclick = async ()=>{
        const confBtn = recovDetailPanel.querySelector("#_rConfBtn");
        confBtn.disabled=true; confBtn.textContent="Recovering…";
        try{
          for(const p of plans){
            const freshMap = (ctx.state.maps.list||maps).find(m=>m.id===p.map.id)||p.map;
            await ctx.actions.mapsUpdate({
              map_id: freshMap.id, receivers: freshMap.receivers||[], calibration: freshMap.calibration||{},
              notes: freshMap.notes||"", floor_id: freshMap.floor_id||"", room_bounds: freshMap.room_bounds||{},
              stack: Object.assign({}, freshMap.stack||{}, { tie_ins: p.keptTieIns }),
            });
          }
          recovDetailPanel.style.display="none";
          renderTieIns();
          ctx.toast(`Recovery complete ✔ — removed ${totalRemoved} outlier tie-in${totalRemoved>1?"s":""}`);
        } catch(e){
          ctx.toast("Recovery failed: "+String(e), true);
          try{ confBtn.disabled=false; confBtn.textContent="Confirm Recovery"; }catch(_){}
        }
      };
    }}, "🚑 Emergency Recovery");
  card.appendChild(recovBtn);
  card.appendChild(recovDetailPanel);

  // ── Section 3: 3D Isometric Preview ───────────────────────────────────────
  card.appendChild(el("div",{class:"muted",style:"margin-top:24px;font-size:13px;font-weight:600"},"3D Isometric Preview"));
  card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-top:2px"},"Shows all uploaded floor plans stacked by their assigned level. Use the slider to focus on one floor."));

  // Floor focus slider
  if(ctx.state.maps._stackIsoFocus  === undefined) ctx.state.maps._stackIsoFocus  = ctx.state.settings?.maps_iso_focus  ?? null;
  if(ctx.state.maps._stackFloorGap  === undefined) ctx.state.maps._stackFloorGap  = ctx.state.settings?.maps_iso_floor_gap ?? 200;
  if(ctx.state.maps._stackHorizGap  === undefined) ctx.state.maps._stackHorizGap  = ctx.state.settings?.maps_iso_horiz_gap ?? 0;
  const sortedIsoLevels = [...new Set(maps.map(m=>m.stack?.z_level||0))].sort((a,b)=>a-b);
  const focusLbl = el("span",{style:"font-size:12px;color:#94a3b8;min-width:80px;display:inline-block"}, "All floors");
  const focusSlider = document.createElement("input");
  focusSlider.type = "range"; focusSlider.min = "0"; focusSlider.max = String(sortedIsoLevels.length);
  focusSlider.style.cssText = "width:130px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
  focusSlider.value = ctx.state.maps._stackIsoFocus === null ? "0"
    : String(sortedIsoLevels.indexOf(ctx.state.maps._stackIsoFocus) + 1);

  // Layer spacing slider
  const gapLbl = el("span",{style:"font-size:12px;color:#94a3b8;min-width:36px;display:inline-block;text-align:right"},
    String(ctx.state.maps._stackFloorGap));
  const gapSlider = document.createElement("input");
  gapSlider.type = "range"; gapSlider.min = "60"; gapSlider.max = "340"; gapSlider.step = "10";
  gapSlider.style.cssText = "width:130px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
  gapSlider.value = String(ctx.state.maps._stackFloorGap);

  // L/R horizontal offset slider
  const horizLbl = el("span",{style:"font-size:12px;color:#94a3b8;min-width:36px;display:inline-block;text-align:right"},
    String(ctx.state.maps._stackHorizGap));
  const horizSlider = document.createElement("input");
  horizSlider.type = "range"; horizSlider.min = "-120"; horizSlider.max = "120"; horizSlider.step = "10";
  horizSlider.style.cssText = "width:100px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
  horizSlider.value = String(ctx.state.maps._stackHorizGap);

  const isoWrap = el("div",{style:"margin-top:8px;overflow:auto;border-radius:8px;background:#071008;padding:8px"});
  const rebuildIso = () => {
    isoWrap.innerHTML = _stackIsoSVG(maps, ctx, levelOptions, ctx.state.maps._stackIsoFocus, ctx.state.maps._stackFloorGap, ctx.state.maps._stackHorizGap);
  };
  horizSlider.addEventListener("input", () => {
    ctx.state.maps._stackHorizGap = parseInt(horizSlider.value, 10);
    horizLbl.textContent = String(ctx.state.maps._stackHorizGap);
    rebuildIso();
  });
  focusSlider.addEventListener("input", () => {
    const idx = parseInt(focusSlider.value, 10);
    if(idx === 0){ ctx.state.maps._stackIsoFocus = null; focusLbl.textContent = "All floors"; }
    else {
      const z = sortedIsoLevels[idx-1];
      ctx.state.maps._stackIsoFocus = z;
      const opt = levelOptions.find(o=>o.value===z);
      focusLbl.textContent = opt ? opt.label : `L${z}`;
    }
    rebuildIso();
  });
  gapSlider.addEventListener("input", () => {
    ctx.state.maps._stackFloorGap = parseInt(gapSlider.value, 10);
    gapLbl.textContent = String(ctx.state.maps._stackFloorGap);
    rebuildIso();
  });

  // Persistent last-seen pins: show red target crosshairs for away objects
  if(ctx.state.maps._persistentPins === undefined) ctx.state.maps._persistentPins = false;
  const persistentBtn = el("button",{
    class: "btn inline",
    style: ctx.state.maps._persistentPins
      ? "background:#7f1d1d;border-color:#ef4444;color:#fca5a5;font-weight:700"
      : "color:#94a3b8",
    title: "Show last-seen position of away objects as red target pins on the 3D map",
    onclick: ()=>{
      ctx.state.maps._persistentPins = !ctx.state.maps._persistentPins;
      persistentBtn.style.cssText = ctx.state.maps._persistentPins
        ? "background:#7f1d1d;border-color:#ef4444;color:#fca5a5;font-weight:700"
        : "color:#94a3b8";
      rebuildIso();
      rebuildPins();
    }
  }, ctx.state.maps._persistentPins ? "⊕ Persistent ON" : "⊕ Persistent");

  if(ctx.state.maps._stackShowRoomList === undefined) ctx.state.maps._stackShowRoomList = false;

  const roomListToggle = el("button",{class:"btn inline", style:"margin-left:auto", onclick:()=>{
    ctx.state.maps._stackShowRoomList = !ctx.state.maps._stackShowRoomList;
    roomListToggle.textContent = ctx.state.maps._stackShowRoomList ? "☰ Hide Room List" : "☰ Room List";
    roomListPanel.style.display = ctx.state.maps._stackShowRoomList ? "block" : "none";
  }}, ctx.state.maps._stackShowRoomList ? "☰ Hide Room List" : "☰ Room List");

  const isoSaveLbl = el("span",{class:"muted",style:"font-size:11px;min-width:50px"}, "");
  const isoSaveBtn = el("button",{class:"btn inline",style:"padding:2px 10px;font-size:12px",
    title:"Save these slider positions so the view reopens with the same layout",
    onclick: async ()=>{
      isoSaveBtn.disabled = true;
      try{
        await ctx.actions.settingsSet({
          maps_iso_floor_gap: ctx.state.maps._stackFloorGap,
          maps_iso_horiz_gap: ctx.state.maps._stackHorizGap,
          maps_iso_focus:     ctx.state.maps._stackIsoFocus,
        });
        isoSaveLbl.textContent = "Saved ✓";
        setTimeout(()=>{ isoSaveLbl.textContent = ""; }, 2000);
      }catch(e){ isoSaveLbl.textContent = "Error"; }
      isoSaveBtn.disabled = false;
    }
  }, "Save");
  const isoResetBtn = el("button",{class:"btn inline",style:"padding:2px 10px;font-size:12px",
    title:"Reset sliders to default values and clear the saved layout",
    onclick: async ()=>{
      ctx.state.maps._stackFloorGap = 200;
      ctx.state.maps._stackHorizGap = 0;
      ctx.state.maps._stackIsoFocus = null;
      gapSlider.value   = "200"; gapLbl.textContent   = "200";
      horizSlider.value = "0";   horizLbl.textContent = "0";
      focusSlider.value = "0";   focusLbl.textContent = "All floors";
      rebuildIso();
      isoResetBtn.disabled = true;
      try{
        await ctx.actions.settingsSet({ maps_iso_floor_gap:200, maps_iso_horiz_gap:0, maps_iso_focus:null });
        isoSaveLbl.textContent = "Reset ✓";
        setTimeout(()=>{ isoSaveLbl.textContent = ""; }, 2000);
      }catch(e){ isoSaveLbl.textContent = "Error"; }
      isoResetBtn.disabled = false;
    }
  }, "Reset");
  // ── Stale Receiver Cleanup ──
  // A receiver is "stale" if its source MAC / label doesn't match any currently
  // active BLE scanner in HA. This can happen when scanners are removed or
  // renamed. The cleanup button removes stale receivers from all maps.
  const snap_rx = (ctx.state.live?.snapshot?.ble?.radios) || [];
  const liveSourceSet = new Set(snap_rx.map(r => r.source).filter(Boolean));
  // name→source and source→name lookups for backfill matching
  const nameToSource = new Map();
  const liveNameLower = new Map(); // lowercase name → source
  for(const radio of snap_rx){
    if(radio.name && radio.source) nameToSource.set(radio.name, radio.source);
    if(radio.name && radio.source) liveNameLower.set(radio.name.toLowerCase(), radio.source);
    // Also map source→source so label matching works when label IS the source address
    if(radio.source) liveNameLower.set(radio.source.toLowerCase(), radio.source);
  }

  // Backfill: if a receiver has no source but its label matches a live radio name,
  // populate source so future stale checks work reliably
  const backfillMaps = [];
  for(const m of maps){
    let changed = false;
    for(const r of (m.receivers||[])){
      if(r.source) continue; // already has source
      // Try exact name match first, then case-insensitive
      const matched = nameToSource.get(r.label) || liveNameLower.get((r.label||"").toLowerCase());
      if(matched){ r.source = matched; changed = true; }
    }
    if(changed) backfillMaps.push(m);
  }
  // Persist backfill silently (fire-and-forget)
  if(backfillMaps.length){
    (async ()=>{
      for(const m of backfillMaps){
        try{ await ctx.actions.mapsUpdate({ map_id: m.id, receivers: m.receivers||[], calibration: m.calibration||{}, notes: m.notes||"" }); }catch(e){}
      }
    })();
  }

  // Now count stale — a receiver matches if source is in live set OR label matches a live radio
  const _rxIsLive = (r) => {
    if(r.source && liveSourceSet.has(r.source)) return true;
    if(r.label && nameToSource.has(r.label)) return true;
    if(r.label && liveNameLower.has((r.label||"").toLowerCase())) return true;
    return false;
  };
  let staleCount = 0;
  for(const m of maps){
    for(const r of (m.receivers||[])){
      if(!_rxIsLive(r)) staleCount++;
    }
  }
  const cleanLbl = el("span",{class:"muted",style:"font-size:11px;min-width:50px"}, "");
  const cleanBtn = el("button",{class:"btn inline",style:"padding:2px 10px;font-size:12px" + (staleCount > 0 ? ";color:#ffd54f;border-color:#92400e" : ";opacity:0.5"),
    title: staleCount > 0 ? `Remove ${staleCount} receiver(s) not matching any live BLE scanner` : "All receivers match live scanners",
    onclick: async ()=>{
      if(!staleCount){ cleanLbl.textContent = "All clean"; setTimeout(()=>{ cleanLbl.textContent = ""; }, 2000); return; }
      if(!confirm(`Remove ${staleCount} stale receiver(s) from your maps?\n\nThese receivers don't match any active BLE scanner.`)) return;
      cleanBtn.disabled = true; cleanLbl.textContent = "Cleaning…";
      try{
        for(const m of maps){
          const orig = m.receivers || [];
          const kept = orig.filter(r => _rxIsLive(r));
          if(kept.length < orig.length){
            await ctx.actions.mapsUpdate({
              map_id: m.id, receivers: kept,
              calibration: m.calibration||{}, notes: m.notes||"",
            });
          }
        }
        cleanLbl.textContent = `Removed ${staleCount} ✓`;
        setTimeout(()=>{ cleanLbl.textContent = ""; ctx.actions.renderRooms(); }, 1500);
      }catch(e){ cleanLbl.textContent = "Error"; }
      cleanBtn.disabled = false;
    }
  }, staleCount > 0 ? `Clean ${staleCount} stale` : "No stale");

  card.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap"},[
    el("span",{class:"muted",style:"font-size:12px"},"Floor:"),
    focusSlider,
    focusLbl,
    el("span",{class:"muted",style:"font-size:12px;margin-left:12px"},"Spacing:"),
    gapSlider,
    gapLbl,
    el("span",{class:"muted",style:"font-size:12px;margin-left:12px"},"L/R:"),
    horizSlider,
    horizLbl,
    isoSaveBtn,
    isoResetBtn,
    persistentBtn,
    cleanBtn,
    isoSaveLbl,
    cleanLbl,
    roomListToggle,
  ]));

  rebuildIso();
  card.appendChild(isoWrap);

  // Room list panel (all unique rooms across visible maps)
  const roomListPanel = el("div",{style:`display:${ctx.state.maps._stackShowRoomList ? "block" : "none"};margin-top:10px`});
  const visMaps2 = maps.filter(m=>!hiddenIds.has(m.id));
  const roomRows = [];
  for(const m of visMaps2){
    const floorLbl = _floorName(ctx, m.stack?.floor_id || m.floor_id || "");
    for(const room of Object.keys(m.room_bounds||{})){
      if(!roomRows.find(r=>r.room===room))
        roomRows.push({ room, map: m.name||m.id, floor: floorLbl });
    }
  }
  roomRows.sort((a,b)=>a.room.localeCompare(b.room));
  if(roomRows.length){
    const tbl = document.createElement("table");
    tbl.style.cssText = "width:100%;border-collapse:collapse;font-size:13px";
    tbl.innerHTML = `<thead><tr style="border-bottom:1px solid #1b3526">
      <th style="padding:5px 8px;color:#94a3b8;font-weight:500;text-align:left;width:24px"></th>
      <th style="padding:5px 8px;color:#94a3b8;font-weight:500;text-align:left">Room</th>
      <th style="padding:5px 8px;color:#94a3b8;font-weight:500;text-align:left">Floor</th>
      <th style="padding:5px 8px;color:#94a3b8;font-weight:500;text-align:left">Map</th>
    </tr></thead>`;
    const tbody2 = document.createElement("tbody");
    const roomColorFn = ctx.helpers.roomColor;
    for(const rr of roomRows){
      const color = roomColorFn(rr.room);
      const tr2 = document.createElement("tr");
      tr2.style.cssText = "border-bottom:1px solid #0f2017";
      tr2.innerHTML = `<td style="padding:5px 8px"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${color};vertical-align:middle"></span></td>
        <td style="padding:5px 8px;font-weight:600;color:#e2e8f0">${esc(rr.room)}</td>
        <td style="padding:5px 8px;color:#94a3b8">${esc(rr.floor)||"—"}</td>
        <td style="padding:5px 8px;color:#94a3b8">${esc(rr.map)}</td>`;
      tbody2.appendChild(tr2);
    }
    tbl.appendChild(tbody2);
    roomListPanel.appendChild(tbl);
  } else {
    roomListPanel.appendChild(el("div",{class:"muted",style:"font-size:12px;padding:8px"},"No rooms drawn yet. Go to Maps → Edit to draw room boundaries."));
  }
  card.appendChild(roomListPanel);

  return card;
}

// Render a single map's room bounds + receivers as an SVG string.
// Used in the Alignment Overlay (both ref and tgt layers) and in Point Align
// panels. viewBox="0 0 1 1" with preserveAspectRatio="none" matches the
// normalized coordinate system used by room bounds and receivers.
function _stackMapSVGStr(map, ctx, isTarget, showBg=true){
  const roomColor = ctx.helpers.roomColor;
  const rb = map.room_bounds || {};
  const hasRooms = Object.keys(rb).length > 0;
  const borderCol = isTarget ? "#52b78888" : "#1b3526";

  let s = `<svg viewBox="0 0 1 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">`;
  if(showBg){
    s += `<rect x="0.005" y="0.005" width="0.99" height="0.99" fill="${isTarget?"#071008aa":"#071008"}" stroke="${borderCol}" stroke-width="0.012"/>`;
  } else if(isTarget){
    // Show a subtle border only so the target boundary is visible over the image
    s += `<rect x="0.005" y="0.005" width="0.99" height="0.99" fill="none" stroke="${borderCol}" stroke-width="0.012" opacity="0.5"/>`;
  }

  if(hasRooms){
    for(const [room, b] of Object.entries(rb)){
      if(!b) continue;
      const color = roomColor(room);
      const alpha = isTarget ? "99" : "33";
      if(b.type==="poly" && Array.isArray(b.points) && b.points.length >= 3){
        const pts = b.points.map(p=>`${p[0]},${p[1]}`).join(" ");
        s += `<polygon points="${pts}" fill="${color}${alpha}" stroke="${color}" stroke-width="0.006"/>`;
        const cx = b.points.reduce((a,p)=>a+p[0],0)/b.points.length;
        const cy = b.points.reduce((a,p)=>a+p[1],0)/b.points.length;
        s += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="0.05" font-family="system-ui,sans-serif">${_escSVG(room)}</text>`;
      } else if(b.type==="circle"){
        const cx=b.cx||0.5, cy=b.cy||0.5, r=b.r||0.12;
        s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}${alpha}" stroke="${color}" stroke-width="0.006"/>`;
        s += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="0.05" font-family="system-ui,sans-serif">${_escSVG(room)}</text>`;
      }
    }
    for(const r of (map.receivers||[])){
      s += `<circle cx="${r.x||0}" cy="${r.y||0}" r="0.022" fill="#52b788" opacity="0.9"/>`;
    }
  } else {
    s += `<text x="0.5" y="0.43" text-anchor="middle" dominant-baseline="middle" fill="#94a3b8" font-size="0.07" font-family="system-ui,sans-serif">${_escSVG(map.name||map.id)}</text>`;
    s += `<text x="0.5" y="0.58" text-anchor="middle" dominant-baseline="middle" fill="#4a6052" font-size="0.045" font-family="system-ui,sans-serif">no room bounds yet</text>`;
  }

  s += `<text x="0.97" y="0.97" text-anchor="end" dominant-baseline="auto" fill="${isTarget?"#52b788":"#94a3b8"}" font-size="0.04" font-family="system-ui,sans-serif">${_escSVG(map.name||map.id)}</text>`;
  s += `</svg>`;
  return s;
}

// Persistent-pins SVG overlay for the 2D alignment view: shows red target
// crosshairs at room centroids for objects that are "away" (stale age > 30s).
// Uses viewBox="0 0 1 1" / preserveAspectRatio="none" to match the room_bounds
// coordinate system (same as _stackMapSVGStr).
function _persistent2dPinsSVGStr(roomBounds, awayObjs){
  if(!awayObjs.length) return "";
  const rb = roomBounds || {};
  let s = `<svg viewBox="0 0 1 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;width:100%;height:100%">`;
  for(const obj of awayObjs){
    const b = rb[obj.room];
    if(!b) continue;
    let cx = 0.5, cy = 0.5;
    if(b.type === "poly" && Array.isArray(b.points) && b.points.length >= 3){
      cx = b.points.reduce((a,p)=>a+p[0],0)/b.points.length;
      cy = b.points.reduce((a,p)=>a+p[1],0)/b.points.length;
    } else if(b.type === "circle"){
      cx = b.cx ?? 0.5; cy = b.cy ?? 0.5;
    }
    const R  = 0.040;  // outer ring
    const rM = 0.022;  // middle ring
    const rD = 0.009;  // centre dot
    const arm = rM + 0.026;  // crosshair arm end distance from centre
    const gap = rM + 0.005;  // crosshair arm start distance from centre
    s += `<g opacity="0.9">`;
    s += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#ef4444" stroke-width="0.007"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${rM}" fill="none" stroke="#ef4444" stroke-width="0.009"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${rD}" fill="#ef4444"/>`;
    s += `<line x1="${cx-arm}" y1="${cy}" x2="${cx-gap}" y2="${cy}" stroke="#ef4444" stroke-width="0.007"/>`;
    s += `<line x1="${cx+gap}" y1="${cy}" x2="${cx+arm}" y2="${cy}" stroke="#ef4444" stroke-width="0.007"/>`;
    s += `<line x1="${cx}" y1="${cy-arm}" x2="${cx}" y2="${cy-gap}" stroke="#ef4444" stroke-width="0.007"/>`;
    s += `<line x1="${cx}" y1="${cy+gap}" x2="${cx}" y2="${cy+arm}" stroke="#ef4444" stroke-width="0.007"/>`;
    s += `<text x="${cx}" y="${cy+R+0.030}" text-anchor="middle" fill="#fca5a5" font-size="0.038" font-family="system-ui,sans-serif" font-weight="600">${_escSVG(obj.user_label)}</text>`;
    s += `</g>`;
  }
  s += `</svg>`;
  return s;
}

// ── 3D Isometric SVG Renderer ─────────────────────────────────────────────────
// Generates a complete isometric building visualization as an SVG string.
// Each z_level becomes a "slab" (3D tile) rendered with an isometric
// projection: iso(wx,wy,wz) = (CX + (wx-wy)*TILE*0.866 + wz*horizGap,
//                               CY + (wx+wy)*TILE*0.5 - wz*FLOOR_GAP).
// The 0.866 factor (≈cos(30°)) and 0.5 (sin(30°)) give the standard
// isometric 30° viewing angle. FLOOR_GAP controls vertical separation
// between levels, horizGap shifts higher floors left/right.
//
// Each map's room bounds are projected through its stack transform
// (translate + rotate + scale) to world coordinates, then through the
// isometric projection to SVG pixel coordinates.
//
// Outside maps are special: they're fitted inside the indoor bounding box
// rather than getting their own slab, so they overlay naturally.
function _stackIsoSVG(maps, ctx, levelOptions, focusLevel=null, floorGap=200, horizGap=0){
  const TILE=260, FLOOR_GAP=floorGap, CX=390, CY=740, W=780, BASE_H=1060;
  const LAYER_PAL = ["#52b788","#f59e0b","#60a5fa","#e879f9","#fb923c","#34d399","#f87171","#a78bfa"];
  const roomColor = ctx.helpers.roomColor;
  const lvlLabel = (z)=>{ const opt=(levelOptions||[]).find(o=>o.value===z); return opt ? opt.label : `L${z}`; };

  // Persistent last-seen pins: collect away objects (labeled + have room + stale)
  const showPins = !!(ctx.state.maps && ctx.state.maps._persistentPins);
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const awayObjs = showPins && snap?.objects
    ? Object.values(snap.objects).filter(o =>
        o.user_label && o.room && o.room !== "unknown" && o.room !== "not_home" &&
        typeof o.age_s === "number" && o.age_s > 30)
    : [];

  // Isometric projection: world (wx,wy,wz) → SVG pixel (x,y)
  const iso = (wx, wy, wz)=>[
    CX + (wx-wy)*TILE*0.866 + wz*horizGap,
    CY + (wx+wy)*TILE*0.5 - wz*FLOOR_GAP,
  ];
  const pt = (c)=>`${Math.round(c[0])},${Math.round(c[1])}`;
  const ptsStr = (corners)=>corners.map(pt).join(" ");

  // Filter hidden maps
  const hiddenIds = (ctx.state.maps && ctx.state.maps._hiddenMapIds) || new Set();
  const visMaps = maps.filter(m=>!hiddenIds.has(m.id));

  // Group by z_level
  const sorted = [...visMaps].sort((a,b)=>(a.stack?.z_level||0)-(b.stack?.z_level||0));
  const byLevel = new Map();
  for(const m of sorted){
    const z = m.stack?.z_level ?? 0;
    if(!byLevel.has(z)) byLevel.set(z,[]);
    byLevel.get(z).push(m);
  }
  const sortedLevels = [...byLevel.keys()].sort((a,b)=>a-b);

  // ── Outside map handling ──
  // Outside maps don't get their own slab in the 3D stack. Instead they're
  // rendered as an overlay fitted inside the indoor bounding box of their
  // z_level. This means their 0–1 coordinates map to the physical extent
  // of the indoor floors, so outdoor room bounds (garden, driveway) appear
  // in the right relative position.
  const _indoorBBByLevel = new Map();
  for(const m of visMaps){
    if(_isOutsideMap(m)) continue;
    const z = m.stack?.z_level ?? 0;
    const stk=m.stack||{}, ox=stk.x_offset||0, oy_=stk.y_offset||0, sc=stk.scale||1.0;
    const sxAdj=stk.scale_x_adj||1.0, ar=(m.image?.height||600)/(m.image?.width||800);
    const arRef=stk.ref_ar||ar, rot=(stk.rotation||0)*Math.PI/180;
    const bbPt=(px,py)=>{const dx=(px-0.5)*sc*sxAdj,dy=(py-0.5)*sc*arRef,rx=dx*Math.cos(rot)-dy*Math.sin(rot),ry=dx*Math.sin(rot)+dy*Math.cos(rot);return[(0.5+ox)+rx,arRef*(0.5+oy_)+ry];};
    if(!_indoorBBByLevel.has(z)) _indoorBBByLevel.set(z,{minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity});
    const bb=_indoorBBByLevel.get(z);
    for(const [cx,cy] of [[0,0],[1,0],[1,1],[0,1]]){const[wx,wy]=bbPt(cx,cy);bb.minX=Math.min(bb.minX,wx);bb.minY=Math.min(bb.minY,wy);bb.maxX=Math.max(bb.maxX,wx);bb.maxY=Math.max(bb.maxY,wy);}
  }
  // Also compute a global indoor bounding box (union of all levels) as fallback
  let _globalIndoorBB = {minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  for(const bb of _indoorBBByLevel.values()){
    _globalIndoorBB.minX=Math.min(_globalIndoorBB.minX,bb.minX);_globalIndoorBB.minY=Math.min(_globalIndoorBB.minY,bb.minY);
    _globalIndoorBB.maxX=Math.max(_globalIndoorBB.maxX,bb.maxX);_globalIndoorBB.maxY=Math.max(_globalIndoorBB.maxY,bb.maxY);
  }
  if(!isFinite(_globalIndoorBB.minX)){_globalIndoorBB={minX:0,minY:0,maxX:1,maxY:0.75};}

  const levelColor = (z) => {
    const grp = byLevel.get(z) || [];
    if(grp.some(m => _isOutsideMap(m))) return "#6b8e23";
    return LAYER_PAL[sortedLevels.indexOf(z) % LAYER_PAL.length];
  };
  const LEGEND_H = sortedLevels.length * 30 + 24;
  const HTOTAL = BASE_H + LEGEND_H;

  let s = `<svg viewBox="0 0 ${W} ${HTOTAL}" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:${HTOTAL}px;display:block;font-family:system-ui,sans-serif">`;
  s += `<rect width="${W}" height="${HTOTAL}" fill="#071008"/>`;
  s += `<text x="12" y="20" fill="#52b788" font-size="11" font-weight="600">3D Floor Stack Preview</text>`;

  if(!maps.length){
    s += `<text x="${W/2}" y="${BASE_H/2}" text-anchor="middle" fill="#4a6052" font-size="14">No floor plans uploaded yet.</text>`;
    s += `</svg>`; return s;
  }
  if(!visMaps.length){
    s += `<text x="${W/2}" y="${BASE_H/2}" text-anchor="middle" fill="#4a6052" font-size="13">All layers hidden.</text>`;
    s += `</svg>`; return s;
  }

  const slabWZ = 10/FLOOR_GAP;

  for(const [z, group] of [...byLevel.entries()].sort((a,b)=>a[0]-b[0])){
    const isFocused = focusLevel === null || focusLevel === z;
    const groupOpacity = isFocused ? 1.0 : 0.12;
    const lyrColor = levelColor(z);

    // Merged bounding box — only from indoor maps; outside maps rendered as overlay inside
    const indoorGroup = group.filter(m => !_isOutsideMap(m));
    const outsideGroup = group.filter(m => _isOutsideMap(m));
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for(const m of indoorGroup){
      const stk=m.stack||{}, ox=stk.x_offset||0, oy_=stk.y_offset||0;
      const sc = stk.scale||1.0;
      const sxAdj = stk.scale_x_adj || 1.0;
      const ar=(m.image?.height||600)/(m.image?.width||800);
      const arRef = stk.ref_ar || ar;
      const rot=(stk.rotation||0)*Math.PI/180;
      const bbPt=(px,py)=>{
        const dx=(px-0.5)*sc*sxAdj, dy=(py-0.5)*sc*arRef;
        const rx=dx*Math.cos(rot)-dy*Math.sin(rot), ry=dx*Math.sin(rot)+dy*Math.cos(rot);
        return [(0.5+ox)+rx, arRef*(0.5+oy_)+ry];
      };
      for(const [cx,cy] of [[0,0],[1,0],[1,1],[0,1]]){
        const [wx,wy]=bbPt(cx,cy);
        minX=Math.min(minX,wx); minY=Math.min(minY,wy);
        maxX=Math.max(maxX,wx); maxY=Math.max(maxY,wy);
      }
    }
    // If level has only outside maps, use global indoor bounding box as the slab
    if(!isFinite(minX)){
      const fb = _indoorBBByLevel.get(z) || _globalIndoorBB;
      minX=fb.minX; minY=fb.minY; maxX=fb.maxX; maxY=fb.maxY;
    }
    if(!isFinite(minX)){ minX=0; minY=0; maxX=1; maxY=0.75; }

    const TL=iso(minX,minY,z), TR=iso(maxX,minY,z), BR=iso(maxX,maxY,z), BL=iso(minX,maxY,z);
    const TR_b=iso(maxX,minY,z-slabWZ), BR_b=iso(maxX,maxY,z-slabWZ), BL_b=iso(minX,maxY,z-slabWZ);

    s += `<g opacity="${groupOpacity}">`;
    // Slab side faces
    s += `<polygon points="${ptsStr([TR,BR,BR_b,TR_b])}" fill="#0d2318" fill-opacity="0.35" stroke="#253e2e" stroke-width="0.8"/>`;
    s += `<polygon points="${ptsStr([BL,BR,BR_b,BL_b])}" fill="#0a1a12" fill-opacity="0.3" stroke="#253e2e" stroke-width="0.8"/>`;
    // Slab top face — see-through with colored outline
    s += `<polygon points="${ptsStr([TL,TR,BR,BL])}" fill="#0f2017" fill-opacity="0.06" stroke="${lyrColor}" stroke-width="1.5" stroke-dasharray="10,5" opacity="0.5"/>`;

    // Room bounds + receivers for all maps in this group
    const lidx = sortedLevels.indexOf(z);
    for(const m of group){
      const stk = m.stack||{};
      const _isOut2 = _isOutsideMap(m);

      // Outside maps: auto-fit their 0-1 coordinate space into the indoor bounding box
      // so their room bounds/receivers appear inside the indoor slab footprint.
      let mapPt;
      if(_isOut2){
        mapPt = (px,py) => {
          return [minX + px * (maxX - minX), minY + py * (maxY - minY)];
        };
      } else {
        const ox=stk.x_offset||0, oy_=stk.y_offset||0, sc=stk.scale||1.0;
        const sxAdj = stk.scale_x_adj || 1.0;
        const ar=(m.image?.height||600)/(m.image?.width||800);
        const arRef = stk.ref_ar || ar;
        const rotRad = (stk.rotation||0) * Math.PI / 180;
        // Matches CSS transform: scale(sc*sxAdj, sc) with transform-origin:50% 50%
        mapPt = (px,py) => {
          const dx=(px-0.5)*sc*sxAdj, dy=(py-0.5)*sc*arRef;
          const rx=dx*Math.cos(rotRad)-dy*Math.sin(rotRad);
          const ry=dx*Math.sin(rotRad)+dy*Math.cos(rotRad);
          return [(0.5+ox)+rx, arRef*(0.5+oy_)+ry];
        };
      }

      for(const [room, b] of Object.entries(m.room_bounds||{})){
        if(!b || b.type!=="poly" || !Array.isArray(b.points) || b.points.length<3) continue;
        const color = roomColor(room);
        const polyPts = b.points.map(p=>{ const [wx,wy]=mapPt(p[0],p[1]); return pt(iso(wx,wy,z)); }).join(" ");
        s += `<polygon points="${polyPts}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5" opacity="0.9"/>`;
        const cx = b.points.reduce((a,p)=>a+p[0],0)/b.points.length;
        const cy = b.points.reduce((a,p)=>a+p[1],0)/b.points.length;
        const [lwx,lwy] = mapPt(cx,cy);
        const [lix,liy] = iso(lwx,lwy,z);
        s += `<text x="${Math.round(lix)}" y="${Math.round(liy)+lidx*2}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="8" font-weight="600" opacity="0.9">${_escSVG(room)}</text>`;
      }
      for(const r of (m.receivers||[])){
        const [wx,wy]=mapPt(r.x||0, r.y||0);
        const [px,py]=iso(wx,wy,z);
        s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="13" fill="none" stroke="#52b788" stroke-width="1.2" opacity="0.3"/>`;
        s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="7"  fill="none" stroke="#52b788" stroke-width="1.5" opacity="0.6"/>`;
        s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="4"  fill="#52b788" opacity="0.9"/>`;
      }
      // Persistent last-seen pins: red target crosshairs for away objects whose room is on this map
      if(awayObjs.length){
        const rb = m.room_bounds || {};
        for(const obj of awayObjs){
          const b = rb[obj.room];
          if(!b) continue;
          let ncx = 0.5, ncy = 0.5;
          if(b.type === "poly" && Array.isArray(b.points) && b.points.length >= 3){
            ncx = b.points.reduce((a,p)=>a+p[0],0)/b.points.length;
            ncy = b.points.reduce((a,p)=>a+p[1],0)/b.points.length;
          } else if(b.type === "circle"){
            ncx = b.cx ?? 0.5; ncy = b.cy ?? 0.5;
          }
          const [wx,wy] = mapPt(ncx, ncy);
          const [px,py] = iso(wx, wy, z);
          const r = Math.round;
          s += `<g opacity="0.92">`;
          s += `<circle cx="${r(px)}" cy="${r(py)}" r="20" fill="none" stroke="#ef4444" stroke-width="1.5"/>`;
          s += `<circle cx="${r(px)}" cy="${r(py)}" r="11" fill="none" stroke="#ef4444" stroke-width="2"/>`;
          s += `<circle cx="${r(px)}" cy="${r(py)}" r="4" fill="#ef4444"/>`;
          s += `<line x1="${r(px)-25}" y1="${r(py)}" x2="${r(px)-13}" y2="${r(py)}" stroke="#ef4444" stroke-width="1.5"/>`;
          s += `<line x1="${r(px)+13}" y1="${r(py)}" x2="${r(px)+25}" y2="${r(py)}" stroke="#ef4444" stroke-width="1.5"/>`;
          s += `<line x1="${r(px)}" y1="${r(py)-25}" x2="${r(px)}" y2="${r(py)-13}" stroke="#ef4444" stroke-width="1.5"/>`;
          s += `<line x1="${r(px)}" y1="${r(py)+13}" x2="${r(px)}" y2="${r(py)+25}" stroke="#ef4444" stroke-width="1.5"/>`;
          s += `<text x="${r(px)}" y="${r(py)+36}" text-anchor="middle" fill="#fca5a5" font-size="9" font-weight="600">${_escSVG(obj.user_label)}</text>`;
          s += `</g>`;
        }
      }
      // Master map: gold dashed outline around its own footprint + star at centre
      if(m.stack?.is_master){
        const footprint = [[0,0],[1,0],[1,1],[0,1]].map(([cx,cy])=>{ const [wx,wy]=mapPt(cx,cy); return iso(wx,wy,z); });
        s += `<polygon points="${ptsStr(footprint)}" fill="#fbbf2415" stroke="#fbbf24" stroke-width="2.5" stroke-dasharray="8,4" opacity="0.85"/>`;
        const [cwx,cwy] = mapPt(0.5, 0.5);
        const [cpx,cpy] = iso(cwx,cwy,z);
        s += `<text x="${Math.round(cpx)}" y="${Math.round(cpy)}" text-anchor="middle" dominant-baseline="middle" font-size="24" opacity="0.9">⭐</text>`;
        s += `<text x="${Math.round(cpx)}" y="${Math.round(cpy)+22}" text-anchor="middle" fill="#fbbf24" font-size="9" font-weight="600" opacity="0.8">master</text>`;
      }
    }

    // Colored index dot at bottom-left corner of slab top face
    s += `<circle cx="${Math.round(BL[0])}" cy="${Math.round(BL[1])}" r="15" fill="${lyrColor}" opacity="0.95"/>`;
    s += `<text x="${Math.round(BL[0])}" y="${Math.round(BL[1])+6}" text-anchor="middle" fill="#071008" font-size="14" font-weight="700">${lidx+1}</text>`;
    s += `</g>`;
  }

  // Legend at bottom
  const LEGEND_ROW = 30;
  s += `<line x1="10" y1="${BASE_H+4}" x2="${W-10}" y2="${BASE_H+4}" stroke="#1b3526" stroke-width="0.8"/>`;
  sortedLevels.forEach((z, i)=>{
    const ly = BASE_H + 10 + i * LEGEND_ROW;
    const color = levelColor(z);
    const groupLabel = byLevel.get(z).map(m=>(m.stack?.is_master?"⭐ ":"")+(m.name||m.id)).join(" + ");
    const ceil0 = byLevel.get(z)[0].stack?.ceiling_height_m || 2.4;
    s += `<circle cx="18" cy="${ly+11}" r="11" fill="${color}" opacity="0.9"/>`;
    s += `<text x="18" y="${ly+15}" text-anchor="middle" fill="#071008" font-size="12" font-weight="700">${i+1}</text>`;
    s += `<text x="36" y="${ly+15}" fill="${color}" font-size="18" font-weight="500">${_escSVG(groupLabel)}</text>`;
    s += `<text x="${W-10}" y="${ly+15}" text-anchor="end" fill="#94a3b8" font-size="15">${_escSVG(lvlLabel(z))} · ${ceil0}m</text>`;
  });

  // Outside overlay label
  if(visMaps.some(m => _isOutsideMap(m))){
    s += `<text x="${W-10}" y="20" text-anchor="end" fill="#6b8e23" font-size="11" font-weight="500">Outside layer fitted to indoor footprint</text>`;
  }

  s += `</svg>`;
  return s;
}

// Escape a string for safe inclusion in SVG text content.
function _escSVG(s){
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ─── Export Helpers ───────────────────────────────────────────────────────────

// Trigger a browser download of a Blob with the given filename.
function _downloadBlob(blob, filename){
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u; a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(u), 3000);
}

// Build a standalone SVG of room boundaries + receiver dots in pixel coordinates.
// Used for SVG export and as an overlay layer in the combined PNG render.
function _buildRoomBoundsSVG(map, ctx, transparent=false){
  const iw = map.image?.width || 800;
  const ih = map.image?.height || 600;
  const roomColor = ctx.helpers.roomColor;
  const rb = map.room_bounds || {};
  let s = `<svg viewBox="0 0 ${iw} ${ih}" xmlns="http://www.w3.org/2000/svg" width="${iw}" height="${ih}">`;
  if(!transparent) s += `<rect width="${iw}" height="${ih}" fill="#071008"/>`;
  for(const [room, b] of Object.entries(rb)){
    if(!b || b.type!=="poly" || !Array.isArray(b.points) || b.points.length<3) continue;
    const color = roomColor(room);
    const pts = b.points.map(p=>`${p[0]*iw},${p[1]*ih}`).join(" ");
    s += `<polygon points="${pts}" fill="${color}44" stroke="${color}" stroke-width="2"/>`;
    const cx = b.points.reduce((a,p)=>a+p[0],0)/b.points.length*iw;
    const cy = b.points.reduce((a,p)=>a+p[1],0)/b.points.length*ih;
    const fs = Math.max(12, Math.round(iw*0.024));
    s += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="${fs}" font-family="system-ui,sans-serif">${_escSVG(room)}</text>`;
  }
  for(const r of (map.receivers||[])){
    const rx=(r.x||0)*iw, ry=(r.y||0)*ih;
    const rr = Math.max(6, Math.round(iw*0.012));
    s += `<circle cx="${rx}" cy="${ry}" r="${rr}" fill="#52b788" opacity="0.9"/>`;
    if(r.label){
      const fs = Math.max(9, Math.round(iw*0.014));
      s += `<text x="${rx}" y="${ry-rr-3}" text-anchor="middle" fill="#52b788" font-size="${fs}" font-family="system-ui,sans-serif">${_escSVG(r.label)}</text>`;
    }
  }
  s += `</svg>`;
  return s;
}

// Render a combined PNG: floor plan image + room bounds overlay composited
// via an offscreen <canvas>. The SVG overlay is drawn at 80% opacity.
async function _combinedMapPng(map, ctx){
  const iw = map.image?.width || 800;
  const ih = map.image?.height || 600;
  const canvas = document.createElement("canvas");
  canvas.width = iw; canvas.height = ih;
  const g = canvas.getContext("2d");
  const _lv = (map.updated||map.image?.sha256||'').replace(/[^a-zA-Z0-9]/g,'').slice(0,16);
  const pngUrl = map.image?.filename ? `/local/padspan_ha/maps/${map.image.filename}${_lv ? '?v='+_lv : ''}` : null;
  if(pngUrl){
    try{ const img = await _loadImage(pngUrl); g.drawImage(img,0,0,iw,ih); }
    catch(e){ g.fillStyle="#071008"; g.fillRect(0,0,iw,ih); }
  } else {
    g.fillStyle="#071008"; g.fillRect(0,0,iw,ih);
  }
  await _drawSvgOnCanvas(g, _buildRoomBoundsSVG(map, ctx, true), iw, ih, 0.8);
  return new Promise(resolve=>canvas.toBlob(resolve,"image/png",0.92));
}

// Render an SVG string to a PNG Blob via an offscreen canvas.
async function _svgStringToPng(svgStr, w, h){
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext("2d");
  g.fillStyle="#071008"; g.fillRect(0,0,w,h);
  await _drawSvgOnCanvas(g, svgStr, w, h, 1.0);
  return new Promise(resolve=>canvas.toBlob(resolve,"image/png",0.95));
}

// Draw an SVG string onto an existing canvas context at the given alpha.
// Creates a temporary Blob URL, loads it as an Image, then drawImage().
async function _drawSvgOnCanvas(g, svgStr, w, h, alpha=1.0){
  const blob = new Blob([svgStr],{type:"image/svg+xml;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  try{
    const img = await _loadImage(url);
    const prev = g.globalAlpha;
    g.globalAlpha = alpha;
    g.drawImage(img,0,0,w,h);
    g.globalAlpha = prev;
  }finally{
    URL.revokeObjectURL(url);
  }
}

// ── Lights Tab ───────────────────────────────────────────────────────────────
// Shows a hex-grid light control overlay on the floor plan image. Each light
// entity gets a hexagonal button positioned at its room's centroid. Tapping
// toggles on/off. Yellow = on, grey = off. Lights are discovered from HA's
// entity registry and grouped by area_name.

// Deterministic 3-char code for each light: A01–A99, B01–B99, etc.
function _lightCode(idx) {
  const letter = String.fromCharCode(65 + Math.floor(idx / 99));
  const num    = String((idx % 99) + 1).padStart(2, "0");
  return letter + num;
}

// SVG points string for a pointy-top regular hexagon. Each vertex is at
// 60° intervals starting from 90° (top vertex).
function _hexPts(cx, cy, r) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = (90 + k * 60) * Math.PI / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

// Compute hex offsets for N lights clustered around a room centre.
// Uses a honeycomb ring layout: 1 centre + up to 6 surrounding hexes.
// Overflow beyond 7 falls back to a 3-wide grid.
function _hexCluster(n, r) {
  const d = r * Math.sqrt(3) + 2;
  const ring = Array.from({length: 6}, (_, i) => {
    const a = (30 + i * 60) * Math.PI / 180;
    return [d * Math.cos(a), d * Math.sin(a)];
  });
  const positions = [[0, 0], ...ring]; // centre + 6-ring = 7 max
  if (n <= 7) return positions.slice(0, n);
  // Overflow: simple 3-wide grid
  return Array.from({length: n}, (_, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    return [(col - 1) * d, row * d * 0.87];
  });
}

// Fetch the HA entity registry and build entity_id → area_name lookup for all
// light entities. Cached on ctx.state._lightsReg for 60s to avoid hammering
// the WS API on every 5s poll cycle.
async function _loadLightsReg(ctx) {
  try {
    const reg   = await ctx.hass.callWS({ type: "config/entity_registry/list" });
    const areas = ctx.state.model?.areas || [];
    const areaIdToName = {};
    for (const a of areas) areaIdToName[a.id] = a.name;
    const areaMap = {};
    for (const e of reg) {
      if (e.entity_id.startsWith("light."))
        areaMap[e.entity_id] = e.area_id ? (areaIdToName[e.area_id] || null) : null;
    }
    ctx.state._lightsReg = { ts: Date.now(), areaMap };
  } catch(err) {
    ctx.state._lightsReg = { ts: Date.now(), areaMap: {} };
  }
}

function _lightsTab(ctx, maps, active) {
  const { el } = ctx.helpers;
  const card = el("div", { class: "card" });

  card.appendChild(el("div", { class: "card-head", style: "margin-bottom:12px" }, [
    el("div", { style: "font-weight:700;font-size:15px" }, "Light Control Map"),
    el("span", { class: "muted", style: "font-size:12px" },
      "Tap a hex or row to toggle. Yellow\u00a0=\u00a0on \u00b7 Grey\u00a0=\u00a0off."),
  ]));

  // Registry cache check
  const regCache = ctx.state._lightsReg;
  if (!regCache || Date.now() - regCache.ts > 60000) {
    card.appendChild(el("div", {
      style: "padding:16px;color:#52b788;font-family:monospace;font-size:13px",
    }, "Loading light registry\u2026"));
    if (ctx.hass) _loadLightsReg(ctx).then(() => ctx.actions.renderRooms());
    return card;
  }

  // Gather all light entities from live hass states
  const states = ctx.hass?.states || {};
  const lights = Object.keys(states)
    .filter(eid => eid.startsWith("light."))
    .map(eid => ({
      entity_id:     eid,
      friendly_name: states[eid].attributes?.friendly_name || eid,
      state:         states[eid].state,   // "on" | "off" | "unavailable"
      area_name:     regCache.areaMap[eid] || null,
    }))
    .sort((a, b) =>
      (a.area_name || "\xff").localeCompare(b.area_name || "\xff") ||
      a.friendly_name.localeCompare(b.friendly_name));

  if (!lights.length) {
    card.appendChild(el("div", { class: "muted", style: "padding:8px" },
      "No light entities found in Home Assistant."));
    return card;
  }

  // Assign deterministic 3-char codes (sort order is stable)
  lights.forEach((l, i) => { l.code = _lightCode(i); });

  // Floor-plan selector when multiple maps are loaded
  if (maps.length > 1) {
    card.appendChild(el("div", {
      style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px",
    }, [
      el("span", { class: "muted", style: "font-size:12px" }, "Floor plan:"),
      ...maps.map(m => el("button", {
        class: "btn inline" + (m.id === (active?.id) ? " primary" : ""),
        onclick: () => ctx.actions.mapsSetActive(m.id),
      }, m.name || m.id)),
    ]));
  }

  // Toggle: turn_on (no params) restores last brightness on dimmers
  const toggle = async (eid) => {
    if (!ctx.hass) return;
    const on = ctx.hass.states[eid]?.state === "on";
    try {
      await ctx.hass.callService("light", on ? "turn_off" : "turn_on", { entity_id: eid });
      setTimeout(() => ctx.actions.renderRooms(), 600);
    } catch(err) {
      ctx.toast("Could not toggle " + eid, true);
    }
  };

  // Group positioned lights by room
  const byRoom = {};
  for (const l of lights) {
    if (l.area_name) (byRoom[l.area_name] = byRoom[l.area_name] || []).push(l);
  }
  const unassigned = lights.filter(l => !l.area_name);

  // ── Floor-plan image with hex overlay ────────────────────────────────────
  if (active?.image_url) {
    const VW = 1000, VH = 1000, HEX_R = 30;
    const rb = active.room_bounds || {};

    // Room centres from room_bounds (normalised 0-1 → SVG 0-1000)
    const roomCentre = {};
    for (const [room, b] of Object.entries(rb)) {
      if (!b) continue;
      if (b.type === "circle") {
        roomCentre[room] = { x: (b.cx ?? 0.5) * VW, y: (b.cy ?? 0.5) * VH };
      } else if (b.type === "poly" && b.points?.length >= 3) {
        const pts = b.points;
        roomCentre[room] = {
          x: (pts.reduce((s, p) => s + p[0], 0) / pts.length) * VW,
          y: (pts.reduce((s, p) => s + p[1], 0) / pts.length) * VH,
        };
      }
    }

    // SVG: hexagons only — no room labels, no scanner dots
    let svgInner = "";
    for (const [room, roomLights] of Object.entries(byRoom)) {
      const ctr = roomCentre[room];
      if (!ctr) continue;
      const offsets = _hexCluster(roomLights.length, HEX_R);
      roomLights.forEach((l, idx) => {
        const [dx, dy] = offsets[idx];
        const hx = (ctr.x + dx).toFixed(1);
        const hy = (ctr.y + dy).toFixed(1);
        const on     = l.state === "on";
        const fill   = on ? "#fbbf24" : "#374151";
        const stroke = on ? "#f59e0b" : "#4b5563";
        const tCol   = on ? "#111827" : "#fbbf24";
        svgInner +=
          `<g class="lhex" data-eid="${_escSVG(l.entity_id)}" style="cursor:pointer">` +
          `<polygon points="${_hexPts(+hx, +hy, HEX_R)}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>` +
          `<text x="${hx}" y="${hy}" text-anchor="middle" dominant-baseline="middle" ` +
          `font-family="monospace" font-size="13" font-weight="700" fill="${tCol}" pointer-events="none">${_escSVG(l.code)}</text>` +
          `</g>`;
      });
    }

    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative;width:100%;margin-bottom:16px";

    const imgEl = document.createElement("img");
    imgEl.src   = active.image_url;
    imgEl.style.cssText = "width:100%;display:block;border-radius:6px";
    imgEl.alt   = "Floor plan";
    wrap.appendChild(imgEl);

    const svgWrap = document.createElement("div");
    svgWrap.style.cssText = "position:absolute;inset:0;pointer-events:none";
    svgWrap.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" ` +
      `width="100%" height="100%" style="position:absolute;inset:0">${svgInner}</svg>`;
    wrap.appendChild(svgWrap);

    // Wire click / hover after first paint
    requestAnimationFrame(() => {
      const svg = svgWrap.querySelector("svg");
      if (!svg) return;
      svg.style.pointerEvents = "all";
      svg.querySelectorAll(".lhex").forEach(g => {
        g.addEventListener("click", e => { e.stopPropagation(); toggle(g.dataset.eid); });
        g.addEventListener("mouseover", () => { g.style.opacity = "0.75"; });
        g.addEventListener("mouseout",  () => { g.style.opacity = "1"; });
      });
    });

    card.appendChild(wrap);

    if (unassigned.length) {
      card.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
        `${unassigned.length} light(s) not assigned to a room \u2014 shown in index only.`));
    }
  } else {
    card.appendChild(el("div", { class: "muted", style: "padding:8px;margin-bottom:12px" },
      "No floor plan loaded (or no room boundaries drawn). " +
      "Upload a map and draw room bounds in the Edit tab to position lights on the map."));
  }

  // ── Light index table ─────────────────────────────────────────────────────
  card.appendChild(el("div", {
    style: "font-weight:700;font-size:13px;color:#e2e8f0;margin-bottom:6px",
  }, `Light Index (${lights.length})`));

  const tbl = el("table", { class: "table", style: "width:100%" });
  tbl.appendChild(el("thead", {}, el("tr", {}, [
    el("th", {}, "Code"),
    el("th", {}, "Light"),
    el("th", {}, "Room"),
    el("th", {}, "State"),
  ])));
  const tbody = el("tbody");
  for (const l of lights) {
    const on = l.state === "on";
    tbody.appendChild(el("tr", { style: "cursor:pointer", onclick: () => toggle(l.entity_id) }, [
      el("td", { style: "font-family:monospace;font-weight:700;color:#52b788;font-size:12px" }, l.code),
      el("td", {}, l.friendly_name),
      el("td", { class: "muted" }, l.area_name || "\u2014"),
      el("td", {}, el("span", {
        style: `display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;` +
               `background:${on ? "#fbbf24" : "#374151"};color:${on ? "#111827" : "#fbbf24"}`,
      }, on ? "ON" : "OFF")),
    ]));
  }
  tbl.appendChild(tbody);
  card.appendChild(tbl);

  return card;
}
