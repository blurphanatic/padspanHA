export function renderTags(ctx, tagsList) {
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

  // --- Live Bluetooth (Radios + Advertisements) ---
  if (ctx.state.dataMode === "live") {
    const ble = ctx.state?.live?.snapshot?.ble;
    if (ble) {
      const radios = Array.isArray(ble.radios) ? ble.radios : [];
      const ads = Array.isArray(ble.advertisements) ? ble.advertisements : [];

      const fmtAge = (ageS) => {
        const s = Math.max(0, Math.floor(Number(ageS) || 0));
        if (!s) return "";
        if (s < 60) return `${s}s ago`;
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        return `${h}h ago`;
      };

      const radioName = new Map();
      for (const r of radios) radioName.set(r.source, r.name || r.source);

      const bleCard = el("div", { class: "card" });
      bleCard.appendChild(el("div", { class: "muted" }, "Bluetooth (live advertisements)"));

      const row = el("div", { class: "grid", style: "grid-template-columns: 1fr 2fr; gap: 12px; margin-top: 8px" });

      const radiosBox = el("div", {});
      radiosBox.appendChild(el("div", { class: "muted" }, `Radios (${radios.length})`));
      if (!radios.length) {
        radiosBox.appendChild(el("div", { class: "item" }, "No radios detected yet."));
      } else {
        for (const r of radios) {
          const it = el("div", { class: "item" });
          it.appendChild(el("div", {}, esc(r.name || r.source)));
          it.appendChild(el("div", { class: "muted" }, esc(r.source)));
          radiosBox.appendChild(it);
        }
      }

      const adsBox = el("div", {});
      adsBox.appendChild(el("div", { class: "muted" }, `Tags / devices seen (${ads.length})`));
      if (!ads.length) {
        adsBox.appendChild(el("div", { class: "item" }, "No advertisements seen yet."));
      } else {
        const max = 60;
        for (const a of ads.slice(0, max)) {
          const it = el("div", { class: "item" });
          it.appendChild(el("div", {}, esc(a.name || a.address)));
          const sub = [
            a.address,
            radioName.get(a.source) || a.source,
            (a.rssi !== undefined && a.rssi !== null) ? `RSSI ${a.rssi}` : "",
            a.age_s ? fmtAge(a.age_s) : "",
          ].filter(Boolean).join(" • ");
          it.appendChild(el("div", { class: "muted" }, esc(sub)));
          adsBox.appendChild(it);
        }
        if (ads.length > max) adsBox.appendChild(el("div", { class: "muted", style: "padding:6px 2px" }, `Showing first ${max} (newest).`));
      }

      row.appendChild(radiosBox);
      row.appendChild(adsBox);
      bleCard.appendChild(row);

      root.appendChild(bleCard);
    }
  }

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
