// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
export function renderTags(ctx, tagsList) {
  const { el } = ctx.helpers;
  const { mode, tagFilter } = ctx.state;

  const isLive = ctx.state.dataMode === "live";
  const roomTagMap = ctx.state.roomTagMap || {};
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const missingByRoom =
    ctx.state.missingRoomTagMap ||
    (snap && snap.room_tag_map_missing) ||
    {};

  // Index live snapshot tags so we can show friendly names + state (not just entity_id).
  const liveTags = ((snap && snap.tags) || []);
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

  tagsList.innerHTML = "";

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
    list.appendChild(
      el("div", { class: "muted", style: "padding:8px 4px" },
        missingTotal
          ? `No tags found. (${missingTotal} configured tags are missing in Home Assistant.)`
          : isLive
            ? "No tags found. Confirm your BLE integration creates entities whose state equals a room/area (e.g., *area_last_seen)."
            : "No tags mapped for the selected room(s)."
      )
    );
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
  const { el, esc, roomColor, helpBtn } = ctx.helpers;
  const { roomTagMap, mode, tagFilter } = ctx.state;
  const selectedRooms = new Set(Array.isArray(ctx.state.selectedRooms) ? ctx.state.selectedRooms : []);
  const isBasic = ctx.state.complexity === "basic";

  const root = el("section",{id:"objects"});
  root.className = ctx.state.view==="objects" ? "" : "hidden";

  // ----------------------------
  // Inventory: unified Objects model (BLE advertisements + mapped entities)
  // ----------------------------
  const isLive = ctx.state.dataMode === "live";
  const liveSnap = (ctx.state.live && ctx.state.live.snapshot) || null;
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

  // --- Inline objects list (BLE scanner detections + entities) ---
  const allObjects = objModel && Array.isArray(objModel.list) ? objModel.list : [];
  const summary = objModel && objModel.summary ? objModel.summary : null;

  // Dedup: suppress entity rows whose physical device already has a BLE/iBeacon/private_ble row.
  // This prevents e.g. "Dog Tracker" entity appearing alongside its BLE advertisement row.
  const _bleAddrSet = new Set(
    allObjects.filter(o => o.kind === "ble" || o.kind === "private_ble" || o.kind === "ibeacon")
      .map(o => o.address).filter(Boolean)
  );
  const _linkedEntitySet = new Set(
    allObjects.flatMap(o => Array.isArray(o.linked_entities) ? o.linked_entities : [])
  );
  const _isDuplicateEntity = (o) =>
    o.kind === "entity" && (
      (o.address && _bleAddrSet.has(o.address)) ||
      (o.entity_id && _linkedEntitySet.has(o.entity_id))
    );

  // Away detection — mirrors sensor.py / device_tracker.py threshold
  const awayTimeoutS = ((ctx.state.settings && ctx.state.settings.away_timeout_m != null)
    ? Number(ctx.state.settings.away_timeout_m) : 5) * 60;
  const _isAway = (o) => {
    if (o.kind !== "ble" && o.kind !== "private_ble" && o.kind !== "ibeacon") return false;
    const a = o.age_s;
    return typeof a === "number" && isFinite(a) && a > awayTimeoutS;
  };

  if (!ctx.state.objSearch) ctx.state.objSearch = "";
  if (!ctx.state.objKind)   ctx.state.objKind   = "all";
  if (!ctx.state.objStatus) ctx.state.objStatus  = "all";

  const objSearchInput = el("input",{type:"text", placeholder:"Search address, name, label…", value: ctx.state.objSearch});
  const objKindSel = el("select",{class:"btn"});
  [{v:"all",t:"All"},{v:"ble",t:"BLE / beacon devices"},{v:"entity",t:"HA entities only"}]
    .forEach(o=>objKindSel.appendChild(el("option",{value:o.v},o.t)));
  objKindSel.value = ctx.state.objKind;

  const objStatusSel = el("select",{class:"btn"});
  [{v:"all",t:"All statuses"},{v:"unidentified",t:"Unidentified"},{v:"identified",t:"Identified"},{v:"away",t:"Away"}]
    .forEach(o=>objStatusSel.appendChild(el("option",{value:o.v},o.t)));
  objStatusSel.value = ctx.state.objStatus;

  const objStats = el("span",{class:"muted"});

  const objTbody = el("tbody",{});
  const objTable = el("table",{class:"table"},[
    el("thead",{}, el("tr",{},[
      el("th",{},"Kind"),
      el("th",{},"Name / Address"),
      el("th",{},"Signal"),
      el("th",{},"Last seen"),
      el("th",{},"Scanner"),
      el("th",{},"Follow"),
      el("th",{},"Tag"),
    ])),
    objTbody,
  ]);

  const objRowEls = allObjects.map(o=>{
    // Skip entity rows that duplicate a BLE/iBeacon/private_ble row for the same device
    if(_isDuplicateEntity(o)) return null;

    const kind = o.kind || "";
    const identified = !!o.identified;
    const addr = o.address || "";
    const userLabel = o.user_label || "";
    const displayName = userLabel || o.name || o.entity_id || addr || "—";
    const rssi = o.rssi != null ? `${o.rssi} dBm` : "";
    const age = o.age_s != null ? fmtAgo(o.age_s) : "";
    const isPrivateBle = kind === "private_ble";
    const isIbeacon = kind === "ibeacon";
    const isAway = _isAway(o);
    const _sid = ctx.helpers.radioShortId || (() => "");
    const scanner = (kind==="ble" || isPrivateBle || isIbeacon) && Array.isArray(o.sources) && o.sources.length
      ? o.sources.map(s => { const src = typeof s === "object" ? (s.source || "") : String(s); const id = _sid(src); return id ? id+" "+src : src; }).filter(Boolean).join(", ")
      : (o.room || "");

    // For iBeacon the stable identifier is the UUID key, not the rotating MAC
    const followKey = isIbeacon ? (o.key || "") : (addr || o.entity_id || "");
    const followCell = (() => {
      if (!followKey) return el("td",{}, "");
      const isF = ctx.actions.followedHas(followKey);
      const btn = el("button",{
        class:"btn tiny",
        style: isF ? "background:#1a3a2a;border-color:#52b788;color:#52b788" : "",
      }, isF ? "✓ Following" : "Follow");
      btn.addEventListener("click",(e)=>{
        e.stopPropagation();
        ctx.actions.followedToggle(followKey);
        const nowF = ctx.actions.followedHas(followKey);
        btn.textContent = nowF ? "✓ Following" : "Follow";
        btn.style.cssText = nowF ? "background:#1a3a2a;border-color:#52b788;color:#52b788" : "";
      });
      return el("td",{}, btn);
    })();

    const tagCell = (() => {
      // Use stable identifier for each kind: canonical_id for private_ble, uuid key for ibeacon
      const tagAddr = kind === "private_ble" ? (o.canonical_id || addr)
                    : kind === "ibeacon"     ? (o.key || "")
                    : addr;
      if ((kind !== "ble" && kind !== "private_ble" && kind !== "ibeacon") || !tagAddr) return el("td",{}, "");
      const btn = el("button",{class:"btn tiny"}, userLabel ? "Relabel" : "Tag");
      btn.addEventListener("click",(e)=>{ e.stopPropagation(); ctx.actions.tagObjectPrompt(tagAddr, userLabel); });
      return el("td",{}, btn);
    })();

    // For iBeacon, show UUID short form instead of the internal uuid key as address
    const displayAddr = isIbeacon ? (o.ibeacon_uuid ? `${o.ibeacon_uuid.slice(0,8)}…` : addr) : addr;

    const tr = el("tr",{
      "data-kind": kind,
      "data-identified": identified ? "1" : "0",
      "data-search": `${kind} ${displayName} ${addr} ${userLabel} ${o.entity_id||""} ${scanner} ${o.ibeacon_uuid||""} ${o.company_name||""} ${o.device_type||""} ${(o.service_names||[]).join(" ")} ${isAway?"away":""}`.toLowerCase(),
    },[
      el("td",{}, [
        isPrivateBle
          ? el("span",{class:"badge"+(identified?"":" warn"),style:identified?"background:#1a3a5a;color:#7dd3fc;border-color:#3b82f6":""}, identified?"Private BLE":"Private BLE?")
          : isIbeacon
            ? el("span",{class:"badge"+(identified?"":" warn"),style:identified?"background:#3a2a0a;color:#fbbf24;border-color:#d97706":""}, identified?"iBeacon":"iBeacon?")
            : el("span",{class:"badge"+(identified?"":" warn")}, kind==="ble" ? (identified?"BLE":"BLE?") : "Entity"),
      ]),
      el("td",{}, [
        el("div",{style:"font-weight:600"}, displayName),
        (displayAddr && displayAddr !== displayName ? el("div",{class:"muted",style:"font-size:11px"}, displayAddr) : null),
        (o.entity_id && !userLabel ? el("div",{class:"muted",style:"font-size:11px"}, o.entity_id) : null),
        (isPrivateBle && o.private_ble_name
          ? el("div",{class:"muted",style:"font-size:11px"}, `\u{1F512} ${o.private_ble_name}`) : null),
        (isIbeacon && o.ibeacon_uuid
          ? el("div",{class:"muted",style:"font-size:11px"}, `UUID: ${o.ibeacon_uuid.slice(0,8)}\u2026 \u00B7 M${o.ibeacon_major}.${o.ibeacon_minor}`) : null),
        // Enrichment: company + device type + services
        ((o.company_name || o.device_type || (o.service_names && o.service_names.length))
          ? el("div",{style:"display:flex;flex-wrap:wrap;gap:4px;margin-top:2px"}, [
              o.company_name ? el("span",{class:"badge",style:"font-size:9px;padding:1px 5px;background:#1a2a3a;color:#7dd3fc;border-color:#1e4976"}, o.company_name) : null,
              o.device_type  ? el("span",{class:"badge",style:"font-size:9px;padding:1px 5px;background:#2a1a3a;color:#c4b5fd;border-color:#5b21b6"}, o.device_type) : null,
              ...(o.service_names || []).slice(0,2).map(sn =>
                el("span",{class:"badge",style:"font-size:9px;padding:1px 5px;background:#1a3a2a;color:#86efac;border-color:#166534"}, sn)
              ),
            ].filter(Boolean))
          : null),
      ].filter(Boolean)),
      el("td",{}, rssi && !isAway ? el("span",{class:"badge"}, rssi) : "—"),
      el("td",{}, isAway
        ? [
            el("span",{class:"badge",style:"background:#3a0a0a;color:#f87171;border-color:#7f1d1d;font-size:10px"}, "Away"),
            age ? el("div",{class:"muted",style:"font-size:10px;margin-top:2px"}, age) : null,
          ].filter(Boolean)
        : (age || "—")),
      el("td",{class:"muted",style:"font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis"},
        o.knn_confidence > 0
          ? [scanner || "—", el("div",{style:"font-size:10px;color:#52b788;margin-top:1px"}, `Calibrated ${Math.round(o.knn_confidence*100)}%`)]
          : (scanner || "—")),
      followCell,
      tagCell,
    ]);
    tr.style.cursor = "pointer";
    tr.title = "Click for details";
    tr.addEventListener("click", (ev)=>{
      if(ev.target.tagName==="BUTTON") return;
      ctx.actions.showObjectDetail(o);
    });
    objTbody.appendChild(tr);
    return tr;
  }).filter(Boolean);

  function applyObjFilter(){
    const q = String(ctx.state.objSearch||"").toLowerCase();
    const k = ctx.state.objKind || "all";
    const s = ctx.state.objStatus || "all";
    let shown = 0;
    for(const tr of objRowEls){
      const kind = tr.getAttribute("data-kind");
      const ident = tr.getAttribute("data-identified")==="1";
      const hay = tr.getAttribute("data-search")||"";
      const away = hay.includes(" away");
      let ok = true;
      // "ble" filter covers ble, private_ble, and ibeacon (all physical BLE devices)
      if(k === "ble" && kind !== "ble" && kind !== "private_ble" && kind !== "ibeacon") ok = false;
      else if(k !== "all" && k !== "ble" && kind !== k) ok = false;
      if(s === "identified" && !ident) ok = false;
      if(s === "unidentified" && ident) ok = false;
      if(s === "away" && !away) ok = false;
      if(q && !hay.includes(q)) ok = false;
      tr.style.display = ok ? "" : "none";
      if(ok) shown++;
    }
    objStats.textContent = `${shown} shown`;
  }

  objSearchInput.addEventListener("input",  ()=>{ ctx.state.objSearch = objSearchInput.value; applyObjFilter(); });
  objKindSel.addEventListener("change",     ()=>{ ctx.state.objKind   = objKindSel.value;     applyObjFilter(); });
  objStatusSel.addEventListener("change",   ()=>{ ctx.state.objStatus = objStatusSel.value;   applyObjFilter(); });
  applyObjFilter();

  // ── Basic mode: card-per-object list ─────────────────────────────────────────
  if(isBasic){
    const identified = allObjects.filter(o => o.identified);
    const unidentified = allObjects.filter(o => !o.identified);

    const headerRow = el("div",{class:"card-head"},[
      el("div",{class:"h2"}, "Tracked Objects"),
      helpBtn("objects"),
    ]);

    const mkCard = (o) => {
      const addr = o.address || o.entity_id || "";
      const name = o.user_label || o.name || o.entity_id || addr || "Unknown";
      const room = o.room || "—";
      const rssi = o.rssi != null ? `${o.rssi} dBm` : null;
      const kind = o.kind === "entity" ? "HA Entity"
        : o.kind === "private_ble" ? "Private BLE"
        : o.kind === "ibeacon" ? "iBeacon"
        : (o.identified ? "Tagged BLE" : "Unknown BLE");
      const isObjAway = _isAway(o);

      const actions = el("div",{class:"basic-obj-actions"});
      // Follow toggle
      const followKey = addr || o.entity_id || "";
      if(followKey){
        const isF = ctx.actions.followedHas(followKey);
        const fBtn = el("button",{
          class:"btn tiny",
          style: isF ? "background:#1a3a2a;border-color:#52b788;color:#52b788" : "",
        }, isF ? "✓ Following" : "Follow");
        fBtn.addEventListener("click", ()=>{
          ctx.actions.followedToggle(followKey);
          const nowF = ctx.actions.followedHas(followKey);
          fBtn.textContent = nowF ? "✓ Following" : "Follow";
          fBtn.style.cssText = nowF ? "background:#1a3a2a;border-color:#52b788;color:#52b788" : "";
        });
        actions.appendChild(fBtn);
      }
      const tagAddr2 = o.kind === "private_ble" ? (o.canonical_id || addr)
                     : o.kind === "ibeacon"     ? (o.key || "")
                     : addr;
      if((o.kind === "ble" || o.kind === "private_ble" || o.kind === "ibeacon") && tagAddr2){
        const btn = el("button",{class:"btn tiny"}, o.user_label ? "Relabel" : "Tag");
        btn.addEventListener("click", ()=> ctx.actions.tagObjectPrompt(tagAddr2, o.user_label || ""));
        actions.appendChild(btn);
      }
      const detailsBtn = el("button",{class:"btn tiny", onclick:()=> ctx.actions.showObjectDetail(o)}, "Details");
      actions.appendChild(detailsBtn);

      return el("div",{class:"basic-obj-card"},[
        el("div",{},[
          el("div",{class:"basic-obj-name",style:"display:flex;align-items:center;gap:6px"},[
            el("span",{}, name),
            isObjAway ? el("span",{class:"badge",style:"background:#3a0a0a;color:#f87171;border-color:#7f1d1d;font-size:9px"}, "Away") : null,
          ].filter(Boolean)),
          el("div",{class:"basic-obj-room"}, isObjAway
            ? (room && room !== "—" ? `Last: ${room}` : "—")
            : room),
          el("div",{class:"basic-obj-sub"}, [kind, o.company_name, o.device_type, isObjAway ? null : rssi].filter(Boolean).join(" · ")),
        ]),
        actions,
      ]);
    };

    const identCard = el("div",{class:"card",style:"margin-bottom:10px"},[
      headerRow,
      helpBtn ? null : null,
    ]);
    identified.forEach(o => identCard.appendChild(mkCard(o)));
    if(!identified.length){
      identCard.appendChild(el("div",{class:"muted",style:"margin-top:8px"},
        isLive ? "No identified objects detected yet." : "Switch to Live mode to see your real devices."));
    }
    root.appendChild(identCard);

    if(unidentified.length){
      const unCard = el("div",{class:"card"},[
        el("div",{class:"card-head"},[
          el("div",{class:"h2"}, `Unidentified (${unidentified.length})`),
          helpBtn("objects_tag"),
        ]),
        el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
          "These Bluetooth devices haven't been named yet. Click Tag to give one a friendly name."),
      ]);
      unidentified.slice(0, 20).forEach(o => unCard.appendChild(mkCard(o)));
      root.appendChild(unCard);
    }
    return root;
  }

  // ── Advanced mode: table ──────────────────────────────────────────────────────
  const awayCount = allObjects.filter(_isAway).length;
  const inventorySection = el("div",{class:"card"},[
    el("div",{class:"row",style:"margin-bottom:8px"},[
      el("div",{class:"h2",style:"flex:1"},"BLE Scanner Detections"),
      summary ? el("span",{class:"badge"}, `${summary.ble||0} BLE`) : null,
      summary ? el("span",{class:"badge warn"}, `${summary.unidentified||0} unidentified`) : null,
      summary ? el("span",{class:"badge"}, `${summary.entities||0} entities`) : null,
      awayCount ? el("span",{class:"badge",style:"background:#3a0a0a;color:#f87171;border-color:#7f1d1d"}, `${awayCount} away`) : null,
    ].filter(Boolean)),
    el("div",{class:"toolbar"},[objSearchInput, objKindSel, objStatusSel, objStats]),
    allObjects.length
      ? objTable
      : el("div",{class:"muted"}, isLive ? "Waiting for scanner data…" : "Switch to Live mode to see real BLE detections."),
  ]);
  root.appendChild(inventorySection);


  const roomsList = el("div",{class:"rooms", id:"rooms"});
  const tagsList = el("div",{class:"tags", id:"tags"});

  const rooms = (() => {
    const disc = liveSnap && liveSnap.rooms_discovered;
    if (disc && disc.length) return [...disc].sort((a,b)=>a.localeCompare(b));
    return Object.keys(roomTagMap||{}).sort((a,b)=>a.localeCompare(b));
  })();
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
    el("div",{class:"h2"},"Room Presence Mapping"),
    el("div",{class:"muted",style:"margin-bottom:6px"},"Select rooms to see which trackers are assigned to them."),
    toolbarLeft,
    roomsList,
  ]);

  const rightCard = el("div",{class:"card"},[
    el("div",{class:"muted"},"Trackers in selected rooms"),
    toolbarRight,
    tagsList,
  ]);

  const grid = el("div",{class:"grid"},[leftCard,rightCard]);
  root.appendChild(grid);

  renderTags(ctx, tagsList);

  return root;
}
