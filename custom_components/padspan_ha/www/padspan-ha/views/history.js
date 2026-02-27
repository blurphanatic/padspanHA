export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"history"});
  const events = ctx.state._sessionEvents || [];

  root.appendChild(el("div",{style:"font-size:20px;font-weight:800;margin-bottom:16px"},"History"));

  if(events.length === 0){
    root.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"Session history will appear as you interact with the panel."),
      el("div",{class:"muted",style:"font-size:12px;margin-top:6px"},"Navigate views, refresh data, and tag objects to generate events."),
    ]));
    return root;
  }

  // Type colors
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

  // Filter state (store on root so it persists across renders within session)
  const allTypes = [...new Set(events.map(e=>e.type))].sort();

  // Filter bar
  const filterRow = el("div",{class:"row",style:"gap:6px;flex-wrap:wrap;margin-bottom:12px"});

  // Active filters tracking — start with all visible
  const activeFilters = new Set(allTypes);

  const clearBtn = el("button",{class:"btn inline",style:"font-size:11px;padding:2px 8px"}, "Clear History");
  clearBtn.addEventListener("click", ()=>ctx.actions.clearSessionEvents());
  filterRow.appendChild(clearBtn);

  filterRow.appendChild(el("span",{class:"muted",style:"font-size:11px;margin-left:8px"}, `${events.length} events`));

  root.appendChild(filterRow);

  // Timeline
  const listContainer = el("div",{class:"list-scroll",style:"max-height:500px;overflow-y:auto;display:flex;flex-direction:column;gap:2px"});

  // Newest first
  const sorted = [...events].reverse();
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
