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
      el("div",{class:"muted",style:"font-size:11px"},"Collect calibration fingerprints in the PadSpan Calib panel first."),
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
        markersSvg += `<text x="${cx}" y="${labelY}" text-anchor="middle" font-size="2.4" fill="${col}" font-weight="bold" paint-order="stroke" stroke="#071008" stroke-width="0.7">${shortName}</text>`;
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
  const taggedObjs = (snap?.objects?.list || []).filter(
    o => o.user_label && (o.kind === "ble" || o.kind === "private_ble" || o.kind === "ibeacon")
  );
  const tagsCard = el("div",{class:"card"});
  tagsCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px"},[
    el("div",{style:"font-weight:700"},"BLE Tags"),
    el("span",{class:"badge",style:"font-size:10px"}, String(taggedObjs.length)),
  ]));
  tagsCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
    "Tagged devices can be followed and appear by label across the panel. Untagging removes the label permanently."
  ));

  if(!taggedObjs.length){
    tagsCard.appendChild(el("div",{class:"muted",style:"font-size:12px"},
      "No BLE devices have been tagged yet. Use the Objects tab to tag a device."));
  } else {
    const table = el("table",{style:"width:100%;border-collapse:collapse;font-size:12px"});
    const thead = el("thead",{});
    thead.innerHTML = `<tr>
      <th style="text-align:left;padding:6px 8px;color:#6b9e7e;font-size:11px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3a28">Label</th>
      <th style="text-align:left;padding:6px 8px;color:#6b9e7e;font-size:11px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3a28">Address / Key</th>
      <th style="text-align:left;padding:6px 8px;color:#6b9e7e;font-size:11px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3a28">Kind</th>
      <th style="text-align:left;padding:6px 8px;color:#6b9e7e;font-size:11px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3a28">Last seen</th>
      <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #1e3a28"></th>
    </tr>`;
    table.appendChild(thead);
    const tbody = el("tbody",{});
    for(const o of taggedObjs){
      const k = o.kind;
      const tagAddr = k === "private_ble" ? (o.canonical_id || o.address)
                    : k === "ibeacon"     ? (o.key || o.address)
                    : o.address;
      const displayAddr = k === "ibeacon"
        ? (o.ibeacon_uuid ? o.ibeacon_uuid.slice(0,8)+"…" : o.address)
        : o.address;
      const kindLabel   = k === "ibeacon" ? "iBeacon" : k === "private_ble" ? "Private BLE" : "BLE";
      const kindStyle   = k === "ibeacon"
        ? "font-size:10px;background:#3a2a0a;color:#fbbf24;border-color:#d97706"
        : k === "private_ble"
        ? "font-size:10px;background:#1a3a5a;color:#7dd3fc;border-color:#3b82f6"
        : "font-size:10px";
      const ageS = o.age_s != null ? Number(o.age_s) : null;
      const ageStr = ageS == null ? "—" : ageS < 60 ? Math.round(ageS)+"s"
                   : Math.floor(ageS/60)+"m "+Math.round(ageS%60)+"s";
      const tr = el("tr",{style:"border-bottom:1px solid #131f17"});
      tr.appendChild(el("td",{style:"padding:8px;font-weight:600"}, o.user_label));
      tr.appendChild(el("td",{style:"padding:8px;font-family:monospace;font-size:11px;color:#6b9e7e"}, displayAddr));
      tr.appendChild(el("td",{style:"padding:8px"},[
        el("span",{class:"badge",style:kindStyle}, kindLabel),
      ]));
      tr.appendChild(el("td",{style:"padding:8px;color:#6b9e7e;font-size:11px"}, ageStr));
      const untagTd = el("td",{style:"padding:8px;text-align:right"});
      const untagBtn = el("button",{class:"btn",style:"font-size:11px;color:#f87171;border-color:#7f1d1d"}, "Untag");
      untagBtn.addEventListener("click", async ()=>{
        if(!confirm(`Remove tag "${o.user_label}"?`)) return;
        untagBtn.disabled = true; untagBtn.textContent = "Removing…";
        try {
          await ctx.actions.objectLabelDelete(tagAddr);
          await ctx.actions.refreshSnapshot();
          ctx.actions.renderRooms();
          ctx.toast(`Removed tag "${o.user_label}"`);
        } catch(e){
          ctx.toast("Failed to remove tag", true);
          untagBtn.disabled = false; untagBtn.textContent = "Untag";
        }
      });
      untagTd.appendChild(untagBtn);
      tr.appendChild(untagTd);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tagsCard.appendChild(table);
  }
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
  const currentDelay = (settings.room_change_delay_s != null ? Number(settings.room_change_delay_s) : 20);
  const polls = Math.max(1, Math.round(currentDelay / 10));

  const inp = el("input", {
    type: "number", min: "0", max: "300", step: "5", value: String(currentDelay),
    style: "width:72px;text-align:center;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:13px",
  });

  const saveBtn = el("button", { class: "btn" }, "Save");
  saveBtn.addEventListener("click", async () => {
    const v = Math.max(0, Math.min(300, parseFloat(inp.value) || 0));
    try {
      await ctx.actions.settingsSet({ room_change_delay_s: v });
      ctx.toast(`Room change delay set to ${v}s`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });

  const inpStyle = "background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:13px";

  return el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Presence Smoothing"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "Controls how quickly PadSpan switches a tracked device to a new room after it moves. " +
      "A higher delay prevents rapid flickering when a device sits on the boundary between two scanners. " +
      "The room only changes after a scanner consistently dominates for the full delay period."
    ),
    el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap" }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Room change delay"),
      inp,
      el("div", { class: "muted", style: "font-size:12px" }, "seconds"),
      saveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      `Current: ${currentDelay}s → requires ~${polls} consecutive 10-second poll${polls !== 1 ? "s" : ""} agreement. ` +
      `Set to 0 for instant room switching.`
    ),
  ]);
}
