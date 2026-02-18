export function render(ctx){
  const { el, esc, pill } = ctx.helpers;
  const host = ctx.host;

  const root = el("section",{id:"maps"});
  root.className = ctx.state.view==="maps" ? "" : "hidden";

  const maps = ctx.state.maps || [];
  const active = ctx.state.activeMap || null;

  const intro = el("div",{class:"card"},[
    el("div",{class:"muted"},"Mapping suite"),
    el("div",{class:"mono"},
`Upload a floorplan image (PNG/JPG/WEBP/GIF) → auto-resized working PNG.
Drop BLE receivers onto the plan and save positions (stored normalized 0..1).
Download PNG + JSON for backups and testing.`),
  ]);

  // --- Upload tools ---
  const uploadCard = el("div",{class:"card"});
  uploadCard.appendChild(el("div",{class:"muted"},"Upload floorplan / map"));

  const row1 = el("div",{class:"row"});
  const name = el("input",{type:"text", placeholder:"Map name (optional)"});
  name.style.maxWidth="420px";
  const maxDim = el("select",{});
  [["1024","Max 1024px"],["2048","Max 2048px (recommended)"],["3072","Max 3072px"],["4096","Max 4096px (large)"]]
    .forEach(([v,l])=>maxDim.appendChild(el("option",{value:v},l)));
  maxDim.value = "2048";
  row1.appendChild(name);
  row1.appendChild(maxDim);

  const file = el("input",{type:"file", accept:"image/*"});
  const status = el("div",{class:"mono"},"Pick an image file. It will be converted to a resized PNG for consistent rendering.");
  const btn = el("button",{class:"btn"},"Upload");
  btn.disabled = true;

  file.addEventListener("change", ()=>{ btn.disabled = !(file.files && file.files.length); });

  btn.addEventListener("click", async ()=>{
    if(!file.files || !file.files.length) return;
    const f = file.files[0];
    const mapName = (name.value||"").trim() || (f.name || "Map").replace(/\.[^.]+$/,"");
    const md = parseInt(maxDim.value, 10);

    try{
      status.textContent = "Loading image…";
      const out = await toWorkingPng(f, md);
      status.textContent = `Converted: ${out.width}×${out.height} (PNG). Uploading…`;

      const payload = {
        name: mapName,
        filename: f.name || "map",
        mime: f.type || "image/*",
        width: out.width,
        height: out.height,
        data_base64: out.pngBase64,
      };

      const created = await host.mapsUpload(payload);
      status.textContent = `Uploaded: ${created.name} (${created.image.width}×${created.image.height})`;
      name.value = "";
      file.value = "";
      btn.disabled = true;
    } catch(e){
      status.textContent = `Upload failed: ${e}`;
    }
  });

  uploadCard.appendChild(row1);
  uploadCard.appendChild(file);
  uploadCard.appendChild(btn);
  uploadCard.appendChild(status);

  // --- Map list ---
  const listCard = el("div",{class:"card"});
  listCard.appendChild(el("div",{class:"muted"},"Maps library"));
  listCard.appendChild(el("div",{class:"row"},[
    el("button",{class:"btn inline", onclick: async()=>{ await host.mapsRefresh(); host._renderAllViews(); }},"Refresh"),
    pill(`${maps.length} map(s)`),
  ]));

  const list = el("div",{class:"mono"});
  list.style.whiteSpace="normal";
  list.style.background="transparent";
  list.style.border="0";
  list.style.padding="0";
  list.style.marginTop="8px";

  if(!maps.length){
    list.appendChild(el("div",{class:"item"},"No maps yet. Upload one above."));
  } else {
    for(const m of maps){
      const card = el("div",{class:"card"});
      const title = el("div",{style:"display:flex;align-items:center;justify-content:space-between;gap:10px"});
      title.appendChild(el("div",{}, esc(m.name || m.id)));
      title.appendChild(el("div",{class:"muted"}, `${(m.image?.width||0)}×${(m.image?.height||0)} • RX: ${(m.receivers||[]).length}`));
      card.appendChild(title);

      const btnRow = el("div",{class:"toolbar"},[
        el("button",{class:"btn inline", onclick: async()=>{ await host.mapsSelect(m.id); }},"Open"),
        el("button",{class:"btn inline", onclick: async()=>{ await host.mapsDownloadPng(m); }},"Download PNG"),
        el("button",{class:"btn inline", onclick: async()=>{ await host.mapsDownloadJson(m); }},"Download JSON"),
        el("button",{class:"btn inline", onclick: async()=>{ if(confirm("Delete this map?")) await host.mapsDelete(m.id); }},"Delete"),
      ]);
      card.appendChild(btnRow);
      list.appendChild(card);
    }
  }

  listCard.appendChild(list);

  const topGrid = el("div",{class:"grid"},[uploadCard, listCard]);

  root.appendChild(intro);
  root.appendChild(topGrid);

  // --- Editor ---
  const editorGrid = el("div",{class:"grid"});
  const editorCard = el("div",{class:"card"});
  const rCard = el("div",{class:"card"});

  editorCard.appendChild(el("div",{class:"muted"},"Map editor (drop BLE receivers)"));
  rCard.appendChild(el("div",{class:"muted"},"Receivers"));

  if(!active){
    editorCard.appendChild(el("div",{class:"mono"},"Select a map from the library to edit receiver placements."));
    rCard.appendChild(el("div",{class:"mono"},""));
    editorGrid.appendChild(editorCard);
    editorGrid.appendChild(rCard);
    root.appendChild(editorGrid);
    return root;
  }

  const draft = ctx.state.mapDraft || { receivers: [] };

  editorCard.appendChild(el("div",{class:"row"},[
    pill(`Active: ${active.name || active.id}`),
    pill(`Receivers: ${(draft.receivers||[]).length}`),
    pill(active.calibration?.px_per_meter ? `Scale: ${Math.round(active.calibration.px_per_meter)} px/m` : "Scale: not set"),
  ]));

  const tools = el("div",{class:"toolbar"});
  const btnSave = el("button",{class:"btn inline"},"Save");
  const btnReset = el("button",{class:"btn inline"},"Reset");
  const btnCal = el("button",{class:"btn inline"},"Calibrate scale");
  const btnGrid = el("button",{class:"btn inline"},"Toggle grid");
  const btnSnap = el("button",{class:"btn inline"},"Toggle snap");
  tools.appendChild(btnSave);
  tools.appendChild(btnReset);
  tools.appendChild(btnCal);
  tools.appendChild(btnGrid);
  tools.appendChild(btnSnap);

  const notes = el("input",{type:"text", placeholder:"Notes (optional)"});
  notes.value = draft.notes || "";
  notes.addEventListener("input", ()=>{ draft.notes = notes.value; });

  editorCard.appendChild(tools);
  editorCard.appendChild(notes);

  const wrap = el("div",{style:"border:1px solid #24324b;border-radius:12px;overflow:hidden;background:#0d1628;position:relative"});
  wrap.style.minHeight="420px";
  const canvas = el("canvas",{});
  canvas.style.width="100%";
  canvas.style.height="640px";
  wrap.appendChild(canvas);
  editorCard.appendChild(wrap);
  editorCard.appendChild(el("div",{class:"muted"},"Wheel zoom • drag to pan • drag receiver to move • double-click add • right-click delete"));

  const rList = el("div",{class:"mono"});
  rList.style.whiteSpace="normal";
  rList.style.background="transparent";
  rList.style.border="0";
  rList.style.padding="0";
  rCard.appendChild(rList);

  // --- editor state ---
  const st = {
    img: new Image(),
    loaded: false,
    iw: active.image?.width || 1,
    ih: active.image?.height || 1,
    zoom: 1,
    panX: 10,
    panY: 10,
    dragging: false,
    dragType: null,
    dragRxId: null,
    lastX: 0,
    lastY: 0,
    selectedRxId: null,
    showGrid: !!ctx.state.mapUi?.showGrid,
    snap: !!ctx.state.mapUi?.snap,
    calMode: false,
    calP1: null,
    calP2: null,
  };

  function receivers(){ return draft.receivers || []; }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

  function screenToMap(x,y){
    const mx = (x - st.panX) / st.zoom;
    const my = (y - st.panY) / st.zoom;
    return { mx, my };
  }
  function mapToScreen(mx,my){
    return { x: mx*st.zoom + st.panX, y: my*st.zoom + st.panY };
  }
  function rxHit(px,py){
    const rad = 10;
    for(const r of receivers()){
      const mx = r.x * st.iw;
      const my = r.y * st.ih;
      const s = mapToScreen(mx,my);
      const dx = s.x - px, dy = s.y - py;
      if(dx*dx+dy*dy <= rad*rad) return r;
    }
    return null;
  }

  function renderReceiverList(){
    rList.innerHTML = "";
    const recs = receivers();
    if(!recs.length){
      rList.appendChild(el("div",{class:"item"},"No receivers yet. Double-click on the map to add one."));
      return;
    }
    for(const r of recs){
      const card = el("div",{class:"card"});
      const head = el("div",{style:"display:flex;justify-content:space-between;gap:10px;align-items:center"});
      head.appendChild(el("div",{}, esc(r.label || r.id)));
      head.appendChild(el("div",{class:"muted"}, `x=${r.x.toFixed(3)} y=${r.y.toFixed(3)}`));
      card.appendChild(head);

      const idIn = el("input",{type:"text", value:r.id||"", placeholder:"id"});
      const labIn = el("input",{type:"text", value:r.label||"", placeholder:"label"});
      idIn.addEventListener("input", ()=>{ r.id = idIn.value; });
      labIn.addEventListener("input", ()=>{ r.label = labIn.value; draw(); });

      const btnSel = el("button",{class:"btn inline"},"Select");
      const btnDel = el("button",{class:"btn inline"},"Delete");
      btnSel.addEventListener("click", ()=>{ st.selectedRxId = r.id; draw(); });
      btnDel.addEventListener("click", ()=>{
        const idx = recs.indexOf(r);
        if(idx>=0){ recs.splice(idx,1); if(st.selectedRxId===r.id) st.selectedRxId=null; draw(); }
      });

      card.appendChild(idIn);
      card.appendChild(labIn);
      card.appendChild(el("div",{class:"toolbar"},[btnSel, btnDel]));
      rList.appendChild(card);
    }
  }

  function applySnap(nx, ny){
    if(!st.snap) return {nx, ny};
    const step = 0.01;
    return { nx: Math.round(nx/step)*step, ny: Math.round(ny/step)*step };
  }

  function draw(){
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cw = Math.max(10, Math.floor(rect.width * dpr));
    const ch = Math.max(10, Math.floor(rect.height * dpr));
    if(canvas.width !== cw || canvas.height !== ch){
      canvas.width = cw; canvas.height = ch;
    }
    const g = canvas.getContext("2d");
    g.clearRect(0,0,canvas.width,canvas.height);
    g.fillStyle="#0d1628";
    g.fillRect(0,0,canvas.width,canvas.height);

    if(st.loaded){
      g.save();
      g.translate(st.panX*dpr, st.panY*dpr);
      g.scale(st.zoom*dpr, st.zoom*dpr);
      g.drawImage(st.img, 0, 0, st.iw, st.ih);

      if(st.showGrid){
        const step = 100;
        g.strokeStyle="rgba(156,177,211,0.18)";
        g.lineWidth=1;
        for(let x=0;x<st.iw;x+=step){ g.beginPath(); g.moveTo(x,0); g.lineTo(x,st.ih); g.stroke(); }
        for(let y=0;y<st.ih;y+=step){ g.beginPath(); g.moveTo(0,y); g.lineTo(st.iw,y); g.stroke(); }
      }

      for(const r of receivers()){
        const mx = r.x*st.iw;
        const my = r.y*st.ih;
        const sel = (r.id===st.selectedRxId);
        g.beginPath();
        g.fillStyle = sel ? "#7aa2ff" : "#9cb1d3";
        g.strokeStyle = sel ? "#ffffff" : "#0b1220";
        g.lineWidth = 2;
        g.arc(mx,my,8,0,Math.PI*2);
        g.fill(); g.stroke();
        g.font="12px Inter, Arial";
        g.fillStyle="rgba(226,232,240,0.95)";
        g.fillText(r.label || r.id, mx+12, my+4);
      }

      if(st.calMode && st.calP1){
        g.fillStyle="#ffcc66";
        g.beginPath(); g.arc(st.calP1.mx, st.calP1.my, 6, 0, Math.PI*2); g.fill();
      }
      if(st.calMode && st.calP1 && st.calP2){
        g.strokeStyle="#ffcc66"; g.lineWidth=2;
        g.beginPath(); g.moveTo(st.calP1.mx, st.calP1.my); g.lineTo(st.calP2.mx, st.calP2.my); g.stroke();
        const dx=st.calP2.mx-st.calP1.mx, dy=st.calP2.my-st.calP1.my;
        const dist=Math.sqrt(dx*dx+dy*dy);
        g.fillStyle="#ffcc66";
        g.fillText(`${Math.round(dist)} px`, st.calP2.mx+8, st.calP2.my+4);
      }

      g.restore();
    } else {
      g.fillStyle="#9cb1d3";
      g.font="14px Inter, Arial";
      g.fillText("Loading map image…", 18, 30);
    }

    renderReceiverList();
  }

  function addReceiverAt(mx,my){
    const recs = receivers();
    const n = recs.length + 1;
    const id = `rx-${String(n).padStart(2,"0")}`;
    const label = prompt("Receiver label?", `Receiver ${n}`) || `Receiver ${n}`;
    let nx = clamp(mx/st.iw, 0, 1);
    let ny = clamp(my/st.ih, 0, 1);
    const snapped = applySnap(nx, ny);
    recs.push({ id, label, x: clamp(snapped.nx,0,1), y: clamp(snapped.ny,0,1) });
    st.selectedRxId = id;
    draw();
  }

  // Load image
  st.img.onload = ()=>{
    st.loaded = true;
    st.iw = active.image?.width || st.img.naturalWidth || 1;
    st.ih = active.image?.height || st.img.naturalHeight || 1;
    // fit
    const rect = canvas.getBoundingClientRect();
    const s = Math.min(rect.width / st.iw, rect.height / st.ih);
    st.zoom = clamp(s, 0.15, 6);
    st.panX = 10; st.panY = 10;
    draw();
  };
  st.img.onerror = ()=>{ st.loaded=false; draw(); };
  st.img.src = host.mapLocalImageUrl(active);

  canvas.addEventListener("wheel", (ev)=>{
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const px = (ev.clientX - rect.left);
    const py = (ev.clientY - rect.top);
    const delta = ev.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = clamp(st.zoom * delta, 0.2, 8);
    const before = screenToMap(px, py);
    st.zoom = newZoom;
    const after = screenToMap(px, py);
    st.panX += (after.mx - before.mx) * st.zoom;
    st.panY += (after.my - before.my) * st.zoom;
    draw();
  }, {passive:false});

  canvas.addEventListener("mousedown",(ev)=>{
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const px = (ev.clientX - rect.left);
    const py = (ev.clientY - rect.top);
    st.lastX = px; st.lastY = py;
    const hit = rxHit(px, py);
    if(hit){
      st.dragging=true; st.dragType="rx"; st.dragRxId=hit.id; st.selectedRxId=hit.id;
    } else {
      st.dragging=true; st.dragType="pan";
    }
    draw();
  });

  canvas.addEventListener("mousemove",(ev)=>{
    if(!st.dragging) return;
    const rect = canvas.getBoundingClientRect();
    const px = (ev.clientX - rect.left);
    const py = (ev.clientY - rect.top);
    const dx = px - st.lastX, dy = py - st.lastY;
    st.lastX = px; st.lastY = py;
    if(st.dragType==="pan"){
      st.panX += dx; st.panY += dy;
    } else if(st.dragType==="rx"){
      const recs = receivers();
      const r = recs.find(x=>x.id===st.dragRxId);
      if(r){
        const mp = screenToMap(px, py);
        let nx = clamp(mp.mx/st.iw,0,1);
        let ny = clamp(mp.my/st.ih,0,1);
        const snapped = applySnap(nx, ny);
        r.x = clamp(snapped.nx,0,1);
        r.y = clamp(snapped.ny,0,1);
      }
    }
    draw();
  });

  ["mouseup","mouseleave"].forEach(evt=>{
    canvas.addEventListener(evt, ()=>{ st.dragging=false; st.dragType=null; st.dragRxId=null; });
  });

  canvas.addEventListener("dblclick",(ev)=>{
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const px = (ev.clientX - rect.left);
    const py = (ev.clientY - rect.top);
    const mp = screenToMap(px, py);
    if(st.calMode){
      if(!st.calP1) st.calP1 = mp;
      else st.calP2 = mp;
      draw();
      if(st.calP1 && st.calP2){
        const dx = st.calP2.mx - st.calP1.mx;
        const dy = st.calP2.my - st.calP1.my;
        const distPx = Math.sqrt(dx*dx+dy*dy);
        const meters = parseFloat(prompt("Enter real-world distance in meters:", "5") || "0");
        if(meters>0 && distPx>0){
          const ppm = distPx / meters;
          draft.calibration = { mode:"px_per_meter", px_per_meter: ppm, reference_points: [{x1:st.calP1.mx,y1:st.calP1.my,x2:st.calP2.mx,y2:st.calP2.my, meters}] };
        }
        st.calMode=false; st.calP1=null; st.calP2=null;
        draw();
      }
      return;
    }
    addReceiverAt(mp.mx, mp.my);
  });

  canvas.addEventListener("contextmenu",(ev)=>{
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const px = (ev.clientX - rect.left);
    const py = (ev.clientY - rect.top);
    const hit = rxHit(px, py);
    if(hit){
      const recs = receivers();
      const idx = recs.indexOf(hit);
      if(idx>=0){
        recs.splice(idx,1);
        if(st.selectedRxId===hit.id) st.selectedRxId=null;
        draw();
      }
    }
  });

  btnReset.addEventListener("click", ()=>{
    ctx.state.mapDraft = {
      receivers: (active.receivers||[]).map(r=>({...r})),
      calibration: active.calibration || { mode:"none", px_per_meter:null, reference_points: [] },
      notes: active.notes || "",
    };
    st.selectedRxId=null;
    draw();
  });

  btnSave.addEventListener("click", async()=>{
    const meta = {
      notes: ctx.state.mapDraft.notes || "",
      receivers: ctx.state.mapDraft.receivers || [],
      calibration: ctx.state.mapDraft.calibration || { mode:"none" },
    };
    await host.mapsSaveMeta(active.id, meta);
    alert("Saved.");
  });

  btnCal.addEventListener("click", ()=>{
    st.calMode = !st.calMode;
    st.calP1=null; st.calP2=null;
    alert(st.calMode ? "Calibration mode: double-click two points to draw a reference line." : "Calibration mode off.");
    draw();
  });

  btnGrid.addEventListener("click", ()=>{ st.showGrid = !st.showGrid; ctx.state.mapUi.showGrid = st.showGrid; draw(); });
  btnSnap.addEventListener("click", ()=>{ st.snap = !st.snap; ctx.state.mapUi.snap = st.snap; draw(); });

  editorGrid.appendChild(editorCard);
  editorGrid.appendChild(rCard);
  root.appendChild(editorGrid);

  setTimeout(draw, 50);
  return root;
}

async function toWorkingPng(file, maxDim){
  const url = URL.createObjectURL(file);
  try{
    const img = await loadImage(url);
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDim / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    g.drawImage(img, 0, 0, w, h);

    const blob = await new Promise((resolve)=>canvas.toBlob(resolve, "image/png"));
    const b64 = await blobToBase64(blob);
    const pngBase64 = b64.split(",")[1] || "";
    return { pngBase64, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=>resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function blobToBase64(blob){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = ()=>resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
