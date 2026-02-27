// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
// PadSpan HA – Devices view
// Purpose: make the live tag/device information readable and actionable.
// We treat device_tracker state as "room" (common for Bermuda-style presence).

export function render(ctx) {
  const { el, esc } = ctx.helpers;

  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const isLive = ctx.state.dataMode === "live";

  if (!snap) {
    return el("div", { class: "card" }, [
      el("div", { style: "font-weight:700" }, "No snapshot data"),
      el("div", { class: "muted" }, "Switch to Sample or Live mode to see device data."),
    ]);
  }

  const tagsRaw = (snap && Array.isArray(snap.tags) ? snap.tags : []).map(t => ({
    entity_id: t.entity_id || "",
    name: t.name || t.entity_id || "Unknown",
    room: normalizeRoom(t.state),
    missing: !!t.missing,
    last_changed: t.last_changed || t.last_updated || "",
    state_raw: t.state || "",
  }));

  // View state
  if (!ctx.state.devSearch) ctx.state.devSearch = "";
  if (!ctx.state.devRoom) ctx.state.devRoom = "All";

  const search = String(ctx.state.devSearch || "").trim().toLowerCase();

  // Rooms list
  const roomCounts = new Map();
  for (const t of tagsRaw) {
    roomCounts.set(t.room, (roomCounts.get(t.room) || 0) + 1);
  }
  const rooms = ["All", ...Array.from(roomCounts.keys()).sort((a, b) => a.localeCompare(b))];

  // Filtered tags
  const tags = tagsRaw.filter(t => {
    if (ctx.state.devRoom && ctx.state.devRoom !== "All" && t.room !== ctx.state.devRoom) return false;
    if (!search) return true;
    const hay = `${t.name} ${t.entity_id} ${t.room} ${t.state_raw}`.toLowerCase();
    return hay.includes(search);
  });

  const roomRow = r => {
    const count = r === "All" ? tagsRaw.length : (roomCounts.get(r) || 0);
    return el(
      "button",
      {
        class: "dev-room" + (ctx.state.devRoom === r ? " active" : ""),
        onclick: () => {
          ctx.state.devRoom = r;
          ctx.actions.renderRooms();
        },
      },
      [
        el("span", { class: "dev-room-name" }, r),
        el("span", { class: "badge" }, String(count)),
      ]
    );
  };

  const tagRow = t => {
    const age = timeAgo(t.last_changed);
    return el("div", { class: "dev-tag" }, [
      el("div", { class: "dev-tag-main" }, [
        el("div", { class: "dev-tag-name" }, t.name),
        el("div", { class: "dev-tag-sub" }, `${t.entity_id}${t.room ? " • " + t.room : ""}`),
      ]),
      el("div", { class: "dev-tag-right" }, [
        t.missing ? el("span", { class: "pill bad" }, "MISSING") : el("span", { class: "pill good" }, "OK"),
        el("span", { class: "muted" }, age),
      ]),
    ]);
  };

  const stats = (() => {
    const missing = tagsRaw.filter(t => t.missing).length;
    const ok = tagsRaw.length - missing;
    return el("div", { class: "row" }, [
      el("div", { class: "grow" }, [
        el("div", { class: "h1" }, "Devices"),
        el("div", { class: "muted" }, "Organized by the current room/state of each tracker."),
      ]),
      el("div", { class: "bt-kpis" }, [
        el("div", { class: "kpi" }, [el("div", { class: "kpi-num" }, String(tagsRaw.length)), el("div", { class: "kpi-lbl" }, "Trackers")]),
        el("div", { class: "kpi" }, [el("div", { class: "kpi-num" }, String(ok)), el("div", { class: "kpi-lbl" }, "OK")]),
        el("div", { class: "kpi" }, [el("div", { class: "kpi-num" }, String(missing)), el("div", { class: "kpi-lbl" }, "Missing")]),
      ]),
    ]);
  })();

  const controls = el("div", { class: "bt-controls" }, [
    el("div", { class: "field", style: "min-width:260px" }, [
      el("div", { class: "label" }, "Search"),
      el("input", {
        class: "input",
        placeholder: "Search name, entity_id, room…",
        value: ctx.state.devSearch,
        oninput: e => {
          ctx.state.devSearch = e.target.value;
          ctx.actions.renderRooms();
        },
      }),
    ]),
    el("div", { class: "field" }, [
      el("div", { class: "label" }, "Selected room"),
      el("div", { class: "pill" }, ctx.state.devRoom || "All"),
    ]),
  ]);

  const left = el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Rooms"),
    el("div", { class: "muted" }, "Click a room to filter trackers."),
    el("div", { class: "dev-room-list list-scroll" }, rooms.map(roomRow)),
  ]);

  const right = el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Trackers"),
    el("div", { class: "muted" }, tags.length ? "Sorted by most recently changed." : "No trackers match the current filters."),
    el("div", { class: "dev-tag-list list-scroll" }, tags.sort((a, b) => (a.last_changed || "").localeCompare(b.last_changed || "")).reverse().map(tagRow)),
  ]);

  const footer = el("details", { class: "card" }, [
    el("summary", { style: "cursor:pointer;font-weight:700" }, "Raw snapshot (for debugging)"),
    el("pre", { class: "pre" }, esc(JSON.stringify({ tags: tagsRaw.slice(0, 100) }, null, 2))),
  ]);

  // BLE Objects from scanner
  const objList = (snap && snap.objects && Array.isArray(snap.objects.list)) ? snap.objects.list : [];
  const taggedBle = objList.filter(o => o.kind === "ble" && (o.user_label || o.identified));
  const unidentifiedBle = objList.filter(o => o.kind === "ble" && !o.identified && !o.user_label);

  const unidentifiedSection = el("div", { class: "card" }, [
    el("div", { class: "row" }, [
      el("div", { class: "h2", style: "flex:1" }, "Unidentified BLE Objects"),
      el("span", { class: "badge warn" }, `${unidentifiedBle.length} untagged`),
    ]),
    el("div", { class: "muted", style: "margin-bottom:8px" }, "BLE devices seen by your scanners that have no Home Assistant entity and no user label. Use Tag to identify them."),
    unidentifiedBle.length === 0
      ? el("div", { class: "muted" }, "None — all detected BLE devices are identified or tagged.")
      : el("div", { class: "dev-tag-list list-scroll" }, unidentifiedBle.slice(0, 200).map(o => {
          const addr = o.address || "";
          const sources = Array.isArray(o.sources) ? o.sources.join(", ") : "";
          const rssi = o.rssi != null ? `RSSI ${o.rssi}` : "";
          const age = o.age_s != null ? `${Math.round(Number(o.age_s))}s ago` : "";

          const tagBtn = el("button", { class: "btn tiny" }, "Tag This");
          tagBtn.addEventListener("click", () => ctx.actions.tagObjectPrompt(addr, ""));

          return el("div", { class: "dev-tag" }, [
            el("div", { class: "dev-tag-main" }, [
              el("div", { class: "dev-tag-name" }, addr || "Unknown"),
              el("div", { class: "dev-tag-sub" }, [sources, rssi, age].filter(Boolean).join(" • ")),
            ]),
            el("div", { class: "dev-tag-right" }, [tagBtn]),
          ]);
        })),
  ]);

  const taggedBleSection = taggedBle.length === 0 ? null : el("div", { class: "card" }, [
    el("div", { class: "row" }, [
      el("div", { class: "h2", style: "flex:1" }, "Tagged BLE Objects"),
      el("span", { class: "badge" }, `${taggedBle.length} tagged`),
    ]),
    el("div", { class: "muted", style: "margin-bottom:8px" }, "BLE devices you have labeled — these are tracked by your scanners."),
    el("div", { class: "dev-tag-list list-scroll" }, taggedBle.slice(0, 200).map(o => {
      const label = o.user_label || o.name || o.address || "Unknown";
      const addr = o.address || "";
      const sources = Array.isArray(o.sources) ? o.sources.join(", ") : "";
      const rssi = o.rssi != null ? `RSSI ${o.rssi}` : "";
      const age = o.age_s != null ? `${Math.round(Number(o.age_s))}s ago` : "";
      const relabelBtn = el("button", { class: "btn tiny" }, "Relabel");
      relabelBtn.addEventListener("click", () => ctx.actions.tagObjectPrompt(addr, o.user_label || ""));
      return el("div", { class: "dev-tag" }, [
        el("div", { class: "dev-tag-main" }, [
          el("div", { class: "dev-tag-name" }, label),
          el("div", { class: "dev-tag-sub" }, [addr, sources, rssi, age].filter(Boolean).join(" • ")),
        ]),
        el("div", { class: "dev-tag-right" }, [
          el("span", { class: "pill good" }, "Tagged"),
          relabelBtn,
        ]),
      ]);
    })),
  ]);

  return el("div", {}, [stats, controls, el("div", { class: "grid-2" }, [left, right]), taggedBleSection, unidentifiedSection, footer].filter(Boolean));
}

function normalizeRoom(state) {
  const s = String(state || "").trim();
  if (!s || s === "unknown" || s === "unavailable") return "Unknown";
  if (s === "not_home") return "Away";
  return s;
}

function timeAgo(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!isFinite(t)) return "—";
  const d = Date.now() - t;
  const s = Math.max(0, Math.floor(d / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
