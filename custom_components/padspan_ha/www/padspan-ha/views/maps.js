/*
REPO LOGIC NOTES

Maps view: upload/resize/convert to PNG client-side, then send base64 PNG to backend store.
Receivers are stored as normalized coordinates.
Editor provides pan/zoom and marker add/drag/delete.
*/

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
    : [["library","Library"],["upload","Upload"],["edit","Edit"],["stack","3D Stack"],["export","Export"],["help","Help"]];

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
    activeTab==="export" ? _export(ctx, active) :
    _help(ctx),
  ]);

  root.appendChild(header);
  root.appendChild(body);
  return root;
}

function _tabBtn(id,label,active,setTab){
  const b = document.createElement("button");
  b.className = "tab" + (active===id ? " active" : "");
  b.textContent = label;
  b.addEventListener("click", ()=>setTab(id));
  return b;
}

function _floorName(ctx, floor_id){
  const floors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
  const id = String(floor_id || "").trim();
  if(!id) return "—";
  const f = floors.find(x=>String(x.id)===id);
  return f ? (f.name || f.id) : id;
}

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

  const list = el("div",{style:"margin-top:10px;display:flex;flex-direction:column;gap:8px"});
  for(const m of maps){
    const row = el("div",{class:"maprow" + (m.id===activeId ? " active" : "")});
    const left = el("div",{},[
      el("div",{style:"font-weight:700"}, m.name || m.id),
      el("div",{class:"muted", style:"font-size:12px"}, `${m.image?.width||0}×${m.image?.height||0} • floor: ${(_floorName(ctx,m.floor_id))} • receivers: ${(m.receivers||[]).length}`),
      el("div",{class:"muted", style:"font-size:12px"}, `updated: ${m.updated || ""}`),
    ]);

    const actions = el("div",{style:"display:flex;gap:8px;align-items:center"},[
      el("button",{class:"btn inline", onclick:()=>{ ctx.actions.mapsSetActive(m.id); ctx.actions.setMapsTab('edit'); }}, "Open"),
      el("button",{class:"btn inline danger", onclick:async ()=>{ if(confirm(`Delete map "${m.name||m.id}"?`)){ await ctx.actions.mapsDelete(m.id); } }}, "Delete"),
    ]);

    row.appendChild(left);
    row.appendChild(actions);
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

function _upload(ctx, helpBtn, isBasic){
  helpBtn = helpBtn || (()=>null);
  const { el } = ctx.helpers;
  const card = el("div",{class:"card"});
  card.appendChild(el("div",{class:"card-head"},[
    el("div",{class:"h2"}, isBasic ? "Upload a floor plan" : "Upload floor plan"),
    helpBtn("maps_upload"),
  ]));
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
  if(!floorSel.value && floors[0]) floorSel.value = floors[0].id;

  const name = el("input",{type:"text", placeholder:"Map name (e.g., Main Floor)"});
  const maxw = el("input",{type:"text", placeholder:"Max size (e.g., 1600). Default 1600"});
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/*";

  const status = el("div",{class:"mono", style:"margin-top:10px"}, "—");

  const btn = el("button",{class:"btn inline", onclick: async ()=>{
    if(!file.files || !file.files[0]){ status.textContent = "Pick an image file first."; return; }
    const f = file.files[0];

    // Floor is REQUIRED: either select existing or add new
    let floor_id = (floorSel.value||"").trim();
    if(!floor_id){ status.textContent = "Choose a floor (from HA) before uploading."; return; }

    status.textContent = "Reading…";
    try{
      const max = parseInt((maxw.value||"").trim() || "1600", 10);
      const res = await _preparePng(f, isFinite(max) ? max : 1600);
      status.textContent = `Uploading… (${res.width}×${res.height})`;
      await ctx.actions.mapsUpload({
        name: (name.value||f.name||"Map"),
        filename: f.name,
        mime: f.type || "image/*",
        width: res.width,
        height: res.height,
        png_base64: res.pngBase64,
        floor_id,
      });
      status.textContent = "Uploaded ✔";
      ctx.state.mapsTab = "edit";
      ctx.actions.renderRooms();
    }catch(e){
      status.textContent = "Upload failed: " + String(e);
    }
  }}, "Upload & Convert");

  card.appendChild(el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-top:10px"},[
    el("div",{},[ el("div",{class:"muted",style:"font-size:12px;margin-bottom:4px"},"Floor (from HA)"), floorSel ]),
    el("div",{class:"muted",style:"font-size:12px;align-self:flex-end;padding-bottom:4px"}, "Manage floors in HA Settings → Areas & Zones"),
  ]));

  card.appendChild(name);
  card.appendChild(maxw);
  card.appendChild(file);
  card.appendChild(btn);
  card.appendChild(status);

  card.appendChild(el("div",{class:"muted", style:"margin-top:12px;font-size:12px"},
    "Best practice: upload one map per floor. Floors let you keep room placement clean and avoid mixing levels."
  ));

  return card;
}


async function _preparePng(file, maxDim){
  const buf = await file.arrayBuffer();
  const blob = new Blob([buf], {type: file.type || "image/*"});
  const url = URL.createObjectURL(blob);
  try{
    const img = await _loadImage(url);
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;

    // constrain
    const scale = Math.min(1, maxDim / Math.max(w,h));
    const tw = Math.max(1, Math.round(w*scale));
    const th = Math.max(1, Math.round(h*scale));

    const canvas = document.createElement("canvas");
    canvas.width = tw; canvas.height = th;
    const g = canvas.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.drawImage(img, 0, 0, tw, th);

    const pngBlob = await new Promise((resolve)=>canvas.toBlob(resolve, "image/png", 0.92));
    const ab = await pngBlob.arrayBuffer();
    const b64 = _arrayBufferToBase64(ab);
    return { width: tw, height: th, pngBase64: b64 };
  }finally{
    URL.revokeObjectURL(url);
  }
}

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
    img.onload = ()=>resolve(img);
    img.onerror = (e)=>reject(new Error("Image decode failed"));
    img.src = url;
  });
}

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
  if(!ctx.state.maps._draftReceivers || ctx.state.maps._draftMapId !== map.id){
    ctx.state.maps._draftReceivers = (map.receivers||[]).map(r=>({
      id: r.id||"",
      label: r.label||"",
      x: Number(r.x||0),
      y: Number(r.y||0),
      room: r.room || ""
    }));
    ctx.state.maps._draftRoomBounds = JSON.parse(JSON.stringify(map.room_bounds||{}));
    ctx.state.maps._draftFloorId = map.floor_id || (floors[0] && floors[0].id) || "main";
    ctx.state.maps._draftMapId = map.id;
    ctx.state.maps._selectedRxId = null;
    ctx.state.maps._mode = "receivers"; // receivers | rooms
    ctx.state.maps._selectedRoom = "";
    ctx.state.maps._drawing = null; // {room, points:[]}
  }

  const url = map.image && map.image.filename ? `/local/padspan_ha/maps/${map.image.filename}` : null;

  // Rooms eligible for this map's floor
  const allRooms = Object.keys(ctx.state.roomTagMap||{}).sort();
  const mapFloorId = ctx.state.maps._draftFloorId || "main";
  const eligibleRooms = allRooms.filter(r=>{
    const meta = ctx.state.model?.room_meta?.[r];
    const fid = meta?.floor_id || mapFloorId;
    return fid === mapFloorId;
  });

  const title = el("div",{style:"display:flex;justify-content:space-between;align-items:center;gap:10px"},[
    el("div",{},[
      el("div",{style:"font-weight:700"}, `Edit: ${map.name || map.id}`),
      el("div",{class:"muted", style:"font-size:12px"}, "Place receivers and then draw room boundaries. Save when done."),
    ]),
    el("div",{style:"display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end"},[
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
    ])
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
    el("button",{class:"btn inline"+(ctx.state.maps._mode==="receivers"?" primary":""), onclick:()=>{ ctx.state.maps._mode="receivers"; ctx.state.maps._drawing=null; renderAll(); renderTools(); }}, "Receivers"),
    el("button",{class:"btn inline"+(ctx.state.maps._mode==="rooms"?" primary":""), onclick:()=>{ ctx.state.maps._mode="rooms"; ctx.state.maps._selectedRxId=null; renderAll(); renderTools(); }}, "Rooms"),
    el("span",{class:"muted", style:"font-size:12px"}, ctx.state.maps._mode==="receivers" ? "Double-click map to add receiver" : "Click map to add points; double-click to finish"),
  ]);

  const saveRow = el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;margin-top:10px"},[
    el("button",{class:"btn inline", onclick:async ()=>{
      await ctx.actions.mapsUpdate({
        map_id: map.id,
        receivers: ctx.state.maps._draftReceivers,
        room_bounds: ctx.state.maps._draftRoomBounds,
        floor_id: ctx.state.maps._draftFloorId,
        calibration: map.calibration||{},
        notes: map.notes||""
      });
      alert("Saved layout ✔");
    }}, "Save Layout"),
    el("button",{class:"btn inline", onclick:()=>{
      // reset drafts from last saved map
      ctx.state.maps._draftReceivers = (map.receivers||[]).map(r=>({id:r.id||"", label:r.label||"", x:Number(r.x||0), y:Number(r.y||0), room:r.room||""}));
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
    for(const r of ctx.state.maps._draftReceivers){
      const mk = document.createElement("div");
      mk.className = "marker" + (ctx.state.maps._selectedRxId===r.id ? " selected" : "");
      mk.style.left = `${Math.round((r.x||0)*10000)/100}%`;
      mk.style.top  = `${Math.round((r.y||0)*10000)/100}%`;
      mk.title = (r.label || r.id || "receiver") + (r.room ? ` • ${r.room}` : "");
      mk.textContent = (r.label || r.id || "R").slice(0,2).toUpperCase();
      mk.addEventListener("click", (ev)=>{
        ev.stopPropagation();
        if(ctx.state.maps._mode!=="receivers") return;
        ctx.state.maps._selectedRxId = r.id;
        renderAll(); renderTools();
      });
      _makeDraggable(mk, r, overlay, ()=>{ renderAll(); refreshList(); }, ()=>ctx.state.maps._mode==="receivers");
      overlay.appendChild(mk);
    }
  };

  const renderTools = ()=>{
    right.innerHTML = "";
    right.appendChild(modeRow);

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
        right.appendChild(el("div",{class:"muted", style:"margin-top:10px;font-size:12px"}, "Tip: click a receiver marker to edit its room assignment."));
      }
    } else {
      right.appendChild(el("div",{class:"muted", style:"margin-top:10px;font-size:12px"}, "Room boundary tools"));

      const roomSel = document.createElement("select");
      roomSel.className = "select";
      const opt = document.createElement("option"); opt.value=""; opt.textContent="Choose room…"; roomSel.appendChild(opt);
      for(const r of eligibleRooms){
        const o = document.createElement("option");
        o.value = r; o.textContent = r;
        roomSel.appendChild(o);
      }
      roomSel.value = ctx.state.maps._selectedRoom || "";
      roomSel.addEventListener("change", ()=>{
        ctx.state.maps._selectedRoom = roomSel.value || "";
        ctx.state.maps._drawing = null;
        renderAll(); renderTools();
      });

      const startBtn = el("button",{class:"btn inline", onclick:()=>{
        if(!ctx.state.maps._selectedRoom){ alert("Choose a room first."); return; }
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
        if(!d || !Array.isArray(d.points) || d.points.length < 3){ alert("Need at least 3 points."); return; }
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

  card.appendChild(title);
  card.appendChild(stage);
  card.appendChild(info);
  card.appendChild(right);
  card.appendChild(list);

  return card;
}

// ----- helpers for maps -----

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
  sel.value = value || (floors[0] && floors[0].id) || "main";
  sel.addEventListener("change", ()=>onChange(sel.value));
  return sel;
}

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


function _makeDraggable(node, receiver, container, onMoved=null, isEnabled=null){
  let dragging = false;
  let rect = null;

  const onDown = (ev)=>{
    if(isEnabled && !isEnabled()) return;
    dragging = true;
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

function _receiversText(receivers){
  if(!receivers || !receivers.length) return "No receivers placed yet.";
  return receivers.map((r,i)=>`${i+1}. ${r.label||r.id} @ (${(r.x||0).toFixed(3)}, ${(r.y||0).toFixed(3)})`).join("\n");
}

function clamp01(x){
  if(!isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function _export(ctx, map){
  const { el } = ctx.helpers;
  const card = el("div",{class:"card"});
  card.appendChild(el("div",{class:"muted"},"Export"));

  if(!map){
    card.appendChild(el("div",{class:"muted", style:"margin-top:10px"},"No map selected."));
    return card;
  }

  const pngUrl = map.image?.filename ? `/local/padspan_ha/maps/${map.image.filename}` : null;

  const dlPng = el("a",{class:"btn inline", href: pngUrl || "#", download: (map.name||map.id||"map") + ".png", target:"_blank"}, "Download PNG");
  if(!pngUrl) dlPng.setAttribute("disabled","disabled");

  const dlJson = el("button",{class:"btn inline", onclick:()=>{
    const payload = JSON.stringify(map, null, 2);
    const blob = new Blob([payload], {type:"application/json"});
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = (map.name||map.id||"map") + ".json";
    a.click();
    setTimeout(()=>URL.revokeObjectURL(u), 2500);
  }}, "Download JSON");

  const openPng = el("a",{class:"btn inline", href: pngUrl || "#", target:"_blank"}, "Open PNG in new tab");
  if(!pngUrl) openPng.setAttribute("disabled","disabled");

  card.appendChild(el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;margin-top:10px"},[dlPng, dlJson, openPng]));
  card.appendChild(el("div",{class:"muted", style:"margin-top:10px;font-size:12px"},
    "Industry best practice: keep raw map images in a library and export receiver placements separately (JSON). This allows iterative calibration without destroying history."
  ));
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
    s += `<text x="${cx}" y="${cy}" text-anchor="middle" fill="${r.color}" font-size="${r.id==="hallway"?"11":"13"}" font-weight="600" opacity="0.85">${r.name}</text>`;
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
    s += `<text x="${x}" y="${y+28}" text-anchor="middle" fill="#52b788" font-size="9" opacity="0.8">${name}</text>`;
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
    s += `<text x="${x}" y="${y-13}" text-anchor="middle" fill="${color}" font-size="9" font-weight="500">${name}</text>`;
  }

  // Title in top-right corner
  s += `<rect x="620" y="375" width="175" height="46" fill="#0a150e" stroke="#1b3526" stroke-width="1" rx="4"/>`;
  s += `<text x="632" y="391" fill="#52b788" font-size="10" font-weight="700">Smith Residence (Demo)</text>`;
  s += `<text x="632" y="404" fill="#94a3b8" font-size="8">3 scanners · 5 objects · 5 rooms</text>`;
  s += `<text x="632" y="415" fill="#52b78870" font-size="8">PadSpan HA Sample Mode</text>`;

  s += `</svg>`;
  return s;
}

// ─── 3D Stack Tab ─────────────────────────────────────────────────────────────

const _LEVEL_NAMES = ["Basement", "Ground", "Level 1", "Level 2", "Level 3"];

function _stack(ctx, maps, helpBtn){
  const { el } = ctx.helpers;
  helpBtn = helpBtn || (()=>null);

  // Init alignment state
  if(!ctx.state.maps._stackAlign){
    const firstTgt = maps[1] || maps[0] || null;
    ctx.state.maps._stackAlign = {
      refId:     maps[0] ? maps[0].id : null,
      targetId:  firstTgt ? firstTgt.id : null,
      x_offset:  firstTgt?.stack?.x_offset  ?? 0.0,
      y_offset:  firstTgt?.stack?.y_offset  ?? 0.0,
      scale:     firstTgt?.stack?.scale     ?? 1.0,
    };
  }
  const alignState = ctx.state.maps._stackAlign;

  // Guard: ensure saved refId/targetId still valid after map deletions
  if(alignState.refId && !maps.find(m=>m.id===alignState.refId))
    alignState.refId = maps[0]?.id || null;
  if(alignState.targetId && !maps.find(m=>m.id===alignState.targetId)){
    const newTgt = maps[1] || maps[0] || null;
    alignState.targetId  = newTgt?.id || null;
    alignState.x_offset  = newTgt?.stack?.x_offset  ?? 0.0;
    alignState.y_offset  = newTgt?.stack?.y_offset  ?? 0.0;
    alignState.scale     = newTgt?.stack?.scale     ?? 1.0;
  }

  // Level options: use HA floor registry if available, fall back to hardcoded names
  const haFloors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
  const levelOptions = haFloors.length > 0
    ? haFloors
        .slice()
        .sort((a,b)=> (a.level ?? 999) - (b.level ?? 999) || (a.name||"").localeCompare(b.name||""))
        .map((f, i) => ({ value: f.level ?? i, label: f.name || f.id }))
    : _LEVEL_NAMES.map((name, i) => ({ value: i, label: name }));

  // Overlay mode: "bounds" (SVG room polygons) or "images" (actual PNG images)
  if(!ctx.state.maps._stackOverlayMode) ctx.state.maps._stackOverlayMode = "bounds";

  const card = el("div",{class:"card"});
  card.appendChild(el("div",{class:"card-head"},[
    el("div",{style:"font-weight:700"},"3D Floor Stack"),
    helpBtn("maps_stack"),
  ]));

  if(!maps.length){
    card.appendChild(el("div",{class:"muted",style:"margin-top:10px"},"No maps uploaded yet. Go to Upload tab first."));
    return card;
  }

  // ── Section 1: Level & Ceiling Height Table ──────────────────────────────
  card.appendChild(el("div",{class:"muted",style:"margin-top:16px;font-size:13px;font-weight:600"},"Floor Levels & Ceiling Heights"));
  card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-top:2px"},"Set the building level and ceiling height for each map."));

  const tableWrap = el("div",{style:"overflow-x:auto;margin-top:8px"});
  const table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;font-size:13px";
  const thead = document.createElement("thead");
  thead.innerHTML = `<tr style="border-bottom:1px solid #1b3526">
    <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:500">Map</th>
    <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:500">Level</th>
    <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:500">Ceiling (m)</th>
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

    const tdLevel = document.createElement("td");
    tdLevel.style.cssText = "padding:6px 8px";
    const levelSel = document.createElement("select");
    levelSel.className = "select";
    levelSel.style.minWidth = "110px";
    levelOptions.forEach(({value, label})=>{
      const o = document.createElement("option");
      o.value = value; o.textContent = label;
      if(value === (stk.z_level || 0)) o.selected = true;
      levelSel.appendChild(o);
    });
    tdLevel.appendChild(levelSel);
    tr.appendChild(tdLevel);

    const tdCeil = document.createElement("td");
    tdCeil.style.cssText = "padding:6px 8px";
    const ceilInput = document.createElement("input");
    ceilInput.type = "number"; ceilInput.min = "1.5"; ceilInput.max = "20"; ceilInput.step = "0.1";
    ceilInput.value = String(stk.ceiling_height_m || 2.4);
    ceilInput.style.cssText = "width:70px;background:#0a150e;border:1px solid #1b3526;color:#e2e8f0;padding:4px 6px;border-radius:4px";
    tdCeil.appendChild(ceilInput);
    tr.appendChild(tdCeil);

    const tdSave = document.createElement("td");
    tdSave.style.cssText = "padding:6px 8px";
    tdSave.appendChild(el("button",{class:"btn inline", onclick: async ()=>{
      const newStk = Object.assign({}, m.stack || {},{
        z_level: parseInt(levelSel.value, 10),
        ceiling_height_m: parseFloat(ceilInput.value) || 2.4,
      });
      await ctx.actions.mapsUpdate({
        map_id: m.id, receivers: m.receivers||[], calibration: m.calibration||{},
        notes: m.notes||"", floor_id: m.floor_id||"", room_bounds: m.room_bounds||{},
        stack: newStk,
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
  card.appendChild(el("div",{class:"muted",style:"margin-top:24px;font-size:13px;font-weight:600"},"Alignment Overlay"));
  card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-top:4px"},"Drag the target floor plan (semi-transparent) over the reference to align them spatially. Use Scale +/− to resize."));

  const selRow = el("div",{style:"display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-top:10px"});
  const refSel = document.createElement("select"); refSel.className = "select";
  const tgtSel = document.createElement("select"); tgtSel.className = "select";
  for(const m of maps){
    const oR = document.createElement("option"); oR.value = m.id; oR.textContent = m.name||m.id;
    if(m.id === alignState.refId) oR.selected = true;
    refSel.appendChild(oR);
    const oT = document.createElement("option"); oT.value = m.id; oT.textContent = m.name||m.id;
    if(m.id === alignState.targetId) oT.selected = true;
    tgtSel.appendChild(oT);
  }
  selRow.appendChild(el("div",{},[el("div",{class:"muted",style:"font-size:11px;margin-bottom:3px"},"Reference (fixed)"), refSel]));
  selRow.appendChild(el("div",{},[el("div",{class:"muted",style:"font-size:11px;margin-bottom:3px"},"Target (draggable)"), tgtSel]));
  card.appendChild(selRow);

  const readoutDiv = el("div",{style:"margin-top:8px;font-size:12px;font-family:monospace;color:#94a3b8"});
  const updateReadout = ()=>{ readoutDiv.textContent = `X: ${alignState.x_offset.toFixed(3)}  Y: ${alignState.y_offset.toFixed(3)}  Scale: ${alignState.scale.toFixed(3)}`; };
  updateReadout();
  card.appendChild(readoutDiv);

  // Overlay mode toggle: Option 1 = Radio Boundaries (SVG), Option 2 = Images (PNG)
  const boundsBtn = el("button",{
    class:"btn inline" + (ctx.state.maps._stackOverlayMode==="bounds" ? " primary" : ""),
    onclick:()=>{ ctx.state.maps._stackOverlayMode="bounds"; boundsBtn.className="btn inline primary"; imagesBtn.className="btn inline"; buildStage(); }
  },"Option 1: Radio Boundaries");
  const imagesBtn = el("button",{
    class:"btn inline" + (ctx.state.maps._stackOverlayMode==="images" ? " primary" : ""),
    onclick:()=>{ ctx.state.maps._stackOverlayMode="images"; imagesBtn.className="btn inline primary"; boundsBtn.className="btn inline"; buildStage(); }
  },"Option 2: Images");
  const modeToggleRow = el("div",{style:"display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap"},[
    el("span",{class:"muted",style:"font-size:12px"},"Overlay view:"),
    boundsBtn,
    imagesBtn,
  ]);
  card.appendChild(modeToggleRow);

  const stageWrap = el("div",{style:"position:relative;margin-top:10px;border-radius:8px;overflow:hidden;background:#071008"});
  card.appendChild(stageWrap);

  let applyCurrentTransform = ()=>{ updateReadout(); };

  const buildStage = ()=>{
    stageWrap.innerHTML = "";
    const refId = refSel.value;
    const tgtId = tgtSel.value;

    // When target changes, reload its saved alignment
    if(tgtId !== alignState.targetId){
      const newTgt = maps.find(m=>m.id===tgtId);
      alignState.x_offset = newTgt?.stack?.x_offset ?? 0.0;
      alignState.y_offset = newTgt?.stack?.y_offset ?? 0.0;
      alignState.scale    = newTgt?.stack?.scale    ?? 1.0;
    }
    alignState.refId    = refId;
    alignState.targetId = tgtId;

    const refMap = maps.find(m=>m.id===refId) || null;
    const tgtMap = maps.find(m=>m.id===tgtId) || null;
    if(!refMap){ applyCurrentTransform = ()=>{ updateReadout(); }; return; }

    const iw = refMap.image?.width  || 800;
    const ih = refMap.image?.height || 600;
    const ar = ih / iw;

    stageWrap.style.paddingBottom = `${ar*100}%`;
    stageWrap.style.height = "0";

    const overlayMode = ctx.state.maps._stackOverlayMode || "bounds";
    const refLayer = document.createElement("div");
    refLayer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none";
    if(overlayMode === "images"){
      const refUrl = refMap.image?.filename ? `/local/padspan_ha/maps/${refMap.image.filename}` : null;
      if(refUrl){ const ri = document.createElement("img"); ri.src = refUrl; ri.style.cssText = "width:100%;height:100%;object-fit:fill;display:block"; refLayer.appendChild(ri); }
      else { refLayer.style.cssText += ";display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px"; refLayer.textContent = "No image available for " + (refMap.name||refMap.id); }
    } else {
      refLayer.innerHTML = _stackMapSVGStr(refMap, ctx, false);
    }
    stageWrap.appendChild(refLayer);

    if(tgtMap && tgtMap.id !== refMap.id){
      const tgtLayer = document.createElement("div");
      tgtLayer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;cursor:grab;transform-origin:0 0;opacity:0.55";
      if(overlayMode === "images"){
        const tgtUrl = tgtMap.image?.filename ? `/local/padspan_ha/maps/${tgtMap.image.filename}` : null;
        if(tgtUrl){ const ti = document.createElement("img"); ti.src = tgtUrl; ti.style.cssText = "width:100%;height:100%;object-fit:fill;display:block"; tgtLayer.appendChild(ti); }
        else { tgtLayer.textContent = "No image for " + (tgtMap.name||tgtMap.id); }
      } else {
        tgtLayer.innerHTML = _stackMapSVGStr(tgtMap, ctx, true);
      }

      applyCurrentTransform = ()=>{
        tgtLayer.style.transform = `translate(${alignState.x_offset*100}%,${alignState.y_offset*100}%) scale(${alignState.scale})`;
        updateReadout();
      };
      applyCurrentTransform();

      let dragging = false, dragStartX = 0, dragStartY = 0, startOffX = 0, startOffY = 0;
      const stageRect = ()=>stageWrap.getBoundingClientRect();

      tgtLayer.addEventListener("mousedown",(ev)=>{
        dragging=true; dragStartX=ev.clientX; dragStartY=ev.clientY;
        startOffX=alignState.x_offset; startOffY=alignState.y_offset;
        tgtLayer.style.cursor="grabbing"; ev.preventDefault();
      });
      tgtLayer.addEventListener("touchstart",(ev)=>{
        if(!ev.touches[0]) return;
        dragging=true; dragStartX=ev.touches[0].clientX; dragStartY=ev.touches[0].clientY;
        startOffX=alignState.x_offset; startOffY=alignState.y_offset;
        ev.preventDefault();
      },{passive:false});
      window.addEventListener("mousemove",(ev)=>{
        if(!dragging) return;
        const r = stageRect(); if(!r.width) return;
        alignState.x_offset = startOffX + (ev.clientX - dragStartX)/r.width;
        alignState.y_offset = startOffY + (ev.clientY - dragStartY)/r.height;
        applyCurrentTransform();
      });
      window.addEventListener("touchmove",(ev)=>{
        if(!dragging||!ev.touches[0]) return;
        const r = stageRect(); if(!r.width) return;
        alignState.x_offset = startOffX + (ev.touches[0].clientX - dragStartX)/r.width;
        alignState.y_offset = startOffY + (ev.touches[0].clientY - dragStartY)/r.height;
        applyCurrentTransform();
      },{passive:false});
      window.addEventListener("mouseup",()=>{ dragging=false; tgtLayer.style.cursor="grab"; });
      window.addEventListener("touchend",()=>{ dragging=false; });

      stageWrap.appendChild(tgtLayer);
    } else {
      applyCurrentTransform = ()=>{ updateReadout(); };
      applyCurrentTransform();
    }
  };

  refSel.addEventListener("change", buildStage);
  tgtSel.addEventListener("change", buildStage);
  buildStage();

  const ctrlRow = el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px"});
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{ alignState.scale = Math.min(5.0, Math.round((alignState.scale+0.05)*1000)/1000); applyCurrentTransform(); }},"Scale +"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{ alignState.scale = Math.max(0.1, Math.round((alignState.scale-0.05)*1000)/1000); applyCurrentTransform(); }},"Scale −"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{ alignState.x_offset=0.0; alignState.y_offset=0.0; alignState.scale=1.0; applyCurrentTransform(); }},"Reset"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick: async ()=>{
    const tgtId = tgtSel.value;
    const tgtMap = maps.find(m=>m.id===tgtId);
    if(!tgtMap) return;
    const newStk = Object.assign({}, tgtMap.stack||{},{
      x_offset: alignState.x_offset, y_offset: alignState.y_offset, scale: alignState.scale,
    });
    await ctx.actions.mapsUpdate({
      map_id: tgtMap.id, receivers: tgtMap.receivers||[], calibration: tgtMap.calibration||{},
      notes: tgtMap.notes||"", floor_id: tgtMap.floor_id||"", room_bounds: tgtMap.room_bounds||{},
      stack: newStk,
    });
    ctx.actions.mapsRefresh();
  }},"Save Alignment"));
  card.appendChild(ctrlRow);

  // ── Section 3: 3D Isometric Preview ───────────────────────────────────────
  card.appendChild(el("div",{class:"muted",style:"margin-top:24px;font-size:13px;font-weight:600"},"3D Isometric Preview"));
  card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-top:2px"},"Shows all uploaded floor plans stacked by their assigned level."));
  const isoWrap = el("div",{style:"margin-top:8px;overflow:auto;border-radius:8px;background:#071008;padding:8px"});
  isoWrap.innerHTML = _stackIsoSVG(maps, ctx, levelOptions);
  card.appendChild(isoWrap);

  return card;
}

function _stackMapSVGStr(map, ctx, isTarget){
  const roomColor = ctx.helpers.roomColor;
  const rb = map.room_bounds || {};
  const hasRooms = Object.keys(rb).length > 0;
  const borderCol = isTarget ? "#52b78888" : "#1b3526";

  let s = `<svg viewBox="0 0 1 1" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">`;
  s += `<rect x="0.005" y="0.005" width="0.99" height="0.99" fill="${isTarget?"#071008aa":"#071008"}" stroke="${borderCol}" stroke-width="0.012"/>`;

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

function _stackIsoSVG(maps, ctx, levelOptions){
  const TILE=140, FLOOR_GAP=80, CX=390, CY=360, W=780, H=520;
  const roomColor = ctx.helpers.roomColor;
  const lvlLabel = (z)=>{ const opt=(levelOptions||[]).find(o=>o.value===z); return opt ? opt.label : `L${z}`; };

  const iso = (wx, wy, wz)=>[
    CX + (wx-wy)*TILE*0.866,
    CY + (wx+wy)*TILE*0.5 - wz*FLOOR_GAP,
  ];
  const pt = (c)=>`${Math.round(c[0])},${Math.round(c[1])}`;
  const pts = (corners)=>corners.map(pt).join(" ");

  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:520px;display:block;font-family:system-ui,sans-serif">`;
  s += `<rect width="${W}" height="${H}" fill="#071008"/>`;
  s += `<text x="12" y="20" fill="#52b788" font-size="11" font-weight="600">3D Floor Stack Preview</text>`;

  if(!maps.length){
    s += `<text x="${W/2}" y="${H/2}" text-anchor="middle" fill="#4a6052" font-size="14">No floor plans uploaded yet.</text>`;
    s += `</svg>`; return s;
  }

  // Draw ascending z_level (lowest z first = behind)
  const sorted = [...maps].sort((a,b)=>(a.stack?.z_level||0)-(b.stack?.z_level||0));
  const slabWZ = 10/FLOOR_GAP; // slab thickness in world z units

  for(const m of sorted){
    const stk = m.stack || {z_level:0,x_offset:0,y_offset:0,scale:1.0,ceiling_height_m:2.4};
    const z   = stk.z_level || 0;
    const ox  = stk.x_offset || 0;
    const oy  = stk.y_offset || 0;
    const sc  = stk.scale || 1.0;
    const ceil_h = stk.ceiling_height_m || 2.4;

    const iw = m.image?.width  || 800;
    const ih = m.image?.height || 600;
    const ar = ih / iw;

    const x0=ox, y0=oy, x1=ox+sc, y1=oy+sc*ar;

    // 4 top-face corners
    const TL = iso(x0,y0,z), TR = iso(x1,y0,z);
    const BR = iso(x1,y1,z), BL = iso(x0,y1,z);

    // Slab-bottom corners
    const TR_b = iso(x1,y0,z-slabWZ), BR_b = iso(x1,y1,z-slabWZ);
    const BL_b = iso(x0,y1,z-slabWZ);

    // Right slab face
    s += `<polygon points="${pts([TR,BR,BR_b,TR_b])}" fill="#0d2318" stroke="#1b3526" stroke-width="0.5"/>`;
    // Front slab face
    s += `<polygon points="${pts([BL,BR,BR_b,BL_b])}" fill="#0a1a12" stroke="#1b3526" stroke-width="0.5"/>`;
    // Top face
    s += `<polygon points="${pts([TL,TR,BR,BL])}" fill="#0f2017" stroke="#1b3526" stroke-width="1"/>`;

    // Project room_bounds onto top face
    const rb = m.room_bounds || {};
    for(const [room, b] of Object.entries(rb)){
      if(!b || b.type!=="poly" || !Array.isArray(b.points) || b.points.length<3) continue;
      const color = roomColor(room);
      const polyPts = b.points.map(p=>{
        const wx=ox+p[0]*sc, wy=oy+p[1]*sc*ar;
        return pt(iso(wx,wy,z));
      }).join(" ");
      s += `<polygon points="${polyPts}" fill="${color}22" stroke="${color}" stroke-width="0.5" opacity="0.75"/>`;
    }

    // Receiver dots on top face
    for(const r of (m.receivers||[])){
      const wx=ox+(r.x||0)*sc, wy=oy+(r.y||0)*sc*ar;
      const [px,py] = iso(wx,wy,z);
      s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="4" fill="#52b788" opacity="0.9"/>`;
    }

    // Labels on top face (centroid)
    const centX = (TL[0]+TR[0]+BR[0]+BL[0])/4;
    const centY = (TL[1]+TR[1]+BR[1]+BL[1])/4;
    s += `<text x="${Math.round(centX)}" y="${Math.round(centY-7)}" text-anchor="middle" fill="#e2e8f0" font-size="11" font-weight="500">${_escSVG(m.name||m.id)}</text>`;
    s += `<text x="${Math.round(centX)}" y="${Math.round(centY+8)}" text-anchor="middle" fill="#94a3b8" font-size="9">${_escSVG(lvlLabel(z))} · ${ceil_h}m</text>`;

    // Level marker on left edge
    s += `<text x="${Math.round(TL[0]-6)}" y="${Math.round(TL[1])}" text-anchor="end" dominant-baseline="middle" fill="#52b788" font-size="10" font-weight="700">L${z}</text>`;
  }

  s += `</svg>`;
  return s;
}

function _escSVG(s){
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
