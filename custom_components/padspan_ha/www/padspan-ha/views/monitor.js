// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
export function render(ctx){
  const { el, radioShortId } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const root = el("section",{id:"monitor"});

  root.appendChild(el("div",{style:"font-size:20px;font-weight:800;margin-bottom:16px"},"Monitor"));

  const grid = el("div",{class:"grid"});

  // ── Websocket Call Counts ──
  const wsCounts = ctx.state.wsCounts || {};
  const wsLines = Object.keys(wsCounts).sort().map(k=>`${k}: ${wsCounts[k]}`).join("\n") || "No websocket calls yet.";
  grid.appendChild(el("div",{class:"card"},[
    el("div",{style:"font-weight:700"},"Websocket Call Counts (UI)"),
    el("pre",{class:"mono",style:"max-height:240px;overflow:auto;font-size:11px"}, wsLines),
    el("div",{class:"muted",style:"font-size:11px;margin-top:6px"},"Helps detect if a button is wired (counts should increase when clicked)."),
  ]));

  // ── Timing ──
  grid.appendChild(el("div",{class:"card"},[
    el("div",{style:"font-weight:700"},"Timing"),
    el("div",{class:"mono"}, `Last refresh: ${ctx.state.timing.lastRefreshMs ?? "\u2014"}ms`),
    el("div",{class:"mono"}, `Last diagnostics: ${ctx.state.timing.lastDiagMs ?? "\u2014"}ms`),
  ]));

  // ── BLE Objects Summary ──
  const objSummary = snap && snap.objects && snap.objects.summary;
  if(objSummary){
    const total = objSummary.total || 0;
    const ble = objSummary.ble || 0;
    const unid = objSummary.unidentified || 0;
    grid.appendChild(el("div",{class:"card"},[
      el("div",{style:"font-weight:700"},"BLE Objects"),
      el("div",{class:"row",style:"gap:8px;flex-wrap:wrap;margin-top:8px"},[
        el("span",{class:"badge"}, `${total} total`),
        el("span",{class:"badge"}, `${ble} BLE ads`),
        unid > 0
          ? el("span",{class:"badge warn"}, `${unid} unidentified`)
          : el("span",{class:"badge"}, "All identified"),
      ]),
    ]));
  } else {
    grid.appendChild(el("div",{class:"card"},[
      el("div",{style:"font-weight:700"},"BLE Objects"),
      el("div",{class:"muted"},"No live snapshot \u2014 switch to Live mode to see BLE metrics."),
    ]));
  }

  // ── Per-Scanner Breakdown ──
  const radios = (snap && snap.ble && snap.ble.radios) || [];
  const ads = (snap && snap.ble && snap.ble.advertisements) || [];
  if(radios.length > 0){
    const scannerData = {};
    for(const r of radios) scannerData[r.source] = { name: r.name || r.source, devs: 0, rssiSum: 0, rssiCount: 0 };
    for(const ad of ads){
      const src = ad.source || "";
      if(!scannerData[src]) scannerData[src] = { name: src, devs: 0, rssiSum: 0, rssiCount: 0 };
      scannerData[src].devs++;
      if(ad.rssi != null){ scannerData[src].rssiSum += ad.rssi; scannerData[src].rssiCount++; }
    }

    const tbl = el("table",{style:"width:100%;font-size:12px;border-collapse:collapse"});
    tbl.appendChild(el("tr",{},[
      el("th",{style:"text-align:left;padding:4px 6px;color:#94a3b8;font-weight:600"},"ID"),
      el("th",{style:"text-align:left;padding:4px 6px;color:#94a3b8;font-weight:600"},"Scanner"),
      el("th",{style:"text-align:right;padding:4px 6px;color:#94a3b8;font-weight:600"},"Devices"),
      el("th",{style:"text-align:right;padding:4px 6px;color:#94a3b8;font-weight:600"},"Avg RSSI"),
      el("th",{style:"text-align:left;padding:4px 6px;color:#94a3b8;font-weight:600"},"Quality"),
    ]));
    for(const [src, st] of Object.entries(scannerData).sort((a,b)=>b[1].devs-a[1].devs)){
      const avg = st.rssiCount > 0 ? Math.round(st.rssiSum / st.rssiCount) : null;
      let quality = "\u2014", qColor = "#64748b";
      if(avg !== null){
        if(avg >= -60){ quality = "Excellent"; qColor = "#52b788"; }
        else if(avg >= -70){ quality = "Good"; qColor = "#81c784"; }
        else if(avg >= -80){ quality = "Fair"; qColor = "#ffd54f"; }
        else { quality = "Poor"; qColor = "#ef5350"; }
      }
      tbl.appendChild(el("tr",{},[
        el("td",{style:"padding:4px 6px;font-family:monospace;font-weight:700;font-size:11px;letter-spacing:.04em"}, _sid(src)),
        el("td",{style:"padding:4px 6px"}, st.name),
        el("td",{style:"padding:4px 6px;text-align:right"}, String(st.devs)),
        el("td",{style:"padding:4px 6px;text-align:right;font-family:monospace"}, avg !== null ? `${avg}` : "\u2014"),
        el("td",{style:`padding:4px 6px;color:${qColor};font-weight:600`}, quality),
      ]));
    }
    grid.appendChild(el("div",{class:"card"},[
      el("div",{style:"font-weight:700;margin-bottom:8px"},"Per-Scanner Breakdown"),
      tbl,
    ]));
  }

  // ── Advertisement Freshness ──
  if(ads.length > 0){
    let fresh = 0, stale = 0, old = 0;
    for(const ad of ads){
      const age = ad.age_s ?? 999;
      if(age < 10) fresh++;
      else if(age < 60) stale++;
      else old++;
    }
    const total = ads.length;
    const freshPct = Math.round((fresh/total)*100);
    const stalePct = Math.round((stale/total)*100);
    const oldPct = 100 - freshPct - stalePct;

    grid.appendChild(el("div",{class:"card"},[
      el("div",{style:"font-weight:700;margin-bottom:8px"},"Advertisement Freshness"),
      el("div",{style:"display:flex;height:18px;border-radius:4px;overflow:hidden;margin-bottom:8px"},[
        fresh > 0 ? el("div",{style:`width:${freshPct}%;background:#52b788`}) : null,
        stale > 0 ? el("div",{style:`width:${stalePct}%;background:#ffd54f`}) : null,
        old > 0 ? el("div",{style:`width:${oldPct}%;background:#ef5350`}) : null,
      ].filter(Boolean)),
      el("div",{style:"display:flex;gap:16px;font-size:12px"},[
        el("span",{}, [el("span",{style:"color:#52b788;font-weight:600"}, `${fresh}`), ` fresh (<10s)`]),
        el("span",{}, [el("span",{style:"color:#ffd54f;font-weight:600"}, `${stale}`), ` stale (10-60s)`]),
        el("span",{}, [el("span",{style:"color:#ef5350;font-weight:600"}, `${old}`), ` old (>60s)`]),
      ]),
    ]));
  }

  // ── Snapshot Summary ──
  if(snap){
    const objects = snap.objects || {};
    const roomCount = (snap.rooms_discovered || []).length;
    const recCount = (snap.receivers || []).length;
    const tags = snap.tags || [];
    const genAt = snap.generated_at || "\u2014";

    grid.appendChild(el("div",{class:"card"},[
      el("div",{style:"font-weight:700;margin-bottom:8px"},"Snapshot Summary"),
      el("div",{style:"display:flex;flex-wrap:wrap;gap:12px;font-size:12px"},[
        el("div",{}, [el("span",{class:"muted"},"Objects: "), el("span",{style:"font-weight:600"}, String(objects.summary?.total ?? 0))]),
        el("div",{}, [el("span",{class:"muted"},"Rooms: "), el("span",{style:"font-weight:600"}, String(roomCount))]),
        el("div",{}, [el("span",{class:"muted"},"Receivers: "), el("span",{style:"font-weight:600"}, String(recCount))]),
        el("div",{}, [el("span",{class:"muted"},"Tags: "), el("span",{style:"font-weight:600"}, String(tags.length))]),
      ]),
      el("div",{class:"muted",style:"font-size:11px;margin-top:6px"}, `Generated: ${genAt}`),
    ]));
  }

  // ── Session Info ──
  const uptimeMs = Date.now() - (ctx.state._sessionStart || Date.now());
  const uptimeMin = Math.floor(uptimeMs / 60000);
  const uptimeSec = Math.floor((uptimeMs % 60000) / 1000);
  grid.appendChild(el("div",{class:"card"},[
    el("div",{style:"font-weight:700;margin-bottom:8px"},"Session Info"),
    el("div",{style:"display:flex;flex-direction:column;gap:4px;font-size:12px"},[
      el("div",{}, [el("span",{class:"muted"},"Data mode: "), el("span",{style:"font-weight:600"}, ctx.state.dataMode.toUpperCase())]),
      el("div",{}, [el("span",{class:"muted"},"Panel uptime: "), el("span",{style:"font-weight:600"}, `${uptimeMin}m ${uptimeSec}s`)]),
      el("div",{}, [el("span",{class:"muted"},"Events logged: "), el("span",{style:"font-weight:600"}, String((ctx.state._sessionEvents||[]).length))]),
    ]),
  ]));

  root.appendChild(grid);
  return root;
}
