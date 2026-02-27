// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
export function render(ctx){
  const { el } = ctx.helpers;
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const root = el("section",{id:"zones"});

  // Header
  root.appendChild(el("div",{style:"font-size:20px;font-weight:800;margin-bottom:16px"},"Zones"));

  if(!snap){
    root.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"No snapshot available. Switch to Live or Sample mode to see zone data."),
    ]));
    return root;
  }

  const rooms = snap.rooms_discovered || [];
  const objects = (snap.objects && snap.objects.list) || [];

  // Build room → objects map
  const roomObjs = {};
  for(const r of rooms) roomObjs[r] = [];
  for(const o of objects){
    const r = o.room || "";
    if(r && roomObjs[r]) roomObjs[r].push(o);
    else if(r) roomObjs[r] = [o]; // room not in rooms_discovered
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

  // Room grid
  const grid = el("div",{class:"grid"});
  const sortedRooms = Object.keys(roomObjs).sort((a,b)=>{
    const diff = (roomObjs[b]||[]).length - (roomObjs[a]||[]).length;
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  for(const room of sortedRooms){
    const objs = roomObjs[room] || [];
    const isOccupied = objs.length > 0;
    const rc = ctx.helpers.roomColor(room);
    const borderColor = isOccupied ? rc : "rgba(255,255,255,0.08)";

    const card = el("div",{class:"card",style:`border-left:4px solid ${borderColor};cursor:pointer`});
    card.addEventListener("click", ()=>ctx.actions.showRoomDetail(room));

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
        list.appendChild(el("div",{class:"muted",style:"font-size:12px"}, `${label}${rssiText}`));
      }
      if(objs.length > 8){
        list.appendChild(el("div",{class:"muted",style:"font-size:11px;font-style:italic"}, `+${objs.length - 8} more`));
      }
      card.appendChild(list);
    } else {
      card.appendChild(el("div",{class:"muted",style:"font-size:12px;font-style:italic"},"Empty"));
    }

    grid.appendChild(card);
  }

  root.appendChild(grid);
  return root;
}
