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
      return el("tr",{},[
        el("td",{}, room),
        el("td",{}, String(eids.length)),
        el("td",{}, eids.join(", "))
      ]);
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
      return el("tr",{},[
        el("td",{}, x.name || ""),
        el("td",{}, x.source || ""),
        el("td",{}, (x.adapter!=null?String(x.adapter):"")),
        el("td",{}, (x.scanning==null?"":String(x.scanning))),
        el("td",{}, (x.connectable==null?"":String(x.connectable))),
        el("td",{}, x.area_name || "—"),
        el("td",{}, assignBtn),
      ]);
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
    if(dataMode !== "live"){
      ctx.toast("Area assignment requires Live mode.", true);
      return;
    }
    const sel = el("select",{class:"select"});
    sel.appendChild(el("option",{value:""},"— No area (clear) —"));
    for(const a of areas){
      const opt = el("option",{value:a}, a);
      if(a === radio.area_name) opt.selected = true;
      sel.appendChild(opt);
    }
    const status = el("div",{class:"muted", style:"min-height:20px;margin-top:6px"});
    const saveBtn = el("button",{class:"btn"}, "Save");
    const cancelBtn = el("button",{class:"btn inline"}, "Cancel");
    cancelBtn.addEventListener("click", ()=>ctx.actions.closeModal());
    saveBtn.addEventListener("click", async ()=>{
      const area_name = sel.value;
      saveBtn.disabled = true;
      try {
        const payload = { area_name };
        if(radio.device_id) payload.device_id = radio.device_id;
        else if(radio.source) payload.source = radio.source;
        await ctx.actions.radioAreaSet(payload);
        ctx.actions.closeModal();
        ctx.toast(area_name ? `Area set to "${area_name}"` : "Area cleared");
        await ctx.actions.refreshSnapshot();
      } catch(e) {
        status.textContent = "Failed to update area. Check HA logs.";
        saveBtn.disabled = false;
      }
    });
    const body = el("div",{},[
      el("div",{class:"muted", style:"margin-bottom:8px"}, `Radio: ${radio.name || radio.source}`),
      el("div",{style:"color:#94a3b8;font-size:12px;margin-bottom:10px"}, areas.length ? "Select an HA area for this scanner:" : "No HA areas found. Add areas in HA Settings → Areas & Zones."),
      el("div",{class:"row",style:"gap:8px;flex-wrap:wrap"},[sel, saveBtn, cancelBtn]),
      status,
    ]);
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
        tagCell,
        vendorCell,
      ]);

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

    // Layout constants
    const COLS = 3, BW = 210, BH = 115, GAP = 12, PX = 14, PY = 14;
    const rows = Math.ceil(rooms.length / COLS);
    const svgW  = COLS * (BW + GAP) - GAP + PX * 2;
    const svgH  = rows * (BH + GAP) - GAP + PY * 2;
    const extraH = unassignedRadios.length ? BH * 0.6 + GAP : 0;
    const PALETTE = ["#52b788","#4caf50","#43a047","#388e3c","#66bb6a","#81c784","#a5d6a7","#2e7d32"];

    const _esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

    let s = `<svg viewBox="0 0 ${svgW} ${svgH + extraH}" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:600px;display:block;font-family:system-ui,sans-serif">`;
    s += `<rect width="${svgW}" height="${svgH + extraH}" fill="#071008" rx="8"/>`;

    rooms.forEach((room, idx) => {
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      const x = PX + col * (BW + GAP);
      const y = PY + row * (BH + GAP);
      const color = PALETTE[idx % PALETTE.length];

      // Box
      s += `<rect x="${x}" y="${y}" width="${BW}" height="${BH}" fill="${color}10" stroke="${color}" stroke-width="1.5" rx="8"/>`;

      // Room name
      s += `<text x="${x + BW/2}" y="${y + 17}" text-anchor="middle" fill="${color}" font-size="13" font-weight="700">${_esc(room)}</text>`;

      // Floor label from HA
      const haArea = haAreas.find(a => a.name === room);
      const haFloor = haFloors.find(f => f.id === (haArea?.floor_id||""));
      if(haFloor){
        s += `<text x="${x + BW/2}" y="${y + 29}" text-anchor="middle" fill="${color}88" font-size="9">${_esc(haFloor.name)}</text>`;
      }

      // Radios (antenna rings)
      const roomRadios = radiosByRoom[room] || [];
      roomRadios.slice(0,4).forEach((r, ri) => {
        const rx = x + 18 + ri * 36, ry = y + 60;
        s += `<circle cx="${rx}" cy="${ry}" r="12" fill="none" stroke="#52b788" stroke-width="0.7" opacity="0.2"/>`;
        s += `<circle cx="${rx}" cy="${ry}" r="7"  fill="none" stroke="#52b788" stroke-width="1"   opacity="0.5"/>`;
        s += `<circle cx="${rx}" cy="${ry}" r="3.5" fill="#52b788"/>`;
        const lbl = (r.name || r.source || "").substring(0, 7);
        s += `<text x="${rx}" y="${ry + 17}" text-anchor="middle" fill="#52b788" font-size="7.5">${_esc(lbl)}</text>`;
      });

      // Objects (dots on the right)
      const roomObjs = objByRoom[room] || [];
      roomObjs.slice(0,5).forEach((o, oi) => {
        const ox = x + BW - 12 - oi * 20, oy = y + 60;
        const oc = o.identified ? "#5eead4" : "#f59e0b";
        s += `<circle cx="${ox}" cy="${oy}" r="5" fill="${oc}" opacity="0.9"/>`;
        const lbl = (o.user_label || o.name || "?").substring(0, 5);
        s += `<text x="${ox}" y="${oy + 14}" text-anchor="middle" fill="${oc}" font-size="7">${_esc(lbl)}</text>`;
      });

      // Bottom summary
      const rc = roomRadios.length, oc = roomObjs.length;
      const sumTxt = [rc ? `${rc} radio${rc>1?"s":""}` : "", oc ? `${oc} obj${oc>1?"s":""}` : ""].filter(Boolean).join(" · ") || "no devices";
      s += `<text x="${x + BW - 6}" y="${y + BH - 5}" text-anchor="end" fill="${color}77" font-size="8">${_esc(sumTxt)}</text>`;
    });

    // Unassigned radios row
    if(unassignedRadios.length){
      const uy = svgH + GAP;
      s += `<text x="${PX}" y="${uy + 13}" fill="#94a3b8" font-size="11" font-weight="600">Radios not yet assigned to an HA area</text>`;
      unassignedRadios.slice(0,8).forEach((r, ri) => {
        const rx = PX + 16 + ri * 120, ry = uy + 38;
        s += `<circle cx="${rx}" cy="${ry}" r="7" fill="none" stroke="#52b788" stroke-width="0.8" opacity="0.3"/>`;
        s += `<circle cx="${rx}" cy="${ry}" r="4" fill="none" stroke="#52b788" stroke-width="1"   opacity="0.6"/>`;
        s += `<circle cx="${rx}" cy="${ry}" r="2.5" fill="#52b78888"/>`;
        s += `<text x="${rx + 12}" y="${ry + 4}" fill="#94a3b8" font-size="9">${_esc(r.name || r.source || "Unknown")}</text>`;
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

  // Use the sample floor plan if available (sample mode), otherwise auto-generate from HA data
  const mapEl = (liveSnap && liveSnap.floor_plan)
    ? renderFloorPlan(liveSnap.floor_plan)
    : renderRoomGrid();

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
