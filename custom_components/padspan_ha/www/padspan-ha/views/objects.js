export function renderTags(ctx, tagsList) {
  const { el } = ctx.helpers;
  const { mode, tagFilter } = ctx.state;

  const isLive = ctx.state.dataMode === "live";
  const roomTagMap = ctx.state.roomTagMap || {};
  const missingByRoom =
    ctx.state.missingRoomTagMap ||
    (ctx.state.live && ctx.state.live.snapshot && ctx.state.live.snapshot.room_tag_map_missing) ||
    {};

  // Index live snapshot tags so we can show friendly names + state (not just entity_id).
  const liveTags = isLive ? ((ctx.state.live && ctx.state.live.snapshot && ctx.state.live.snapshot.tags) || []) : [];
  const liveIndex = {};
  const liveMissingIndex = {};
  for (const t of liveTags) {
    if (!t || !t.entity_id) continue;
    const eid = String(t.entity_id);
    if (t.missing) liveMissingIndex[eid] = t;
    else liveIndex[eid] = t;
  }

  const rooms = Object.keys(roomTagMap);

  // Ensure selectedRooms is always valid.
  if (!ctx.state.selectedRooms || !Array.isArray(ctx.state.selectedRooms)) ctx.state.selectedRooms = rooms.slice(0, 1);
  if (ctx.state.selectedRooms.length === 0 && rooms.length) ctx.state.selectedRooms = [rooms[0]];

  // Rooms list
  tagsList.innerHTML = "";
  const roomsWrap = el("div", { class: "grid2" });
  for (const room of rooms) {
    const liveCount = (roomTagMap[room] || []).length;
    const missCount = (missingByRoom[room] || []).length;

    const pill = el("div", { class: "pill" });
    pill.addEventListener("click", () => {
      const sel = new Set(ctx.state.selectedRooms || []);
      if (sel.has(room)) sel.delete(room);
      else sel.add(room);
      ctx.state.selectedRooms = Array.from(sel);
      renderTags(ctx, tagsList);
    });

    const row = el("div", { class: "row" });
    row.appendChild(el("span", { class: "label" }, room));
    row.appendChild(el("span", { class: "muted" }, `(${liveCount}${missCount ? ` +${missCount} missing` : ""})`));
    pill.appendChild(row);

    if ((ctx.state.selectedRooms || []).includes(room)) pill.style.outline = "2px solid var(--acc)";
    roomsWrap.appendChild(pill);
  }
  tagsList.appendChild(roomsWrap);

  // Selected tags
  const selectedRooms = (ctx.state.selectedRooms || []).filter(r => rooms.includes(r));
  const sets = selectedRooms.map(r => new Set(roomTagMap[r] || []));

  const union = new Set();
  for (const s of sets) for (const v of s) union.add(v);

  const intersect = new Set(union);
  for (const s of sets) for (const v of Array.from(intersect)) if (!s.has(v)) intersect.delete(v);

  let items = [];
  if (mode === "union") items = Array.from(union);
  else if (mode === "intersect") items = Array.from(intersect);
  else items = Array.from(union);

  // Optional filter
  if (tagFilter && tagFilter.trim()) {
    const q = tagFilter.trim().toLowerCase();
    items = items.filter(eid => {
      const meta = liveIndex[eid];
      return eid.toLowerCase().includes(q) || (meta && String(meta.name || "").toLowerCase().includes(q));
    });
  }

  const list = el("div", { class: "list" });

  // Empty state guidance (common when only placeholders exist).
  if (items.length === 0) {
    const missingTotal = Object.values(missingByRoom).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
    if (isLive) {
      list.appendChild(
        el("div", { class: "muted", style: "padding:8px 4px" },
          missingTotal
            ? `No LIVE tags found. (${missingTotal} configured tags are missing in Home Assistant.)`
            : "No LIVE tags found. If you expected tags, confirm your BLE integration is creating entities whose state equals a room/area (e.g., *area_last_seen)."
        )
      );
    } else {
      list.appendChild(el("div", { class: "muted", style: "padding:8px 4px" }, "No tags mapped for the selected room(s)."));
    }
  }

  // Render each tag
  for (const eid of items) {
    const meta = liveIndex[eid] || null;
    const item = el("div", { class: "item" });

    const textWrap = el("div", { style: "display:flex;flex-direction:column;gap:2px;flex:1" });
    textWrap.appendChild(el("span", {}, meta ? String(meta.name || eid) : eid));

    if (meta) {
      const details = [];
      details.push(eid);
      if (meta.state !== undefined) details.push(String(meta.state));
      if (meta.nearest_receiver) details.push(`rx:${meta.nearest_receiver}`);
      textWrap.appendChild(el("span", { class: "muted" }, details.join(" • ")));
    } else {
      textWrap.appendChild(el("span", { class: "muted" }, eid));
    }

    item.appendChild(textWrap);

    // "open in HA" button
    const openBtn = el("button", { class: "btn tiny" }, "Open");
    openBtn.addEventListener("click", () => {
      const url = `/developer-tools/state?entity_id=${encodeURIComponent(eid)}`;
      window.open(url, "_blank");
    });
    item.appendChild(openBtn);

    list.appendChild(item);
  }

  // If there are missing configured tags for selected rooms, show them underneath (collapsed-ish).
  const missingForSelected = [];
  for (const r of selectedRooms) for (const eid of (missingByRoom[r] || [])) missingForSelected.push({ room: r, eid });
  if (isLive && missingForSelected.length) {
    list.appendChild(el("div", { class: "muted", style: "padding:10px 4px 4px" }, "Configured (missing in Home Assistant):"));
    for (const x of missingForSelected.slice(0, 200)) {
      const item = el("div", { class: "item" });
      const tw = el("div", { style: "display:flex;flex-direction:column;gap:2px;flex:1" });
      tw.appendChild(el("span", {}, x.eid));
      tw.appendChild(el("span", { class: "muted" }, `room: ${x.room}`));
      item.appendChild(tw);
      list.appendChild(item);
    }
  }

  tagsList.appendChild(list);
}

export function render(ctx){
  const { el, esc, roomColor } = ctx.helpers;
  const { roomTagMap, mode, tagFilter } = ctx.state;
  const selectedRooms = new Set(Array.isArray(ctx.state.selectedRooms) ? ctx.state.selectedRooms : []);

  const root = el("section",{id:"objects"});
  root.className = ctx.state.view==="objects" ? "" : "hidden";

  // ----------------------------
  // Inventory: unified Objects model (BLE advertisements + mapped entities)
  // ----------------------------
  const isLive = ctx.state.dataMode === "live";
  const liveSnap = isLive ? (ctx.state.live && ctx.state.live.snapshot) : null;
  const objModel = liveSnap && liveSnap.objects ? liveSnap.objects : null;

  const fmtAgo = (age_s)=>{
    const s = Number(age_s);
    if(!isFinite(s)) return "—";
    if(s < 1) return "<1s";
    if(s < 60) return `${Math.round(s)}s`;
    const m = Math.floor(s/60);
    const rs = Math.round(s - m*60);
    if(m < 60) return `${m}m ${rs}s`;
    const h = Math.floor(m/60);
    const rm = m - h*60;
    return `${h}h ${rm}m`;
  };
  const fmtNum = (n)=>{
    const v = Number(n);
    if(!isFinite(v)) return "0";
    return v.toLocaleString();
  };

  const openObjectsModal = (initialFilter="all")=>{
    if(!objModel || !Array.isArray(objModel.list)) {
      ctx.toast("No live objects yet. Switch Data Mode to Live and wait for BLE advertisements.", true);
      return;
    }

    const summary = objModel.summary || {};
    const list = objModel.list || [];

    const container = el("div",{});
    const controls = el("div",{class:"toolbar"});

    const search = el("input",{type:"text", placeholder:"Search name/entity/address…"});
    search.style.minWidth="220px";

    const kindSel = el("select",{class:"btn"});
    [
      {v:"all", t:"All kinds"},
      {v:"ble", t:"BLE (advertisements)"},
      {v:"entity", t:"HA entities"},
    ].forEach(o=>kindSel.appendChild(el("option",{value:o.v}, o.t)));

    const statusSel = el("select",{class:"btn"});
    [
      {v:"all", t:"All"},
      {v:"identified", t:"Identified"},
      {v:"unidentified", t:"Unidentified"},
    ].forEach(o=>statusSel.appendChild(el("option",{value:o.v}, o.t)));
    statusSel.value = initialFilter === "unidentified" ? "unidentified" : "all";

    const stats = el("div",{class:"spacer"});
    controls.appendChild(el("span",{class:"badge"}, `${fmtNum(summary.total||0)} total`));
    controls.appendChild(el("span",{class:"badge"}, `${fmtNum(summary.unidentified||0)} unidentified`));
    controls.appendChild(search);
    controls.appendChild(kindSel);
    controls.appendChild(statusSel);
    controls.appendChild(stats);

    const table = el("table",{class:"table"});
    const thead = el("thead",{}, el("tr",{},[
      el("th",{}, "Kind"),
      el("th",{}, "Name / Entity"),
      el("th",{}, "Address"),
      el("th",{}, "Room"),
      el("th",{}, "Signal"),
      el("th",{}, "Last seen"),
      el("th",{}, "Tag"),
      el("th",{}, "Vendor (online)"),
    ]));
    const tbody = el("tbody",{});
    table.appendChild(thead);
    table.appendChild(tbody);

    const rowEls = list.map((o)=>{
      const kind = o.kind || "";
      const identified = !!o.identified;
      const addr = o.address || "";
      const name = o.name || o.entity_id || "";
      const room = o.room || "";
      const rssi = (o.rssi==null?"":String(o.rssi));
      const lastSeen = o.age_s!=null ? fmtAgo(o.age_s) : (o.last_seen || "");

      const userLabel = o.user_label || "";
      const displayName = userLabel || name;
      const vendorCell = el("td",{}, kind==="ble" ? el("span",{class:"badge"}, "—") : el("span",{class:"badge"}, "n/a"));

      // Tag button for BLE rows
      const tagCell = (() => {
        if (kind !== "ble" || !addr) return el("td",{}, "—");
        const btn = el("button",{class:"btn tiny"}, userLabel ? "Relabel" : "Tag");
        btn.addEventListener("click", (e)=>{
          e.stopPropagation();
          ctx.actions.tagObjectPrompt(addr, userLabel);
        });
        const wrap = el("div",{style:"display:flex;align-items:center;gap:6px"});
        if(userLabel) wrap.appendChild(el("span",{class:"badge"}, userLabel));
        wrap.appendChild(btn);
        return el("td",{}, wrap);
      })();

      const tr = el("tr",{
        "data-kind": kind,
        "data-identified": identified ? "1":"0",
      },[
        el("td",{}, [ el("span",{class:"badge"}, kind || "—"), (identified ? null : el("span",{class:"badge warn", style:"margin-left:6px"}, "unidentified")) ]),
        el("td",{}, [
          el("div",{style:"font-weight:600"}, displayName || "—"),
          (userLabel && name && name !== userLabel ? el("div",{class:"muted"}, `raw: ${name}`) : null),
          (o.entity_id ? el("div",{class:"muted"}, o.entity_id) : null),
          (kind==="ble" && Array.isArray(o.sources) && o.sources.length ? el("div",{class:"muted"}, `Seen by: ${o.sources.join(", ")}`) : null),
          (kind==="ble" && o.manufacturer_data && Object.keys(o.manufacturer_data).length ? el("div",{class:"muted"}, `Manuf IDs: ${Object.keys(o.manufacturer_data).slice(0,3).join(", ")}${Object.keys(o.manufacturer_data).length>3?"…":""}`) : null),
          (kind==="ble" && Array.isArray(o.service_uuids) && o.service_uuids.length ? el("div",{class:"muted"}, `Services: ${o.service_uuids.length}`) : null),
        ].filter(Boolean)),
        el("td",{}, addr ? el("code",{}, addr) : "—"),
        el("td",{}, room ? el("span",{class:"badge"}, room) : "—"),
        el("td",{}, rssi ? el("span",{class:"badge"}, rssi) : "—"),
        el("td",{}, lastSeen || "—"),
        tagCell,
        vendorCell,
      ]);

      // Best-effort vendor lookup for BLE addresses
      if(kind==="ble" && addr) {
        (async ()=>{
          try{
            vendorCell.innerHTML = "";
            vendorCell.appendChild(el("span",{class:"muted"}, "Looking up…"));
            const res = await ctx.actions.vendorLookup(addr, false);
            const vendor = (res && (res.vendor || res.name)) ? (res.vendor || res.name) : "Unknown";
            vendorCell.innerHTML = "";
            vendorCell.appendChild(el("span",{class:"badge"}, vendor));
          } catch(e) {
            vendorCell.innerHTML = "";
            vendorCell.appendChild(el("span",{class:"badge warn"}, "lookup failed"));
          }
        })();
      }

      tbody.appendChild(tr);
      return tr;
    });

    const applyFilter = ()=>{
      const q = String(search.value||"").trim().toLowerCase();
      const kindV = kindSel.value || "all";
      const statusV = statusSel.value || "all";
      let shown=0;
      for(const tr of rowEls){
        const kind = tr.getAttribute("data-kind")||"";
        const ident = tr.getAttribute("data-identified")==="1";
        if(kindV!=="all" && kind!==kindV){ tr.style.display="none"; continue; }
        if(statusV==="identified" && !ident){ tr.style.display="none"; continue; }
        if(statusV==="unidentified" && ident){ tr.style.display="none"; continue; }
        if(q){
          const hay = tr.innerText.toLowerCase();
          if(!hay.includes(q)){ tr.style.display="none"; continue; }
        }
        tr.style.display="";
        shown++;
      }
      stats.innerHTML="";
      stats.appendChild(el("span",{class:"muted"}, `${shown} shown`));
    };

    search.addEventListener("input", applyFilter);
    kindSel.addEventListener("change", applyFilter);
    statusSel.addEventListener("change", applyFilter);

    container.appendChild(controls);
    container.appendChild(table);

    ctx.actions.openModal("Objects", container, "Unified object inventory (BLE advertisements + mapped entities). Use filters above.");
    applyFilter();
  };

  const inventoryCard = el("div",{class:"card"},[
    el("div",{class:"muted"},"Inventory (Bluetooth objects)"),
    (!isLive ? el("div",{class:"muted"},"Switch Data Mode to Live to populate BLE objects.") : null),
    (isLive && objModel && objModel.summary ? el("div",{class:"row", style:"gap:12px;flex-wrap:wrap"},[
      el("span",{class:"badge"}, `${fmtNum(objModel.summary.total||0)} total`),
      el("span",{class:"badge warn"}, `${fmtNum(objModel.summary.unidentified||0)} unidentified`),
      el("button",{class:"btn", onclick:()=>openObjectsModal("all")},"All objects"),
      el("button",{class:"btn", onclick:()=>openObjectsModal("unidentified")},"Unidentified"),
    ]) : null),
    (isLive && (!objModel || !objModel.summary) ? el("div",{class:"muted"},"Waiting for first snapshot…") : null)
  ]);
  root.appendChild(inventoryCard);


  const roomsList = el("div",{class:"rooms", id:"rooms"});
  const tagsList = el("div",{class:"tags", id:"tags"});

  const rooms = (ctx.state.dataMode==="live" && ctx.state.live?.snapshot?.rooms_discovered?.length)
    ? [...ctx.state.live.snapshot.rooms_discovered].sort((a,b)=>a.localeCompare(b))
    : Object.keys(roomTagMap||{}).sort((a,b)=>a.localeCompare(b));
  // Ensure at least one room selected so tags list has context.
  if (selectedRooms.size === 0 && rooms.length) { selectedRooms.add(rooms[0]); ctx.state.selectedRooms = Array.from(selectedRooms); }
  if(!rooms.length){
    roomsList.appendChild(el("div",{class:"item"},"No room data yet."));
  } else {
    for(const room of rooms){
      const count = (roomTagMap[room]||[]).length;
      const row = el("label",{class:"item"});
      const cb = el("input",{type:"checkbox"});
      cb.checked = selectedRooms.has(room);
      cb.addEventListener("change", ()=>{ cb.checked ? selectedRooms.add(room) : selectedRooms.delete(room); ctx.state.selectedRooms = Array.from(selectedRooms); ctx.actions.renderTags(); });
      row.appendChild(cb);
      row.appendChild(el("span",{class:"roomdot", style:`background:${roomColor(room)}`}, ""));
      row.appendChild(el("span",{}, esc(room)));
      row.appendChild(el("span",{class:"muted"}, `(${count})`));
      roomsList.appendChild(row);
    }
  }

  const toolbarLeft = el("div",{class:"toolbar"},[
    el("button",{class:"btn", onclick:()=>{ rooms.forEach(r=>selectedRooms.add(r)); ctx.state.selectedRooms = Array.from(selectedRooms); ctx.state._roomsInit = true; ctx.actions.renderRooms(); ctx.actions.renderTags(); }},"All Rooms"),
    el("button",{class:"btn", onclick:()=>{ selectedRooms.clear(); ctx.state.selectedRooms = []; ctx.state._roomsInit = true; ctx.actions.renderRooms(); ctx.actions.renderTags(); }},"Clear"),
  ]);

  const modeSel = el("select",{class:"btn", id:"modeSel"});
  modeSel.style.maxWidth="420px";
  const optAll = el("option",{value:"all"},"Show tags in ALL selected rooms (intersection)");
  const optAny = el("option",{value:"any"},"Show tags in ANY selected room (union)");
  modeSel.appendChild(optAll); modeSel.appendChild(optAny);
  modeSel.value = mode;
  modeSel.addEventListener("change", ()=>{ ctx.state.mode = modeSel.value; ctx.actions.renderTags(); });

  const filter = el("input",{type:"text", id:"tagFilter", placeholder:"Filter tags… (e.g., keys)"});
  filter.value = tagFilter;
  filter.addEventListener("input", ()=>{ ctx.state.tagFilter = filter.value; ctx.actions.renderTags(); });

  const toolbarRight = el("div",{class:"toolbar"},[modeSel, filter]);

  const leftCard = el("div",{class:"card"},[
    el("div",{class:"muted"},"Select rooms"),
    toolbarLeft,
    roomsList,
  ]);

  const rightCard = el("div",{class:"card"},[
    el("div",{class:"muted"},"Object checklist from selected rooms"),
    toolbarRight,
    tagsList,
  ]);

  const grid = el("div",{class:"grid"},[leftCard,rightCard]);
  root.appendChild(grid);

  renderTags(ctx, tagsList);

  return root;
}
