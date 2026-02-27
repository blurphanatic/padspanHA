export function render(ctx){
  const { el, radioShortId } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const root = el("section",{id:"sandbox"});

  root.appendChild(el("div",{style:"font-size:20px;font-weight:800;margin-bottom:16px"},"Sandbox"));

  const grid = el("div",{class:"grid"});

  // ── State Inspector ──
  const rooms = snap ? (snap.rooms_discovered || []) : [];
  const objects = snap ? ((snap.objects && snap.objects.list) || []) : [];
  const genAt = snap ? (snap.generated_at || "\u2014") : "\u2014";
  const uptimeMs = Date.now() - (ctx.state._sessionStart || Date.now());
  const uptimeMin = Math.floor(uptimeMs / 60000);

  grid.appendChild(el("div",{class:"card"},[
    el("div",{style:"font-weight:700;margin-bottom:8px"},"State Inspector"),
    el("div",{style:"display:flex;flex-direction:column;gap:4px;font-size:12px"},[
      el("div",{}, [el("span",{class:"muted"},"Data mode: "), el("span",{style:"font-weight:600"}, ctx.state.dataMode.toUpperCase())]),
      el("div",{}, [el("span",{class:"muted"},"Snapshot age: "), el("span",{style:"font-weight:600"}, genAt)]),
      el("div",{}, [el("span",{class:"muted"},"Objects: "), el("span",{style:"font-weight:600"}, String(objects.length))]),
      el("div",{}, [el("span",{class:"muted"},"Rooms: "), el("span",{style:"font-weight:600"}, String(rooms.length))]),
      el("div",{}, [el("span",{class:"muted"},"Session: "), el("span",{style:"font-weight:600"}, `${uptimeMin}m`)]),
    ]),
  ]));

  // ── Room Color Grid ──
  const PALETTE = ["#5eead4","#52b788","#ff8a65","#4db6ac","#43a047","#ba68c8","#81c784","#ffd54f","#f06292","#4caf50","#ffb74d","#e57373","#b0bec5","#9575cd","#26c6da","#9ccc65"];

  if(rooms.length > 0){
    const roomGrid = el("div",{style:"display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:6px"});
    for(let i = 0; i < rooms.length; i++){
      const room = rooms[i];
      const rc = ctx.helpers.roomColor(room);
      const count = objects.filter(o=>o.room===room).length;
      const tile = el("div",{style:`background:${rc}22;border:1px solid ${rc}44;border-radius:6px;padding:8px;text-align:center;cursor:pointer`});
      tile.appendChild(el("div",{style:`font-size:11px;color:${rc};font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`}, room));
      tile.appendChild(el("div",{style:"font-size:18px;font-weight:800;color:#e2e8f0;margin-top:2px"}, String(count)));
      tile.addEventListener("click", ()=>ctx.actions.showRoomDetail(room));
      roomGrid.appendChild(tile);
    }
    grid.appendChild(el("div",{class:"card"},[
      el("div",{style:"font-weight:700;margin-bottom:8px"},"Room Color Grid"),
      roomGrid,
    ]));
  }

  // ── RSSI Distribution ──
  const ads = snap ? ((snap.ble && snap.ble.advertisements) || []) : [];
  if(ads.length > 0){
    // Bucket by 10 dBm ranges
    const buckets = {};
    for(const ad of ads){
      if(ad.rssi == null) continue;
      const bucket = Math.floor(ad.rssi / 10) * 10;
      buckets[bucket] = (buckets[bucket] || 0) + 1;
    }
    const sortedBuckets = Object.entries(buckets)
      .map(([k,v])=>([Number(k),v]))
      .sort((a,b)=>a[0]-b[0]);
    const maxBucket = Math.max(...sortedBuckets.map(x=>x[1]), 1);

    const histCard = el("div",{class:"card"});
    histCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:8px"},"RSSI Distribution"));

    const chart = el("div",{style:"display:flex;align-items:flex-end;gap:4px;height:100px"});
    for(const [range, count] of sortedBuckets){
      const pct = Math.round((count / maxBucket) * 100);
      // Color gradient: green for strong, yellow for mid, red for weak
      let barColor = "#52b788";
      if(range < -80) barColor = "#ef5350";
      else if(range < -70) barColor = "#ffd54f";
      else if(range < -60) barColor = "#81c784";

      const col = el("div",{style:"display:flex;flex-direction:column;align-items:center;flex:1;min-width:0"});
      col.appendChild(el("div",{style:`height:${pct}px;width:100%;background:${barColor};border-radius:2px 2px 0 0;min-height:2px`}));
      col.appendChild(el("div",{style:"font-size:9px;color:#64748b;margin-top:2px;white-space:nowrap"}, `${range}`));
      chart.appendChild(col);
    }
    histCard.appendChild(chart);
    histCard.appendChild(el("div",{class:"muted",style:"font-size:10px;margin-top:6px;text-align:center"}, "dBm ranges (10 dBm buckets)"));
    grid.appendChild(histCard);
  }

  // ── Live Signal Bars ──
  const radios = snap ? ((snap.ble && snap.ble.radios) || []) : [];
  if(radios.length > 0){
    const scannerDevCounts = {};
    for(const ad of ads){
      const src = ad.source || "";
      scannerDevCounts[src] = (scannerDevCounts[src] || 0) + 1;
    }
    const maxDevs = Math.max(...Object.values(scannerDevCounts), 1);

    const barsCard = el("div",{class:"card"});
    barsCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:8px"},"Live Signal Bars"));

    const barList = el("div",{style:"display:flex;flex-direction:column;gap:6px"});
    const sorted = radios.sort((a,b)=>(scannerDevCounts[b.source]||0)-(scannerDevCounts[a.source]||0));
    for(const radio of sorted){
      const count = scannerDevCounts[radio.source] || 0;
      const pct = Math.round((count / maxDevs) * 100);
      const row = el("div",{style:"display:flex;align-items:center;gap:8px"});
      const rsid = _sid(radio.source);
      row.appendChild(el("div",{style:"width:110px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0"}, [
        el("span",{style:"font-family:monospace;font-weight:700;letter-spacing:.04em;margin-right:4px"}, rsid),
        el("span",{class:"muted"}, radio.name || radio.source),
      ]));
      row.appendChild(el("div",{style:"flex:1;background:#1a2e1e;border-radius:3px;height:12px"}, [
        el("div",{style:`width:${pct}%;height:100%;background:#52b788;border-radius:3px;min-width:2px;transition:width 0.3s`}),
      ]));
      row.appendChild(el("div",{style:"width:30px;text-align:right;font-size:11px;font-weight:600"}, String(count)));
      barList.appendChild(row);
    }
    barsCard.appendChild(barList);
    grid.appendChild(barsCard);
  }

  root.appendChild(grid);
  return root;
}
