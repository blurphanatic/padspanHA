
(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    entryId: null,
    snapshot: null,
    mode: "anchor", // anchor | room | calibrate
    selectedAnchor: null,
    draggingAnchor: null,
    roomDraft: [],
    zoom: 1.0,
    panX: 0,
    panY: 0,
    image: new Image(),
    imageLoaded: false,
    imgW: 0,
    imgH: 0,
    hover: {x:0,y:0},
  };

  const canvas = $("mapCanvas");
  const ctx = canvas.getContext("2d");

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * window.devicePixelRatio);
    canvas.height = Math.floor(rect.height * window.devicePixelRatio);
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    draw();
  }
  window.addEventListener("resize", resizeCanvas);

  function setStatus(txt) {
    $("status").textContent = txt;
  }

  async function apiStatus() {
    let url = "/api/padspan_ha/status";
    if (state.entryId) url += "?entry_id=" + encodeURIComponent(state.entryId);
    const r = await fetch(url, {credentials:"same-origin"});
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function apiCommand(body) {
    if (state.entryId && !body.entry_id) body.entry_id = state.entryId;
    const r = await fetch("/api/padspan_ha/command", {
      method:"POST",
      credentials:"same-origin",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function uploadMap() {
    const mapId = $("mapId").value.trim();
    const mapName = $("mapName").value.trim();
    const file = $("mapFile").files[0];
    if (!mapId || !file) {
      alert("map_id and file are required");
      return;
    }
    const fd = new FormData();
    fd.append("map_id", mapId);
    if (mapName) fd.append("name", mapName);
    if (state.entryId) fd.append("entry_id", state.entryId);
    fd.append("file", file);
    const r = await fetch("/api/padspan_ha/map/upload", {
      method:"POST",
      credentials:"same-origin",
      body: fd
    });
    if (!r.ok) throw new Error(await r.text());
    await refreshAll();
  }

  function populateSelectors(snapshot) {
    // entry selector
    const entrySel = $("entryId");
    const allEntries = snapshot.all_entry_ids || [];
    entrySel.innerHTML = "";
    allEntries.forEach((id) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id.slice(0,8);
      if (!state.entryId && id === snapshot.entry_id) state.entryId = id;
      if (id === state.entryId) opt.selected = true;
      entrySel.appendChild(opt);
    });
    if (!state.entryId && allEntries.length) state.entryId = allEntries[0];

    // map selector
    const maps = snapshot.maps || {};
    const mapSel = $("activeMap");
    mapSel.innerHTML = "";
    Object.keys(maps).forEach((mapId) => {
      const m = maps[mapId];
      const opt = document.createElement("option");
      opt.value = mapId;
      opt.textContent = `${m.name || mapId} (${mapId})`;
      if (mapId === snapshot.active_map_id) opt.selected = true;
      mapSel.appendChild(opt);
    });

    // source selector
    const sourceSel = $("sourceId");
    sourceSel.innerHTML = "";
    (snapshot.scanner_sources || []).forEach((src) => {
      const opt = document.createElement("option");
      opt.value = src;
      opt.textContent = src;
      sourceSel.appendChild(opt);
    });

    renderCalPoints();
  }

  function currentMap() {
    const s = state.snapshot;
    if (!s) return null;
    const mapId = s.active_map_id;
    return (s.maps || {})[mapId] || null;
  }

  function ensureImageLoaded() {
    const m = currentMap();
    if (!m || !m.image_url) {
      state.imageLoaded = false;
      draw();
      return;
    }
    if (state.image.src.endsWith(m.image_url)) {
      draw();
      return;
    }
    state.image.onload = () => {
      state.imageLoaded = true;
      state.imgW = state.image.naturalWidth || 1;
      state.imgH = state.image.naturalHeight || 1;
      draw();
    };
    state.image.onerror = () => {
      state.imageLoaded = false;
      draw();
    };
    state.image.src = m.image_url + (m.image_url.includes("?") ? "&" : "?") + "t=" + Date.now();
  }

  function mapToScreen(x, y) {
    return {
      x: x * state.zoom + state.panX,
      y: y * state.zoom + state.panY,
    };
  }

  function screenToMap(x, y) {
    return {
      x: (x - state.panX) / state.zoom,
      y: (y - state.panY) / state.zoom,
    };
  }

  function drawGrid(w, h) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.06)";
    ctx.lineWidth = 1;
    const step = 80 * state.zoom;
    for (let x = state.panX % step; x < w; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = state.panY % step; y < h; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawMapImage() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.fillStyle = "#080b12";
    ctx.fillRect(0,0,w,h);
    drawGrid(w,h);

    if (!state.imageLoaded) {
      ctx.fillStyle = "#8ea0cc";
      ctx.font = "14px sans-serif";
      ctx.fillText("No active map image.", 16, 28);
      return;
    }

    const iw = state.imgW * state.zoom;
    const ih = state.imgH * state.zoom;
    ctx.drawImage(state.image, state.panX, state.panY, iw, ih);
  }

  function drawRooms(map) {
    const rooms = map.rooms || {};
    Object.values(rooms).forEach((room) => {
      const pts = room.points || [];
      if (pts.length < 3) return;
      ctx.beginPath();
      const p0 = mapToScreen(pts[0].x, pts[0].y);
      ctx.moveTo(p0.x,p0.y);
      for (let i=1;i<pts.length;i++){
        const p = mapToScreen(pts[i].x, pts[i].y);
        ctx.lineTo(p.x,p.y);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(255,176,73,.12)";
      ctx.strokeStyle = "rgba(255,176,73,.9)";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      // room label centroid
      let sx=0, sy=0;
      pts.forEach(p=>{sx+=p.x; sy+=p.y});
      const c = mapToScreen(sx/pts.length, sy/pts.length);
      ctx.fillStyle = "#ffcf8a";
      ctx.font = "12px sans-serif";
      ctx.fillText(room.name || room.id, c.x + 6, c.y - 4);
    });

    // Draft polygon
    if (state.mode === "room" && state.roomDraft.length) {
      ctx.beginPath();
      const p0 = mapToScreen(state.roomDraft[0].x, state.roomDraft[0].y);
      ctx.moveTo(p0.x,p0.y);
      for (let i=1;i<state.roomDraft.length;i++){
        const p = mapToScreen(state.roomDraft[i].x, state.roomDraft[i].y);
        ctx.lineTo(p.x,p.y);
      }
      const h = mapToScreen(state.hover.x, state.hover.y);
      ctx.lineTo(h.x,h.y);
      ctx.strokeStyle = "rgba(255,176,73,.95)";
      ctx.setLineDash([6,6]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawAnchors(map) {
    const anchors = map.anchors || {};
    Object.values(anchors).forEach((a) => {
      const p = mapToScreen(a.x, a.y);
      const isSel = state.selectedAnchor === a.source_id;
      ctx.beginPath();
      ctx.arc(p.x, p.y, isSel ? 8 : 6, 0, Math.PI*2);
      ctx.fillStyle = isSel ? "#87c7ff" : "#4ea1ff";
      ctx.fill();
      ctx.strokeStyle = "#0a223d";
      ctx.lineWidth = 2;
      ctx.stroke();

      // anchor label
      const label = a.label || a.source_id;
      ctx.fillStyle = "rgba(10,15,24,.8)";
      ctx.fillRect(p.x + 9, p.y - 14, Math.max(40, label.length * 7.2), 16);
      ctx.strokeStyle = "rgba(78,161,255,.8)";
      ctx.strokeRect(p.x + 9, p.y - 14, Math.max(40, label.length * 7.2), 16);
      ctx.fillStyle = "#d6e9ff";
      ctx.font = "11px sans-serif";
      ctx.fillText(label, p.x + 13, p.y - 2);
    });
  }

  function drawDevices(snapshot) {
    (snapshot.devices || []).forEach((d) => {
      const p = d.position;
      if (!p || p.map_id !== snapshot.active_map_id) return;
      const s = mapToScreen(p.x, p.y);
      const r = (p.heat_radius || 24) * state.zoom * 0.5;
      // heat confidence circle
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI*2);
      ctx.fillStyle = "rgba(39,210,141,.15)";
      ctx.fill();
      ctx.strokeStyle = "rgba(39,210,141,.65)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(s.x, s.y, 5, 0, Math.PI*2);
      ctx.fillStyle = "#27d28d";
      ctx.fill();

      ctx.fillStyle = "rgba(9,16,20,.85)";
      const tag = `${d.name || d.address}  ${(p.confidence*100).toFixed(0)}%`;
      ctx.fillRect(s.x + 8, s.y + 6, Math.max(60, tag.length*6.8), 15);
      ctx.strokeStyle = "rgba(39,210,141,.8)";
      ctx.strokeRect(s.x + 8, s.y + 6, Math.max(60, tag.length*6.8), 15);
      ctx.fillStyle = "#d8ffe9";
      ctx.font = "11px sans-serif";
      ctx.fillText(tag, s.x + 11, s.y + 17);
    });
  }

  function drawCalibration(map) {
    const cal = (map.calibration || {});
    const pts = cal.captured_points || [];
    pts.forEach((p, idx) => {
      const s = mapToScreen(p.image_x, p.image_y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 5, 0, Math.PI*2);
      ctx.fillStyle = "#ff6d7a";
      ctx.fill();
      ctx.fillStyle = "#ffd6db";
      ctx.font = "11px sans-serif";
      ctx.fillText(`#${idx+1}`, s.x + 8, s.y - 8);
    });
  }

  function draw() {
    drawMapImage();
    if (!state.snapshot) return;
    const map = currentMap();
    if (!map) return;
    drawRooms(map);
    drawAnchors(map);
    drawDevices(state.snapshot);
    drawCalibration(map);
  }

  function nearestAnchor(mx, my, map) {
    let best = null;
    const anchors = map.anchors || {};
    Object.values(anchors).forEach((a) => {
      const dx = a.x - mx, dy = a.y - my;
      const d = Math.sqrt(dx*dx + dy*dy);
      if (!best || d < best.d) best = {d, anchor: a};
    });
    return best && best.d < (14 / state.zoom) ? best.anchor : null;
  }

  async function placeAnchor(mx, my) {
    const mapId = $("activeMap").value;
    const sourceId = $("sourceId").value.trim();
    if (!mapId || !sourceId) {
      alert("Select active map and source_id first.");
      return;
    }
    const label = $("anchorLabel").value.trim() || sourceId;
    await apiCommand({
      action:"set_anchor",
      map_id: mapId,
      source_id: sourceId,
      label,
      x: mx,
      y: my,
      z: 0,
      weight: 1.0
    });
    await refreshAll();
  }

  async function deleteSelectedAnchor() {
    const mapId = $("activeMap").value;
    if (!mapId || !state.selectedAnchor) return;
    await apiCommand({
      action:"delete_anchor",
      map_id: mapId,
      source_id: state.selectedAnchor
    });
    state.selectedAnchor = null;
    await refreshAll();
  }

  async function saveRoom() {
    const mapId = $("activeMap").value;
    const roomId = $("roomId").value.trim();
    const roomName = $("roomName").value.trim() || roomId;
    if (!mapId || !roomId || state.roomDraft.length < 3) {
      alert("Need map_id, room_id, and at least 3 points.");
      return;
    }
    await apiCommand({
      action:"set_room",
      map_id: mapId,
      room_id: roomId,
      name: roomName,
      points: state.roomDraft,
    });
    state.roomDraft = [];
    await refreshAll();
  }

  async function deleteRoom() {
    const mapId = $("activeMap").value;
    const roomId = $("roomId").value.trim();
    if (!mapId || !roomId) return;
    await apiCommand({
      action:"delete_room",
      map_id: mapId,
      room_id: roomId,
    });
    await refreshAll();
  }

  function renderCalPoints() {
    const el = $("calPoints");
    const m = currentMap();
    if (!m) {
      el.innerHTML = "<div class='pt'>No active map.</div>";
      return;
    }
    const pts = ((m.calibration || {}).captured_points) || [];
    if (!pts.length) {
      el.innerHTML = "<div class='pt'>No points captured.</div>";
      return;
    }
    el.innerHTML = pts.map((p,i)=>
      `<div class="pt">#${i+1} image(${p.image_x.toFixed(1)}, ${p.image_y.toFixed(1)}) → real(${p.real_x.toFixed(2)}, ${p.real_y.toFixed(2)})</div>`
    ).join("");
  }

  async function clickCalibration(mx, my) {
    const mapId = $("activeMap").value;
    if (!mapId) return;
    const rx = prompt("Real-world X for this point:");
    if (rx === null) return;
    const ry = prompt("Real-world Y for this point:");
    if (ry === null) return;
    const realX = parseFloat(rx);
    const realY = parseFloat(ry);
    if (Number.isNaN(realX) || Number.isNaN(realY)) {
      alert("Invalid real-world coordinates.");
      return;
    }
    await apiCommand({
      action:"capture_calibration",
      map_id: mapId,
      image_x: mx,
      image_y: my,
      real_x: realX,
      real_y: realY,
    });
    await refreshAll();
  }

  function bindEvents() {
    $("refresh").onclick = refreshAll;
    $("uploadMap").onclick = async () => {
      try { await uploadMap(); setStatus("Map uploaded."); }
      catch (e) { setStatus("Upload error: " + e.message); }
    };

    $("setActive").onclick = async () => {
      const mapId = $("activeMap").value;
      if (!mapId) return;
      await apiCommand({action:"set_active_map", map_id: mapId});
      await refreshAll();
    };

    $("reloadBle").onclick = async () => {
      await apiCommand({action:"reload_ble_cache"});
      await refreshAll();
    };

    $("entryId").onchange = async () => {
      state.entryId = $("entryId").value;
      await refreshAll();
    };

    $("modeAnchor").onclick = () => setMode("anchor");
    $("modeRoom").onclick = () => setMode("room");
    $("modeCal").onclick = () => setMode("calibrate");

    $("saveRoom").onclick = async () => {
      try { await saveRoom(); } catch(e){ setStatus(e.message); }
    };
    $("clearRoom").onclick = () => { state.roomDraft = []; draw(); };
    $("deleteRoom").onclick = async () => {
      try { await deleteRoom(); } catch(e){ setStatus(e.message); }
    };

    $("deleteAnchor").onclick = async () => {
      try { await deleteSelectedAnchor(); } catch(e){ setStatus(e.message); }
    };

    $("startCal").onclick = async () => {
      const mapId = $("activeMap").value;
      if (!mapId) return;
      await apiCommand({action:"start_calibration", map_id: mapId});
      await refreshAll();
    };

    $("finishCal").onclick = async () => {
      const mapId = $("activeMap").value;
      if (!mapId) return;
      try {
        await apiCommand({action:"finish_calibration", map_id: mapId});
      } catch(e){
        alert(e.message);
      }
      await refreshAll();
    };

    $("zoomIn").onclick = () => { state.zoom *= 1.1; draw(); };
    $("zoomOut").onclick = () => { state.zoom /= 1.1; draw(); };
    $("zoomReset").onclick = () => { state.zoom = 1.0; state.panX = 0; state.panY = 0; draw(); };

    let panning = false;
    let last = null;

    canvas.addEventListener("mousedown", (ev) => {
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const mapPt = screenToMap(sx, sy);

      const map = currentMap();
      if (!map) return;

      if (state.mode === "anchor") {
        const hit = nearestAnchor(mapPt.x, mapPt.y, map);
        if (hit) {
          state.selectedAnchor = hit.source_id;
          state.draggingAnchor = hit.source_id;
          draw();
          return;
        }
      }

      if (ev.button === 1 || ev.shiftKey) {
        panning = true;
        last = {x: sx, y: sy};
      }
    });

    canvas.addEventListener("mousemove", (ev) => {
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const mapPt = screenToMap(sx, sy);
      state.hover = mapPt;

      if (panning && last) {
        state.panX += sx - last.x;
        state.panY += sy - last.y;
        last = {x:sx,y:sy};
        draw();
        return;
      }

      if (state.draggingAnchor && state.mode === "anchor") {
        const map = currentMap();
        if (!map) return;
        const a = (map.anchors || {})[state.draggingAnchor];
        if (!a) return;
        a.x = mapPt.x; a.y = mapPt.y;
        draw();
      } else {
        draw();
      }
    });

    canvas.addEventListener("mouseup", async (ev) => {
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const mapPt = screenToMap(sx, sy);

      if (state.draggingAnchor) {
        const mapId = $("activeMap").value;
        const src = state.draggingAnchor;
        const map = currentMap();
        const a = map && (map.anchors || {})[src];
        state.draggingAnchor = null;
        if (a) {
          await apiCommand({
            action:"set_anchor",
            map_id: mapId,
            source_id: src,
            label: a.label || src,
            x: a.x, y: a.y, z: a.z || 0, weight: a.weight || 1.0
          });
          await refreshAll();
          return;
        }
      }

      panning = false;
      last = null;
    });

    canvas.addEventListener("click", async (ev) => {
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const mapPt = screenToMap(sx, sy);
      const map = currentMap();
      if (!map) return;

      if (state.mode === "anchor") {
        const hit = nearestAnchor(mapPt.x, mapPt.y, map);
        if (hit) {
          state.selectedAnchor = hit.source_id;
          $("sourceId").value = hit.source_id;
          $("anchorLabel").value = hit.label || hit.source_id;
          draw();
        } else {
          await placeAnchor(mapPt.x, mapPt.y);
        }
      } else if (state.mode === "room") {
        state.roomDraft.push({x: mapPt.x, y: mapPt.y});
        draw();
      } else if (state.mode === "calibrate") {
        await clickCalibration(mapPt.x, mapPt.y);
      }
    });

    canvas.addEventListener("dblclick", (ev) => {
      if (state.mode !== "room" || state.roomDraft.length < 3) return;
      draw();
    });

    canvas.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const delta = ev.deltaY < 0 ? 1.06 : 0.94;
      state.zoom *= delta;
      draw();
    }, {passive:false});
  }

  function setMode(mode) {
    state.mode = mode;
    $("modePill").textContent = "Mode: " + mode;
    draw();
  }

  async function refreshAll() {
    try {
      const snapshot = await apiStatus();
      state.snapshot = snapshot;
      if (!state.entryId) state.entryId = snapshot.entry_id;
      populateSelectors(snapshot);
      ensureImageLoaded();

      const lines = [
        `entry: ${snapshot.entry_id}`,
        `scanners: ${snapshot.scanner_count_all} (${(snapshot.scanner_sources||[]).join(", ")})`,
        `active devices: ${snapshot.active_now}`,
        `seen ever: ${snapshot.seen_ever}`,
        `active map: ${snapshot.active_map_id || "none"}`,
      ];
      setStatus(lines.join("\n"));
      draw();
    } catch (e) {
      setStatus("Refresh error: " + e.message);
    }
  }

  bindEvents();
  resizeCanvas();
  refreshAll();
  setInterval(refreshAll, 3000);
})();
