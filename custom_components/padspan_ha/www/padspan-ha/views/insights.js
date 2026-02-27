export function render(ctx){
  const { el, radioShortId } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const root = el("section",{id:"insights"});

  root.appendChild(el("div",{style:"font-size:20px;font-weight:800;margin-bottom:16px"},"Insights"));

  if(!snap){
    root.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"No snapshot available. Switch to Live or Sample mode to see insights."),
    ]));
    return root;
  }

  const rooms = snap.rooms_discovered || [];
  const objects = (snap.objects && snap.objects.list) || [];
  const radios = (snap.ble && snap.ble.radios) || [];
  const ads = (snap.ble && snap.ble.advertisements) || [];
  const roomTagMap = ctx.state.roomTagMap || {};
  const maps = (ctx.state.maps && ctx.state.maps.list) || [];

  const grid = el("div",{class:"grid"});

  // ── Room Occupancy bar chart ──
  const roomCounts = {};
  for(const o of objects){
    const r = o.room || "Unknown";
    roomCounts[r] = (roomCounts[r]||0) + 1;
  }
  const sortedRC = Object.entries(roomCounts).sort((a,b)=>b[1]-a[1]);
  const maxCount = sortedRC.length ? sortedRC[0][1] : 1;

  const occCard = el("div",{class:"card"});
  occCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Room Occupancy"));
  if(sortedRC.length === 0){
    occCard.appendChild(el("div",{class:"muted"},"No objects assigned to rooms."));
  } else {
    const bars = el("div",{style:"display:flex;flex-direction:column;gap:6px"});
    for(const [room, count] of sortedRC.slice(0, 12)){
      const pct = Math.round((count / maxCount) * 100);
      const rc = ctx.helpers.roomColor(room);
      const row = el("div",{style:"display:flex;align-items:center;gap:8px"});
      row.appendChild(el("div",{style:"width:100px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0"}, room));
      row.appendChild(el("div",{style:"flex:1;background:#1a2e1e;border-radius:3px;height:14px;position:relative"}, [
        el("div",{style:`width:${pct}%;height:100%;background:${rc};border-radius:3px;min-width:2px`}),
      ]));
      row.appendChild(el("div",{style:"width:24px;text-align:right;font-size:12px;font-weight:600"}, String(count)));
      bars.appendChild(row);
    }
    occCard.appendChild(bars);
  }
  grid.appendChild(occCard);

  // ── Signal Quality per scanner ──
  const scannerStats = {};
  for(const ad of ads){
    const src = ad.source || "unknown";
    if(!scannerStats[src]) scannerStats[src] = { total: 0, rssiSum: 0, count: 0 };
    scannerStats[src].total++;
    if(ad.rssi != null){ scannerStats[src].rssiSum += ad.rssi; scannerStats[src].count++; }
  }

  const sigCard = el("div",{class:"card"});
  sigCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Signal Quality"));
  if(Object.keys(scannerStats).length === 0){
    sigCard.appendChild(el("div",{class:"muted"},"No scanner data available."));
  } else {
    const tbl = el("table",{style:"width:100%;font-size:12px;border-collapse:collapse"});
    tbl.appendChild(el("tr",{},[
      el("th",{style:"text-align:left;padding:4px 6px;color:#94a3b8;font-weight:600"},"ID"),
      el("th",{style:"text-align:left;padding:4px 6px;color:#94a3b8;font-weight:600"},"Scanner"),
      el("th",{style:"text-align:right;padding:4px 6px;color:#94a3b8;font-weight:600"},"Devices"),
      el("th",{style:"text-align:right;padding:4px 6px;color:#94a3b8;font-weight:600"},"Avg RSSI"),
      el("th",{style:"text-align:left;padding:4px 6px;color:#94a3b8;font-weight:600"},"Grade"),
    ]));
    for(const [src, st] of Object.entries(scannerStats).sort((a,b)=>b[1].total-a[1].total)){
      const avg = st.count > 0 ? Math.round(st.rssiSum / st.count) : null;
      let grade = "—", gradeColor = "#64748b";
      if(avg !== null){
        if(avg >= -60){ grade = "Excellent"; gradeColor = "#52b788"; }
        else if(avg >= -70){ grade = "Good"; gradeColor = "#81c784"; }
        else if(avg >= -80){ grade = "Fair"; gradeColor = "#ffd54f"; }
        else { grade = "Poor"; gradeColor = "#ef5350"; }
      }
      const radio = radios.find(r=>r.source===src);
      const name = (radio && radio.name) || src;
      tbl.appendChild(el("tr",{},[
        el("td",{style:"padding:4px 6px;font-family:monospace;font-weight:700;font-size:11px;letter-spacing:.04em"}, _sid(src)),
        el("td",{style:"padding:4px 6px;max-width:120px;overflow:hidden;text-overflow:ellipsis"}, name),
        el("td",{style:"padding:4px 6px;text-align:right"}, String(st.total)),
        el("td",{style:"padding:4px 6px;text-align:right;font-family:monospace"}, avg !== null ? `${avg}` : "—"),
        el("td",{style:`padding:4px 6px;color:${gradeColor};font-weight:600`}, grade),
      ]));
    }
    sigCard.appendChild(tbl);
  }
  grid.appendChild(sigCard);

  // ── Object Mobility ──
  const tagRooms = {};
  for(const [room, tags] of Object.entries(roomTagMap)){
    for(const t of (tags || [])){
      const k = String(t);
      if(!tagRooms[k]) tagRooms[k] = new Set();
      tagRooms[k].add(room);
    }
  }
  const mobCard = el("div",{class:"card"});
  mobCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Object Mobility"));
  const topMobile = Object.entries(tagRooms)
    .map(([t, rs])=>({t, n: rs.size}))
    .filter(x=>x.n > 1)
    .sort((a,b)=>b.n-a.n)
    .slice(0, 10);
  if(topMobile.length === 0){
    mobCard.appendChild(el("div",{class:"muted"},"No objects seen in multiple rooms yet."));
  } else {
    const list = el("div",{style:"display:flex;flex-direction:column;gap:4px"});
    for(const x of topMobile){
      list.appendChild(el("div",{style:"font-size:12px;display:flex;justify-content:space-between"},[
        el("span",{}, x.t),
        el("span",{class:"badge"}, `${x.n} rooms`),
      ]));
    }
    mobCard.appendChild(list);
  }
  grid.appendChild(mobCard);

  // ── Coverage Gaps ──
  const gapCard = el("div",{class:"card"});
  gapCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Coverage Gaps"));
  const gapItems = [];

  // Rooms with no objects
  const emptyRooms = rooms.filter(r=>!(roomCounts[r]));
  if(emptyRooms.length > 0){
    gapItems.push(el("div",{style:"font-size:12px;margin-bottom:6px"},[
      el("span",{style:"color:#ffd54f;font-weight:600"}, `${emptyRooms.length} empty room${emptyRooms.length>1?"s":""}: `),
      el("span",{class:"muted"}, emptyRooms.join(", ")),
    ]));
  }

  // Scanners not on any map
  const mappedReceivers = new Set();
  for(const m of maps){
    for(const r of (m.receivers || [])) mappedReceivers.add(r.source || r.name || r.id);
  }
  const unmappedScanners = radios.filter(r=>!mappedReceivers.has(r.source) && !mappedReceivers.has(r.name));
  if(unmappedScanners.length > 0){
    gapItems.push(el("div",{style:"font-size:12px;margin-bottom:6px"},[
      el("span",{style:"color:#ffd54f;font-weight:600"}, `${unmappedScanners.length} scanner${unmappedScanners.length>1?"s":""} not on any map: `),
      el("span",{class:"muted"}, unmappedScanners.map(s=>s.name||s.source).join(", ")),
    ]));
  }

  if(gapItems.length === 0){
    gapCard.appendChild(el("div",{style:"font-size:12px;color:#52b788;font-weight:600"},"No coverage gaps detected."));
  } else {
    for(const item of gapItems) gapCard.appendChild(item);
  }
  grid.appendChild(gapCard);

  // ── Device Breakdown ──
  const summary = snap.objects && snap.objects.summary;
  const brkCard = el("div",{class:"card"});
  brkCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Device Breakdown"));
  if(!summary){
    brkCard.appendChild(el("div",{class:"muted"},"No object summary available."));
  } else {
    const tagged = objects.filter(o=>o.user_label).length;
    const identified = summary.identified || 0;
    const unidentified = summary.unidentified || 0;
    const total = summary.total || 0;

    const items = [
      { label: "Total", value: total, color: "#e2e8f0" },
      { label: "Identified", value: identified, color: "#52b788" },
      { label: "Unidentified", value: unidentified, color: unidentified > 0 ? "#ef5350" : "#52b788" },
      { label: "Tagged", value: tagged, color: "#5eead4" },
    ];
    const row = el("div",{style:"display:flex;gap:16px;flex-wrap:wrap"});
    for(const it of items){
      row.appendChild(el("div",{style:"text-align:center"},[
        el("div",{style:`font-size:24px;font-weight:800;color:${it.color}`}, String(it.value)),
        el("div",{class:"muted",style:"font-size:11px"}, it.label),
      ]));
    }
    brkCard.appendChild(row);
  }
  grid.appendChild(brkCard);

  root.appendChild(grid);
  return root;
}
