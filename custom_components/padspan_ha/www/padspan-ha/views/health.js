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
  return root;
}
