// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
export function render(ctx){
  const { el, esc, roomColor, helpBtn } = ctx.helpers;
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

  // Advanced mode: tabbed — Appearance | Scanner Map
  if(!ctx.state._settingsTab) ctx.state._settingsTab = "appearance";
  const activeTab = ctx.state._settingsTab;
  const setTab = (t) => { ctx.state._settingsTab = t; ctx.actions.renderRooms(); };

  const tabBar = el("div",{class:"tabs", style:"margin-bottom:14px;flex-wrap:wrap;gap:4px"});
  for(const [id, label] of [["appearance","Appearance"],["scannermap","Scanner Map"],["presence","Presence"],["manage","Manage"]]){
    tabBar.appendChild(el("button",{
      class:"tab" + (activeTab===id ? " active" : ""),
      onclick:()=>setTab(id),
    }, label));
  }
  root.appendChild(tabBar);

  if(activeTab === "appearance"){
    root.appendChild(_settingsAppearance(ctx, el, helpBtn, draft, haFloors, haAreas, roomColor, false));
  } else if(activeTab === "presence"){
    root.appendChild(_settingsPresence(ctx, el));
  } else if(activeTab === "manage"){
    root.appendChild(_settingsManage(ctx, el, haAreas, haFloors));
  } else {
    root.appendChild(_scannerMap(ctx, el, haFloors));
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

// ── Scanner Map tab ───────────────────────────────────────────────────────────
// Uses calibration fingerprint data to estimate where each BLE scanner physically
// sits on the floor plans, then renders those guessed positions on each map.
function _scannerMap(ctx, el, haFloors){
  const esc = ctx.helpers.esc;
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const maps  = (ctx.state.maps && ctx.state.maps.list) || [];

  // Load calibration data if not yet loaded
  if(!ctx.state.calibration){
    ctx.actions.calibrationGet()
      .then(d => { ctx.state.calibration = d; ctx.actions.renderRooms(); })
      .catch(() => { ctx.state.calibration = { points:[], model:{} }; ctx.actions.renderRooms(); });
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted",style:"font-size:11px"},"Loading calibration data…"),
    ]));
    return wrap;
  }

  const calData = ctx.state.calibration;
  const radios  = snap?.ble?.radios || [];

  // Intro card
  wrap.appendChild(el("div",{class:"card",style:"border-color:#52b788;padding:10px"},[
    el("div",{style:"font-weight:700;font-size:13px;margin-bottom:4px;color:#52b788"},"Scanner Position Estimates"),
    el("div",{style:"font-size:11px;color:#78909c;line-height:1.5"},
      "Signal-weighted centroid from calibration fingerprints. Every scanner that heard any point on a map is listed. Confidence rises with more points."),
  ]));

  if(!calData.points || calData.points.length === 0){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{style:"font-weight:700;font-size:13px;color:#f59e0b;margin-bottom:4px"},"⚠ No calibration data"),
      el("div",{class:"muted",style:"font-size:11px"},"Collect calibration fingerprints in the PadSpan™ Calib panel first."),
    ]));
    return wrap;
  }

  // Build per-map scanner estimates — ALL scanners heard on each map
  const byMap = _estimatePositionsPerMap(calData, radios);
  const allEstimatedSources = new Set(Object.values(byMap).flatMap(arr => arr.map(r => r.source)));

  // Radios active in snapshot but absent from all calibration data
  const unplacedRadios = radios.filter(r => r.source && !allEstimatedSources.has(r.source));

  const mapIds = Object.keys(byMap);
  if(!mapIds.length){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted",style:"font-size:11px"},"Could not estimate positions from the available calibration data."),
    ]));
  }

  // Colour palette — up to 16 distinct scanners per map
  const PALETTE = [
    "#52b788","#60a5fa","#f59e0b","#a78bfa","#fb7185","#34d399",
    "#f472b6","#38bdf8","#fbbf24","#818cf8","#4ade80","#f87171",
    "#22d3ee","#e879f9","#a3e635","#fb923c",
  ];

  for(const mapId of mapIds){
    const mapData  = maps.find(m => m.id === mapId);
    const mapRadios = byMap[mapId];  // sorted by pointCount desc

    const mapCard = el("div",{class:"card",style:"padding:10px"});

    // Card header
    const floorName = _floorNameForMap(mapData, haFloors);
    mapCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:6px;margin-bottom:8px"},[
      el("div",{style:"font-weight:700;font-size:13px"}, mapData?.name || mapId),
      floorName ? el("span",{class:"badge",style:"font-size:9px"},floorName) : null,
      el("span",{class:"badge",style:"margin-left:auto;font-size:9px"},
        `${mapRadios.length} scanner${mapRadios.length!==1?"s":""}`),
    ].filter(Boolean)));

    // SVG map with markers
    if(mapData?.image?.filename){
      const ar  = (mapData.image.height || 600) / (mapData.image.width || 800);
      const vbH = ar * 100;
      const imgUrl = `/local/padspan_ha/maps/${mapData.image.filename}`;

      let markersSvg = "";
      mapRadios.forEach((r, i) => {
        const cx  = (r.x_frac * 100).toFixed(2);
        const cy  = (r.y_frac * vbH).toFixed(2);
        const col = PALETTE[i % PALETTE.length];
        const conf = r.confidence;
        const outerR = (2.5 + conf * 4).toFixed(1);   // 2.5–6.5 SVG units

        // Confidence ring
        const ringOp = (0.15 + conf * 0.45).toFixed(2);
        markersSvg += `<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="${col}" fill-opacity="0.12" stroke="${col}" stroke-width="0.7" stroke-dasharray="1.5 1" opacity="${ringOp}"/>`;
        // Centre dot
        markersSvg += `<circle cx="${cx}" cy="${cy}" r="1.4" fill="${col}" stroke="white" stroke-width="0.5" opacity="0.95"/>`;
        // Number label on dot
        markersSvg += `<text x="${cx}" y="${(parseFloat(cy)+0.5).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="1.8" fill="white" font-weight="bold">${i+1}</text>`;
        // Room name above ring
        const labelY = (r.y_frac * vbH - parseFloat(outerR) - 0.8).toFixed(1);
        const shortName = r.name.length > 12 ? r.name.slice(0,10)+"…" : r.name;
        markersSvg += `<text x="${cx}" y="${labelY}" text-anchor="middle" font-size="2.4" fill="${col}" font-weight="bold" paint-order="stroke" stroke="#071008" stroke-width="0.7">${esc(shortName)}</text>`;
      });

      const mapDiv = el("div",{style:"border-radius:6px;overflow:hidden;border:1px solid #1b3526;margin-bottom:8px"});
      mapDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${vbH}"
        preserveAspectRatio="none" style="width:100%;display:block">
        <image href="${imgUrl}" x="0" y="0" width="100" height="${vbH}" preserveAspectRatio="none"/>
        ${markersSvg}
      </svg>`;
      mapCard.appendChild(mapDiv);
    }

    // Compact legend — one row per scanner
    const legendDiv = el("div",{style:"display:flex;flex-direction:column;gap:2px"});
    mapRadios.forEach((r, i) => {
      const col = PALETTE[i % PALETTE.length];
      const confPct = Math.round(r.confidence * 100);
      const confColor = confPct >= 80 ? "#52b788" : confPct >= 40 ? "#f59e0b" : "#dc2626";
      legendDiv.appendChild(el("div",{
        style:"display:grid;grid-template-columns:16px 1fr auto auto;gap:5px;align-items:center;padding:3px 6px;background:#0a150e;border-radius:5px"
      },[
        // Number badge
        el("div",{style:`width:14px;height:14px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#071008;flex-shrink:0`}, i+1),
        // Name
        el("div",{style:"font-size:10px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e2e8f0"}, r.name),
        // Source tail
        el("div",{style:"font-size:9px;color:#4a6670;font-family:monospace;white-space:nowrap"}, r.source.slice(-8)),
        // Confidence + point count
        el("div",{style:`font-size:9px;color:${confColor};white-space:nowrap;text-align:right`},
          `${confPct}% · ${r.pointCount}pt`),
      ]));
    });
    mapCard.appendChild(legendDiv);
    wrap.appendChild(mapCard);
  }

  // Unplaced radios — active but no calibration data anywhere
  if(unplacedRadios.length){
    const unplacedCard = el("div",{class:"card",style:"border-color:#f59e0b;padding:10px"});
    unplacedCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:6px;margin-bottom:6px"},[
      el("div",{style:"font-weight:700;font-size:12px;color:#f59e0b"},"⚠ Not yet in calibration data"),
      el("span",{class:"badge warn",style:"font-size:9px;margin-left:auto"},unplacedRadios.length),
    ]));
    for(const r of unplacedRadios){
      const name = r.area_name || r.area || r.name || r.source || "?";
      unplacedCard.appendChild(el("div",{
        style:"display:grid;grid-template-columns:1fr auto auto;gap:5px;align-items:center;padding:3px 6px;background:#0a150e;border-radius:5px;margin-bottom:2px"
      },[
        el("div",{style:"font-size:10px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, name),
        el("div",{style:"font-size:9px;color:#4a6670;font-family:monospace;white-space:nowrap"}, r.source.slice(-8)),
        r.scanning ? el("span",{class:"badge",style:"font-size:9px"},"scanning") : el("span",{class:"badge warn",style:"font-size:9px"},"idle"),
      ]));
    }
    wrap.appendChild(unplacedCard);
  }

  // ── Replace Scanner card ─────────────────────────────────────────────────
  // Collects all source IDs ever seen in calibration data + live radios
  const calSources = new Set();
  for(const pt of calData.points || []){
    for(const sr of pt.scanner_readings || []){ if(sr.source) calSources.add(sr.source); }
  }
  for(const r of radios){ if(r.source) calSources.add(r.source); }

  if(calSources.size >= 2){
    const swapCard = el("div",{class:"card",style:"padding:10px"});
    swapCard.appendChild(el("div",{style:"font-weight:700;font-size:12px;margin-bottom:4px"},"Replace Scanner"));
    swapCard.appendChild(el("div",{style:"font-size:10px;color:#78909c;margin-bottom:8px;line-height:1.5"},
      "Reassign all calibration data from one scanner to another — useful when a physical device is swapped out."));

    // Helper: build an option element
    const mkOpt = (val, label) => {
      const o = document.createElement("option"); o.value=val; o.textContent=label; return o;
    };
    // Name lookup helper
    const radioName = (src) => {
      const r = radios.find(r=>r.source===src);
      return r ? (r.area_name||r.area||r.name||src) : src;
    };
    const sortedSources = [...calSources].sort((a,b)=>radioName(a).localeCompare(radioName(b)));

    const rowEl = el("div",{style:"display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;margin-bottom:8px"});

    const oldSel = document.createElement("select");
    oldSel.style.cssText = "font-size:11px;width:100%";
    oldSel.appendChild(mkOpt("","— old radio —"));
    for(const src of sortedSources) oldSel.appendChild(mkOpt(src, radioName(src)));

    const arrowEl = el("div",{style:"font-size:14px;color:#78909c;text-align:center"},"→");

    const newSel = document.createElement("select");
    newSel.style.cssText = "font-size:11px;width:100%";
    newSel.appendChild(mkOpt("","— new radio —"));
    for(const src of sortedSources) newSel.appendChild(mkOpt(src, radioName(src)));

    rowEl.appendChild(oldSel);
    rowEl.appendChild(arrowEl);
    rowEl.appendChild(newSel);
    swapCard.appendChild(rowEl);

    // Summary line (updates when selects change)
    const summaryEl = el("div",{style:"font-size:10px;color:#78909c;margin-bottom:8px;min-height:14px"});
    const updateSummary = () => {
      if(!oldSel.value || !newSel.value || oldSel.value === newSel.value){
        summaryEl.textContent = "";
        return;
      }
      const pts = (calData.points||[]).filter(pt =>
        (pt.scanner_readings||[]).some(sr=>sr.source===oldSel.value)
      ).length;
      summaryEl.textContent = `Will update ${pts} calibration point${pts!==1?"s":""}. This cannot be undone.`;
      summaryEl.style.color = pts > 0 ? "#f59e0b" : "#78909c";
    };
    oldSel.addEventListener("change", updateSummary);
    newSel.addEventListener("change", updateSummary);
    swapCard.appendChild(summaryEl);

    // Swap button
    const swapBtnWrap = el("div");
    const makeSwapBtn = () => {
      const btn = el("button",{class:"btn inline",style:"font-size:11px;width:100%"},"Swap Readings");
      btn.addEventListener("click", async () => {
        const old_source = oldSel.value;
        const new_source = newSel.value;
        if(!old_source || !new_source){ ctx.toast("Select both radios first.", true); return; }
        if(old_source === new_source){ ctx.toast("Old and new radio must be different.", true); return; }
        btn.disabled = true; btn.textContent = "Swapping…";
        try {
          const res = await ctx.actions.calibrationSwapRadio(old_source, new_source);
          ctx.state.calibration = null;  // force reload
          ctx.toast(`Swapped ${res.updated_readings} reading${res.updated_readings!==1?"s":""} from ${radioName(old_source)} → ${radioName(new_source)}.`);
          ctx.actions.renderRooms();
        } catch(e){
          ctx.toast("Swap failed: " + String(e), true);
          swapBtnWrap.innerHTML = "";
          swapBtnWrap.appendChild(makeSwapBtn());
        }
      });
      return btn;
    };
    swapBtnWrap.appendChild(makeSwapBtn());
    swapCard.appendChild(swapBtnWrap);
    wrap.appendChild(swapCard);
  }

  // Reload button
  wrap.appendChild(el("div",{style:"text-align:center"},[
    el("button",{class:"btn inline",style:"font-size:11px",
      onclick:()=>{ ctx.state.calibration=null; ctx.actions.renderRooms(); }},
      "Reload calibration data"),
  ]));

  return wrap;
}

// Build per-map scanner estimates — every scanner that heard any calibration point
// on a given map gets an estimated position on that map.
// Returns { mapId: [ {source, name, x_frac, y_frac, pointCount, meanRssi, confidence} ] }
function _estimatePositionsPerMap(calData, radios){
  // acc[mapId][source] = [{x_frac, y_frac, mean_rssi}]
  const acc = {};
  for(const pt of calData.points || []){
    for(const sr of pt.scanner_readings || []){
      if(!sr.source || !sr.rssi_samples?.length) continue;
      const meanRssi = sr.rssi_samples.reduce((a,b)=>a+b,0) / sr.rssi_samples.length;
      if(!acc[pt.map_id]) acc[pt.map_id] = {};
      if(!acc[pt.map_id][sr.source]) acc[pt.map_id][sr.source] = [];
      acc[pt.map_id][sr.source].push({ x_frac:pt.x_frac, y_frac:pt.y_frac, mean_rssi:meanRssi });
    }
  }

  const result = {};
  for(const [mapId, bySource] of Object.entries(acc)){
    result[mapId] = [];
    for(const [source, pts] of Object.entries(bySource)){
      const weights = pts.map(p => Math.pow(10, p.mean_rssi / 10));
      const totalW  = weights.reduce((a,b)=>a+b, 0);
      const x = pts.reduce((s,p,i) => s + p.x_frac * weights[i], 0) / totalW;
      const y = pts.reduce((s,p,i) => s + p.y_frac * weights[i], 0) / totalW;
      const meanRssi  = Math.round(pts.reduce((s,p)=>s+p.mean_rssi,0) / pts.length);
      const confidence = Math.min(1, pts.length / 6);
      // Resolve display name from live snapshot radios
      const radio = radios.find(r => r.source === source);
      const name  = radio?.area_name || radio?.area || radio?.name || source;
      result[mapId].push({ source, name, x_frac:x, y_frac:y, pointCount:pts.length, meanRssi, confidence });
    }
    // Sort: most calibration points first
    result[mapId].sort((a,b) => b.pointCount - a.pointCount);
  }
  return result;
}

function _floorNameForMap(mapData, haFloors){
  if(!mapData) return null;
  const fid = mapData.floor_id;
  if(!fid) return null;
  const f = haFloors.find(f=>f.id===fid);
  return f ? (f.name || f.id) : fid;
}

// ── Manage tab ────────────────────────────────────────────────────────────────
function _settingsManage(ctx, el, haAreas, haFloors){
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;

  // ── Section 1: BLE Tags ──────────────────────────────────────────────────
  // Load tags from persistent ObjectStore (not just live snapshot)
  const tagsCard = el("div",{class:"card"});
  tagsCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px"},[
    el("div",{style:"font-weight:700"},"BLE Tags"),
  ]));
  tagsCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
    "Tagged devices can be followed and appear by label across the panel. Untagging removes the label permanently."
  ));

  // Async-load stored labels from backend, then populate table
  const tagsLoading = el("div",{class:"muted",style:"font-size:12px"},"Loading tags…");
  tagsCard.appendChild(tagsLoading);
  (async ()=>{
    let storedLabels = {};
    try {
      const res = await ctx.actions.objectLabelList();
      storedLabels = (res && res.labels) || {};
    } catch(e){ /* fallback to empty */ }

    // Build list of tagged entries: merge store data with live snapshot info
    const liveObjects = (snap?.objects?.list || []);
    const liveByAddr = {};
    for(const o of liveObjects){
      const addr = (o.address || o.canonical_id || o.key || "").toUpperCase();
      if(addr) liveByAddr[addr] = o;
    }

    const taggedList = [];
    for(const [mac, entry] of Object.entries(storedLabels)){
      const live = liveByAddr[mac.toUpperCase()] || null;
      taggedList.push({
        address: mac,
        label: entry.label || mac,
        tagged_at: entry.tagged_at || null,
        kind: live ? live.kind : null,
        age_s: live ? live.age_s : null,
        room: live ? live.room : null,
        live: live,
      });
    }
    taggedList.sort((a,b) => a.label.localeCompare(b.label));

    // Remove loading indicator
    tagsLoading.remove();

    // Badge count
    const countBadge = el("span",{class:"badge",style:"font-size:10px"}, String(taggedList.length));
    tagsCard.querySelector("div").appendChild(countBadge);

    if(!taggedList.length){
      tagsCard.appendChild(el("div",{class:"muted",style:"font-size:12px"},
        "No BLE devices have been tagged yet. Use the Objects tab to tag a device."));
      return;
    }

    const table = el("table",{style:"width:100%;border-collapse:collapse;font-size:12px"});
    const thead = el("thead",{});
    thead.innerHTML = `<tr>
      <th style="text-align:left;padding:6px 8px;color:#6b9e7e;font-size:11px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3a28">Label</th>
      <th style="text-align:left;padding:6px 8px;color:#6b9e7e;font-size:11px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3a28">Address</th>
      <th style="text-align:left;padding:6px 8px;color:#6b9e7e;font-size:11px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3a28">Status</th>
      <th style="text-align:left;padding:6px 8px;color:#6b9e7e;font-size:11px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3a28">Room</th>
      <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #1e3a28"></th>
    </tr>`;
    table.appendChild(thead);
    const tbody = el("tbody",{});
    for(const t of taggedList){
      const isOnline = t.age_s != null && t.age_s < 120;
      const statusDot = isOnline ? "●" : "○";
      const statusColor = isOnline ? "#52b788" : "#64748b";
      const statusText = t.age_s != null
        ? (t.age_s < 60 ? Math.round(t.age_s)+"s ago" : Math.floor(t.age_s/60)+"m ago")
        : "offline";
      const roomStr = t.room || "—";
      const isFollowed = ctx.actions.followedHas(t.address);

      const tr = el("tr",{style:"border-bottom:1px solid #131f17"});

      // Label + follow indicator
      const labelCell = el("td",{style:"padding:8px;font-weight:600"});
      if(isFollowed) labelCell.appendChild(el("span",{style:"color:#fbbf24;margin-right:4px"},"◉"));
      labelCell.appendChild(document.createTextNode(t.label));
      tr.appendChild(labelCell);

      // Address
      tr.appendChild(el("td",{style:"padding:8px;font-family:monospace;font-size:11px;color:#6b9e7e"}, t.address));

      // Status
      tr.appendChild(el("td",{style:"padding:8px;font-size:11px"},[
        el("span",{style:`color:${statusColor};margin-right:4px`}, statusDot),
        el("span",{style:`color:${statusColor}`}, statusText),
      ]));

      // Room
      tr.appendChild(el("td",{style:"padding:8px;font-size:11px;color:#94a3b8"}, roomStr));

      // Actions: Follow + Untag
      const actionsTd = el("td",{style:"padding:8px;text-align:right;white-space:nowrap"});

      const followBtn = el("button",{class:"btn inline",style:"font-size:11px;margin-right:6px;color:" + (isFollowed ? "#fbbf24" : "#5eead4") + ";border-color:" + (isFollowed ? "#92400e" : "#134e4a")},
        isFollowed ? "Unfollow" : "Follow");
      followBtn.addEventListener("click", ()=>{
        ctx.actions.followedToggle(t.address);
      });
      actionsTd.appendChild(followBtn);

      const untagBtn = el("button",{class:"btn",style:"font-size:11px;color:#f87171;border-color:#7f1d1d"}, "Untag");
      untagBtn.addEventListener("click", async ()=>{
        if(!confirm(`Remove tag "${t.label}"?`)) return;
        untagBtn.disabled = true; untagBtn.textContent = "Removing…";
        try {
          await ctx.actions.objectLabelDelete(t.address);
          await ctx.actions.refreshSnapshot();
          ctx.actions.renderRooms();
          ctx.toast(`Removed tag "${t.label}"`);
        } catch(e){
          ctx.toast("Failed to remove tag", true);
          untagBtn.disabled = false; untagBtn.textContent = "Untag";
        }
      });
      actionsTd.appendChild(untagBtn);

      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tagsCard.appendChild(table);
  })();
  wrap.appendChild(tagsCard);

  // ── Section 2: HA Areas ──────────────────────────────────────────────────
  const areasCard = el("div",{class:"card"});
  areasCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px"},[
    el("div",{style:"font-weight:700"},"Rooms (HA Areas)"),
    el("span",{class:"badge",style:"font-size:10px"}, String(haAreas.length)),
    el("span",{class:"badge warn",style:"font-size:10px;margin-left:auto"},"⚠ Deletes from HA"),
  ]));
  areasCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
    "Deleting an area removes it from Home Assistant entirely. Scanners assigned to it become unassigned."
  ));

  if(!haAreas.length){
    areasCard.appendChild(el("div",{class:"muted",style:"font-size:12px"},"No areas found in HA."));
  } else {
    const table = el("table",{style:"width:100%;border-collapse:collapse;font-size:12px"});
    const thead = el("thead",{});
    thead.innerHTML = `<tr>
      <th style="text-align:left;padding:6px 8px;color:#6b9e7e;font-size:11px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3a28">Room</th>
      <th style="text-align:left;padding:6px 8px;color:#6b9e7e;font-size:11px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3a28">Floor</th>
      <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #1e3a28"></th>
    </tr>`;
    table.appendChild(thead);
    const tbody = el("tbody",{});
    const sorted = [...haAreas].sort((a,b)=>(a.name||"").localeCompare(b.name||""));
    for(const area of sorted){
      const haFloor  = haFloors.find(f=>f.id===area.floor_id);
      const floorLabel = haFloor ? (haFloor.name||haFloor.id) : (area.floor_id || "—");
      const tr = el("tr",{style:"border-bottom:1px solid #131f17"});
      tr.appendChild(el("td",{style:"padding:8px;font-weight:600"}, area.name||area.id));
      tr.appendChild(el("td",{style:"padding:8px;color:#6b9e7e;font-size:12px"}, floorLabel));
      const delTd = el("td",{style:"padding:8px;text-align:right"});
      const delBtn = el("button",{class:"btn",style:"font-size:11px;color:#f87171;border-color:#7f1d1d"},"Delete");
      delBtn.addEventListener("click", async ()=>{
        const areaName = area.name || area.id;
        if(!confirm(`Delete area "${areaName}"? This removes it from Home Assistant and cannot be undone.`)) return;
        delBtn.disabled = true; delBtn.textContent = "Deleting…";
        try {
          await ctx.actions.areaDelete(area.id);
          await ctx.actions.modelUpdate({floors:[], room_meta:{}});
          ctx.actions.renderRooms();
          ctx.toast(`Deleted area "${areaName}"`);
        } catch(e){
          ctx.toast("Failed to delete area: "+String(e), true);
          delBtn.disabled = false; delBtn.textContent = "Delete";
        }
      });
      delTd.appendChild(delBtn);
      tr.appendChild(delTd);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    areasCard.appendChild(table);
  }
  wrap.appendChild(areasCard);
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

// ── Presence tab ────────────────────────────────────────────────────────────────
function _settingsPresence(ctx, el){
  const settings = ctx.state.settings || {};
  const inpStyle = "width:72px;text-align:center;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:13px";
  const rowStyle = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px";
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});

  // ── Room change delay ──────────────────────────────────────────────────────
  const currentDelay = (settings.room_change_delay_s != null ? Number(settings.room_change_delay_s) : 20);
  const polls = Math.max(1, Math.round(currentDelay / 10));
  const delayInp = el("input", {
    type: "number", min: "0", max: "300", step: "5", value: String(currentDelay), style: inpStyle,
  });
  const delaySaveBtn = el("button", { class: "btn" }, "Save");
  delaySaveBtn.addEventListener("click", async () => {
    const v = Math.max(0, Math.min(300, parseFloat(delayInp.value) || 0));
    try {
      await ctx.actions.settingsSet({ room_change_delay_s: v });
      ctx.toast(`Room change delay set to ${v}s`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Room Change Delay"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "How long a scanner must consistently dominate before PadSpan switches a device to a new room. " +
      "Higher values prevent flickering when a device sits on the boundary between two scanners."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Room change delay"),
      delayInp,
      el("div", { class: "muted", style: "font-size:12px" }, "seconds"),
      delaySaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      `Current: ${currentDelay}s → requires ~${polls} consecutive 10-second poll${polls !== 1 ? "s" : ""} agreement. ` +
      `Set to 0 for instant room switching.`
    ),
  ]));

  // ── Away timeout ───────────────────────────────────────────────────────────
  const currentAwayM = (settings.away_timeout_m != null ? Number(settings.away_timeout_m) : 5);
  const awayInp = el("input", {
    type: "number", min: "1", max: "1440", step: "1", value: String(currentAwayM), style: inpStyle,
  });
  const awaySaveBtn = el("button", { class: "btn" }, "Save");
  awaySaveBtn.addEventListener("click", async () => {
    const v = Math.max(1, Math.min(1440, parseFloat(awayInp.value) || 5));
    try {
      await ctx.actions.settingsSet({ away_timeout_m: v });
      ctx.toast(`Away timeout set to ${v} min`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Home/Away Timeout"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "If a device hasn't been detected for this long, it is marked as not_home in HA. " +
      "The device_tracker and area sensor both switch to not_home. " +
      "Set higher if devices drop off briefly during normal use."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Away timeout"),
      awayInp,
      el("div", { class: "muted", style: "font-size:12px" }, "minutes"),
      awaySaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      `Current: ${currentAwayM} min (${currentAwayM * 60}s). Default: 5 min. Range: 1 min – 24 h.`
    ),
  ]));

  // ── BLE Advertisement Timeout ─────────────────────────────────────────────
  const currentBleAge = (settings.ble_max_age_s != null ? Number(settings.ble_max_age_s) : 300);
  const bleAgeInp = el("input", {
    type: "number", min: "30", max: "600", step: "10", value: String(currentBleAge), style: inpStyle,
  });
  const bleAgeSaveBtn = el("button", { class: "btn" }, "Save");
  bleAgeSaveBtn.addEventListener("click", async () => {
    const v = Math.max(30, Math.min(600, parseInt(bleAgeInp.value) || 300));
    try {
      await ctx.actions.settingsSet({ ble_max_age_s: v });
      ctx.toast(`BLE timeout set to ${v}s`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "BLE Advertisement Timeout"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "How long to keep a BLE device visible after its last advertisement. " +
      "Higher values show more devices (especially slow-broadcasting ones). " +
      "Lower values keep the list cleaner but may drop intermittent devices."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Max age"),
      bleAgeInp,
      el("div", { class: "muted", style: "font-size:12px" }, "seconds"),
      bleAgeSaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      `Current: ${currentBleAge}s. Default: 300s (5 min). Range: 30s – 600s (10 min).`
    ),
  ]));

  // ── Distance Calibration ───────────────────────────────────────────────────
  const currentRefPower   = (settings.ref_power    != null ? Number(settings.ref_power)    : -59);
  const currentPathLoss   = (settings.path_loss_exp != null ? Number(settings.path_loss_exp) : 2.5);
  const refInp = el("input", {
    type: "number", min: "-100", max: "0", step: "1", value: String(currentRefPower), style: inpStyle,
  });
  const plInp = el("input", {
    type: "number", min: "1", max: "4", step: "0.1", value: String(currentPathLoss), style: inpStyle,
  });
  const distSaveBtn = el("button", { class: "btn" }, "Save");
  distSaveBtn.addEventListener("click", async () => {
    const ref = Math.max(-100, Math.min(0, parseFloat(refInp.value) || -59));
    const pl  = Math.max(1.0,  Math.min(4.0,  parseFloat(plInp.value)  || 2.5));
    try {
      await ctx.actions.settingsSet({ ref_power: ref, path_loss_exp: pl });
      ctx.toast(`Distance params saved: ref=${ref} dBm, n=${pl}`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Distance Calibration"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "Parameters for the log-distance path-loss formula used by the sensor.{device}_distance HA entity. " +
      "Distance (m) = 10 ^ ((ref_power − RSSI) / (10 × n)). " +
      "Measure ref_power by holding a phone 1 m from a scanner and reading its RSSI. " +
      "Increase n for cluttered environments (walls, furniture); lower it for open spaces."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Reference power"),
      refInp,
      el("div", { class: "muted", style: "font-size:12px" }, "dBm at 1 m (default −59)"),
    ]),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Path-loss exponent"),
      plInp,
      el("div", { class: "muted", style: "font-size:12px" }, "n  (default 2.5, range 1–4)"),
    ]),
    el("div", { style: "margin-top:8px" }, distSaveBtn),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      `Current: ref=${currentRefPower} dBm, n=${currentPathLoss}. ` +
      "Free-space ≈ n=2.0. Typical indoor ≈ n=2.5–3.5."
    ),
  ]));

  // ── Signal Filter (Kalman) ────────────────────────────────────────────────
  const currentKalmanQ = (settings.kalman_q != null ? Number(settings.kalman_q) : 0.125);
  const currentKalmanR = (settings.kalman_r != null ? Number(settings.kalman_r) : 8.0);
  const kqInp = el("input", {
    type: "number", min: "0.01", max: "1", step: "0.01", value: String(currentKalmanQ), style: inpStyle,
  });
  const krInp = el("input", {
    type: "number", min: "0.5", max: "50", step: "0.5", value: String(currentKalmanR), style: inpStyle,
  });
  const kalmanSaveBtn = el("button", { class: "btn inline" }, "Save");
  kalmanSaveBtn.addEventListener("click", async () => {
    const q = Math.max(0.01, Math.min(1.0, parseFloat(kqInp.value) || 0.125));
    const r = Math.max(0.5, Math.min(50.0, parseFloat(krInp.value) || 8.0));
    try {
      await ctx.actions.settingsSet({ kalman_q: q, kalman_r: r });
      ctx.toast(`Signal filter saved: Q=${q}, R=${r}`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Signal Filter"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "Kalman filter parameters for per-scanner RSSI smoothing. " +
      "Q (process noise) controls how quickly the filter responds to real movement — lower = more smoothing, slower response. " +
      "R (measurement noise) controls how much individual RSSI readings are trusted — higher = more smoothing. " +
      "ESPresense defaults: Q=0.125, R=8.0."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Process noise Q"),
      kqInp,
      el("div", { class: "muted", style: "font-size:12px" }, "0.01–1.0 (default 0.125)"),
    ]),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Measurement noise R"),
      krInp,
      el("div", { class: "muted", style: "font-size:12px" }, "0.5–50 (default 8.0)"),
    ]),
    el("div", { style: "margin-top:8px" }, kalmanSaveBtn),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      `Current: Q=${currentKalmanQ}, R=${currentKalmanR}. ` +
      "Increase R to suppress noise at the cost of slower room detection. " +
      "Increase Q for faster response to movement."
    ),
  ]));

  // ── Room Boundary Scoring ─────────────────────────────────────────────────
  const currentSigma = (settings.room_sigma_m != null ? Number(settings.room_sigma_m) : 4.0);
  const sigmaInp = el("input", {
    type: "number", min: "1", max: "20", step: "0.5", value: String(currentSigma), style: inpStyle,
  });
  const sigmaSaveBtn = el("button", { class: "btn inline" }, "Save");
  sigmaSaveBtn.addEventListener("click", async () => {
    const v = Math.max(1.0, Math.min(20.0, parseFloat(sigmaInp.value) || 4.0));
    try {
      await ctx.actions.settingsSet({ room_sigma_m: v });
      ctx.toast(`Room sigma set to ${v} m`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Room Boundary Scoring"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "Controls how sharply room boundaries are enforced. " +
      "Room assignment now uses a Gaussian distance model: each scanner's Kalman-filtered RSSI is " +
      "converted to an estimated distance, then scored as exp(−(d/σ)²). " +
      "The room whose scanner scores highest wins — this penalises scanners on the far side of a wall " +
      "more proportionally than simple strongest-RSSI-wins. " +
      "When calibration fingerprint data is collected (≥5 points), k-NN matching also activates " +
      "and can override the Gaussian result when confidence ≥ 30%."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Room sigma (m)"),
      sigmaInp,
      el("div", { class: "muted", style: "font-size:12px" }, "1–20 m (default 4.0)"),
    ]),
    el("div", { style: "margin-top:8px" }, sigmaSaveBtn),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      `Current: σ = ${currentSigma} m. ` +
      "Smaller (1–2 m): sharper boundaries, best for small rooms with close scanner placement. " +
      "Larger (6–12 m): softer, more tolerant of weak signals in large open spaces. " +
      "At d = σ the scanner's influence drops to ~37%; at d = 2σ it drops to ~2%."
    ),
  ]));

  // ── Scanner RSSI Offsets ───────────────────────────────────────────────────
  const savedOffsets = settings.scanner_offsets || {};
  const radios = (ctx.state.live?.snapshot?.ble?.radios) || [];
  if(radios.length){
    const offsetRows = el("div",{style:"display:flex;flex-direction:column;gap:8px;margin-top:8px"});
    for(const radio of radios){
      const src = radio.source || radio.name || "";
      if(!src) continue;
      const currentOffset = savedOffsets[src] != null ? Number(savedOffsets[src]) : 0;
      const offInp = el("input",{type:"number",min:"-20",max:"20",step:"0.5",value:String(currentOffset),style:inpStyle});
      const offSaveBtn = el("button",{class:"btn inline"},"Save");
      offSaveBtn.addEventListener("click", async()=>{
        const v = Math.max(-20, Math.min(20, parseFloat(offInp.value)||0));
        try {
          await ctx.actions.scannerOffsetSet(src, v);
          ctx.toast(`${src}: offset set to ${v>0?"+":""}${v} dB`);
        } catch(e){ ctx.toast("Failed to save offset", true); }
      });
      offsetRows.appendChild(el("div",{style:rowStyle},[
        el("div",{style:"font-size:12px;color:#a7f3d0;min-width:180px;font-family:monospace;overflow:hidden;text-overflow:ellipsis"},src),
        offInp,
        el("div",{class:"muted",style:"font-size:12px"},"dB"),
        offSaveBtn,
      ]));
    }
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"h2"},"Scanner RSSI Offsets"),
      el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
        "Trim the reported signal strength of a specific scanner by a fixed dB amount. " +
        "Normally not needed — walk-around calibration handles hardware variation automatically. " +
        "Only adjust if a scanner reads consistently high or low despite good calibration coverage."
      ),
      offsetRows,
      el("div",{class:"muted",style:"font-size:11px;margin-top:8px"},
        "Range: −20 to +20 dB. Positive = scanner reads weaker than reality (boost it). " +
        "Negative = scanner reads stronger than reality (attenuate it). Set to 0 to remove offset."
      ),
    ]));
  }

  // ── Calibration Accuracy Reminder ─────────────────────────────────────────
  const reminderEnabled = settings.health_reminder_enabled === true;
  const reminderLastTs  = settings.health_reminder_last_ts || null;

  const reminderToggle = el("input",{type:"checkbox",id:"healthReminderToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
  reminderToggle.checked = reminderEnabled;

  const reminderResultDiv = el("div",{style:"margin-top:10px"});

  const _renderHealthResults = (r)=>{
    while(reminderResultDiv.firstChild) reminderResultDiv.removeChild(reminderResultDiv.firstChild);
    if(!r){ return; }
    const rows = [];
    if(r.point_count === 0){
      rows.push(el("div",{class:"muted",style:"font-size:12px"},
        "No calibration data collected yet. Use Calibration → Pin & Listen to get started."));
    } else {
      const age = r.stale_days != null ? `${r.stale_days} day${r.stale_days!==1?"s":""}` : "unknown age";
      const ageColor = (r.stale_days||0) > 60 ? "#fbbf24" : "#52b788";
      rows.push(el("div",{style:"font-size:12px;margin-bottom:6px"},[
        el("span",{style:`color:${ageColor};font-weight:600`}, (r.stale_days||0)>60?"⚠ ":"✓ "),
        el("span",{class:"muted"},`${r.point_count} calibration point${r.point_count!==1?"s":""} · newest is ${age} old`),
      ]));
    }
    for(const a of (r.scanner_anomalies||[])){
      rows.push(el("div",{style:"font-size:12px;color:#fbbf24;margin-bottom:4px"},`⚠ ${a.message}`));
    }
    if((r.recommended_spots||[]).length){
      rows.push(el("div",{style:"font-size:12px;font-weight:600;color:#e2e8f0;margin:8px 0 4px"},
        "Suggested walk-around spots — stand for 60 s each with your beacon:"));
      for(const [i,spot] of (r.recommended_spots||[]).entries()){
        const pct = x=>Math.round(x*100);
        const scoreLabel = spot.coverage_score<0.2?"uncovered":spot.coverage_score<0.5?"sparse":"partial";
        rows.push(el("div",{style:"font-size:12px;color:#94a3b8;margin-bottom:3px"},
          `${i+1}. Map ${spot.map_id} · position (${pct(spot.x_frac)}%, ${pct(spot.y_frac)}%) · ${scoreLabel}`));
      }
      rows.push(el("div",{class:"muted",style:"font-size:11px;margin-top:6px"},
        "Open Calibration → Pin & Listen, tap these positions on the map, and collect for 60 s each."));
    }
    if(!r.has_issues && r.point_count > 0){
      rows.push(el("div",{style:"font-size:12px;color:#52b788"},"✓ Calibration data looks good — no issues detected."));
    }
    for(const row of rows) reminderResultDiv.appendChild(row);
  };

  _renderHealthResults(ctx.state._healthCheckResult || null);

  const checkNowBtn = el("button",{class:"btn",style:"margin-top:8px"},"Check Now");
  checkNowBtn.addEventListener("click", async()=>{
    checkNowBtn.disabled=true; checkNowBtn.textContent="Checking…";
    try {
      const r = await ctx.actions.calibrationHealthCheck();
      ctx.state._healthCheckResult = r;
      _renderHealthResults(r);
      await ctx.actions.settingsSet({ health_reminder_last_ts: Date.now()/1000 });
    } catch(e){ ctx.toast("Health check failed: "+String(e), true); }
    finally{ checkNowBtn.disabled=false; checkNowBtn.textContent="Check Now"; }
  });

  reminderToggle.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({ health_reminder_enabled: reminderToggle.checked });
      ctx.toast(reminderToggle.checked ? "Calibration reminders enabled" : "Calibration reminders disabled");
    } catch(e){ ctx.toast("Failed to save setting", true); }
  });

  const lastCheckedTxt = reminderLastTs
    ? `Last checked: ${new Date(reminderLastTs*1000).toLocaleDateString()}`
    : "Never checked";

  wrap.appendChild(el("div",{class:"card"},[
    el("div",{class:"h2"},"Calibration Accuracy Reminders"),
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
      reminderToggle,
      el("label",{for:"healthReminderToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer"},
        "Remind me to update calibration when needed for accuracy"),
    ]),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
      "Checks whether calibration data has gaps, stale readings, or scanner anomalies. " +
      "When issues are found, suggests a few specific spots to stand with your beacon for 60 s each. Off by default."),
    el("div",{style:"display:flex;align-items:center;gap:12px;flex-wrap:wrap"},[
      checkNowBtn,
      el("span",{class:"muted",style:"font-size:12px"}, lastCheckedTxt),
    ]),
    reminderResultDiv,
  ]));

  // ── Adaptive Learning (Experimental) ───────────────────────────────────
  const adaptiveEnabled = settings.adaptive_learning_enabled === true;
  const floorDetEnabled = settings.adaptive_floor_detection === true;

  const adaptiveToggle = el("input",{type:"checkbox",id:"adaptiveLearningToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
  adaptiveToggle.checked = adaptiveEnabled;

  const floorToggle = el("input",{type:"checkbox",id:"adaptiveFloorToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
  floorToggle.checked = floorDetEnabled;

  const adaptiveStatusDiv = el("div",{style:"margin-top:10px"});

  const _renderAdaptiveStatus = (s)=>{
    while(adaptiveStatusDiv.firstChild) adaptiveStatusDiv.removeChild(adaptiveStatusDiv.firstChild);
    if(!s || !s.total_observations){
      adaptiveStatusDiv.appendChild(el("div",{class:"muted",style:"font-size:12px"},
        adaptiveEnabled ? "Learning... waiting for high-confidence room assignments." : "Enable to start learning from device movements."));
      return;
    }
    const matPct = s.maturity_pct || 0;
    const barColor = matPct < 25 ? "#fbbf24" : matPct < 75 ? "#38bdf8" : "#52b788";
    const rows = [
      el("div",{style:"font-size:12px;margin-bottom:6px"},[
        el("span",{style:"font-weight:600;color:#e2e8f0"},"Maturity: "),
        el("span",{style:`color:${barColor};font-weight:600`}, `${matPct}%`),
        el("span",{class:"muted"}, ` — ${matPct < 25 ? "collecting baseline" : matPct < 75 ? "building model" : "model active"}`),
      ]),
      el("div",{style:"background:#1e293b;border-radius:4px;height:6px;margin-bottom:8px;overflow:hidden"},[
        el("div",{style:`width:${Math.min(100,matPct)}%;height:100%;background:${barColor};border-radius:4px;transition:width 0.3s`}),
      ]),
      el("div",{style:"display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:12px"},[
        el("span",{class:"muted"},`Observations: ${(s.total_observations||0).toLocaleString()}`),
        el("span",{class:"muted"},`Days active: ${s.days_active||0}`),
        el("span",{class:"muted"},`Rooms learned: ${s.rooms_learned||0}`),
        el("span",{class:"muted"},`Scanners: ${s.scanners_learned||0}`),
        el("span",{class:"muted"},`Transitions: ${(s.transitions_total||0).toLocaleString()}`),
        el("span",{class:"muted"},`Floor pairs: ${s.floor_pairs_learned||0}`),
      ]),
    ];
    for(const r of rows) adaptiveStatusDiv.appendChild(r);
  };

  // Load adaptive status on render
  if(adaptiveEnabled){
    (async()=>{
      try {
        const r = await ctx.actions.wsCall("padspan_ha/adaptive_status_get");
        _renderAdaptiveStatus(r?.adaptive || null);
      } catch(e){ /* best-effort */ }
    })();
  }
  _renderAdaptiveStatus(null);

  adaptiveToggle.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({ adaptive_learning_enabled: adaptiveToggle.checked });
      ctx.toast(adaptiveToggle.checked ? "Adaptive learning enabled" : "Adaptive learning disabled");
      if(!adaptiveToggle.checked){
        floorToggle.checked = false;
        floorToggle.disabled = true;
      } else {
        floorToggle.disabled = false;
      }
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast("Failed to save setting", true); }
  });

  floorToggle.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({ adaptive_floor_detection: floorToggle.checked });
      ctx.toast(floorToggle.checked ? "Floor detection enhancement enabled" : "Floor detection enhancement disabled");
    } catch(e){ ctx.toast("Failed to save setting", true); }
  });

  if(!adaptiveEnabled) floorToggle.disabled = true;

  const resetAdaptiveBtn = el("button",{class:"btn",style:"margin-top:8px;background:#991b1b;border-color:#991b1b"},"Reset Learned Data");
  resetAdaptiveBtn.addEventListener("click", async()=>{
    if(!confirm("Clear all adaptive learning data? This cannot be undone.")) return;
    resetAdaptiveBtn.disabled=true; resetAdaptiveBtn.textContent="Resetting…";
    try {
      await ctx.actions.wsCall("padspan_ha/adaptive_reset");
      ctx.toast("Adaptive learning data cleared");
      _renderAdaptiveStatus(null);
    } catch(e){ ctx.toast("Reset failed: "+String(e), true); }
    finally{ resetAdaptiveBtn.disabled=false; resetAdaptiveBtn.textContent="Reset Learned Data"; }
  });

  wrap.appendChild(el("div",{class:"card"},[
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
      el("div",{class:"h2",style:"margin:0"},"Adaptive Learning"),
      el("span",{style:"font-size:10px;font-weight:600;color:#fbbf24;background:#422006;padding:2px 6px;border-radius:4px"},"EXPERIMENTAL"),
    ]),
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
      adaptiveToggle,
      el("label",{for:"adaptiveLearningToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer"},
        "Enable adaptive learning"),
    ]),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
      "When enabled, PadSpan passively learns room RSSI fingerprints from high-confidence room " +
      "assignments. Over days, this tightens radio propagation models for more accurate room detection " +
      "without manual calibration walks. The system also learns room transition patterns to reduce false " +
      "room changes."),
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
      floorToggle,
      el("label",{for:"adaptiveFloorToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer"},
        "Enhance floor-to-floor detection"),
    ]),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
      "Learns cross-floor signal attenuation patterns to better distinguish between rooms on different " +
      "floors. Requires scanners assigned to rooms on multiple floors in Home Assistant."),
    adaptiveStatusDiv,
    resetAdaptiveBtn,
  ]));

  return wrap;
}
