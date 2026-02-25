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
    activeTab==="export" ? _export(ctx, active, maps) :
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

  file.addEventListener("change", ()=>{
    if(!file.files||!file.files[0]) return;
    const f2=file.files[0];
    if(!name.value) name.value=f2.name.replace(/\.[^.]+$/,"");
    const objUrl=URL.createObjectURL(f2);
    previewImg.onload=()=>{
      URL.revokeObjectURL(objUrl);
      _imgNatW=previewImg.naturalWidth; _imgNatH=previewImg.naturalHeight;
      const cs=Math.min(1,1600/Math.max(_imgNatW,_imgNatH));
      cropCanvas.width=Math.round(_imgNatW*cs); cropCanvas.height=Math.round(_imgNatH*cs);
      cropRect=null; _drawCropOverlay();
      previewOuter.style.display="";
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
    if(!file.files || !file.files[0]){ status.textContent = "Pick an image file first."; return; }
    const f = file.files[0];
    let floor_id = (floorSel.value||"").trim();
    if(!floor_id){ status.textContent = "Choose a floor (from HA) before uploading."; return; }
    status.textContent = "Reading\u2026";
    try{
      const max = parseInt((maxw.value||"").trim() || "1600", 10);
      const res = await _preparePng(f, isFinite(max) ? max : 1600, cropRect);
      status.textContent = `Uploading\u2026 (${res.width}\u00d7${res.height})`;
      await ctx.actions.mapsUpload({
        name: (name.value||f.name||"Map"),
        filename: f.name,
        mime: f.type || "image/*",
        width: res.width,
        height: res.height,
        png_base64: res.pngBase64,
        floor_id,
      });
      status.textContent = "Uploaded \u2714";
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

  card.appendChild(el("div",{class:"muted", style:"margin-top:12px;font-size:12px"},
    "Best practice: upload one map per floor. Floors let you keep room placement clean and avoid mixing levels."
  ));

  return card;
}


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

// Like _preparePng but reads from a URL (for already-uploaded map images).
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
          const alreadyPlaced = ctx.state.maps._draftReceivers.some(r => r.label === radio.name || r.id === radio.source);
          const sid = _sid(radio.source || "");
          const borderColor = radio.disabled ? "#5b3b7a" : radio.lost ? "#7d5c2b" : "#1b3526";
          const bg = radio.disabled ? "rgba(148,100,220,.06)" : radio.lost ? "rgba(245,158,11,.06)" : "#0a150e";
          const row = el("div",{style:`display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid ${borderColor};border-radius:6px;background:${bg};opacity:${(radio.lost||radio.disabled)?0.75:1}`});
          // ID pill
          row.appendChild(el("span",{style:"font-family:monospace;font-weight:700;font-size:10px;color:#94a3b8;white-space:nowrap"}, sid));
          // Name + room
          const info = el("div",{style:"flex:1;min-width:0"});
          info.appendChild(el("div",{style:"font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, radio.name || radio.source || "Unknown"));
          info.appendChild(el("div",{class:"muted",style:"font-size:10px"}, radio.area_name || "no room"));
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

  // ── Trim Image panel ────────────────────────────────────────────────────
  // Shown/hidden by the "Trim" button in the title row.
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

  // Load the current map image into the trim preview
  if(url){
    const tmpImg = new Image();
    tmpImg.crossOrigin = "anonymous";
    tmpImg.onload = ()=>{
      _trimImgW = tmpImg.naturalWidth; _trimImgH = tmpImg.naturalHeight;
      const cs = Math.min(1, 1600/Math.max(_trimImgW,_trimImgH));
      trimCanvas.width  = Math.round(_trimImgW*cs);
      trimCanvas.height = Math.round(_trimImgH*cs);
      _trimCrop = null; _drawTrimOverlay();
    };
    tmpImg.src = url;
  }

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

  card.appendChild(title);
  card.appendChild(trimPanel);
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
  const isoSvgStr = _stackIsoSVG(maps_list, ctx, lvlOpts2, null, ctx.state.maps._stackFloorGap || 200);
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
      refId:      maps[0] ? maps[0].id : null,
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

  // View zoom (scales the stage down so both maps fit on screen) and target opacity
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
  const updateReadout = ()=>{
    const xAdj = alignState.scaleX_adj || 1.0;
    const xStr = Math.abs(xAdj - 1.0) > 0.001 ? `  ScaleX: ${xAdj.toFixed(3)}` : "";
    readoutDiv.textContent = `X: ${alignState.x_offset.toFixed(3)}  Y: ${alignState.y_offset.toFixed(3)}  Scale: ${alignState.scale.toFixed(3)}  Rot: ${(alignState.rotation||0).toFixed(1)}°${xStr}`;
  };
  updateReadout();
  card.appendChild(readoutDiv);

  // stageOuter: scrollable canvas with 60px buffer so dragged target remains visible near edges
  const stageOuter = el("div",{style:"margin-top:10px;overflow:auto;max-width:100%;border-radius:8px;background:#071008;padding:60px"});
  const stageWrap = el("div",{style:`position:relative;overflow:visible;border-radius:6px;background:#071008;width:${Math.round((ctx.state.maps._stackViewScale||1.0)*100)}%;min-width:220px`});
  stageOuter.appendChild(stageWrap);
  card.appendChild(stageOuter);

  let tgtLayerRef = null;
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

    stageWrap.style.paddingBottom = `${ar * (ctx.state.maps._stackViewScale||1.0) * 100}%`;
    stageWrap.style.height = "0";

    // Reference layer: image (if any) + SVG room bounds on top
    const refLayer = document.createElement("div");
    refLayer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none";
    const refUrl = refMap.image?.filename ? `/local/padspan_ha/maps/${refMap.image.filename}` : null;
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
    stageWrap.appendChild(refLayer);

    if(tgtMap && tgtMap.id !== refMap.id){
      const tgtLayer = document.createElement("div");
      tgtLayer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;cursor:grab;transform-origin:50% 50%";

      // Target layer: image (if any) + SVG room bounds on top
      const tgtUrl = tgtMap.image?.filename ? `/local/padspan_ha/maps/${tgtMap.image.filename}` : null;
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
        // transform-origin:50% 50% means rotate/scale happen around element center.
        // translate moves the center to (x_offset+0.5, y_offset+0.5) of stage; rotate/scale around that point.
        const sx = (alignState.scale || 1.0) * (alignState.scaleX_adj || 1.0);
        const sy = alignState.scale || 1.0;
        tgtLayer.style.transform = `translate(${alignState.x_offset*100}%,${alignState.y_offset*100}%) rotate(${alignState.rotation||0}deg) scale(${sx},${sy})`;
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
      }, { signal });
      window.addEventListener("touchmove",(ev)=>{
        if(!dragging||!ev.touches[0]) return;
        const r = stageRect(); if(!r.width) return;
        alignState.x_offset = startOffX + (ev.touches[0].clientX - dragStartX)/r.width;
        alignState.y_offset = startOffY + (ev.touches[0].clientY - dragStartY)/r.height;
        applyCurrentTransform();
      },{ passive:false, signal });
      window.addEventListener("mouseup",()=>{ dragging=false; tgtLayer.style.cursor="grab"; }, { signal });
      window.addEventListener("touchend",()=>{ dragging=false; }, { signal });

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

  // View zoom controls (shrinks the stage canvas so both maps are visible)
  ctrlRow.appendChild(el("span",{class:"muted",style:"font-size:11px;white-space:nowrap;margin-left:8px"},"View:"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    ctx.state.maps._stackViewScale = Math.max(0.1, Math.round(((ctx.state.maps._stackViewScale||1.0)-0.1)*100)/100);
    stageWrap.style.width = `${Math.round(ctx.state.maps._stackViewScale*100)}%`;
    stageWrap.style.paddingBottom = `${Math.round(stageAr * ctx.state.maps._stackViewScale * 100)}%`;
  }},"Zoom −"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    ctx.state.maps._stackViewScale = 1.0;
    stageWrap.style.width = "100%";
    stageWrap.style.paddingBottom = `${Math.round(stageAr * 100)}%`;
  }},"100%"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    ctx.state.maps._stackViewScale = Math.min(2.0, Math.round(((ctx.state.maps._stackViewScale||1.0)+0.1)*100)/100);
    stageWrap.style.width = `${Math.round(ctx.state.maps._stackViewScale*100)}%`;
    stageWrap.style.paddingBottom = `${Math.round(stageAr * ctx.state.maps._stackViewScale * 100)}%`;
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

  // Save alignment
  const saveAlignBtn = el("button",{class:"btn inline", onclick: async (ev)=>{
    const btn = ev.currentTarget;
    const tgtId = alignState.targetId || tgtSel.value;
    // Use freshest copy of the map from state (in case list was refreshed)
    const tgtMap = (ctx.state.maps.list||[]).find(m=>m.id===tgtId) || maps.find(m=>m.id===tgtId);
    if(!tgtMap){ ctx.toast("No target map selected.", true); return; }
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const refId2 = alignState.refId || refSel.value;
      const refMap2 = (ctx.state.maps.list||[]).find(m=>m.id===refId2) || maps.find(m=>m.id===refId2);
      const newStk = Object.assign({}, tgtMap.stack||{},{
        x_offset: alignState.x_offset, y_offset: alignState.y_offset,
        scale: alignState.scale, rotation: alignState.rotation||0,
        scale_x_adj: alignState.scaleX_adj || 1.0,
        ref_ar: refMap2 ? (refMap2.image?.height||600)/(refMap2.image?.width||800) : undefined,
      });
      await ctx.actions.mapsUpdate({
        map_id: tgtMap.id, receivers: tgtMap.receivers||[], calibration: tgtMap.calibration||{},
        notes: tgtMap.notes||"", floor_id: tgtMap.floor_id||"", room_bounds: tgtMap.room_bounds||{},
        stack: newStk,
      });
      // mapsUpdate already fetched fresh list + re-rendered the view;
      // sync alignState rotation from saved value (backend now persists it)
      const saved = (ctx.state.maps.list||[]).find(m=>m.id===tgtId);
      if(saved?.stack) alignState.rotation = saved.stack.rotation ?? alignState.rotation;
      ctx.toast("Alignment saved ✔");
    } catch(e){
      ctx.toast("Save failed: " + String(e), true);
      try{ btn.disabled = false; btn.textContent = "Save Alignment"; } catch(_){}
    }
  }},"Save Alignment");
  ctrlRow.appendChild(saveAlignBtn);
  card.appendChild(ctrlRow);

  // ── Section 3: 3D Isometric Preview ───────────────────────────────────────
  card.appendChild(el("div",{class:"muted",style:"margin-top:24px;font-size:13px;font-weight:600"},"3D Isometric Preview"));
  card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-top:2px"},"Shows all uploaded floor plans stacked by their assigned level. Use the slider to focus on one floor."));

  // Floor focus slider
  if(ctx.state.maps._stackIsoFocus  === undefined) ctx.state.maps._stackIsoFocus  = null;
  if(ctx.state.maps._stackFloorGap  === undefined) ctx.state.maps._stackFloorGap  = 200;
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

  const isoWrap = el("div",{style:"margin-top:8px;overflow:auto;border-radius:8px;background:#071008;padding:8px"});
  const rebuildIso = () => {
    isoWrap.innerHTML = _stackIsoSVG(maps, ctx, levelOptions, ctx.state.maps._stackIsoFocus, ctx.state.maps._stackFloorGap);
  };
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

  if(ctx.state.maps._stackShowRoomList === undefined) ctx.state.maps._stackShowRoomList = false;

  const roomListToggle = el("button",{class:"btn inline", style:"margin-left:auto", onclick:()=>{
    ctx.state.maps._stackShowRoomList = !ctx.state.maps._stackShowRoomList;
    roomListToggle.textContent = ctx.state.maps._stackShowRoomList ? "☰ Hide Room List" : "☰ Room List";
    roomListPanel.style.display = ctx.state.maps._stackShowRoomList ? "block" : "none";
  }}, ctx.state.maps._stackShowRoomList ? "☰ Hide Room List" : "☰ Room List");

  card.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap"},[
    el("span",{class:"muted",style:"font-size:12px"},"Floor:"),
    focusSlider,
    focusLbl,
    el("span",{class:"muted",style:"font-size:12px;margin-left:12px"},"Spacing:"),
    gapSlider,
    gapLbl,
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
        <td style="padding:5px 8px;font-weight:600;color:#e2e8f0">${rr.room}</td>
        <td style="padding:5px 8px;color:#94a3b8">${rr.floor||"—"}</td>
        <td style="padding:5px 8px;color:#94a3b8">${rr.map}</td>`;
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

function _stackIsoSVG(maps, ctx, levelOptions, focusLevel=null, floorGap=200){
  const TILE=260, FLOOR_GAP=floorGap, CX=390, CY=740, W=780, BASE_H=1060;
  const LAYER_PAL = ["#52b788","#f59e0b","#60a5fa","#e879f9","#fb923c","#34d399","#f87171","#a78bfa"];
  const roomColor = ctx.helpers.roomColor;
  const lvlLabel = (z)=>{ const opt=(levelOptions||[]).find(o=>o.value===z); return opt ? opt.label : `L${z}`; };

  const iso = (wx, wy, wz)=>[
    CX + (wx-wy)*TILE*0.866,
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
  const levelColor = (z) => LAYER_PAL[sortedLevels.indexOf(z) % LAYER_PAL.length];
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

    // Merged bounding box using correct CSS-aligned world coords for all four corners of each map
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for(const m of group){
      const stk=m.stack||{}, ox=stk.x_offset||0, oy_=stk.y_offset||0, sc=stk.scale||1.0;
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
      const ox=stk.x_offset||0, oy_=stk.y_offset||0, sc=stk.scale||1.0;
      const sxAdj = stk.scale_x_adj || 1.0;
      const ar=(m.image?.height||600)/(m.image?.width||800);
      const arRef = stk.ref_ar || ar;
      const rotRad = (stk.rotation||0) * Math.PI / 180;
      // Matches CSS transform: scale(sc*sxAdj, sc) with transform-origin:50% 50%
      const mapPt = (px,py) => {
        const dx=(px-0.5)*sc*sxAdj, dy=(py-0.5)*sc*arRef;
        const rx=dx*Math.cos(rotRad)-dy*Math.sin(rotRad);
        const ry=dx*Math.sin(rotRad)+dy*Math.cos(rotRad);
        return [(0.5+ox)+rx, arRef*(0.5+oy_)+ry];
      };

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
    const groupLabel = byLevel.get(z).map(m=>m.name||m.id).join(" + ");
    const ceil0 = byLevel.get(z)[0].stack?.ceiling_height_m || 2.4;
    s += `<circle cx="18" cy="${ly+11}" r="11" fill="${color}" opacity="0.9"/>`;
    s += `<text x="18" y="${ly+15}" text-anchor="middle" fill="#071008" font-size="12" font-weight="700">${i+1}</text>`;
    s += `<text x="36" y="${ly+15}" fill="${color}" font-size="18" font-weight="500">${_escSVG(groupLabel)}</text>`;
    s += `<text x="${W-10}" y="${ly+15}" text-anchor="end" fill="#94a3b8" font-size="15">${_escSVG(lvlLabel(z))} · ${ceil0}m</text>`;
  });

  s += `</svg>`;
  return s;
}

function _escSVG(s){
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ─── Export Helpers ───────────────────────────────────────────────────────────

function _downloadBlob(blob, filename){
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u; a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(u), 3000);
}

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

async function _combinedMapPng(map, ctx){
  const iw = map.image?.width || 800;
  const ih = map.image?.height || 600;
  const canvas = document.createElement("canvas");
  canvas.width = iw; canvas.height = ih;
  const g = canvas.getContext("2d");
  const pngUrl = map.image?.filename ? `/local/padspan_ha/maps/${map.image.filename}` : null;
  if(pngUrl){
    try{ const img = await _loadImage(pngUrl); g.drawImage(img,0,0,iw,ih); }
    catch(e){ g.fillStyle="#071008"; g.fillRect(0,0,iw,ih); }
  } else {
    g.fillStyle="#071008"; g.fillRect(0,0,iw,ih);
  }
  await _drawSvgOnCanvas(g, _buildRoomBoundsSVG(map, ctx, true), iw, ih, 0.8);
  return new Promise(resolve=>canvas.toBlob(resolve,"image/png",0.92));
}

async function _svgStringToPng(svgStr, w, h){
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext("2d");
  g.fillStyle="#071008"; g.fillRect(0,0,w,h);
  await _drawSvgOnCanvas(g, svgStr, w, h, 1.0);
  return new Promise(resolve=>canvas.toBlob(resolve,"image/png",0.95));
}

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
