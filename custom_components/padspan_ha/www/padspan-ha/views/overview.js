/**
 * Overview page (PadSpan)
 *
 * REPO LOGIC NOTES
 * - This is intentionally a "control tower" page: small metrics + buttons that open lists.
 * - The user explicitly asked that **every metric in Overview links to a list** (modal).
 * - For BLE, the live snapshot provides:
 *     snapshot.ble.radios            -> HA scanners/proxies
 *     snapshot.ble.advertisements    -> ad monitor stream
 *     snapshot.objects.list          -> derived union list (entities + BLE addresses)
 *     snapshot.objects.summary       -> counts + common OUIs (>=3)
 */

export function render(ctx){
  const { el, pill, helpBtn } = ctx.helpers;
  const isBasic = ctx.state.complexity === "basic";

  const fmtNum = (n)=>{
    try{ return new Intl.NumberFormat().format(Number(n||0)); }catch(e){ return String(n||0); }
  };
  const fmtAgo = (sec)=>{
    if(sec==null || isNaN(sec)) return "";
    const s = Math.max(0, Math.round(Number(sec)));
    if(s < 60) return `${s}s ago`;
    const m = Math.round(s/60);
    if(m < 60) return `${m}m ago`;
    const h = Math.round(m/60);
    if(h < 48) return `${h}h ago`;
    const d = Math.round(h/24);
    return `${d}d ago`;
  };

  const dataMode = ctx.state.dataMode || "sample";
  const liveSnap = ctx.state.live?.snapshot || null;

  // Fallback counts based on roomTagMap (works in sample mode too).
  const roomTagMap = ctx.state.roomTagMap || {};
  const roomsCount = Object.keys(roomTagMap).length;
  const tagsCount = (() => {
    const s = new Set();
    for(const r of Object.keys(roomTagMap)){
      (roomTagMap[r]||[]).forEach(eid=>s.add(eid));
    }
    return s.size;
  })();

  const objSummary = (liveSnap && liveSnap.objects && liveSnap.objects.summary) ? liveSnap.objects.summary : null;
  const objectsTotal = objSummary ? objSummary.total : tagsCount;
  const unidentifiedCount = objSummary ? objSummary.unidentified : 0;

  const radios = (liveSnap && liveSnap.ble && Array.isArray(liveSnap.ble.radios)) ? liveSnap.ble.radios : [];
  const radiosCount = radios.length;

  // ---------- Modal helpers ----------
  function openRoomsList(){
    const body = el("div",{});
    const rows = Object.keys(roomTagMap).sort().map((room)=>{
      const eids = roomTagMap[room] || [];
      const row = el("tr",{},[
        el("td",{}, room),
        el("td",{}, String(eids.length)),
        el("td",{}, eids.join(", "))
      ]);
      row.style.cursor = "pointer";
      row.title = "Click for room details";
      row.addEventListener("click", ()=>{ ctx.actions.closeModal(); ctx.actions.showRoomDetail(room); });
      return row;
    });

    body.appendChild(el("div",{class:"controls"},[
      el("span",{class:"badge"}, `${roomsCount} rooms`),
      el("span",{class:"badge"}, `${tagsCount} mapped entities`)
    ]));

    body.appendChild(el("table",{class:"table"},[
      el("thead",{}, el("tr",{},[
        el("th",{}, "Room"),
        el("th",{}, "Mapped entities"),
        el("th",{}, "Entity IDs")
      ])),
      el("tbody",{}, rows.length?rows:el("tr",{}, el("td",{colspan:3}, "No rooms in current map.")))
    ]));

    ctx.actions.openModal("Rooms", body, "Current room→entity map");
  }

  function openRadiosList(){
    const body = el("div",{});
    const r = radios || [];
    const areas = (liveSnap && Array.isArray(liveSnap.rooms_discovered)) ? liveSnap.rooms_discovered : [];
    body.appendChild(el("div",{class:"controls"},[
      el("span",{class:"badge"}, `${r.length} radios`),
      el("span",{class:"badge"}, "Areas read from HA device registry"),
    ]));
    const rows = r.map((x)=>{
      const assignBtn = el("button",{class:"btn tiny"}, x.area_name ? "Change" : "Assign");
      assignBtn.addEventListener("click",(e)=>{
        e.stopPropagation();
        openAreaAssign(x, areas);
      });
      const areaCell = el("td",{});
      if(x.disabled){
        areaCell.appendChild(el("span",{class:"badge warn",style:"background:rgba(148,100,220,.18);color:#c084fc;margin-right:4px"},"⊘ Disabled"));
      } else if(x.lost){
        areaCell.appendChild(el("span",{class:"badge warn",style:"background:rgba(245,158,11,.18);color:#f59e0b;margin-right:4px"},"⚠ Lost"));
      }
      areaCell.appendChild(document.createTextNode(x.area_name || (x.disabled||x.lost ? "" : "—")));
      const tr = el("tr",{},[
        el("td",{}, x.name || ""),
        el("td",{}, x.source || ""),
        el("td",{}, (x.adapter!=null?String(x.adapter):"")),
        el("td",{}, (x.scanning==null?"":String(x.scanning))),
        el("td",{}, (x.connectable==null?"":String(x.connectable))),
        areaCell,
        el("td",{}, assignBtn),
      ]);
      tr.style.cursor = "pointer";
      tr.title = "Click for scanner details";
      tr.addEventListener("click",(e)=>{
        if(e.target.tagName==="BUTTON") return;
        ctx.actions.closeModal(); ctx.actions.showScannerDetail(x);
      });
      return tr;
    });

    body.appendChild(el("table",{class:"table"},[
      el("thead",{}, el("tr",{},[
        el("th",{}, "Name"),
        el("th",{}, "Source"),
        el("th",{}, "Adapter"),
        el("th",{}, "Scanning"),
        el("th",{}, "Connectable"),
        el("th",{}, "Area"),
        el("th",{}, ""),
      ])),
      el("tbody",{}, rows.length?rows:el("tr",{}, el("td",{colspan:7}, "No radios found. (Switch to Live mode + ensure Bluetooth is enabled in HA.)")))
    ]));
    ctx.actions.openModal("Bluetooth Radios", body, "Areas read from HA — assign to update HA device registry");
  }

  function openAreaAssign(radio, areas){
    const { radioShortId } = ctx.helpers;
    const sid = radioShortId ? radioShortId(radio.source||"") : "";
    if(dataMode !== "live"){
      ctx.toast("Area assignment requires Live mode.", true);
      return;
    }
    const sel = el("select",{class:"select"});
    sel.appendChild(el("option",{value:""},"— No area (clear) —"));
    for(const a of areas){
      const opt = el("option",{value:a}, a);
      if(a === radio.area_name && !radio.lost && !radio.disabled) opt.selected = true;
      sel.appendChild(opt);
    }
    // Lost sentinel — always at bottom, visually distinct
    const lostOpt = el("option",{value:"__lost__"}, "⚠  Lost  —  exclude from location math");
    lostOpt.style.color = "#f59e0b";
    if(radio.lost) lostOpt.selected = true;
    sel.appendChild(lostOpt);
    // Disabled sentinel — below Lost
    const disabledOpt = el("option",{value:"__disabled__"}, "⊘  Disabled  —  intentionally off");
    disabledOpt.style.color = "#c084fc";
    if(radio.disabled) disabledOpt.selected = true;
    sel.appendChild(disabledOpt);

    const status = el("div",{class:"muted", style:"min-height:20px;margin-top:6px"});
    const saveBtn = el("button",{class:"btn"}, "Save");
    const cancelBtn = el("button",{class:"btn inline"}, "Cancel");
    cancelBtn.addEventListener("click", ()=>ctx.actions.closeModal());
    saveBtn.addEventListener("click", async ()=>{
      const v = sel.value;
      saveBtn.disabled = true;
      try {
        if(v === "__lost__"){
          if(radio.disabled) await ctx.actions.radioDisabledSet(radio.source, false);
          await ctx.actions.radioLostSet(radio.source, true);
          ctx.actions.closeModal();
          ctx.toast(`"${radio.name || radio.source}" marked as Lost`);
        } else if(v === "__disabled__"){
          if(radio.lost) await ctx.actions.radioLostSet(radio.source, false);
          await ctx.actions.radioDisabledSet(radio.source, true);
          ctx.actions.closeModal();
          ctx.toast(`"${radio.name || radio.source}" marked as Disabled`);
        } else {
          // Restore from lost/disabled if needed, then set area
          if(radio.lost)     await ctx.actions.radioLostSet(radio.source, false);
          if(radio.disabled) await ctx.actions.radioDisabledSet(radio.source, false);
          const payload = { area_name: v };
          if(radio.device_id) payload.device_id = radio.device_id;
          else if(radio.source) payload.source = radio.source;
          await ctx.actions.radioAreaSet(payload);
          ctx.actions.closeModal();
          ctx.toast(v ? `Area set to "${v}"` : "Area cleared");
        }
        await ctx.actions.refreshSnapshot();
      } catch(e) {
        status.textContent = "Failed to update. Check HA logs.";
        saveBtn.disabled = false;
      }
    });
    const radioLabel = [sid, radio.name || radio.source].filter(Boolean).join("  ·  ");
    const body = el("div",{},[
      el("div",{class:"muted", style:"margin-bottom:8px"}, `Radio: ${radioLabel}`),
      radio.lost     ? el("div",{style:"color:#f59e0b;font-size:12px;margin-bottom:8px"}, "⚠ Currently marked as Lost. Select a room to restore it.") : null,
      radio.disabled ? el("div",{style:"color:#c084fc;font-size:12px;margin-bottom:8px"}, "⊘ Currently Disabled. Select a room to re-enable it.") : null,
      el("div",{style:"color:#94a3b8;font-size:12px;margin-bottom:10px"}, areas.length ? "Select an HA area for this scanner:" : "No HA areas found. Add areas in HA Settings → Areas & Zones."),
      el("div",{class:"row",style:"gap:8px;flex-wrap:wrap"},[sel, saveBtn, cancelBtn]),
      status,
    ].filter(Boolean));
    ctx.actions.openModal("Assign Area", body, `HA area for "${radio.name || radio.source}"`);
  }

  async function fillVendorCell(mac, cell){
    // Cache by prefix (AA:BB:CC)
    ctx.state._vendorCache = ctx.state._vendorCache || {};
    const prefix = (mac||"").split(":").slice(0,3).join(":").toUpperCase();
    if(!prefix){ cell.textContent = ""; return; }

    const cached = ctx.state._vendorCache[prefix];
    if(cached){
      cell.innerHTML = renderVendorHTML(cached);
      return;
    }

    // Placeholder while fetching
    cell.innerHTML = `<span class="badge">Looking up…</span>`;
    try{
      const res = await ctx.actions.vendorLookup(mac, false);
      ctx.state._vendorCache[prefix] = res;
      cell.innerHTML = renderVendorHTML(res);
    }catch(e){
      cell.innerHTML = `<span class="badge err">Lookup failed</span>`;
    }
  }

  function renderVendorHTML(res){
    if(!res || res.enabled === false){
      return `<span class="badge warn">Vendor lookup disabled</span>`;
    }
    const v1 = res.sources?.macvendors || null;
    const v2 = res.sources?.maclookup?.company || null;
    const rand = res.sources?.maclookup?.isRand;
    const priv = res.sources?.maclookup?.isPrivate;
    const flags = [];
    if(rand===true) flags.push("randomized");
    if(priv===true) flags.push("private");
    const top = (v2 || v1 || "Unknown vendor");
    const sub = flags.length ? ` <span class="badge warn">${flags.join(", ")}</span>` : "";
    const bt = res.sources?.maclookup?.blockType ? ` · ${res.sources.maclookup.blockType}` : "";
    return `<div><span class="badge">${escapeHtml(top)}</span>${sub}${escapeHtml(bt)}</div>`;
  }

  function escapeHtml(s){
    return String(s||"").replace(/[&<>"']/g,(c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
  }

  function openObjectsList(initialFilter="all"){
    if(!liveSnap || !liveSnap.objects){
      const body = el("div",{},[
        el("p",{}, "Objects list is only available in Live mode (it includes BLE advertisement monitor data)."),
        el("p",{}, "Switch to Live in Settings, then reopen this list.")
      ]);
      ctx.actions.openModal("Objects", body, "Live snapshot required");
      return;
    }

    const list = liveSnap.objects.list || [];
    const summary = liveSnap.objects.summary || {};
    const commonPrefixes = summary.common_prefixes || {};

    const body = el("div",{});
    const controls = el("div",{class:"controls"});
    const search = el("input",{type:"text", placeholder:"Filter by address, vendor, entity, room…"});
    const kindSel = el("select",{},[
      el("option",{value:"all"}, "All kinds"),
      el("option",{value:"entity"}, "Entities only"),
      el("option",{value:"ble"}, "BLE only"),
    ]);
    const statusSel = el("select",{},[
      el("option",{value:"all"}, "All statuses"),
      el("option",{value:"identified"}, "Identified"),
      el("option",{value:"unidentified"}, "Unidentified"),
    ]);
    statusSel.value = initialFilter === "unidentified" ? "unidentified" : "all";

    const commonOnly = el("label",{style:"display:flex;align-items:center;gap:6px"},[
      el("input",{type:"checkbox"}),
      el("span",{}, "Only common OUIs (≥3)")
    ]);

    const stats = el("div",{class:"spacer"});
    controls.appendChild(el("span",{class:"badge"}, `${fmtNum(summary.total||0)} total`));
    controls.appendChild(el("span",{class:"badge"}, `${fmtNum(summary.unidentified||0)} unidentified`));
    controls.appendChild(search);
    controls.appendChild(kindSel);
    controls.appendChild(statusSel);
    controls.appendChild(commonOnly);
    controls.appendChild(stats);

    const table = el("table",{class:"table"});
    const thead = el("thead",{}, el("tr",{},[
      el("th",{}, "Kind"),
      el("th",{}, "Name / Entity"),
      el("th",{}, "Address"),
      el("th",{}, "Room"),
      el("th",{}, "Signal"),
      el("th",{}, "Last seen"),
      el("th",{}, "OUI freq"),
      el("th",{}, "Follow"),
      el("th",{}, "Tag"),
      el("th",{}, "Vendor (online)"),
    ]));
    const tbody = el("tbody",{});
    table.appendChild(thead);
    table.appendChild(tbody);

    // Build rows once, then filter by show/hide (fast, no re-render).
    const rowEls = list.map((o)=>{
      const kind = o.kind || "";
      const identified = !!o.identified;
      const addr = o.address || "";
      const userLabel = o.user_label || "";
      const name = userLabel || o.name || o.entity_id || "";
      const room = o.room || "";
      const rssi = (o.rssi==null?"":String(o.rssi));
      const lastSeen = o.age_s!=null ? fmtAgo(o.age_s) : (o.last_seen || "");
      const pfxCount = o.prefix_count || 0;
      const pfx = (o.prefix || "").toUpperCase();
      const isCommon = pfx && (commonPrefixes[pfx] || 0) >= 3;

      const vendorCell = el("td",{}, kind==="ble" ? el("span",{class:"badge"}, "—") : el("span",{class:"badge"}, "n/a"));

      // Follow button
      const followKey = addr || o.entity_id || "";
      const followCell = (() => {
        if (!followKey) return el("td",{}, "");
        const isF = ctx.actions.followedHas(followKey);
        const btn = el("button",{
          class: "btn tiny",
          style: isF ? "background:#1a3a2a;border-color:#52b788;color:#52b788" : "",
        }, isF ? "✓ Following" : "Follow");
        btn.addEventListener("click",(e)=>{ e.stopPropagation(); ctx.actions.followedToggle(followKey); });
        return el("td",{}, btn);
      })();

      // Tag button for BLE rows
      const tagCell = (() => {
        if (kind !== "ble" || !addr) return el("td",{}, "");
        const btn = el("button",{class:"btn tiny"}, userLabel ? "Relabel" : "Tag");
        btn.addEventListener("click",(e)=>{
          e.stopPropagation();
          ctx.actions.tagObjectPrompt(addr, userLabel);
        });
        const wrap = el("div",{style:"display:flex;align-items:center;gap:6px"});
        if(userLabel) wrap.appendChild(el("span",{style:"color:#94a3b8;font-size:12px"}, userLabel));
        wrap.appendChild(btn);
        return el("td",{}, wrap);
      })();

      const tr = el("tr",{
        "data-kind": kind,
        "data-identified": identified ? "1":"0",
        "data-common": isCommon ? "1":"0",
        "data-search": `${kind} ${name} ${addr} ${room} ${userLabel} ${(o.entity_id||"")} ${(o.linked_entities||[]).join(" ")}`.toLowerCase(),
        "data-mac": addr,
      },[
        el("td",{}, kind==="ble" ? pill("BLE","") : pill("Entity","")),
        el("td",{}, [
          el("div",{}, name),
          (userLabel && (o.name && o.name !== userLabel) ? el("div",{style:"color:#94a3b8"}, `raw: ${o.name}`) : null),
          (o.entity_id ? el("div",{style:"color:#94a3b8"}, o.entity_id) : null),
          (Array.isArray(o.linked_entities) && o.linked_entities.length ? el("div",{style:"color:#94a3b8"}, `Linked: ${o.linked_entities.join(", ")}`) : null),
          (kind==="ble" && Array.isArray(o.sources) && o.sources.length ? el("div",{style:"color:#94a3b8"}, `Seen by: ${o.sources.join(", ")}`) : null),
          (kind==="ble" && o.manufacturer_data && Object.keys(o.manufacturer_data).length ? el("div",{style:"color:#94a3b8"}, `Manuf IDs: ${Object.keys(o.manufacturer_data).slice(0,3).join(", ")}${Object.keys(o.manufacturer_data).length>3?"…":""}`) : null),
          (kind==="ble" && Array.isArray(o.service_uuids) && o.service_uuids.length ? el("div",{style:"color:#94a3b8"}, `Services: ${o.service_uuids.length}`) : null),
          (o.device && (o.device.manufacturer || o.device.model) ? el("div",{style:"color:#94a3b8"}, `${o.device.manufacturer||""} ${o.device.model||""}`.trim()) : null),
        ].filter(Boolean)),
        el("td",{}, addr || "—"),
        el("td",{}, room || "—"),
        el("td",{}, rssi ? `${rssi} dBm` : "—"),
        el("td",{}, lastSeen || "—"),
        el("td",{}, pfxCount>=3 ? el("span",{class:"badge warn"}, `${pfxCount}×`) : (pfxCount? String(pfxCount):"")),
        followCell,
        tagCell,
        vendorCell,
      ]);

      tr.style.cursor = "pointer";
      tr.addEventListener("click",(ev)=>{
        if(ev.target.tagName==="BUTTON"||ev.target.tagName==="A") return;
        ctx.actions.closeModal(); ctx.actions.showObjectDetail(o);
      });
      // kick vendor lookup for BLE rows (best-effort, after render)
      tr._vendorCell = vendorCell;
      return tr;
    });

    rowEls.forEach(tr=>tbody.appendChild(tr));

    function apply(){
      const q = (search.value||"").trim().toLowerCase();
      const k = kindSel.value;
      const st = statusSel.value;
      const co = commonOnly.querySelector("input").checked;

      let shown = 0;

      for(const tr of rowEls){
        const kind = tr.getAttribute("data-kind");
        const idf = tr.getAttribute("data-identified")==="1";
        const common = tr.getAttribute("data-common")==="1";
        const hay = tr.getAttribute("data-search") || "";

        let ok = true;
        if(q && !hay.includes(q)) ok=false;
        if(k!=="all" && kind!==k) ok=false;
        if(st==="identified" && !idf) ok=false;
        if(st==="unidentified" && idf) ok=false;
        if(co && !common) ok=false;

        tr.style.display = ok ? "" : "none";
        if(ok) shown++;
      }
      stats.textContent = `${shown} shown`;
    }

    search.addEventListener("input", apply);
    kindSel.addEventListener("change", apply);
    statusSel.addEventListener("change", apply);
    commonOnly.querySelector("input").addEventListener("change", apply);
    apply();

    body.appendChild(controls);
    body.appendChild(table);

    ctx.actions.openModal("Objects", body, "Filter + vendor lookup (best-effort)");

    // After modal opens, do vendor lookups for visible BLE rows (limited concurrency).
    const maxLookups = 40;
    const queue = rowEls
      .filter(tr=>tr.getAttribute("data-kind")==="ble")
      .slice(0, maxLookups);

    // lightweight concurrency limiter
    let i = 0;
    const conc = 3;
    const runOne = async ()=>{
      while(i < queue.length){
        const tr = queue[i++];
        if(tr.style.display==="none") continue;
        const mac = tr.getAttribute("data-mac") || "";
        const cell = tr._vendorCell;
        if(mac && cell) await fillVendorCell(mac, cell);
      }
    };
    for(let n=0;n<conc;n++) runOne();
  }

  // ---------- 3D Iso Floor Stack (uses uploaded maps data + live presence) ----------
  function renderIsoFloorStack(){
    const maps_list = (ctx.state.maps && ctx.state.maps.list) ? ctx.state.maps.list : [];
    // Fallback: sample floor plan → room grid
    if(!maps_list.length){
      if(liveSnap && liveSnap.floor_plan) return renderFloorPlan(liveSnap.floor_plan);
      return renderRoomGrid();
    }

    const TILE=220, CX=380, CY=590, W=760, BASE_H=940;
    const LAYER_PAL = ["#52b788","#f59e0b","#60a5fa","#e879f9","#fb923c","#34d399","#f87171","#a78bfa"];
    const roomColorFn = ctx.helpers.roomColor;
    const _esc = s=>String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    if(ctx.state._overviewFloorGap===undefined) ctx.state._overviewFloorGap = ctx.state.settings?.overview_iso_floor_gap ?? 150;
    if(ctx.state._overviewHorizGap===undefined) ctx.state._overviewHorizGap = ctx.state.settings?.overview_iso_horiz_gap ?? 0;
    let _ovFG=ctx.state._overviewFloorGap, _ovHG=ctx.state._overviewHorizGap;
    const iso = (wx,wy,wz)=>[CX+(wx-wy)*TILE*0.866+wz*_ovHG, CY+(wx+wy)*TILE*0.5-wz*_ovFG];
    const pt  = c=>`${Math.round(c[0])},${Math.round(c[1])}`;
    const pts = cs=>cs.map(pt).join(" ");

    const allObjects = (liveSnap && liveSnap.objects && Array.isArray(liveSnap.objects.list)) ? liveSnap.objects.list : [];
    const allRadios_live = radios;

    // Filter hidden maps
    const hiddenIds = (ctx.state.maps && ctx.state.maps._hiddenMapIds) || new Set();
    const sorted = [...maps_list].filter(m=>!hiddenIds.has(m.id)).sort((a,b)=>(a.stack?.z_level||0)-(b.stack?.z_level||0));

    // Group maps by z_level
    const byLevel = new Map();
    for(const m of sorted){
      const z=m.stack?.z_level??0;
      if(!byLevel.has(z)) byLevel.set(z,[]);
      byLevel.get(z).push(m);
    }
    const sortedIsoLevels = [...byLevel.keys()].sort((a,b)=>a-b);
    const levelColor = (z) => LAYER_PAL[sortedIsoLevels.indexOf(z) % LAYER_PAL.length];

    // ── Slider positions: all → l0 → l0+l1 → l1 → l1+l2 → l2 → … ───────────
    // Each position is null (all), a single z-level, or [z0, z1] (adjacent pair).
    const _isoPos = [null];
    for(let _fi=0; _fi<sortedIsoLevels.length; _fi++){
      _isoPos.push(sortedIsoLevels[_fi]);
      if(_fi < sortedIsoLevels.length-1)
        _isoPos.push([sortedIsoLevels[_fi], sortedIsoLevels[_fi+1]]);
    }
    const _getFocusZ   = (idx) => _isoPos[Math.max(0,Math.min(idx,_isoPos.length-1))];
    const _getFocusLbl = (idx) => {
      const pos = _getFocusZ(idx);
      if(pos === null) return "All floors";
      const fl = ctx.state.model?.floors || [];
      const zArr = Array.isArray(pos) ? pos : [pos];
      return zArr.map(z=>{ const f=fl.find(x=>x.level===z); return f?(f.name||`L${z}`):`L${z}`; }).join(" + ");
    };

    // Build room centroid + receiver iso positions for live data overlay
    // _rebuildPositions() is called initially and whenever iso params change (slider)
    const roomIsoPos = {}, receiverIsoByRoom = {};
    function _rebuildPositions(){
      for(const k of Object.keys(roomIsoPos)) delete roomIsoPos[k];
      for(const k of Object.keys(receiverIsoByRoom)) delete receiverIsoByRoom[k];
      for(const m of sorted){
        const stk=m.stack||{}, z=stk.z_level||0, ox=stk.x_offset||0, oy_=stk.y_offset||0, sc=stk.scale||1.0;
        const ar=(m.image?.height||600)/(m.image?.width||800);
        for(const [room,b] of Object.entries(m.room_bounds||{})){
          if(!b||b.type!=="poly"||!Array.isArray(b.points)||b.points.length<3) continue;
          const cx=b.points.reduce((a,p)=>a+p[0],0)/b.points.length;
          const cy=b.points.reduce((a,p)=>a+p[1],0)/b.points.length;
          roomIsoPos[room] = iso(ox+cx*sc, oy_+cy*sc*ar, z);
        }
        for(const r of (m.receivers||[])){
          if(r.room && !receiverIsoByRoom[r.room])
            receiverIsoByRoom[r.room] = iso(ox+(r.x||0)*sc, oy_+(r.y||0)*sc*ar, z);
        }
      }
    }
    _rebuildPositions();

    if(ctx.state._overviewIsoFocusIdx === undefined)
      ctx.state._overviewIsoFocusIdx = Math.max(0, Math.min(ctx.state.settings?.overview_iso_focus ?? 0, _isoPos.length-1));
    const hasBounds = sorted.some(m=>Object.keys(m.room_bounds||{}).length>0);

    // ── Fingerprint positioning ─────────────────────────────────────────────
    // Load calibration data the first time (non-blocking; re-renders when ready)
    if(!ctx.state.calibration){
      ctx.actions.calibrationGet().then(d=>{
        ctx.state.calibration = d;
        ctx.actions.renderRooms();
      }).catch(()=>{});
    }
    const calPoints = (ctx.state.calibration?.points) || [];

    // Per-map coord transform: image-fraction (0-1) → ISO screen pixel
    // Uses the same mapPt formula as the room-polygon renderer so positions align exactly.
    const mapTransforms = {};
    for(const m of sorted){
      const stk=m.stack||{}, z=stk.z_level||0, ox=stk.x_offset||0, oy_=stk.y_offset||0, sc=stk.scale||1.0;
      const ar=(m.image?.height||600)/(m.image?.width||800);
      const arRefT=stk.ref_ar||ar, sxAdjT=stk.scale_x_adj||1.0;
      const rotRad=(stk.rotation||0)*Math.PI/180;
      mapTransforms[m.id]={z, mapPt:(px,py)=>{
        const dx=(px-0.5)*sc*sxAdjT, dy=(py-0.5)*sc*arRefT;
        const rx=dx*Math.cos(rotRad)-dy*Math.sin(rotRad);
        const ry=dx*Math.sin(rotRad)+dy*Math.cos(rotRad);
        return[(0.5+ox)+rx, arRefT*(0.5+oy_)+ry];
      }};
    }

    // Collect per-source RSSI for an object from the live advertisement stream.
    // obj.sources in the snapshot is a string array; the actual RSSI values are in
    // snap.ble.advertisements (one row per {address, source}).
    function _getObjReadings(obj){
      const addr = obj.address||"";
      if(!addr) return {};
      const readings={};
      for(const ad of (liveSnap?.ble?.advertisements||[])){
        if(ad.address!==addr || !ad.source || ad.rssi==null) continue;
        if(!readings[ad.source] || (ad.age_s||0) < readings[ad.source].age_s)
          readings[ad.source]={rssi:ad.rssi, age_s:ad.age_s||0};
      }
      return readings;
    }

    // k-NN fingerprint match across all calibration points visible on current maps.
    // Returns {sx, sy, z, dist, confidence} (ISO screen coords) or null.
    // Age-decay: readings >45 s old contribute less weight.
    // Missing-source penalty: 28 dBm per calibration source absent from current scan.
    function _matchFingerprint(readings){
      if(!calPoints.length) return null;
      const obsSrcs = Object.keys(readings);
      if(!obsSrcs.length) return null;
      const scored=[];
      for(const p of calPoints){
        if(!mapTransforms[p.map_id]) continue;
        const cal=p.scanner_readings||{};
        let sumSq=0, count=0;
        for(const src of obsSrcs){
          if(cal[src]?.rssi!=null){
            const ageW = Math.exp(-(readings[src].age_s||0)/45);
            const diff  = readings[src].rssi - cal[src].rssi;
            sumSq += diff*diff * Math.max(ageW, 0.1);
            count++;
          }
        }
        if(count<1) continue;
        const missing = Object.keys(cal).length - count;
        const dist = Math.sqrt(sumSq/count) + missing*28;
        scored.push({p, dist});
      }
      if(!scored.length) return null;
      scored.sort((a,b)=>a.dist-b.dist);
      const k=Math.min(5, scored.length);
      // Find dominant map (highest total weight among top-k)
      const mapW={};
      for(let i=0;i<k;i++){
        const {p,dist}=scored[i]; const w=1/Math.max(dist*dist,0.01);
        mapW[p.map_id]=(mapW[p.map_id]||0)+w;
      }
      let bestMap=scored[0].p.map_id, bestW=0;
      for(const [mid,w] of Object.entries(mapW)){if(w>bestW){bestW=w;bestMap=mid;}}
      // Weighted centroid using only points on the dominant map
      let wx=0, wy=0, wTotal=0;
      for(let i=0;i<k;i++){
        const {p,dist}=scored[i];
        if(p.map_id!==bestMap) continue;
        const w=1/Math.max(dist*dist,0.01);
        wx+=p.x_frac*w; wy+=p.y_frac*w; wTotal+=w;
      }
      if(!wTotal) return null;
      const tf=mapTransforms[bestMap];
      const [lwx,lwy]=tf.mapPt(wx/wTotal, wy/wTotal);
      const [sx,sy]=iso(lwx, lwy, tf.z);
      return{sx, sy, z:tf.z, dist:scored[0].dist, confidence:Math.max(0,1-scored[0].dist/50)};
    }
    const LEGEND_H = sortedIsoLevels.length * 30 + 24;

    const buildIsoSVG = (focusZ)=>{
      const slabWZ = 18/_ovFG;
      // Dynamic viewBox: expand upward so high floors aren't clipped when spacing is large
      const maxIsoZ = sortedIsoLevels.length ? sortedIsoLevels[sortedIsoLevels.length-1] : 0;
      const viewY   = Math.min(0, CY - maxIsoZ*_ovFG - 50);   // 50 px top padding
      const HTOTAL  = BASE_H + LEGEND_H - viewY;
      let s = `<svg viewBox="0 ${viewY} ${W} ${HTOTAL}" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:${HTOTAL}px;display:block;font-family:system-ui,sans-serif">`;
      s += `<rect x="0" y="${viewY}" width="${W}" height="${HTOTAL}" fill="#071008"/>`;

      // Floor surface patterns — defined once per level, referenced by fill="url(#...)"
      s += `<defs>`;
      sortedIsoLevels.forEach((z2, li) => {
        const c2 = levelColor(z2);
        if(li === 0){
          // Ground floor: subtle paisley (teardrop + curl + inner dot)
          s += `<pattern id="flrpat_${li}" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">`;
          s += `<path d="M12,2 C16,2 19,6 19,11 C19,16 16,21 12,22 C8,21 5,16 5,11 C5,6 8,2 12,2 Z" fill="none" stroke="${c2}" stroke-width="0.7" opacity="0.14"/>`;
          s += `<path d="M12,2 C13.5,0 15.5,0.5 14.5,2.5 C13.5,1.5 12,2 12,2 Z" fill="${c2}" opacity="0.11"/>`;
          s += `<circle cx="12" cy="15" r="1.4" fill="${c2}" opacity="0.1"/>`;
          s += `</pattern>`;
        } else if(li === 2){
          // Level 2: crosshatch (two diagonal sets of lines)
          s += `<pattern id="flrpat_${li}" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">`;
          s += `<line x1="0" y1="12" x2="12" y2="0" stroke="${c2}" stroke-width="0.6" opacity="0.18"/>`;
          s += `<line x1="0" y1="0" x2="12" y2="12" stroke="${c2}" stroke-width="0.6" opacity="0.18"/>`;
          s += `</pattern>`;
        } else if(li >= 3){
          // Level 3+: hex dot grid
          s += `<pattern id="flrpat_${li}" x="0" y="0" width="16" height="13.86" patternUnits="userSpaceOnUse">`;
          s += `<circle cx="0"  cy="0"     r="1.5" fill="${c2}" opacity="0.14"/>`;
          s += `<circle cx="8"  cy="6.93"  r="1.5" fill="${c2}" opacity="0.14"/>`;
          s += `<circle cx="16" cy="0"     r="1.5" fill="${c2}" opacity="0.14"/>`;
          s += `<circle cx="0"  cy="13.86" r="1.5" fill="${c2}" opacity="0.14"/>`;
          s += `<circle cx="16" cy="13.86" r="1.5" fill="${c2}" opacity="0.14"/>`;
          s += `</pattern>`;
        }
        // li === 1: no pattern (clean slab)
      });
      s += `</defs>`;

      if(!sorted.length){
        s += `<text x="${W/2}" y="${BASE_H/2}" text-anchor="middle" fill="#4a6052" font-size="13">All layers hidden</text>`;
        s += `</svg>`; return s;
      }

      for(const [z,group] of [...byLevel.entries()].sort((a,b)=>a[0]-b[0])){
        const isFocused = focusZ===null || (Array.isArray(focusZ) ? focusZ.includes(z) : focusZ===z);
        const go = isFocused ? 1.0 : 0.1;
        const lyrColor = levelColor(z);
        const lidx = sortedIsoLevels.indexOf(z);

        let x0=Infinity,y0_=Infinity,x1=-Infinity,y1_=-Infinity;
        for(const m of group){
          const stk=m.stack||{}, ox=stk.x_offset||0, oy__=stk.y_offset||0, sc=stk.scale||1.0;
          const ar=(m.image?.height||600)/(m.image?.width||800);
          const arRefBB=stk.ref_ar||ar, sxAdjBB=stk.scale_x_adj||1.0;
          const rot=(stk.rotation||0)*Math.PI/180;
          const bbPt=(px,py)=>{const dx=(px-0.5)*sc*sxAdjBB,dy=(py-0.5)*sc*arRefBB,rx=dx*Math.cos(rot)-dy*Math.sin(rot),ry=dx*Math.sin(rot)+dy*Math.cos(rot);return[(0.5+ox)+rx,arRefBB*(0.5+oy__)+ry];};
          for(const [cx,cy] of [[0,0],[1,0],[1,1],[0,1]]){const[wx,wy]=bbPt(cx,cy);x0=Math.min(x0,wx);y0_=Math.min(y0_,wy);x1=Math.max(x1,wx);y1_=Math.max(y1_,wy);}
        }
        if(!isFinite(x0)){x0=0;y0_=0;x1=1;y1_=0.75;}

        const TL=iso(x0,y0_,z), TR=iso(x1,y0_,z), BR=iso(x1,y1_,z), BL=iso(x0,y1_,z);
        const TR_b=iso(x1,y0_,z-slabWZ), BR_b=iso(x1,y1_,z-slabWZ), BL_b=iso(x0,y1_,z-slabWZ);

        s += `<g opacity="${go}">`;
        s += `<polygon points="${pts([TR,BR,BR_b,TR_b])}" fill="#0d2318" fill-opacity="0.35" stroke="#253e2e" stroke-width="0.8"/>`;
        s += `<polygon points="${pts([BL,BR,BR_b,BL_b])}" fill="#0a1a12" fill-opacity="0.3" stroke="#253e2e" stroke-width="0.8"/>`;
        s += `<polygon points="${pts([TL,TR,BR,BL])}" fill="#0f2017" fill-opacity="0.06" stroke="${lyrColor}" stroke-width="1.5" stroke-dasharray="10,5" opacity="0.5"/>`;
        if(lidx !== 1){ s += `<polygon points="${pts([TL,TR,BR,BL])}" fill="url(#flrpat_${lidx})" stroke="none"/>`; }

        // Room polygons
        for(const m of group){
          const stk=m.stack||{}, ox=stk.x_offset||0, oy__=stk.y_offset||0, sc=stk.scale||1.0;
          const ar=(m.image?.height||600)/(m.image?.width||800);
          const rotRad=(stk.rotation||0)*Math.PI/180;
          // CSS-matching: scale centered, rotation in pixel space, then offset
          const arRef=stk.ref_ar||ar, sxAdj=stk.scale_x_adj||1.0;
          const mapPt=(px,py)=>{const dx=(px-0.5)*sc*sxAdj,dy=(py-0.5)*sc*arRef,rx=dx*Math.cos(rotRad)-dy*Math.sin(rotRad),ry=dx*Math.sin(rotRad)+dy*Math.cos(rotRad);return[(0.5+ox)+rx,arRef*(0.5+oy__)+ry];};
          for(const [room,b] of Object.entries(m.room_bounds||{})){
            if(!b||b.type!=="poly"||!Array.isArray(b.points)||b.points.length<3) continue;
            const color = roomColorFn(room);
            const pp = b.points.map(p=>{const[wx,wy]=mapPt(p[0],p[1]);return pt(iso(wx,wy,z));}).join(" ");
            s += `<polygon points="${pp}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5" opacity="0.9"/>`;
            const cx=b.points.reduce((a,p)=>a+p[0],0)/b.points.length;
            const cy=b.points.reduce((a,p)=>a+p[1],0)/b.points.length;
            const [lwx,lwy]=mapPt(cx,cy);
            const [lix,liy]=iso(lwx,lwy,z);
            s += `<text x="${Math.round(lix)}" y="${Math.round(liy)+lidx*2}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="7">${_esc(room)}</text>`;
          }
          // Placed receivers
          for(const r of (m.receivers||[])){
            const[wx,wy]=mapPt(r.x||0,r.y||0);
            const [px,py]=iso(wx,wy,z);
            s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="13" fill="none" stroke="#52b788" stroke-width="1.2" opacity="0.3"/>`;
            s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="7"  fill="none" stroke="#52b788" stroke-width="1.5" opacity="0.6"/>`;
            s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="4"  fill="#52b788" opacity="0.9"/>`;
          }
        }

        // Layer index dot at bottom-left corner (BL = front-left of top face)
        s += `<circle cx="${Math.round(BL[0])}" cy="${Math.round(BL[1])}" r="15" fill="${lyrColor}" opacity="0.95"/>`;
        s += `<text x="${Math.round(BL[0])}" y="${Math.round(BL[1])+6}" text-anchor="middle" fill="#071008" font-size="14" font-weight="700">${lidx+1}</text>`;
        s += `</g>`;
      }

      // Followed beacons — fingerprint-positioned using all live RSSI data
      const followedAddrs = ctx.state.followedAddrs || new Set();
      const followedObjects = allObjects.filter(o =>
        followedAddrs.has(o.address || "") || followedAddrs.has(o.entity_id || "")
      );
      // Bright gold (#fbbf24) — intentionally distinct from all other map elements:
      // radios are green, rooms are per-room color, floor badges are LAYER_PAL.
      const BEACON_CLR = "#fbbf24";
      for(const o of followedObjects){
        const readings = _getObjReadings(o);
        const match    = _matchFingerprint(readings);
        const lbl = (o.user_label||o.name||"?").substring(0,14);
        let bx, by;
        if(match){
          bx=match.sx; by=match.sy;
          // Dashed uncertainty ring: tight+opaque = confident; wide+faint = uncertain
          const cr = Math.round(10 + (1-match.confidence)*24);
          const op = (0.3 + match.confidence*0.55).toFixed(2);
          s += `<circle cx="${Math.round(bx)}" cy="${Math.round(by)}" r="${cr}" fill="none" stroke="${BEACON_CLR}" stroke-width="1.5" stroke-dasharray="5,3" opacity="${op}"/>`;
        } else if(o.room && roomIsoPos[o.room]){
          [bx,by] = roomIsoPos[o.room];
        } else { continue; }
        // Outer glow ring
        s += `<circle cx="${Math.round(bx)}" cy="${Math.round(by)}" r="14" fill="${BEACON_CLR}" opacity="0.18"/>`;
        // Main dot
        s += `<circle cx="${Math.round(bx)}" cy="${Math.round(by)}" r="10" fill="${BEACON_CLR}" stroke="#071008" stroke-width="1.5" opacity="0.97"/>`;
        // Dark centre pip
        s += `<circle cx="${Math.round(bx)}" cy="${Math.round(by)}" r="3" fill="#071008" opacity="0.7"/>`;
        // Label: dark backing rect + bright text
        const lblW = Math.min(lbl.length * 7 + 10, 110);
        s += `<rect x="${Math.round(bx)-lblW/2}" y="${Math.round(by)-30}" width="${lblW}" height="14" rx="3" fill="#071008" opacity="0.7"/>`;
        s += `<text x="${Math.round(bx)}" y="${Math.round(by)-19}" text-anchor="middle" fill="${BEACON_CLR}" font-size="11" font-weight="700">${_esc(lbl)}</text>`;
      }

      // Live BLE radios — rings only, no text labels
      const drawn = new Set();
      for(const radio of allRadios_live){
        const name = radio.name||radio.source||"";
        if(drawn.has(name)) continue; drawn.add(name);
        const area = radio.area_name;
        const pos = (area && receiverIsoByRoom[area]) || (area && roomIsoPos[area]);
        let px,py;
        if(pos){ [px,py]=pos; }
        else { const idx=drawn.size-1; px=50+idx*160; py=BASE_H-40; if(px>W-80) continue; }
        s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="22" fill="none" stroke="#52b788" stroke-width="1" opacity="0.2"/>`;
        s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="14" fill="none" stroke="#52b788" stroke-width="1.5" opacity="0.45"/>`;
        s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="7"  fill="#52b788" opacity="0.9"/>`;
        s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="3"  fill="#071008" opacity="0.7"/>`;
      }

      if(!hasBounds && sorted.length){
        s += `<text x="${W/2}" y="${BASE_H-20}" text-anchor="middle" fill="#4a6052" font-size="16">Go to Maps → Edit to draw room boundaries</text>`;
      }

      // Legend at bottom
      s += `<line x1="10" y1="${BASE_H+4}" x2="${W-10}" y2="${BASE_H+4}" stroke="#1b3526" stroke-width="0.8"/>`;
      sortedIsoLevels.forEach((z, i)=>{
        const ly = BASE_H + 10 + i * 30;
        const color = levelColor(z);
        const groupLabel = byLevel.get(z).map(m=>m.name||m.id).join(" + ");
        s += `<circle cx="18" cy="${ly+11}" r="11" fill="${color}" opacity="0.9"/>`;
        s += `<text x="18" y="${ly+15}" text-anchor="middle" fill="#071008" font-size="12" font-weight="700">${i+1}</text>`;
        s += `<text x="36" y="${ly+15}" fill="${color}" font-size="18" font-weight="500">${_esc(groupLabel)}</text>`;
      });

      s += `</svg>`;
      return s;
    };

    // Wrapper with floor focus slider + room list toggle
    const outer = document.createElement("div");
    outer.style.cssText = "margin-bottom:16px";

    const focusLbl = document.createElement("span");
    focusLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:80px;display:inline-block";
    focusLbl.textContent = _getFocusLbl(ctx.state._overviewIsoFocusIdx);

    const focusSlider = document.createElement("input");
    focusSlider.type = "range"; focusSlider.min = "0"; focusSlider.max = String(_isoPos.length-1);
    focusSlider.style.cssText = "width:130px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
    focusSlider.value = String(ctx.state._overviewIsoFocusIdx);

    const isoDiv = document.createElement("div");
    isoDiv.style.cssText = "overflow:auto;border-radius:8px;background:#071008;padding:8px;margin-top:6px";
    isoDiv.innerHTML = buildIsoSVG(_getFocusZ(ctx.state._overviewIsoFocusIdx));

    const haFloors2 = ctx.state.model?.floors || [];
    focusSlider.addEventListener("input", ()=>{
      ctx.state._overviewIsoFocusIdx = parseInt(focusSlider.value, 10);
      focusLbl.textContent = _getFocusLbl(ctx.state._overviewIsoFocusIdx);
      isoDiv.innerHTML = buildIsoSVG(_getFocusZ(ctx.state._overviewIsoFocusIdx));
    });

    // Room list toggle
    if(ctx.state._overviewShowRoomList === undefined) ctx.state._overviewShowRoomList = false;
    const roomListPanel = document.createElement("div");
    roomListPanel.style.cssText = `margin-top:10px;display:${ctx.state._overviewShowRoomList?"block":"none"}`;

    // Build room list from all visible maps
    const ovRoomRows = [];
    for(const m of sorted){
      const floorId = m.stack?.floor_id || m.floor_id || "";
      const haFlr = haFloors2.find(f=>String(f.id)===String(floorId));
      const flLbl = haFlr ? (haFlr.name||haFlr.id) : (floorId||"—");
      for(const room of Object.keys(m.room_bounds||{})){
        if(!ovRoomRows.find(r=>r.room===room)){
          const objsInRoom = allObjects.filter(o=>o.room===room);
          ovRoomRows.push({ room, map: m.name||m.id, floor: flLbl, count: objsInRoom.length });
        }
      }
    }
    ovRoomRows.sort((a,b)=>a.room.localeCompare(b.room));

    if(ovRoomRows.length){
      const tbl = document.createElement("table");
      tbl.style.cssText = "width:100%;border-collapse:collapse;font-size:13px";
      tbl.innerHTML = `<thead><tr style="border-bottom:1px solid #1b3526">
        <th style="padding:5px 8px;color:#94a3b8;font-weight:500;text-align:left;width:24px"></th>
        <th style="padding:5px 8px;color:#94a3b8;font-weight:500;text-align:left">Room</th>
        <th style="padding:5px 8px;color:#94a3b8;font-weight:500;text-align:left">Floor</th>
        <th style="padding:5px 8px;color:#94a3b8;font-weight:500;text-align:left">Map</th>
        <th style="padding:5px 8px;color:#94a3b8;font-weight:500;text-align:right">Objects</th>
      </tr></thead>`;
      const tbody2 = document.createElement("tbody");
      const roomColorFn2 = ctx.helpers.roomColor;
      for(const rr of ovRoomRows){
        const color = roomColorFn2(rr.room);
        const tr2 = document.createElement("tr");
        tr2.style.cssText = "border-bottom:1px solid #0f2017";
        tr2.innerHTML = `<td style="padding:5px 8px"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${color};vertical-align:middle"></span></td>
          <td style="padding:5px 8px;font-weight:600;color:#e2e8f0">${rr.room}</td>
          <td style="padding:5px 8px;color:#94a3b8">${rr.floor}</td>
          <td style="padding:5px 8px;color:#94a3b8">${rr.map}</td>
          <td style="padding:5px 8px;color:#94a3b8;text-align:right">${rr.count||""}</td>`;
        tbody2.appendChild(tr2);
      }
      tbl.appendChild(tbody2);
      roomListPanel.appendChild(tbl);
    } else {
      const msg = document.createElement("div");
      msg.className = "muted"; msg.style.cssText = "font-size:12px;padding:8px";
      msg.textContent = "No rooms drawn yet. Go to Maps → Edit to draw room boundaries.";
      roomListPanel.appendChild(msg);
    }

    const roomToggleBtn = document.createElement("button");
    roomToggleBtn.className = "btn inline";
    roomToggleBtn.style.cssText = "margin-left:auto";
    roomToggleBtn.textContent = ctx.state._overviewShowRoomList ? "☰ Hide Room List" : "☰ Room List";
    roomToggleBtn.addEventListener("click", ()=>{
      ctx.state._overviewShowRoomList = !ctx.state._overviewShowRoomList;
      roomToggleBtn.textContent = ctx.state._overviewShowRoomList ? "☰ Hide Room List" : "☰ Room List";
      roomListPanel.style.display = ctx.state._overviewShowRoomList ? "block" : "none";
    });

    // Spacing slider
    const ovGapLbl = document.createElement("span");
    ovGapLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:36px;display:inline-block;text-align:right";
    ovGapLbl.textContent = String(ctx.state._overviewFloorGap);
    const ovGapSlider = document.createElement("input");
    ovGapSlider.type="range"; ovGapSlider.min="60"; ovGapSlider.max="340"; ovGapSlider.step="10";
    ovGapSlider.style.cssText = "width:110px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
    ovGapSlider.value = String(ctx.state._overviewFloorGap);
    ovGapSlider.addEventListener("input",()=>{
      ctx.state._overviewFloorGap = parseInt(ovGapSlider.value, 10);
      _ovFG = ctx.state._overviewFloorGap;
      ovGapLbl.textContent = String(ctx.state._overviewFloorGap);
      _rebuildPositions();
      isoDiv.innerHTML = buildIsoSVG(ctx.state._overviewIsoFocus);
    });

    // L/R horizontal offset slider
    const ovHorizLbl = document.createElement("span");
    ovHorizLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:36px;display:inline-block;text-align:right";
    ovHorizLbl.textContent = String(ctx.state._overviewHorizGap);
    const ovHorizSlider = document.createElement("input");
    ovHorizSlider.type="range"; ovHorizSlider.min="-120"; ovHorizSlider.max="120"; ovHorizSlider.step="10";
    ovHorizSlider.style.cssText = "width:110px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
    ovHorizSlider.value = String(ctx.state._overviewHorizGap);
    ovHorizSlider.addEventListener("input",()=>{
      ctx.state._overviewHorizGap = parseInt(ovHorizSlider.value, 10);
      _ovHG = ctx.state._overviewHorizGap;
      ovHorizLbl.textContent = String(ctx.state._overviewHorizGap);
      _rebuildPositions();
      isoDiv.innerHTML = buildIsoSVG(ctx.state._overviewIsoFocus);
    });

    const ctrlRow = document.createElement("div");
    ctrlRow.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap";
    const floorLbl = document.createElement("span");
    floorLbl.style.cssText = "font-size:12px;color:#94a3b8";
    floorLbl.textContent = "Floor:";
    ctrlRow.appendChild(floorLbl);
    ctrlRow.appendChild(focusSlider);
    ctrlRow.appendChild(focusLbl);
    // Spacing
    const ovSpacingLbl = document.createElement("span");
    ovSpacingLbl.style.cssText = "font-size:12px;color:#94a3b8;margin-left:8px";
    ovSpacingLbl.textContent = "Spacing:";
    ctrlRow.appendChild(ovSpacingLbl);
    ctrlRow.appendChild(ovGapSlider);
    ctrlRow.appendChild(ovGapLbl);
    // L/R
    const ovLRLbl = document.createElement("span");
    ovLRLbl.style.cssText = "font-size:12px;color:#94a3b8;margin-left:8px";
    ovLRLbl.textContent = "L/R:";
    ctrlRow.appendChild(ovLRLbl);
    ctrlRow.appendChild(ovHorizSlider);
    ctrlRow.appendChild(ovHorizLbl);
    // Save button — persists all three slider values to settings store
    const ovSaveLbl = document.createElement("span");
    ovSaveLbl.style.cssText = "font-size:11px;color:#94a3b8;min-width:50px";
    const ovSaveBtn = document.createElement("button");
    ovSaveBtn.className = "btn inline";
    ovSaveBtn.style.cssText = "padding:2px 10px;font-size:12px";
    ovSaveBtn.title = "Save these slider positions so the view reopens with the same layout";
    ovSaveBtn.textContent = "Save";
    ovSaveBtn.addEventListener("click", async ()=>{
      ovSaveBtn.disabled = true;
      try{
        await ctx.actions.settingsSet({
          overview_iso_floor_gap: ctx.state._overviewFloorGap,
          overview_iso_horiz_gap: ctx.state._overviewHorizGap,
          overview_iso_focus:     ctx.state._overviewIsoFocusIdx,
        });
        ovSaveLbl.textContent = "Saved ✓";
        setTimeout(()=>{ ovSaveLbl.textContent = ""; }, 2000);
      }catch(e){ ovSaveLbl.textContent = "Error"; }
      ovSaveBtn.disabled = false;
    });
    const ovResetBtn = document.createElement("button");
    ovResetBtn.className = "btn inline";
    ovResetBtn.style.cssText = "padding:2px 10px;font-size:12px";
    ovResetBtn.title = "Reset sliders to default values and clear the saved layout";
    ovResetBtn.textContent = "Reset";
    ovResetBtn.addEventListener("click", async ()=>{
      ctx.state._overviewFloorGap = 150; _ovFG = 150;
      ctx.state._overviewHorizGap = 0;   _ovHG = 0;
      ctx.state._overviewIsoFocusIdx = 0;
      ovGapSlider.value   = "150"; ovGapLbl.textContent   = "150";
      ovHorizSlider.value = "0";   ovHorizLbl.textContent = "0";
      focusSlider.value   = "0";   focusLbl.textContent   = "All floors";
      _rebuildPositions();
      isoDiv.innerHTML = buildIsoSVG(null);
      ovResetBtn.disabled = true;
      try{
        await ctx.actions.settingsSet({ overview_iso_floor_gap:150, overview_iso_horiz_gap:0, overview_iso_focus:0 });
        ovSaveLbl.textContent = "Reset ✓";
        setTimeout(()=>{ ovSaveLbl.textContent = ""; }, 2000);
      }catch(e){ ovSaveLbl.textContent = "Error"; }
      ovResetBtn.disabled = false;
    });
    ctrlRow.appendChild(ovSaveBtn);
    ctrlRow.appendChild(ovResetBtn);
    ctrlRow.appendChild(ovSaveLbl);
    ctrlRow.appendChild(roomToggleBtn);
    outer.appendChild(ctrlRow);
    outer.appendChild(isoDiv);
    outer.appendChild(roomListPanel);
    return outer;
  }

  // ---------- Room + radio grid (auto-generated from live HA data) ----------
  function renderRoomGrid(){
    const haAreas  = (ctx.state.model && Array.isArray(ctx.state.model.areas))  ? ctx.state.model.areas  : [];
    const haFloors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];

    const allRadios  = (liveSnap && liveSnap.ble && Array.isArray(liveSnap.ble.radios)) ? liveSnap.ble.radios : [];
    const allObjects = (liveSnap && liveSnap.objects && Array.isArray(liveSnap.objects.list)) ? liveSnap.objects.list : [];

    // Build room list from HA areas + roomTagMap (union)
    const roomSet = new Set(haAreas.map(a => a.name));
    for(const r of Object.keys(roomTagMap)) roomSet.add(r);
    const rooms = Array.from(roomSet).sort();

    if(!rooms.length && !allRadios.length) return null;

    // Group radios + objects by room
    const radiosByRoom = {}, objByRoom = {};
    for(const r of allRadios){
      const a = r.area_name || ""; if(a){ (radiosByRoom[a] = radiosByRoom[a]||[]).push(r); }
    }
    for(const o of allObjects){
      const r = o.room || ""; if(r){ (objByRoom[r] = objByRoom[r]||[]).push(o); }
    }
    const unassignedRadios = allRadios.filter(r => !r.area_name);

    // Layout constants — 2 columns, large boxes
    const COLS = 2, BW = 380, BH = 170, GAP = 16, PX = 14, PY = 14;
    const rows = Math.ceil(rooms.length / COLS);
    const svgW  = COLS * (BW + GAP) - GAP + PX * 2;
    const svgH  = rows * (BH + GAP) - GAP + PY * 2;
    const extraH = unassignedRadios.length ? BH * 0.6 + GAP : 0;
    const PALETTE = ["#52b788","#4caf50","#43a047","#388e3c","#66bb6a","#81c784","#a5d6a7","#2e7d32"];

    const _esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

    let s = `<svg viewBox="0 0 ${svgW} ${svgH + extraH}" xmlns="http://www.w3.org/2000/svg" width="100%" style="display:block;font-family:system-ui,sans-serif">`;
    s += `<rect width="${svgW}" height="${svgH + extraH}" fill="#071008" rx="8"/>`;

    rooms.forEach((room, idx) => {
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      const x = PX + col * (BW + GAP);
      const y = PY + row * (BH + GAP);
      const color = PALETTE[idx % PALETTE.length];

      // Box
      s += `<rect x="${x}" y="${y}" width="${BW}" height="${BH}" fill="${color}10" stroke="${color}" stroke-width="1.5" rx="10"/>`;

      // Room name
      s += `<text x="${x + BW/2}" y="${y + 22}" text-anchor="middle" fill="${color}" font-size="16" font-weight="700">${_esc(room)}</text>`;

      // Floor label from HA
      const haArea = haAreas.find(a => a.name === room);
      const haFloor = haFloors.find(f => f.id === (haArea?.floor_id||""));
      if(haFloor){
        s += `<text x="${x + BW/2}" y="${y + 37}" text-anchor="middle" fill="${color}88" font-size="11">${_esc(haFloor.name)}</text>`;
      }

      // Radios (antenna rings) — spread across the box width
      const roomRadios = radiosByRoom[room] || [];
      roomRadios.slice(0,5).forEach((r, ri) => {
        const rx = x + 22 + ri * 52, ry = y + 105;
        s += `<circle cx="${rx}" cy="${ry}" r="14" fill="none" stroke="#52b788" stroke-width="0.7" opacity="0.2"/>`;
        s += `<circle cx="${rx}" cy="${ry}" r="8"  fill="none" stroke="#52b788" stroke-width="1"   opacity="0.5"/>`;
        s += `<circle cx="${rx}" cy="${ry}" r="4"  fill="#52b788"/>`;
        const lbl = (r.name || r.source || "").substring(0, 9);
        s += `<text x="${rx}" y="${ry + 20}" text-anchor="middle" fill="#52b788" font-size="9">${_esc(lbl)}</text>`;
      });

      // Objects (dots on the right side)
      const roomObjs = objByRoom[room] || [];
      roomObjs.slice(0,6).forEach((o, oi) => {
        const ox = x + BW - 16 - oi * 28, oy = y + 100;
        const oc = o.identified ? "#5eead4" : "#f59e0b";
        s += `<circle cx="${ox}" cy="${oy}" r="7" fill="${oc}" opacity="0.9"/>`;
        const lbl = (o.user_label || o.name || "?").substring(0, 6);
        s += `<text x="${ox}" y="${oy + 18}" text-anchor="middle" fill="${oc}" font-size="9">${_esc(lbl)}</text>`;
      });

      // Bottom summary
      const rc = roomRadios.length, oc = roomObjs.length;
      const sumTxt = [rc ? `${rc} radio${rc>1?"s":""}` : "", oc ? `${oc} obj${oc>1?"s":""}` : ""].filter(Boolean).join(" · ") || "no devices";
      s += `<text x="${x + BW - 8}" y="${y + BH - 7}" text-anchor="end" fill="${color}77" font-size="10">${_esc(sumTxt)}</text>`;
    });

    // Unassigned radios row
    if(unassignedRadios.length){
      const uy = svgH + GAP;
      s += `<text x="${PX}" y="${uy + 14}" fill="#94a3b8" font-size="12" font-weight="600">Radios not yet assigned to an HA area</text>`;
      unassignedRadios.slice(0,6).forEach((r, ri) => {
        const rx = PX + 20 + ri * 140, ry = uy + 42;
        s += `<circle cx="${rx}" cy="${ry}" r="8" fill="none" stroke="#52b788" stroke-width="0.8" opacity="0.3"/>`;
        s += `<circle cx="${rx}" cy="${ry}" r="5" fill="none" stroke="#52b788" stroke-width="1"   opacity="0.6"/>`;
        s += `<circle cx="${rx}" cy="${ry}" r="3" fill="#52b78888"/>`;
        s += `<text x="${rx + 14}" y="${ry + 4}" fill="#94a3b8" font-size="10">${_esc(r.name || r.source || "Unknown")}</text>`;
      });
    }

    s += `</svg>`;
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:16px";
    wrap.innerHTML = s;
    return wrap;
  }

  // ---------- Floor plan SVG ----------
  function renderFloorPlan(fp){
    if(!fp) return null;
    const vw = fp.vw || 800;
    const vh = fp.vh || 440;
    let s = `<svg viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;border-radius:8px;background:#091209;display:block">`;

    // Rooms
    for(const r of (fp.rooms||[])){
      s += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.color}18" stroke="${r.color}" stroke-width="1.5" rx="3"/>`;
      const tx = r.x + r.w/2, ty = r.y + 16;
      s += `<text x="${tx}" y="${ty}" text-anchor="middle" fill="${r.color}" font-size="12" font-family="system-ui,sans-serif" font-weight="600">${r.name}</text>`;
    }

    // Radio markers (concentric rings = scanning BT proxy)
    for(const radio of (fp.radios||[])){
      const {x,y} = radio;
      s += `<circle cx="${x}" cy="${y}" r="22" fill="none" stroke="#52b788" stroke-width="0.8" opacity="0.2"/>`;
      s += `<circle cx="${x}" cy="${y}" r="14" fill="none" stroke="#52b788" stroke-width="1" opacity="0.4"/>`;
      s += `<circle cx="${x}" cy="${y}" r="8"  fill="none" stroke="#52b788" stroke-width="1.5" opacity="0.7"/>`;
      s += `<circle cx="${x}" cy="${y}" r="4"  fill="#52b788" opacity="1"/>`;
      s += `<text x="${x}" y="${y+30}" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui,sans-serif">${radio.name}</text>`;
    }

    // Objects (phones, keys, trackers)
    for(const obj of (fp.objects||[])){
      const {x,y,color,name} = obj;
      s += `<circle cx="${x}" cy="${y}" r="7" fill="${color}" opacity="0.95"/>`;
      s += `<text x="${x}" y="${y-11}" text-anchor="middle" fill="${color}" font-size="9" font-family="system-ui,sans-serif">${name}</text>`;
    }

    s += `</svg>`;
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:16px";
    wrap.innerHTML = s;
    if(fp.name){
      const lbl = document.createElement("div");
      lbl.style.cssText = "color:#94a3b8;font-size:11px;margin-top:4px;text-align:center";
      lbl.textContent = fp.name;
      wrap.appendChild(lbl);
    }
    return wrap;
  }

  // Always try iso floor stack first; falls back to sample floor plan or room grid if no maps
  const mapEl = renderIsoFloorStack();

  // ---------- Basic mode layout ----------
  if(isBasic){
    const summary = el("div",{class:"basic-summary"},[
      el("div",{style:"text-align:center"},[
        el("div",{class:"basic-summary-num"}, String(roomsCount)),
        el("div",{class:"basic-summary-lbl"}, "Rooms"),
      ]),
      el("div",{style:"text-align:center"},[
        el("div",{class:"basic-summary-num"}, String(objectsTotal)),
        el("div",{class:"basic-summary-lbl"}, "Objects"),
      ]),
      el("div",{style:"text-align:center"},[
        el("div",{class:"basic-summary-num"}, String(radiosCount)),
        el("div",{class:"basic-summary-lbl"}, "Scanners"),
      ]),
    ]);

    const mapCard = el("div",{class:"card"},[
      el("div",{class:"card-head"},[
        el("div",{class:"h2"}, "Your home"),
        helpBtn("overview"),
      ]),
      el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
        dataMode === "live" ? "Live view · updates every 5s" : "Sample data — switch to Live for your real home."),
    ]);
    if(mapEl) mapCard.appendChild(mapEl);

    const section = el("section",{},[
      el("div",{class:"row",style:"align-items:center;gap:8px;margin-bottom:10px"},[
        el("h2",{}, "Overview"),
        helpBtn("overview_grid"),
      ]),
      summary,
      mapCard,
    ]);
    return section;
  }

  // ---------- Advanced mode layout ----------
  const grid = el("div",{class:"grid"},[
    el("div",{class:"card"},[
      el("div",{class:"kpi"},[
        el("div",{class:"k"}, "Rooms"),
        el("div",{class:"v"}, String(roomsCount)),
      ]),
      el("div",{class:"row"},[
        el("button",{class:"btn", onclick: openRoomsList}, "View rooms list"),
      ])
    ]),
    el("div",{class:"card"},[
      el("div",{class:"kpi"},[
        el("div",{class:"k"}, "Objects"),
        el("div",{class:"v"}, String(objectsTotal)),
      ]),
      el("div",{class:"row"},[
        el("button",{class:"btn", onclick: ()=>openObjectsList("all")}, "All objects"),
        el("button",{class:"btn", onclick: ()=>openObjectsList("unidentified")}, `Unidentified (${unidentifiedCount})`),
      ])
    ]),
    el("div",{class:"card"},[
      el("div",{class:"kpi"},[
        el("div",{class:"k"}, "Bluetooth radios"),
        el("div",{class:"v"}, String(radiosCount)),
      ]),
      el("div",{class:"row"},[
        el("button",{class:"btn", onclick: openRadiosList}, "View radios list"),
      ]),
      el("div",{style:"margin-top:8px;color:#94a3b8;font-size:12px"}, dataMode==="live" ? "Live snapshot" : "Sample data — switch to Live to see your real devices")
    ]),
  ]);

  const section = el("section",{},[
    el("h2",{}, "Overview"),
    el("div",{style:"color:#94a3b8;margin-top:-6px;margin-bottom:10px"}, `Mode: ${dataMode.toUpperCase()} · ${ctx.state.versionInfo?.version || ""} (${ctx.state.versionInfo?.build_id || ""})`),
  ]);
  if(mapEl) section.appendChild(mapEl);
  section.appendChild(grid);
  return section;
}
