// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Health view — quick system status summary.
 * Shows UI version/build, data mode, last refresh timing, and best-effort
 * live discovery counts (rooms, radios, tags). Lightweight counterpart
 * to the full Diagnostics JSON dump.
 */

export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"health"});
  root.className = ctx.state.view==="health" ? "" : "hidden";

  const snap = ctx.state.live.snapshot;
  const rooms = snap?.rooms?.length ?? Object.keys(ctx.state.roomTagMap||{}).length;
  const tags = snap?.tags?.length ?? Object.values(ctx.state.roomTagMap||{}).reduce((a,b)=>a+(b?.length||0),0);
  const radios = snap?.radios?.length ?? 0;

  root.appendChild(el("div",{class:"grid"},[
    el("div",{class:"card"},[
      el("div",{style:"font-weight:700"},"System"),
      el("div",{class:"mono"}, `UI v${ctx.state.version} • build ${ctx.state.buildId}`),
      el("div",{class:"mono"}, `Data mode: ${ctx.state.dataMode.toUpperCase()}`),
      el("div",{class:"mono"}, `Refresh: ${ctx.state.timing.lastRefreshMs ?? "—"}ms`),
    ]),
    el("div",{class:"card"},[
      el("div",{style:"font-weight:700"},"Live Discovery (best-effort)"),
      el("div",{class:"mono"}, `Rooms: ${rooms}`),
      el("div",{class:"mono"}, `Radios: ${radios}`),
      el("div",{class:"mono"}, `Tags/Objects: ${tags}`),
      el("div",{class:"muted", style:"margin-top:8px"},"For deeper validation, open Diagnostics and paste the JSON into chat."),
    ]),
  ]));

  // ── Scanner Health (Phase 3) ────────────────────────────────────────────
  const sh = snap?.scanner_health;
  if (sh && Object.keys(sh).length) {
    const _sid = ctx.helpers.radioShortId;
    const liveRadios = (snap?.ble?.radios) || [];
    const nameMap = {};
    for (const r of liveRadios) { if(r.source && r.name) nameMap[r.source] = r.name; }
    const entries = Object.entries(sh).sort((a,b) => a[1].reliability - b[1].reliability);
    const shCard = el("div",{class:"card",style:"margin-top:12px"});
    shCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:8px"},"Scanner Health"));
    const tbl = el("div",{style:"display:grid;grid-template-columns:auto 1fr auto auto auto;gap:4px 10px;font-size:11px;align-items:center"});
    // Header
    for(const h of ["","Scanner","Room","Agreement","Weight"]){
      tbl.appendChild(el("div",{style:"font-weight:600;color:#94a3b8;font-size:10px;text-transform:uppercase"},h));
    }
    for(const [src, d] of entries){
      const rel = d.reliability;
      const dotColor = rel >= 0.9 ? "#52b788" : rel >= 0.7 ? "#f59e0b" : "#f87171";
      const sid = _sid ? _sid(src) : "";
      const name = nameMap[src] || src;
      tbl.appendChild(el("div",{style:`display:flex;align-items:center;gap:4px`},[
        el("span",{style:`display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor}`}),
        sid ? el("span",{class:"pill",style:"font-family:monospace;font-size:10px;padding:0 4px"},sid) : null,
      ].filter(Boolean)));
      tbl.appendChild(el("div",{style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap"},name));
      tbl.appendChild(el("div",{class:"muted"},d.room || "—"));
      tbl.appendChild(el("div",{style:`color:${dotColor}`},`${d.agree_pct}%`));
      tbl.appendChild(el("div",{class:"mono"},String(rel)));
    }
    shCard.appendChild(tbl);
    // Flag scanners with low reliability
    const bad = entries.filter(([,d]) => d.reliability < 0.7 && d.polls >= 12);
    if(bad.length){
      const warn = el("div",{style:"margin-top:8px;padding:8px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);border-radius:6px;font-size:11px;color:#fca5a5"});
      warn.innerHTML = `<b>\u26a0 ${bad.length} scanner(s) below 70% reliability</b><br>` +
        bad.map(([src,d]) => `${nameMap[src]||src} (${d.agree_pct}% agreement)`).join(", ") +
        `<br><span style="color:#94a3b8;font-size:10px">These scanners frequently disagree with consensus room assignments. Check placement, antenna orientation, or RSSI offset.</span>`;
      shCard.appendChild(warn);
    }
    root.appendChild(shCard);
  }

  return root;
}
