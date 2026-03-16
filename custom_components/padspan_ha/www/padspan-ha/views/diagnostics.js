// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Diagnostics view — full JSON dump of UI and backend state.
 * Serializes version info, timing, WS counts, live snapshot, maps, room-tag map,
 * and auto-diagnostics into a copyable JSON block. Intended for pasting into
 * support conversations or AI-assisted debugging.
 */

export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"diagnostics"});
  root.className = ctx.state.view==="diagnostics" ? "" : "hidden";

  const payload = {
    ui: {
      version: ctx.state.version,
      buildId: ctx.state.buildId,
      view: ctx.state.view,
      dataMode: ctx.state.dataMode,
      timing: ctx.state.timing,
      wsCounts: ctx.state.wsCounts,
    },
    backend: {
      versionInfo: ctx.state.versionInfo,
      status: ctx.state.status,
      roomTagMap: ctx.state.roomTagMap,
      liveSnapshot: ctx.state.live.snapshot,
      liveSources: ctx.state.live.sources,
      maps: ctx.state.maps.list,
    },
    autoDiagnostics: ctx.state.diag,
  };

  const text = JSON.stringify(payload, null, 2);

  // Use a textarea so manual select/copy always works (even on http:// where
  // navigator.clipboard is often blocked).
  const ta = el("textarea", {
    class: "mono",
    style: "width:100%;height:420px;resize:vertical;white-space:pre;overflow:auto;",
    readonly: true,
  });
  ta.value = text;

  const selectAll = ()=>{
    ta.focus();
    ta.select();
  };

  const btnSelect = el("button",{class:"btn"}, "Select All");
  btnSelect.addEventListener("click", ()=>{
    selectAll();
    ctx.toast("Selected. Press Ctrl/Cmd+C to copy.");
  });

  const btnDownload = el("button",{class:"btn"}, "Download Report");
  btnDownload.addEventListener("click", ()=>{
    const ts = new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
    const blob = new Blob([text], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `padspan-diag-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    ctx.toast("Downloaded diagnostic report.");
  });

  const btnCopy = el("button",{class:"btn"}, "Copy");
  btnCopy.addEventListener("click", async ()=>{
    // Try modern clipboard first
    try {
      await navigator.clipboard.writeText(text);
      ctx.toast("Copied diagnostics.");
      return;
    } catch (e) {}

    // Robust fallback: temp textarea attached to document.body (outside shadow DOM)
    try {
      const tmp = document.createElement("textarea");
      tmp.value = text;
      tmp.setAttribute("readonly", "");
      tmp.style.position = "fixed";
      tmp.style.left = "-9999px";
      tmp.style.top = "0";
      document.body.appendChild(tmp);
      tmp.focus();
      tmp.select();
      const ok = document.execCommand && document.execCommand("copy");
      document.body.removeChild(tmp);
      if (ok) {
        ctx.toast("Copied diagnostics.");
        return;
      }
    } catch (e2) {}

    // Final fallback: manual
    selectAll();
    ctx.toast("Copy blocked by browser. Press Ctrl/Cmd+C.", true);
  });

  root.appendChild(el("div",{class:"grid"},[
    el("div",{class:"card"},[
      el("div",{style:"display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"},[
        el("div",{},[
          el("div",{style:"font-weight:700"}, "Diagnostics"),
          el("div",{class:"muted"}, "Paste this back into chat when something breaks."),
        ]),
        el("div",{style:"display:flex;gap:8px;align-items:center"},[ btnSelect, btnCopy, btnDownload ])
      ]),
      ta,
    ]),

    el("div",{class:"card"},[
      el("div",{style:"font-weight:700"}, "Install Verification"),
      el("div",{class:"muted"}, "If UI/Backend versions differ, HA is serving an older install or cached JS."),
      el("div",{class:"mono"}, `UI: v${ctx.state.version} • build ${ctx.state.buildId}`),
      el("div",{class:"mono"}, `Backend: ${ctx.state.versionInfo ? JSON.stringify(ctx.state.versionInfo) : "unknown"}`),
      el("div",{class:"muted", style:"margin-top:8px"}, "If backend version differs from UI, you likely have multiple installs (HACS + manual, or multiple custom_components copies). Remove duplicates and restart HA."),
    ]),
  ]));

  return root;
}
