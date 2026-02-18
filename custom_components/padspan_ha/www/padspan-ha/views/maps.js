/*
REPO LOGIC NOTES

Maps view: upload/resize/convert to PNG client-side, then send base64 PNG to backend store.
Receivers are stored as normalized coordinates.
Editor provides pan/zoom and marker add/drag/delete.
*/

export function render(ctx){
  const { el, esc, pill } = ctx.helpers;
  const root = el("section",{id:"maps"});
  root.className = ctx.state.view==="maps" ? "" : "hidden";

  const maps = (ctx.state.maps && ctx.state.maps.list) ? ctx.state.maps.list : [];
  const activeId = ctx.state.activeMapId || (maps[0] && maps[0].id) || null;
  const active = maps.find(m=>m.id===activeId) || null;

  const tab = ctx.state.mapsTab || "library";
  const setTab = (t)=>ctx.actions.setMapsTab(t);

  const tabs = el("div",{class:"tabs"},[
    _tabBtn("library","Library",tab,setTab),
    _tabBtn("upload","Upload",tab,setTab),
    _tabBtn("edit","Edit",tab,setTab),
    _tabBtn("export","Export",tab,setTab),
    _tabBtn("help","Help",tab,setTab),
  ]);

  const header = el("div",{class:"card"},[
    el("div",{style:"display:flex;align-items:center;gap:10px;justify-content:space-between"},[
      el("div",{},[
        el("div",{style:"font-weight:700;font-size:16px"},"Mapping Suite"),
        el("div",{class:"muted"},"Upload floorplans (any image type), auto-size to PNG, then place BLE receivers. Export maps + receiver layout."),
      ]),
      el("div",{style:"display:flex;gap:8px;align-items:center"},[
        el("button",{class:"btn inline", onclick:()=>ctx.actions.mapsRefresh()}, "Refresh"),
      ])
    ]),
    tabs,
  ]);

  const body = el("div",{},[
    tab==="library" ? _library(ctx, maps, activeId) :
    tab==="upload" ? _upload(ctx) :
    tab==="edit" ? _edit(ctx, active) :
    tab==="export" ? _export(ctx, active) :
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

function _library(ctx, maps, activeId){
  const { el } = ctx.helpers;
  const wrap = el("div",{class:"card"},[
    el("div",{style:"display:flex;justify-content:space-between;align-items:center"},[
      el("div",{class:"muted"},"Maps Library"),
      el("div",{class:"muted"},`${maps.length} map(s)`),
    ]),
  ]);

  if(!maps.length){
    wrap.appendChild(el("div",{class:"muted", style:"margin-top:10px"},"No maps yet. Go to Upload tab."));
    return wrap;
  }

  const list = el("div",{style:"margin-top:10px;display:flex;flex-direction:column;gap:8px"});
  for(const m of maps){
    const row = el("div",{class:"maprow" + (m.id===activeId ? " active" : "")});
    const left = el("div",{},[
      el("div",{style:"font-weight:700"}, m.name || m.id),
      el("div",{class:"muted", style:"font-size:12px"}, `${m.image?.width||0}×${m.image?.height||0} • receivers: ${(m.receivers||[]).length}`),
      el("div",{class:"muted", style:"font-size:12px"}, `updated: ${m.updated || ""}`),
    ]);

    const actions = el("div",{style:"display:flex;gap:8px;align-items:center"},[
      el("button",{class:"btn inline", onclick:()=>{ ctx.actions.mapsSetActive(m.id); }}, "Open"),
      el("button",{class:"btn inline danger", onclick:async ()=>{ if(confirm(`Delete map "${m.name||m.id}"?`)){ await ctx.actions.mapsDelete(m.id); } }}, "Delete"),
    ]);

    row.appendChild(left);
    row.appendChild(actions);
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

function _upload(ctx){
  const { el } = ctx.helpers;
  const card = el("div",{class:"card"});
  card.appendChild(el("div",{class:"muted"},"Upload floorplan image (PNG/JPG/WebP/GIF/SVG). We'll auto-resize and store as optimized PNG for mapping."));

  const name = el("input",{type:"text", placeholder:"Map name (e.g., Main Floor)"});
  const maxw = el("input",{type:"text", placeholder:"Max size (e.g., 1600). Default 1600"});
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/*";

  const status = el("div",{class:"mono", style:"margin-top:10px"}, "—");

  const btn = el("button",{class:"btn inline", onclick: async ()=>{
    if(!file.files || !file.files[0]){ status.textContent = "Pick an image file first."; return; }
    const f = file.files[0];
    status.textContent = "Reading…";
    try{
      const max = parseInt((maxw.value||"").trim() || "1600", 10);
      const res = await _preparePng(f, isFinite(max) ? max : 1600);
      status.textContent = `Uploading… (${res.width}×${res.height})`;
      const r = await ctx.actions.mapsUpload({
        name: (name.value||f.name||"Map"),
        filename: f.name,
        mime: f.type || "image/*",
        width: res.width,
        height: res.height,
        png_base64: res.pngBase64,
      });
      status.textContent = "Uploaded ✔";
      ctx.state.mapsTab = "edit";
      ctx.actions.renderRooms();
    }catch(e){
      status.textContent = "Upload failed: " + String(e);
    }
  }}, "Upload & Convert");

  card.appendChild(name);
  card.appendChild(maxw);
  card.appendChild(file);
  card.appendChild(btn);
  card.appendChild(status);

  card.appendChild(el("div",{class:"muted", style:"margin-top:12px;font-size:12px"},
    "Best practice: use a clear, high-contrast floorplan. If you have multiple floors, upload one per map."
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
  const { el } = ctx.helpers;
  const card = el("div",{class:"card"});

  if(!map){
    card.appendChild(el("div",{class:"muted"},"No map selected. Go to Library or Upload tab."));
    return card;
  }

  const title = el("div",{style:"display:flex;justify-content:space-between;align-items:center;gap:10px"},[
    el("div",{},[
      el("div",{style:"font-weight:700"}, `Edit: ${map.name || map.id}`),
      el("div",{class:"muted", style:"font-size:12px"}, "Double-click to add receiver. Drag to reposition. Save when done."),
    ]),
    el("div",{style:"display:flex;gap:8px;align-items:center"},[
      el("button",{class:"btn inline", onclick:()=>{ ctx.actions.mapsSetActive(map.id); ctx.actions.setMapsTab('library'); }}, "Back"),
    ])
  ]);

  const url = map.image && map.image.filename ? `/local/padspan_ha/maps/${map.image.filename}` : null;

  const stage = document.createElement("div");
  stage.className = "mapstage";
  stage.title = "Double-click to add receiver";

  const img = new Image();
  img.className = "mapimg";
  if(url) img.src = url;

  const overlay = document.createElement("div");
  overlay.className = "mapoverlay";

  stage.appendChild(img);
  stage.appendChild(overlay);

  // draft receivers stored in ctx.state.maps._draftReceivers
  if(!ctx.state.maps._draftReceivers || ctx.state.maps._draftMapId !== map.id){
    ctx.state.maps._draftReceivers = (map.receivers||[]).map(r=>({id:r.id||"", label:r.label||"", x:Number(r.x||0), y:Number(r.y||0)}));
    ctx.state.maps._draftMapId = map.id;
  }

  const renderMarkers = ()=>{
    overlay.innerHTML = "";
    for(const r of ctx.state.maps._draftReceivers){
      const mk = document.createElement("div");
      mk.className = "marker";
      mk.style.left = `${Math.round((r.x||0)*10000)/100}%`;
      mk.style.top  = `${Math.round((r.y||0)*10000)/100}%`;
      mk.title = r.label || r.id || "receiver";
      mk.textContent = (r.label || r.id || "R").slice(0,2).toUpperCase();
      _makeDraggable(mk, r, overlay);
      overlay.appendChild(mk);
    }
  };

  stage.addEventListener("dblclick", (ev)=>{
    const rect = overlay.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    const id = `rx_${Date.now().toString(16)}`;
    ctx.state.maps._draftReceivers.push({id, label:`Receiver ${ctx.state.maps._draftReceivers.length+1}`, x: clamp01(x), y: clamp01(y)});
    renderMarkers();
  });

  const form = el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;margin-top:10px"},[
    el("button",{class:"btn inline", onclick:()=>{
      ctx.state.maps._draftReceivers.push({id:`rx_${Date.now().toString(16)}`, label:`Receiver ${ctx.state.maps._draftReceivers.length+1}`, x:0.5, y:0.5});
      renderMarkers();
    }}, "Add Receiver"),
    el("button",{class:"btn inline", onclick:()=>{
      if(!ctx.state.maps._draftReceivers.length) return;
      ctx.state.maps._draftReceivers.pop();
      renderMarkers();
    }}, "Undo"),
    el("button",{class:"btn inline", onclick:async ()=>{
      await ctx.actions.mapsUpdate({map_id: map.id, receivers: ctx.state.maps._draftReceivers, calibration: map.calibration||{}, notes: map.notes||""});
      alert("Saved receivers ✔");
    }}, "Save Receivers"),
  ]);

  const list = el("div",{class:"mono", style:"margin-top:10px;white-space:pre-wrap"}, _receiversText(ctx.state.maps._draftReceivers));

  const refreshList = ()=>{ list.textContent = _receiversText(ctx.state.maps._draftReceivers); };

  // refresh list when dragging stops
  overlay.addEventListener("mouseup", ()=>refreshList());
  overlay.addEventListener("touchend", ()=>refreshList());

  renderMarkers();
  refreshList();

  card.appendChild(title);
  card.appendChild(stage);
  card.appendChild(form);
  card.appendChild(el("div",{class:"muted", style:"margin-top:10px;font-size:12px"},
    "Coordinates are stored normalized (0–1), so they stay correct if you re-upload a resized map with same aspect ratio."
  ));
  card.appendChild(list);
  return card;
}

function _makeDraggable(node, receiver, container){
  let dragging = false;
  let rect = null;

  const onDown = (ev)=>{
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
  };
  const onUp = ()=>{
    dragging = false;
    rect = null;
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
