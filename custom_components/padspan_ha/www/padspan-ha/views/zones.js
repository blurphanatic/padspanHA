// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
export function render(ctx){
  const { el, helpBtn } = ctx.helpers;
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const root = el("section",{id:"zones"});

  // Header
  root.appendChild(el("div",{class:"row",style:"align-items:center;gap:8px;margin-bottom:14px"},[
    el("h2",{},"Zones"),
    helpBtn("zones"),
  ]));

  if(!snap){
    root.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"No snapshot available. Switch to Live or Sample mode to see zone data."),
    ]));
    return root;
  }

  const rooms = snap.rooms_discovered || [];
  const objects = (snap.objects && snap.objects.list) || [];
  const model = ctx.state.model || {};
  const floors = (model.floors || []);
  const areas = (model.areas || []);

  // Build room → objects map
  const roomObjs = {};
  for(const r of rooms) roomObjs[r] = [];
  for(const o of objects){
    const r = o.room || "";
    if(r && roomObjs[r]) roomObjs[r].push(o);
    else if(r) roomObjs[r] = [o];
  }

  const occupied = Object.values(roomObjs).filter(v=>v.length>0).length;
  const empty = rooms.length - occupied;

  // KPI row
  root.appendChild(el("div",{class:"row",style:"gap:10px;flex-wrap:wrap;margin-bottom:16px"},[
    el("span",{class:"badge"}, `${rooms.length} rooms`),
    el("span",{class:"badge"}, `${occupied} occupied`),
    el("span",{class:"badge"}, `${empty} empty`),
    el("span",{class:"badge"}, `${objects.length} objects`),
  ]));

  if(rooms.length === 0){
    root.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"No rooms discovered. Configure areas in Home Assistant."),
    ]));
    return root;
  }

  // Build floor→room mapping if floors exist
  const floorRooms = {};
  let hasFloors = false;
  if(floors.length > 0 && areas.length > 0){
    for(const f of floors) floorRooms[f.floor_id] = { name: f.name || f.floor_id, rooms: [] };
    floorRooms["_none"] = { name: "Unassigned", rooms: [] };
    for(const a of areas){
      const fid = a.floor_id || "_none";
      if(!floorRooms[fid]) floorRooms[fid] = { name: fid, rooms: [] };
      if(rooms.includes(a.name)) floorRooms[fid].rooms.push(a.name);
    }
    // Add rooms not in any area
    const assignedRooms = new Set(areas.map(a=>a.name));
    for(const r of rooms){
      if(!assignedRooms.has(r)){
        floorRooms["_none"].rooms.push(r);
      }
    }
    hasFloors = Object.values(floorRooms).some(f => f.rooms.length > 0 && f.name !== "Unassigned");
  }

  // Render room card helper
  const renderRoomCard = (room) => {
    const objs = roomObjs[room] || [];
    const isOccupied = objs.length > 0;
    const rc = ctx.helpers.roomColor(room);
    const borderColor = isOccupied ? rc : "rgba(255,255,255,0.08)";

    const card = el("div",{class:"card",style:`border-left:4px solid ${borderColor};cursor:pointer`});
    card.addEventListener("click", (e)=>{
      // Don't trigger room detail if an object was clicked
      if(e.target.closest("[data-obj-click]")) return;
      ctx.actions.showRoomDetail(room);
    });

    // Room name + badge
    card.appendChild(el("div",{class:"row",style:"justify-content:space-between;align-items:center;margin-bottom:8px"},[
      el("div",{style:`font-weight:700;color:${isOccupied ? "#e2e8f0" : "#64748b"}`}, room),
      el("span",{class:"badge"+(isOccupied?"":" muted")}, `${objs.length}`),
    ]));

    // Object list
    if(objs.length > 0){
      const list = el("div",{style:"display:flex;flex-direction:column;gap:3px"});
      for(const o of objs.slice(0, 8)){
        const label = o.user_label || o.name || o.address || "Unknown";
        const rssiText = o.rssi != null ? ` (${o.rssi} dBm)` : "";
        const isFollowed = ctx.actions.followedHas && ctx.actions.followedHas(o.address || o.key);
        const objRow = el("div",{"data-obj-click":"1",style:"font-size:12px;cursor:pointer;padding:2px 4px;border-radius:3px;display:flex;align-items:center;gap:4px"});
        objRow.addEventListener("mouseenter", ()=>{ objRow.style.background = "rgba(255,255,255,0.06)"; });
        objRow.addEventListener("mouseleave", ()=>{ objRow.style.background = ""; });
        objRow.addEventListener("click", (e)=>{ e.stopPropagation(); ctx.actions.showObjectDetail(o); });
        if(isFollowed){
          objRow.appendChild(el("span",{style:"color:#f59e0b;font-size:10px;flex-shrink:0"},"◉"));
        }
        objRow.appendChild(el("span",{style:"color:#cbd5e1"}, label));
        objRow.appendChild(el("span",{class:"muted",style:"font-size:11px"}, rssiText));
        list.appendChild(objRow);
      }
      if(objs.length > 8){
        list.appendChild(el("div",{class:"muted",style:"font-size:11px;font-style:italic;padding-left:4px"}, `+${objs.length - 8} more`));
      }
      card.appendChild(list);
    } else {
      card.appendChild(el("div",{class:"muted",style:"font-size:12px;font-style:italic"},"Empty"));
    }

    return card;
  };

  // Render with floor grouping or flat
  if(hasFloors){
    for(const [fid, fdata] of Object.entries(floorRooms)){
      if(fdata.rooms.length === 0) continue;
      // Sort rooms by occupancy count desc
      const sorted = [...fdata.rooms].sort((a,b)=>(roomObjs[b]||[]).length - (roomObjs[a]||[]).length || a.localeCompare(b));

      root.appendChild(el("div",{style:"font-size:14px;font-weight:700;color:#94a3b8;margin:16px 0 8px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:4px"}, fdata.name));
      const grid = el("div",{class:"grid"});
      for(const room of sorted) grid.appendChild(renderRoomCard(room));
      root.appendChild(grid);
    }
  } else {
    const grid = el("div",{class:"grid"});
    const sortedRooms = Object.keys(roomObjs).sort((a,b)=>{
      const diff = (roomObjs[b]||[]).length - (roomObjs[a]||[]).length;
      return diff !== 0 ? diff : a.localeCompare(b);
    });
    for(const room of sortedRooms) grid.appendChild(renderRoomCard(room));
    root.appendChild(grid);
  }

  return root;
}
