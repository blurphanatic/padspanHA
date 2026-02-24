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
  for(const [id, label] of [["appearance","Appearance"],["scannermap","Scanner Map"]]){
    tabBar.appendChild(el("button",{
      class:"tab" + (activeTab===id ? " active" : ""),
      onclick:()=>setTab(id),
    }, label));
  }
  root.appendChild(tabBar);

  if(activeTab === "appearance"){
    root.appendChild(_settingsAppearance(ctx, el, helpBtn, draft, haFloors, haAreas, roomColor, false));
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
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:14px"});
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const maps  = (ctx.state.maps && ctx.state.maps.list) || [];

  // Load calibration data if not yet loaded (shared with calibration.js via ctx.state.calibration)
  if(!ctx.state.calibration){
    ctx.actions.calibrationGet()
      .then(d => { ctx.state.calibration = d; ctx.actions.renderRooms(); })
      .catch(() => { ctx.state.calibration = { points:[], model:{} }; ctx.actions.renderRooms(); });
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted",style:"font-size:12px"},"Loading calibration data…"),
    ]));
    return wrap;
  }

  const calData = ctx.state.calibration;
  const radios  = snap?.ble?.radios || [];

  // Intro card
  wrap.appendChild(el("div",{class:"card",style:"border-color:#52b788"},[
    el("div",{style:"font-weight:700;font-size:14px;margin-bottom:6px;color:#52b788"},"Scanner Position Estimates"),
    el("div",{style:"font-size:12px;color:#b0c4b1;line-height:1.6"},[
      el("div",{},"Based on your calibration fingerprints, PadSpan can guess where each BLE scanner physically sits."),
      el("div",{style:"margin-top:4px;color:#78909c"},"Position = signal-weighted centroid of all calibration points seen by that scanner. Confidence rises with more points."),
    ]),
  ]));

  // Estimate scanner positions from calibration data
  const positions = _estimateScannerPositions(calData);
  const estimatedSources = new Set(Object.keys(positions));

  // Find which radios have no calibration estimate at all
  const unplacedRadios = radios.filter(r => r.source && !estimatedSources.has(r.source));

  if(!calData.points || calData.points.length === 0){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{style:"font-weight:700;font-size:14px;color:#f59e0b;margin-bottom:6px"},"⚠ No calibration data"),
      el("div",{class:"muted",style:"font-size:12px"},"Collect calibration fingerprints in the PadSpan Calib panel first. The more points you collect, the better these position estimates become."),
    ]));
    return wrap;
  }

  // Group estimated positions by map_id
  const byMap = {};
  for(const [source, pos] of Object.entries(positions)){
    if(!byMap[pos.mapId]) byMap[pos.mapId] = [];
    // Find radio display name from snap
    const radio = radios.find(r => r.source === source);
    const name = radio?.area_name || radio?.area || radio?.name || source;
    byMap[pos.mapId].push({ source, name, ...pos });
  }

  // Render one map card per floor plan that has estimated radios
  const mapIds = Object.keys(byMap);
  if(!mapIds.length){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted",style:"font-size:12px"},"Could not estimate any positions from the available calibration data."),
    ]));
  }

  // Colour palette for radios
  const PALETTE = ["#52b788","#60a5fa","#f59e0b","#a78bfa","#fb7185","#34d399","#f472b6","#38bdf8"];

  for(const mapId of mapIds){
    const mapData = maps.find(m => m.id === mapId);
    const mapRadios = byMap[mapId];

    const mapCard = el("div",{class:"card"});

    // Card header
    const floorName = _floorNameForMap(mapData, haFloors);
    mapCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
      el("div",{style:"font-weight:700;font-size:14px"}, mapData?.name || mapId),
      floorName ? el("span",{class:"badge",style:"font-size:10px"},floorName) : null,
      el("span",{class:"badge",style:"margin-left:auto;font-size:10px"},`${mapRadios.length} scanner${mapRadios.length!==1?"s":""}`),
    ].filter(Boolean)));

    if(mapData?.image?.filename){
      const ar  = (mapData.image.height || 600) / (mapData.image.width || 800);
      const vbH = ar * 100;
      const imgUrl = `/local/padspan_ha/maps/${mapData.image.filename}`;

      // Build SVG overlay
      let markersSvg = "";
      mapRadios.forEach((r, i) => {
        const cx = (r.x_frac * 100).toFixed(2);
        const cy = (r.y_frac * vbH).toFixed(2);
        const col = PALETTE[i % PALETTE.length];
        const conf = r.confidence;     // 0–1
        const outerR = (3 + conf * 5).toFixed(1);   // 3–8 SVG units
        const innerR = (1.5).toFixed(1);

        // Confidence ring (dashed, fades with uncertainty)
        const ringOp = (0.2 + conf * 0.4).toFixed(2);
        markersSvg += `<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="${col}" fill-opacity="0.15" stroke="${col}" stroke-width="0.8" stroke-dasharray="2 1.5" opacity="${ringOp}"/>`;
        // Solid centre dot
        markersSvg += `<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="${col}" stroke="white" stroke-width="0.6" opacity="0.9"/>`;
        // Label — truncated, shown above pin
        const labelY = (r.y_frac * vbH - parseFloat(outerR) - 1).toFixed(1);
        const shortName = r.name.length > 14 ? r.name.slice(0,12) + "…" : r.name;
        markersSvg += `<text x="${cx}" y="${labelY}" text-anchor="middle" font-size="3" fill="${col}" font-weight="bold" paint-order="stroke" stroke="#071008" stroke-width="0.8">${shortName}</text>`;
      });

      const mapDiv = el("div",{style:"border-radius:8px;overflow:hidden;border:1px solid #1b3526;margin-bottom:10px"});
      mapDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${vbH}"
        preserveAspectRatio="none" style="width:100%;display:block">
        <image href="${imgUrl}" x="0" y="0" width="100" height="${vbH}" preserveAspectRatio="none"/>
        ${markersSvg}
      </svg>`;
      mapCard.appendChild(mapDiv);
    }

    // Legend table
    const legendDiv = el("div",{style:"display:flex;flex-direction:column;gap:4px"});
    mapRadios.forEach((r, i) => {
      const col = PALETTE[i % PALETTE.length];
      const confPct = Math.round(r.confidence * 100);
      const confColor = confPct >= 80 ? "#52b788" : confPct >= 40 ? "#f59e0b" : "#dc2626";
      legendDiv.appendChild(el("div",{
        style:"display:flex;align-items:center;gap:8px;padding:5px 8px;background:#0a150e;border:1px solid #1b3526;border-radius:8px"
      },[
        el("div",{style:`width:10px;height:10px;border-radius:50%;background:${col};flex-shrink:0`}),
        el("div",{style:"flex:1;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, r.name),
        el("div",{style:"font-size:10px;color:#78909c;font-family:monospace;flex-shrink:0"}, r.source.slice(-11)),
        el("div",{style:`font-size:11px;color:${confColor};flex-shrink:0;white-space:nowrap`},
          `${confPct}% · ${r.pointCount} pt${r.pointCount!==1?"s":""}`),
      ]));
    });
    mapCard.appendChild(legendDiv);
    wrap.appendChild(mapCard);
  }

  // Unplaced radios (no calibration data at all)
  if(unplacedRadios.length){
    const unplacedCard = el("div",{class:"card",style:"border-color:#f59e0b"});
    unplacedCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px"},[
      el("div",{style:"font-weight:700;font-size:14px;color:#f59e0b"},"⚠ No calibration data for these scanners"),
      el("span",{class:"badge warn",style:"font-size:10px;margin-left:auto"},`${unplacedRadios.length}`),
    ]));
    unplacedCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:8px"},
      "These radios are active but haven't been seen in any calibration points yet. Walk near them with your beacon to include them in the fingerprint database."));
    for(const r of unplacedRadios){
      const name = r.area_name || r.area || r.name || r.source || "?";
      unplacedCard.appendChild(el("div",{
        style:"display:flex;align-items:center;gap:8px;padding:5px 8px;background:#0a150e;border:1px solid #2d1f0e;border-radius:8px;margin-bottom:4px"
      },[
        el("div",{style:"width:10px;height:10px;border-radius:50%;background:#78909c;flex-shrink:0"}),
        el("div",{style:"flex:1;font-size:12px;font-weight:600"}, name),
        el("div",{style:"font-size:10px;color:#78909c;font-family:monospace"}, r.source.slice(-11)),
        r.scanning ? el("span",{class:"badge",style:"font-size:10px"},"scanning") : el("span",{class:"badge warn",style:"font-size:10px"},"idle"),
      ]));
    }
    wrap.appendChild(unplacedCard);
  }

  // Refresh button
  wrap.appendChild(el("div",{style:"text-align:center;margin-top:4px"},[
    el("button",{class:"btn inline",onclick:()=>{ ctx.state.calibration=null; ctx.actions.renderRooms(); }},
      "Reload calibration data"),
  ]));

  return wrap;
}

// Estimate scanner positions from calibration data using signal-weighted centroid.
// Returns { source: { mapId, x_frac, y_frac, pointCount, meanRssi, confidence } }
function _estimateScannerPositions(calData){
  // Accumulate per (source, map_id)
  const acc = {};   // acc[source][mapId] = [{x_frac, y_frac, mean_rssi}]
  for(const pt of calData.points || []){
    for(const sr of pt.scanner_readings || []){
      if(!sr.source || !sr.rssi_samples?.length) continue;
      const meanRssi = sr.rssi_samples.reduce((a,b)=>a+b,0) / sr.rssi_samples.length;
      if(!acc[sr.source]) acc[sr.source] = {};
      if(!acc[sr.source][pt.map_id]) acc[sr.source][pt.map_id] = [];
      acc[sr.source][pt.map_id].push({ x_frac:pt.x_frac, y_frac:pt.y_frac, mean_rssi:meanRssi });
    }
  }

  const positions = {};
  for(const [source, byMap] of Object.entries(acc)){
    // Pick the map with the most calibration readings (most likely floor)
    let bestMapId = null, bestCount = 0;
    for(const [mapId, pts] of Object.entries(byMap)){
      if(pts.length > bestCount){ bestCount = pts.length; bestMapId = mapId; }
    }
    if(!bestMapId) continue;

    const pts = byMap[bestMapId];
    // Use exponential weighting: w = 10^(rssi/10) so stronger signal = exponentially heavier
    const weights = pts.map(p => Math.pow(10, p.mean_rssi / 10));
    const totalW  = weights.reduce((a,b)=>a+b,0);
    const x = pts.reduce((s,p,i) => s + p.x_frac * weights[i], 0) / totalW;
    const y = pts.reduce((s,p,i) => s + p.y_frac * weights[i], 0) / totalW;
    const meanRssi = Math.round(pts.reduce((s,p)=>s+p.mean_rssi,0) / pts.length);
    const confidence = Math.min(1, pts.length / 6);  // 6 points → 100% confidence

    positions[source] = { mapId:bestMapId, x_frac:x, y_frac:y, pointCount:pts.length, meanRssi, confidence };
  }
  return positions;
}

function _floorNameForMap(mapData, haFloors){
  if(!mapData) return null;
  const fid = mapData.floor_id;
  if(!fid) return null;
  const f = haFloors.find(f=>f.id===fid);
  return f ? (f.name || f.id) : fid;
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
