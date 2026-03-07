// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Traceback — NVR-style playback of object movement history on the 3D iso map.
 * Extracted from overview.js into its own dedicated tab.
 */

export function render(ctx) {
  const { el, esc: _esc } = ctx.helpers;
  const roomColorFn = ctx.helpers.roomColor;
  const liveSnap = ctx.state.live?.snapshot || null;
  const radios = (liveSnap?.ble?.radios) || [];

  const outer = document.createElement("div");
  outer.style.cssText = "padding:0";

  // ── 3D Iso map setup (mirrors overview) ────────────────────────────────
  const maps_list = (ctx.state.maps?.list) || [];
  if (!maps_list.length) {
    const msg = document.createElement("div");
    msg.className = "card";
    msg.style.cssText = "text-align:center;padding:30px;color:#94a3b8";
    msg.textContent = "No maps uploaded yet. Go to Maps to add floor plans, then use Traceback to replay object movement.";
    outer.appendChild(msg);
    return outer;
  }

  const TILE = 220, CX = 380, CY = 590, W = 760, BASE_H = 940;
  const LAYER_PAL = ["#52b788","#f59e0b","#60a5fa","#e879f9","#fb923c","#34d399","#f87171","#a78bfa"];

  const floorGap = ctx.state._overviewFloorGap ?? ctx.state.settings?.overview_iso_floor_gap ?? 150;
  const horizGap = ctx.state._overviewHorizGap ?? ctx.state.settings?.overview_iso_horiz_gap ?? 0;
  let _ovFG = floorGap, _ovHG = horizGap;

  const iso = (wx, wy, wz) => [CX + (wx - wy) * TILE * 0.866 + wz * _ovHG, CY + (wx + wy) * TILE * 0.5 - wz * _ovFG];
  const pt  = c => `${Math.round(c[0])},${Math.round(c[1])}`;
  const pts = cs => cs.map(pt).join(" ");

  // Filter hidden maps
  const hiddenIds = ctx.state.maps._hiddenMapIds || new Set();
  const sorted = [...maps_list].filter(m => !hiddenIds.has(m.id)).sort((a, b) => (a.stack?.z_level || 0) - (b.stack?.z_level || 0));

  // Group maps by z_level
  const byLevel = new Map();
  for (const m of sorted) {
    const z = m.stack?.z_level ?? 0;
    if (!byLevel.has(z)) byLevel.set(z, []);
    byLevel.get(z).push(m);
  }
  const sortedIsoLevels = [...byLevel.keys()].sort((a, b) => a - b);
  const levelColor = (z) => LAYER_PAL[sortedIsoLevels.indexOf(z) % LAYER_PAL.length];
  const LEGEND_H = sortedIsoLevels.length * 30 + 24;

  // Build room centroid iso positions
  const roomIsoPos = {};
  for (const m of sorted) {
    const stk = m.stack || {}, z = stk.z_level || 0, ox = stk.x_offset || 0, oy_ = stk.y_offset || 0, sc = stk.scale || 1.0;
    const ar = (m.image?.height || 600) / (m.image?.width || 800);
    for (const [room, b] of Object.entries(m.room_bounds || {})) {
      if (!b || b.type !== "poly" || !Array.isArray(b.points) || b.points.length < 3) continue;
      const cx = b.points.reduce((a, p) => a + p[0], 0) / b.points.length;
      const cy = b.points.reduce((a, p) => a + p[1], 0) / b.points.length;
      roomIsoPos[room] = iso(ox + cx * sc, oy_ + cy * sc * ar, z);
    }
  }

  // Slider positions for floor focus
  const _isoPos = [null];
  for (let i = 0; i < sortedIsoLevels.length; i++) {
    _isoPos.push(sortedIsoLevels[i]);
    if (i < sortedIsoLevels.length - 1) _isoPos.push([sortedIsoLevels[i], sortedIsoLevels[i + 1]]);
  }
  const focusIdx = ctx.state._overviewIsoFocusIdx ?? 0;
  const focusZ = _isoPos[Math.max(0, Math.min(focusIdx, _isoPos.length - 1))];

  // ── Traceback state ────────────────────────────────────────────────────
  if (!ctx.state._traceback) ctx.state._traceback = {
    playing: false,
    playDurationS: 300,  // how long full playback takes (1 min to 1 hr slider)
    frameIdx: 0,
    frames: [],
    range: null,
    objKeys: [],
    filterKey: null,
    filterName: "All objects",
    rangePreset: 300,
    startTs: null,
    endTs: null,
    _animTimer: null,
  };
  const tb = ctx.state._traceback;

  function _fmtTime(ts) {
    if (!ts) return "--";
    return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  function _fmtDate(ts) {
    if (!ts) return "--";
    const d = new Date(ts * 1000);
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function _fmtDuration(sec) {
    if (sec < 60) return `${Math.round(sec)}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
    return `${(sec / 86400).toFixed(1)}d`;
  }

  // ── Data loading ───────────────────────────────────────────────────────
  async function _loadTracebackData() {
    try {
      const now = Date.now() / 1000;
      const startTs = tb.startTs || (now - tb.rangePreset);
      const endTs = tb.endTs || now;
      const res = await ctx.actions.wsCall("padspan_ha/traceback_get", {
        start_ts: startTs,
        end_ts: endTs,
        obj_key: tb.filterKey || undefined,
        max_frames: 4000,
      });
      tb.frames = res.frames || [];
      tb.range = res.range || { start: 0, end: 0, count: 0 };
      tb.frameIdx = 0;

      // If filtering by object and no frames found, auto-expand to full data range
      if (tb.filterKey && !tb.frames.length && tb.range && tb.range.start > 0) {
        const fullRes = await ctx.actions.wsCall("padspan_ha/traceback_get", {
          start_ts: tb.range.start,
          end_ts: tb.range.end || now,
          obj_key: tb.filterKey,
          max_frames: 4000,
        });
        tb.frames = fullRes.frames || [];
        if (tb.frames.length) {
          tb._autoExpanded = true;
        }
      } else {
        tb._autoExpanded = false;
      }

      const objRes = await ctx.actions.wsCall("padspan_ha/traceback_objects", {});
      tb.objKeys = objRes.objects || [];
      tb.range = objRes.range || tb.range;
    } catch (e) {
      console.error("Traceback load error:", e);
      tb.frames = [];
    }
  }

  // ── SVG builder ────────────────────────────────────────────────────────
  function _buildTracebackSVG(frameIdx) {
    const maxIsoZ = sortedIsoLevels.length ? sortedIsoLevels[sortedIsoLevels.length - 1] : 0;
    const viewY = Math.min(0, CY - maxIsoZ * _ovFG - 50);
    const HTOTAL = BASE_H + LEGEND_H - viewY;
    let s = `<svg viewBox="0 ${viewY} ${W} ${HTOTAL}" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:${HTOTAL}px;display:block;font-family:system-ui,sans-serif">`;
    s += `<rect x="0" y="${viewY}" width="${W}" height="${HTOTAL}" fill="#071008"/>`;

    // Defs
    s += `<defs>`;
    sortedIsoLevels.forEach((z2, li) => {
      const c2 = levelColor(z2);
      if (li === 0) {
        s += `<pattern id="tbpat_${li}" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">`;
        s += `<path d="M12,2 C16,2 19,6 19,11 C19,16 16,21 12,22 C8,21 5,16 5,11 C5,6 8,2 12,2 Z" fill="none" stroke="${c2}" stroke-width="0.7" opacity="0.14"/>`;
        s += `</pattern>`;
      } else if (li === 2) {
        s += `<pattern id="tbpat_${li}" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">`;
        s += `<line x1="0" y1="12" x2="12" y2="0" stroke="${c2}" stroke-width="0.6" opacity="0.18"/>`;
        s += `</pattern>`;
      }
    });
    s += `</defs>`;

    // Floor slabs + room polygons + receivers (dim)
    for (const [z, group] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
      const isFocused = focusZ === null || (Array.isArray(focusZ) ? focusZ.includes(z) : focusZ === z);
      const go = isFocused ? 0.7 : 0.08;
      const lyrColor = levelColor(z);
      const lidx = sortedIsoLevels.indexOf(z);

      let x0 = Infinity, y0_ = Infinity, x1 = -Infinity, y1_ = -Infinity;
      for (const m of group) {
        const stk = m.stack || {}, ox = stk.x_offset || 0, oy_ = stk.y_offset || 0, sc = stk.scale || 1.0;
        const ar = (m.image?.height || 600) / (m.image?.width || 800);
        const arRef = stk.ref_ar || ar, sxAdj = stk.scale_x_adj || 1.0;
        const rot = (stk.rotation || 0) * Math.PI / 180;
        const bbPt = (px, py) => { const dx = (px - 0.5) * sc * sxAdj, dy = (py - 0.5) * sc * arRef; return [(0.5 + ox) + dx * Math.cos(rot) - dy * Math.sin(rot), arRef * (0.5 + oy_) + dx * Math.sin(rot) + dy * Math.cos(rot)]; };
        for (const [cx, cy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const [wx, wy] = bbPt(cx, cy); x0 = Math.min(x0, wx); y0_ = Math.min(y0_, wy); x1 = Math.max(x1, wx); y1_ = Math.max(y1_, wy); }
      }
      if (!isFinite(x0)) { x0 = 0; y0_ = 0; x1 = 1; y1_ = 0.75; }
      const TL = iso(x0, y0_, z), TR = iso(x1, y0_, z), BR = iso(x1, y1_, z), BL = iso(x0, y1_, z);
      s += `<g opacity="${go}">`;
      s += `<polygon points="${pts([TL, TR, BR, BL])}" fill="#0f2017" fill-opacity="0.06" stroke="${lyrColor}" stroke-width="1.2" stroke-dasharray="10,5" opacity="0.5"/>`;

      // Room polygons
      for (const m of group) {
        const stk = m.stack || {}, ox = stk.x_offset || 0, oy_ = stk.y_offset || 0, sc = stk.scale || 1.0;
        const ar = (m.image?.height || 600) / (m.image?.width || 800);
        const arRef = stk.ref_ar || ar, sxAdj = stk.scale_x_adj || 1.0;
        const rotRad = (stk.rotation || 0) * Math.PI / 180;
        const mapPt = (px, py) => { const dx = (px - 0.5) * sc * sxAdj, dy = (py - 0.5) * sc * arRef, rx = dx * Math.cos(rotRad) - dy * Math.sin(rotRad), ry = dx * Math.sin(rotRad) + dy * Math.cos(rotRad); return [(0.5 + ox) + rx, arRef * (0.5 + oy_) + ry]; };
        for (const [room, b] of Object.entries(m.room_bounds || {})) {
          if (!b || b.type !== "poly" || !Array.isArray(b.points) || b.points.length < 3) continue;
          const color = roomColorFn(room);
          const pp = b.points.map(p => { const [wx, wy] = mapPt(p[0], p[1]); return pt(iso(wx, wy, z)); }).join(" ");
          s += `<polygon points="${pp}" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="1" opacity="0.8"/>`;
          const cx2 = b.points.reduce((a, p) => a + p[0], 0) / b.points.length;
          const cy2 = b.points.reduce((a, p) => a + p[1], 0) / b.points.length;
          const [lwx, lwy] = mapPt(cx2, cy2);
          const [lix, liy] = iso(lwx, lwy, z);
          s += `<text x="${Math.round(lix)}" y="${Math.round(liy) + lidx * 2}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="7" opacity="0.7">${_esc(room)}</text>`;
        }
        // Receivers
        for (const r of (m.receivers || [])) {
          const [wx, wy] = mapPt(r.x || 0, r.y || 0);
          const [px2, py2] = iso(wx, wy, z);
          s += `<circle cx="${Math.round(px2)}" cy="${Math.round(py2)}" r="4" fill="#52b788" opacity="0.3"/>`;
        }
      }
      // Layer index
      s += `<circle cx="${Math.round(BL[0])}" cy="${Math.round(BL[1])}" r="12" fill="${lyrColor}" opacity="0.7"/>`;
      s += `<text x="${Math.round(BL[0])}" y="${Math.round(BL[1]) + 5}" text-anchor="middle" fill="#071008" font-size="11" font-weight="700">${lidx + 1}</text>`;
      s += `</g>`;
    }

    // Overlay: playback objects at this frame
    if (tb.frames.length && frameIdx >= 0 && frameIdx < tb.frames.length) {
      const frame = tb.frames[frameIdx];
      const objs = frame.o || [];
      const _roomCount = {};
      const TB_COLORS = ["#fbbf24", "#60a5fa", "#f87171", "#34d399", "#c4b5fd", "#fb923c", "#5eead4", "#f472b6", "#a3e635", "#818cf8"];
      const _colorMap = {};
      let _ci = 0;
      for (const o of objs) {
        if (!_colorMap[o.k]) { _colorMap[o.k] = TB_COLORS[_ci % TB_COLORS.length]; _ci++; }
      }

      // Trail from prev frames
      const trailLen = Math.min(8, frameIdx);
      for (let ti = Math.max(0, frameIdx - trailLen); ti < frameIdx; ti++) {
        const trailFrame = tb.frames[ti];
        const fade = 0.08 + 0.12 * ((ti - (frameIdx - trailLen)) / trailLen);
        for (const to of (trailFrame.o || [])) {
          if (!to.r || !roomIsoPos[to.r]) continue;
          const tpos = roomIsoPos[to.r];
          const col = _colorMap[to.k] || "#fbbf24";
          s += `<circle cx="${Math.round(tpos[0])}" cy="${Math.round(tpos[1])}" r="3" fill="${col}" opacity="${fade.toFixed(2)}"/>`;
        }
      }

      // Current frame objects
      for (const o of objs) {
        if (!o.r || !roomIsoPos[o.r]) continue;
        const pos = roomIsoPos[o.r];
        const idx = (_roomCount[o.r] || 0);
        _roomCount[o.r] = idx + 1;
        const angle = idx * 2.4;
        const radius = 6 + idx * 5;
        const offX = Math.cos(angle) * Math.min(radius, 35);
        const offY = Math.sin(angle) * Math.min(radius, 22);
        const px = Math.round(pos[0] + offX);
        const py = Math.round(pos[1] + offY);
        const col = _colorMap[o.k] || "#fbbf24";
        const lbl = (o.n || o.k || "?").substring(0, 12);
        const tip = `${lbl} | Room: ${o.r}${o.rssi ? " | RSSI: " + o.rssi + " dBm" : ""}`;

        s += `<g data-tip="${_esc(tip)}">`;
        s += `<circle cx="${px}" cy="${py}" r="16" fill="${col}" opacity="0.1"/>`;
        s += `<circle cx="${px}" cy="${py}" r="9" fill="${col}" stroke="#071008" stroke-width="1.5" opacity="0.95"/>`;
        s += `<circle cx="${px}" cy="${py}" r="3" fill="#071008" opacity="0.6"/>`;
        const lblW = Math.min(lbl.length * 6 + 8, 90);
        s += `<rect x="${px - lblW / 2}" y="${py - 24}" width="${lblW}" height="13" rx="3" fill="#071008" opacity="0.8"/>`;
        s += `<text x="${px}" y="${py - 14}" text-anchor="middle" fill="${col}" font-size="9" font-weight="700">${_esc(lbl)}</text>`;
        s += `</g>`;
      }
    }

    // Timestamp overlay
    if (tb.frames.length && frameIdx >= 0 && frameIdx < tb.frames.length) {
      const ts = tb.frames[frameIdx].ts;
      const timeStr = _fmtDate(ts);
      s += `<rect x="${W - 200}" y="${viewY + 4}" width="196" height="22" rx="4" fill="#071008" opacity="0.85"/>`;
      s += `<text x="${W - 102}" y="${viewY + 19}" text-anchor="middle" fill="#fbbf24" font-size="13" font-weight="700">${_esc(timeStr)}</text>`;
    }

    // Legend
    s += `<line x1="10" y1="${BASE_H + 4}" x2="${W - 10}" y2="${BASE_H + 4}" stroke="#1b3526" stroke-width="0.8"/>`;
    sortedIsoLevels.forEach((z, i) => {
      const ly = BASE_H + 10 + i * 30;
      const color = levelColor(z);
      const groupLabel = byLevel.get(z).map(m => m.name || m.id).join(" + ");
      s += `<circle cx="18" cy="${ly + 11}" r="11" fill="${color}" opacity="0.7"/>`;
      s += `<text x="18" y="${ly + 15}" text-anchor="middle" fill="#071008" font-size="12" font-weight="700">${i + 1}</text>`;
      s += `<text x="36" y="${ly + 15}" fill="${color}" font-size="14" font-weight="500">${_esc(groupLabel)}</text>`;
    });

    s += `</svg>`;
    return s;
  }

  // ── Map display div ────────────────────────────────────────────────────
  const mapDiv = document.createElement("div");
  mapDiv.style.cssText = "overflow:auto;border-radius:8px;background:#071008;padding:8px;margin-bottom:10px";

  // ── Playback helpers ───────────────────────────────────────────────────
  function _renderFrame() {
    if (!tb.frames.length) return;
    mapDiv.innerHTML = _buildTracebackSVG(tb.frameIdx);
  }

  function _updateScrubber() {
    const scrubber = ctrlCard.querySelector('input[type="range"]');
    if (scrubber) scrubber.value = String(tb.frameIdx);
    _updateTimeLbl();
  }

  function _updateTimeLbl() {
    const timeLbl = ctrlCard.querySelector("#tb-time-lbl");
    if (timeLbl && tb.frames[tb.frameIdx]) {
      timeLbl.textContent = _fmtDate(tb.frames[tb.frameIdx].ts);
    }
    const progLbl = ctrlCard.querySelector("#tb-progress-lbl");
    if (progLbl) progLbl.textContent = `${tb.frameIdx + 1} / ${tb.frames.length}`;
  }

  function _startPlayback() {
    if (tb._animTimer) clearInterval(tb._animTimer);
    tb.playing = true;
    // Compute interval: total run time / remaining frames
    const remaining = Math.max(1, tb.frames.length - 1 - tb.frameIdx);
    const totalMs = tb.playDurationS * 1000;
    const interval = Math.max(16, Math.round(totalMs / tb.frames.length));
    tb._animTimer = setInterval(() => {
      if (tb.frameIdx >= tb.frames.length - 1) {
        _stopPlayback();
        _buildControls();
        return;
      }
      tb.frameIdx++;
      _renderFrame();
      _updateScrubber();
    }, interval);
  }

  function _stopPlayback() {
    tb.playing = false;
    if (tb._animTimer) { clearInterval(tb._animTimer); tb._animTimer = null; }
  }

  // ── Controls card ──────────────────────────────────────────────────────
  const ctrlCard = document.createElement("div");
  ctrlCard.className = "card";
  ctrlCard.style.cssText = "border-color:#92400e;background:#0f0a00";

  function _buildControls() {
    ctrlCard.innerHTML = "";

    // Header
    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap";
    const title = document.createElement("span");
    title.style.cssText = "font-weight:700;font-size:15px;color:#fbbf24";
    title.textContent = "Traceback Playback";
    hdr.appendChild(title);
    ctrlCard.appendChild(hdr);

    // Range preset buttons
    const rangeRow = document.createElement("div");
    rangeRow.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px";
    const rangeLbl = document.createElement("span");
    rangeLbl.style.cssText = "font-size:12px;color:#94a3b8";
    rangeLbl.textContent = "Time range:";
    rangeRow.appendChild(rangeLbl);

    const presets = [
      { label: "5 min", s: 300 }, { label: "15 min", s: 900 }, { label: "30 min", s: 1800 },
      { label: "1 hr", s: 3600 }, { label: "4 hr", s: 14400 }, { label: "12 hr", s: 43200 },
      { label: "1 day", s: 86400 }, { label: "3 days", s: 259200 }, { label: "7 days", s: 604800 },
    ];
    for (const p of presets) {
      const btn = document.createElement("button");
      btn.className = "btn inline";
      const isActive = tb.rangePreset === p.s;
      btn.style.cssText = isActive
        ? "font-size:11px;padding:2px 8px;background:#92400e;color:#fbbf24;border-color:#fbbf24;font-weight:700"
        : "font-size:11px;padding:2px 8px;color:#94a3b8";
      btn.textContent = p.label;
      btn.addEventListener("click", async () => {
        _stopPlayback();
        tb.rangePreset = p.s;
        tb.startTs = null;
        tb.endTs = null;
        await _loadTracebackData();
        _buildControls();
        _renderFrame();
      });
      rangeRow.appendChild(btn);
    }
    ctrlCard.appendChild(rangeRow);

    // Object filter
    const filterRow = document.createElement("div");
    filterRow.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px";
    const filterLbl = document.createElement("span");
    filterLbl.style.cssText = "font-size:12px;color:#94a3b8";
    filterLbl.textContent = "Object:";
    filterRow.appendChild(filterLbl);

    const filterSelect = document.createElement("select");
    filterSelect.style.cssText = "background:#071008;color:#e2e8f0;border:1px solid #2d6a4f;border-radius:4px;padding:3px 8px;font-size:12px;max-width:280px";
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "All objects";
    if (!tb.filterKey) allOpt.selected = true;
    filterSelect.appendChild(allOpt);

    const byKind = {};
    for (const obj of tb.objKeys) {
      const kind = obj.kind || "other";
      if (!byKind[kind]) byKind[kind] = [];
      byKind[kind].push(obj);
    }
    for (const [kind, items] of Object.entries(byKind).sort()) {
      const grp = document.createElement("optgroup");
      grp.label = kind;
      for (const item of items.sort((a, b) => (a.name || "").localeCompare(b.name || ""))) {
        const opt = document.createElement("option");
        opt.value = item.key;
        opt.textContent = item.name || item.key;
        if (tb.filterKey === item.key) opt.selected = true;
        grp.appendChild(opt);
      }
      filterSelect.appendChild(grp);
    }
    filterSelect.addEventListener("change", async () => {
      _stopPlayback();
      tb.filterKey = filterSelect.value || null;
      tb.filterName = filterSelect.options[filterSelect.selectedIndex]?.textContent || "All objects";
      await _loadTracebackData();
      _buildControls();
      _renderFrame();
    });
    filterRow.appendChild(filterSelect);

    const infoLbl = document.createElement("span");
    infoLbl.style.cssText = "font-size:11px;color:#64748b;margin-left:auto";
    if (tb.frames.length) {
      const rangeNote = tb._autoExpanded ? "auto-expanded to full range" : `${_fmtDuration(tb.rangePreset)} window`;
      infoLbl.textContent = `${tb.frames.length} frames | ${rangeNote}`;
    } else {
      infoLbl.textContent = tb.filterKey ? "No data for this object" : "No data in range";
    }
    filterRow.appendChild(infoLbl);
    ctrlCard.appendChild(filterRow);

    if (!tb.frames.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "text-align:center;padding:20px;color:#64748b;font-size:13px";
      if (tb.filterKey) {
        empty.textContent = `No traceback data found for "${tb.filterName}". This object may not have been seen recently or may not be identified/followed. Only identified and followed objects are recorded.`;
      } else {
        empty.textContent = "No traceback data in this time range. Only identified and followed objects are recorded (~10s intervals). Try a longer time range or check back after some time.";
      }
      ctrlCard.appendChild(empty);
      return;
    }

    // Transport controls
    const transport = document.createElement("div");
    transport.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap";

    // Rewind
    const rewBtn = document.createElement("button");
    rewBtn.className = "btn inline";
    rewBtn.style.cssText = "font-size:14px;padding:2px 8px;color:#fbbf24";
    rewBtn.innerHTML = "&#9198;";
    rewBtn.title = "Jump to start";
    rewBtn.addEventListener("click", () => { tb.frameIdx = 0; _renderFrame(); _updateScrubber(); });
    transport.appendChild(rewBtn);

    // Step back
    const stepBackBtn = document.createElement("button");
    stepBackBtn.className = "btn inline";
    stepBackBtn.style.cssText = "font-size:14px;padding:2px 8px;color:#fbbf24";
    stepBackBtn.innerHTML = "&#9664;";
    stepBackBtn.title = "Previous frame";
    stepBackBtn.addEventListener("click", () => {
      if (tb.frameIdx > 0) { tb.frameIdx--; _renderFrame(); _updateScrubber(); }
    });
    transport.appendChild(stepBackBtn);

    // Play/Pause
    const playBtn = document.createElement("button");
    playBtn.className = "btn inline";
    playBtn.style.cssText = tb.playing
      ? "font-size:16px;padding:3px 12px;background:#92400e;color:#fbbf24;border-color:#fbbf24;font-weight:700"
      : "font-size:16px;padding:3px 12px;color:#fbbf24;border-color:#92400e";
    playBtn.innerHTML = tb.playing ? "&#9646;&#9646;" : "&#9654;";
    playBtn.title = tb.playing ? "Pause" : "Play";
    playBtn.addEventListener("click", () => {
      if (tb.playing) { _stopPlayback(); } else { _startPlayback(); }
      _buildControls();
    });
    transport.appendChild(playBtn);

    // Step forward
    const stepFwdBtn = document.createElement("button");
    stepFwdBtn.className = "btn inline";
    stepFwdBtn.style.cssText = "font-size:14px;padding:2px 8px;color:#fbbf24";
    stepFwdBtn.innerHTML = "&#9654;";
    stepFwdBtn.title = "Next frame";
    stepFwdBtn.addEventListener("click", () => {
      if (tb.frameIdx < tb.frames.length - 1) { tb.frameIdx++; _renderFrame(); _updateScrubber(); }
    });
    transport.appendChild(stepFwdBtn);

    // Jump to end
    const endBtn = document.createElement("button");
    endBtn.className = "btn inline";
    endBtn.style.cssText = "font-size:14px;padding:2px 8px;color:#fbbf24";
    endBtn.innerHTML = "&#9197;";
    endBtn.title = "Jump to end";
    endBtn.addEventListener("click", () => { tb.frameIdx = tb.frames.length - 1; _renderFrame(); _updateScrubber(); });
    transport.appendChild(endBtn);

    // Run time slider (1 min to 60 min)
    const rtWrap = document.createElement("span");
    rtWrap.style.cssText = "display:flex;align-items:center;gap:6px;margin-left:8px";
    const rtLbl = document.createElement("span");
    rtLbl.style.cssText = "font-size:11px;color:#94a3b8;white-space:nowrap";
    rtLbl.textContent = "Run time:";
    rtWrap.appendChild(rtLbl);

    const rtSlider = document.createElement("input");
    rtSlider.type = "range";
    rtSlider.min = "60";
    rtSlider.max = "3600";
    rtSlider.step = "30";
    rtSlider.value = String(tb.playDurationS);
    rtSlider.style.cssText = "width:100px;accent-color:#fbbf24;cursor:pointer;height:20px";
    rtSlider.title = "How long the full playback takes";

    const rtValLbl = document.createElement("span");
    rtValLbl.style.cssText = "font-size:11px;color:#fbbf24;font-weight:600;min-width:36px;font-family:monospace";
    rtValLbl.textContent = _fmtDuration(tb.playDurationS);

    rtSlider.addEventListener("input", () => {
      tb.playDurationS = parseInt(rtSlider.value, 10);
      rtValLbl.textContent = _fmtDuration(tb.playDurationS);
      if (tb.playing) { _stopPlayback(); _startPlayback(); }
    });
    rtWrap.appendChild(rtSlider);
    rtWrap.appendChild(rtValLbl);
    transport.appendChild(rtWrap);

    // Current time display
    const timeLbl = document.createElement("span");
    timeLbl.id = "tb-time-lbl";
    timeLbl.style.cssText = "font-size:12px;color:#fbbf24;font-weight:600;margin-left:auto;font-family:monospace";
    const curTs = tb.frames[tb.frameIdx]?.ts;
    timeLbl.textContent = curTs ? _fmtDate(curTs) : "--";
    transport.appendChild(timeLbl);

    ctrlCard.appendChild(transport);

    // Timeline scrubber
    const scrubberWrap = document.createElement("div");
    scrubberWrap.style.cssText = "position:relative;margin-bottom:6px";

    const scrubber = document.createElement("input");
    scrubber.type = "range";
    scrubber.min = "0";
    scrubber.max = String(Math.max(0, tb.frames.length - 1));
    scrubber.value = String(tb.frameIdx);
    scrubber.style.cssText = "width:100%;accent-color:#fbbf24;cursor:pointer;height:24px";
    scrubber.addEventListener("input", () => {
      tb.frameIdx = parseInt(scrubber.value, 10);
      _renderFrame();
      _updateTimeLbl();
    });
    scrubberWrap.appendChild(scrubber);

    // Time markers
    const markerRow = document.createElement("div");
    markerRow.style.cssText = "display:flex;justify-content:space-between;font-size:10px;color:#64748b;padding:0 2px";
    const startStr = tb.frames.length ? _fmtDate(tb.frames[0].ts) : "--";
    const endStr = tb.frames.length ? _fmtDate(tb.frames[tb.frames.length - 1].ts) : "--";
    markerRow.appendChild(document.createTextNode(startStr));
    const progLbl = document.createElement("span");
    progLbl.id = "tb-progress-lbl";
    progLbl.style.cssText = "color:#94a3b8";
    progLbl.textContent = `${tb.frameIdx + 1} / ${tb.frames.length}`;
    markerRow.appendChild(progLbl);
    markerRow.appendChild(document.createTextNode(endStr));
    scrubberWrap.appendChild(markerRow);

    ctrlCard.appendChild(scrubberWrap);
  }

  // ── Assemble ───────────────────────────────────────────────────────────
  outer.appendChild(mapDiv);
  outer.appendChild(ctrlCard);

  // Auto-load data on tab open
  _loadTracebackData().then(() => {
    _buildControls();
    _renderFrame();
  });

  return outer;
}
