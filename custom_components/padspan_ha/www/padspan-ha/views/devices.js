// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Devices view — unified list of ALL tracked devices.
 * Merges HA entity trackers, tagged BLE objects, and unidentified BLE advertisements
 * into a single sortable table. Each row is clickable for details and supports
 * delete/untag actions. Gathers data from snap.tags, snap.objects, and snap.ble.
 */

export function render(ctx) {
  const { el, esc, radioShortId } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";

  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const isLive = ctx.state.dataMode === "live";

  if (!snap) {
    return el("div", { class: "card" }, [
      el("div", { style: "font-weight:700" }, "No snapshot data"),
      el("div", { class: "muted" }, "Switch to Sample or Live mode to see device data."),
    ]);
  }

  // ── Gather all devices from multiple sources ──────────────────────────────

  // 1) Entity-based trackers from snap.tags
  const tagsRaw = (Array.isArray(snap.tags) ? snap.tags : []).map(t => ({
    id: t.entity_id || "",
    type: "entity",
    name: t.name || t.entity_id || "Unknown",
    room: normalizeRoom(t.state),
    stateRaw: t.state || "",
    missing: !!t.missing,
    lastChanged: t.last_changed || t.last_updated || "",
    extra: t,
  }));

  // 2) BLE objects from objects.list (tagged, ibeacon, private_ble)
  const objList = (snap.objects && Array.isArray(snap.objects.list)) ? snap.objects.list : [];
  const bleDevices = objList
    .filter(o => o.kind === "ble" || o.kind === "private_ble" || o.kind === "ibeacon")
    .map(o => {
      const stableId = o.kind === "private_ble" ? (o.canonical_id || o.address || "")
                      : o.kind === "ibeacon"     ? (o.key || o.address || "")
                      : (o.address || "");
      return {
        id: stableId,
        type: o.kind,
        name: o.user_label || o.name || o.address || "Unknown",
        room: o.room || "",
        stateRaw: o.room || (o.age_s != null ? `seen ${Math.round(o.age_s)}s ago` : ""),
        missing: false,
        lastChanged: o.last_seen || "",
        tagged: !!(o.user_label || o.identified),
        rssi: o.rssi,
        age_s: o.age_s,
        sources: o.sources,
        obj: o,
      };
    });

  // Quiet mode: hide unidentified/untagged devices
  const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
  const _followedAddrs = ctx.state.followedAddrs || new Set();

  // Merge: entity trackers + BLE objects, dedup by id
  const seen = new Set();
  const allDevices = [];
  for (const t of tagsRaw) {
    if (t.id && !seen.has(t.id)) { seen.add(t.id); allDevices.push(t); }
  }
  for (const b of bleDevices) {
    if (b.id && !seen.has(b.id)) {
      // In quiet mode, skip untagged/unidentified BLE objects (unless followed)
      if (_quietMode && !b.tagged) {
        const fk = String(b.id || "").toUpperCase();
        if (!fk || !_followedAddrs.has(fk)) continue;
      }
      seen.add(b.id); allDevices.push(b);
    }
  }

  // ── View state ────────────────────────────────────────────────────────────
  if (!ctx.state.devSearch) ctx.state.devSearch = "";
  if (!ctx.state.devFilter) ctx.state.devFilter = "all"; // all | tagged | untagged | entity | missing

  const search = String(ctx.state.devSearch || "").trim().toLowerCase();
  const filter = ctx.state.devFilter;

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = allDevices.filter(d => {
    // Type filter
    if (filter === "tagged" && !(d.tagged || d.type === "entity")) return false;
    if (filter === "untagged" && (d.tagged || d.type === "entity")) return false;
    if (filter === "entity" && d.type !== "entity") return false;
    if (filter === "missing" && !d.missing) return false;
    // Search
    if (search) {
      const hay = `${d.name} ${d.id} ${d.room} ${d.stateRaw} ${d.type}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // Sort: followed first, then tagged/entities, then by name
  filtered.sort((a, b) => {
    const aFol = _followedAddrs.has(a.address || "") || _followedAddrs.has(a.entity_id || "") || _followedAddrs.has(a.key || "") ? 0 : 1;
    const bFol = _followedAddrs.has(b.address || "") || _followedAddrs.has(b.entity_id || "") || _followedAddrs.has(b.key || "") ? 0 : 1;
    if (aFol !== bFol) return aFol - bFol;
    const aRank = (a.tagged || a.type === "entity") ? 0 : 1;
    const bRank = (b.tagged || b.type === "entity") ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return (a.name || "").localeCompare(b.name || "");
  });

  // ── Counts ────────────────────────────────────────────────────────────────
  const entityCount = allDevices.filter(d => d.type === "entity").length;
  const taggedCount = allDevices.filter(d => d.tagged && d.type !== "entity").length;
  const untaggedCount = allDevices.filter(d => !d.tagged && d.type !== "entity").length;
  const missingCount = allDevices.filter(d => d.missing).length;

  // Clickable KPI card factory — clicking sets the device filter
  function _mkDevKpi(num, label, filterVal) {
    const isActive = filter === filterVal;
    const kpi = el("div", {
      class: "kpi",
      style: `cursor:pointer;${isActive ? "border:1px solid #52b788;border-radius:8px;background:#0a2a1a" : ""}`,
      title: `Click to filter: ${label}`,
    }, [
      el("div", { class: "kpi-num" }, num),
      el("div", { class: "kpi-lbl" }, label),
    ]);
    kpi.addEventListener("click", () => {
      ctx.state.devFilter = filterVal;
      ctx.actions.renderRooms();
    });
    return kpi;
  }

  // ── Header ────────────────────────────────────────────────────────────────
  const header = el("div", { class: "row", style: "margin-bottom:14px" }, [
    el("div", { class: "grow" }, [
      el("div", { class: "h1" }, "Devices & Trackers"),
      el("div", { class: "muted" }, "All tracked devices: HA entities, tagged BLE objects, and unidentified BLE devices."),
    ]),
    el("div", { class: "bt-kpis" }, [
      _mkDevKpi(String(allDevices.length), "Total", "all"),
      _mkDevKpi(String(entityCount), "Entities", "entity"),
      _mkDevKpi(String(taggedCount), "Tagged", "tagged"),
      _mkDevKpi(String(untaggedCount), "Untagged", "untagged"),
      missingCount ? _mkDevKpi(String(missingCount), "Missing", "missing") : null,
    ].filter(Boolean)),
  ]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const filterBtn = (value, label, count) => el("button", {
    class: "btn" + (filter === value ? "" : " inline"),
    style: "font-size:11px;padding:3px 10px",
    onclick: () => { ctx.state.devFilter = value; ctx.actions.renderRooms(); },
  }, `${label} (${count})`);

  const controls = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px" }, [
    el("input", {
      class: "input", style: "flex:1;min-width:180px;max-width:300px",
      placeholder: "Search name, address, room…",
      value: ctx.state.devSearch,
      oninput: e => { ctx.state.devSearch = e.target.value; ctx.actions.renderRooms(); },
    }),
    filterBtn("all", "All", allDevices.length),
    filterBtn("tagged", "Named", entityCount + taggedCount),
    filterBtn("untagged", "Untagged", untaggedCount),
    missingCount > 0 ? filterBtn("missing", "Missing", missingCount) : null,
  ].filter(Boolean));

  // ── Device rows ───────────────────────────────────────────────────────────
  const rows = filtered.slice(0, 300).map(d => {
    const kindBadge = d.type === "entity"      ? el("span", { class: "badge", style: "font-size:9px" }, "Entity")
                    : d.type === "private_ble"  ? el("span", { class: "badge", style: "font-size:9px;background:#1a2a3a;color:#7dd3fc;border-color:#1e4976" }, "Private BLE")
                    : d.type === "ibeacon"      ? el("span", { class: "badge", style: "font-size:9px;background:#2a1a3a;color:#c4b5fd;border-color:#5b21b6" }, "iBeacon")
                    : d.tagged                  ? el("span", { class: "badge", style: "font-size:9px" }, "Tagged")
                    : el("span", { class: "badge warn", style: "font-size:9px" }, "Untagged");

    const statusBadge = d.missing
      ? el("span", { class: "pill bad" }, "MISSING")
      : d.room
        ? el("span", { class: "pill good" }, d.room)
        : el("span", { class: "pill", style: "color:#94a3b8" }, "No room");

    const sub = [d.id];
    if (d.rssi != null) sub.push(`RSSI ${d.rssi}`);
    if (d.age_s != null) sub.push(`${Math.round(d.age_s)}s ago`);
    if (d.sources && d.sources.length) sub.push(`${d.sources.length} radio${d.sources.length > 1 ? "s" : ""}`);
    if (d.type === "entity" && d.stateRaw) sub.push(`state: ${d.stateRaw}`);

    // Buttons
    const btns = [];

    // Details button
    btns.push(el("button", { class: "btn tiny", style: "font-size:10px;padding:2px 6px", onclick: () => {
      if (d.obj) {
        ctx.actions.showObjectDetail(d.obj);
      } else if (d.extra) {
        // Build a minimal object for the detail modal
        ctx.actions.showObjectDetail({
          address: d.id,
          entity_id: d.type === "entity" ? d.id : undefined,
          name: d.name,
          kind: d.type === "entity" ? "entity" : d.type,
          room: d.room,
          ...d.extra,
        });
      }
    }}, "Details"));

    // Tag/Rename button (BLE objects only)
    if (d.type === "ble" || d.type === "private_ble" || d.type === "ibeacon") {
      const label = d.obj?.user_label || "";
      btns.push(el("button", { class: "btn tiny", style: "font-size:10px;padding:2px 6px", onclick: () => {
        ctx.actions.tagObjectPrompt(d.id, label);
      }}, label ? "Rename" : "Tag"));
    }

    // Delete/Untag button
    if (d.tagged && d.type !== "entity") {
      btns.push(el("button", { class: "btn tiny", style: "font-size:10px;padding:2px 6px;color:#f87171;border-color:#7f1d1d", onclick: async () => {
        if (!confirm(`Remove tag "${d.name}" (${d.id})?`)) return;
        try {
          await ctx.actions.objectLabelDelete(d.id);
          ctx.toast("Tag removed.");
          await ctx.actions.refreshSnapshot();
        } catch(e) { ctx.toast("Failed to remove tag.", true); }
      }}, "Untag"));
    }

    return el("div", { class: "dev-tag", style: "cursor:pointer", onclick: (e) => {
      // Don't trigger if a button was clicked
      if (e.target.closest("button")) return;
      if (d.obj) ctx.actions.showObjectDetail(d.obj);
    }}, [
      el("div", { class: "dev-tag-main" }, [
        el("div", { class: "dev-tag-name" }, d.name),
        el("div", { class: "dev-tag-sub" }, sub.join(" · ")),
      ]),
      el("div", { class: "dev-tag-right", style: "display:flex;align-items:center;gap:6px;flex-wrap:wrap" }, [
        kindBadge,
        statusBadge,
        ...btns,
      ]),
    ]);
  });

  const listCard = el("div", { class: "card" }, [
    el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px" }, [
      el("div", { class: "h2", style: "flex:1" }, `Showing ${filtered.length} of ${allDevices.length}`),
    ]),
    filtered.length === 0
      ? el("div", { class: "muted", style: "padding:12px 0" }, "No devices match the current filters.")
      : el("div", { class: "dev-tag-list list-scroll" }, rows),
  ]);

  return el("div", {}, [header, controls, listCard]);
}

function normalizeRoom(state) {
  const s = String(state || "").trim();
  if (!s || s === "unknown" || s === "unavailable") return "";
  if (s === "not_home") return "Away";
  if (s === "home") return "Home";
  return s;
}
