// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
export function render(ctx){
  const { el, helpBtn } = ctx.helpers;
  const root = el("section",{id:"history"});
  const events = ctx.state._sessionEvents || [];

  // Header
  root.appendChild(el("div",{class:"row",style:"align-items:center;gap:8px;margin-bottom:14px"},[
    el("h2",{},"History"),
    helpBtn("history"),
  ]));

  if(events.length === 0){
    root.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"Session history will appear as you interact with the panel."),
      el("div",{class:"muted",style:"font-size:12px;margin-top:6px"},"Navigate views, refresh data, and tag objects to generate events."),
    ]));
    return root;
  }

  // Type colors & labels
  const TYPE_COLORS = {
    view_change: "#5eead4",
    snapshot: "#52b788",
    tag: "#ff8a65",
    ws_call: "#90a4ae",
  };
  const TYPE_LABELS = {
    view_change: "View",
    snapshot: "Data",
    tag: "Tag",
    ws_call: "WS",
  };

  // Filter state — persist across re-renders
  const allTypes = [...new Set(events.map(e=>e.type))].sort();
  if(!ctx.state._historyFilters){
    ctx.state._historyFilters = new Set(allTypes);
  }
  // Ensure new types are visible
  for(const t of allTypes){
    if(!ctx.state._historyFilters.has(t)) ctx.state._historyFilters.add(t);
  }
  const activeFilters = ctx.state._historyFilters;

  // Toolbar: filters + clear
  const toolbar = el("div",{style:"display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px"});

  // Filter toggle buttons
  for(const type of allTypes){
    const color = TYPE_COLORS[type] || "#94a3b8";
    const label = TYPE_LABELS[type] || type;
    const isActive = activeFilters.has(type);
    const count = events.filter(e=>e.type===type).length;
    const btn = el("button",{
      style:`font-size:11px;padding:3px 10px;border-radius:12px;border:1px solid ${color};cursor:pointer;font-weight:600;transition:all 0.15s;`
        + (isActive
          ? `background:${color}22;color:${color};`
          : `background:transparent;color:#64748b;border-color:#333;text-decoration:line-through;opacity:0.5;`)
    }, `${label} (${count})`);
    btn.addEventListener("click", ()=>{
      if(activeFilters.has(type)) activeFilters.delete(type);
      else activeFilters.add(type);
      ctx.actions.renderRooms();
    });
    toolbar.appendChild(btn);
  }

  // Spacer + clear button
  toolbar.appendChild(el("div",{style:"flex:1"}));
  const clearBtn = el("button",{class:"btn inline",style:"font-size:11px;padding:2px 8px"}, "Clear History");
  clearBtn.addEventListener("click", ()=>ctx.actions.clearSessionEvents());
  toolbar.appendChild(clearBtn);

  root.appendChild(toolbar);

  // Apply filters
  const filtered = events.filter(e => activeFilters.has(e.type));

  // Count info
  root.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-bottom:8px"},
    filtered.length === events.length
      ? `${events.length} events`
      : `Showing ${filtered.length} of ${events.length} events`
  ));

  if(filtered.length === 0){
    root.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"All event types are filtered out. Click a filter button above to show events."),
    ]));
    return root;
  }

  // Timeline (newest first)
  const listContainer = el("div",{class:"list-scroll",style:"max-height:500px;overflow-y:auto;display:flex;flex-direction:column;gap:2px"});

  const sorted = [...filtered].reverse();
  for(const ev of sorted){
    const time = new Date(ev.ts);
    const hh = String(time.getHours()).padStart(2, "0");
    const mm = String(time.getMinutes()).padStart(2, "0");
    const ss = String(time.getSeconds()).padStart(2, "0");
    const timeStr = `${hh}:${mm}:${ss}`;

    const typeColor = TYPE_COLORS[ev.type] || "#94a3b8";
    const typeLabel = TYPE_LABELS[ev.type] || ev.type;

    const row = el("div",{style:"display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:4px;background:rgba(255,255,255,0.02)"});

    row.appendChild(el("span",{style:"font-family:monospace;font-size:11px;color:#64748b;flex-shrink:0;width:56px"}, timeStr));
    row.appendChild(el("span",{style:`font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;background:${typeColor}22;color:${typeColor};flex-shrink:0;min-width:36px;text-align:center`}, typeLabel));
    row.appendChild(el("span",{style:"font-size:12px;color:#cbd5e1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, ev.detail || ""));

    listContainer.appendChild(row);
  }

  root.appendChild(listContainer);
  return root;
}
