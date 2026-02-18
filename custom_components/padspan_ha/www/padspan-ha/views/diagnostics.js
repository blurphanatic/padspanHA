export function render(ctx){
  const { el, esc } = ctx.helpers;
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

  const pre = el("pre",{class:"mono", style:"max-height:420px;overflow:auto"}, JSON.stringify(payload, null, 2));

  const btnCopy = el("button",{class:"btn"}, "Copy to Clipboard");
  btnCopy.addEventListener("click", async ()=>{
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      ctx.toast("Copied diagnostics.");
    } catch (e) {
      ctx.toast("Copy failed. Select and copy manually.", true);
    }
  });

  root.appendChild(el("div",{class:"grid"},[
    el("div",{class:"card"},[
      el("div",{style:"display:flex;justify-content:space-between;align-items:center"},[
        el("div",{},[
          el("div",{style:"font-weight:700"}, "Diagnostics"),
          el("div",{class:"muted"}, "Paste this back into chat when something breaks."),
        ]),
        btnCopy
      ]),
      pre
    ]),
    el("div",{class:"card"},[
      el("div",{style:"font-weight:700"}, "Install Verification"),
      el("div",{class:"muted"}, "If you don't see v0.4.0 + this build id, HA is still serving an older install/cached JS."),
      el("div",{class:"mono"}, `UI: v${ctx.state.version} • build ${ctx.state.buildId}`),
      el("div",{class:"mono"}, `Backend: ${ctx.state.versionInfo ? JSON.stringify(ctx.state.versionInfo) : "unknown"}`),
      el("div",{class:"muted", style:"margin-top:8px"}, "If backend version differs from UI, you likely have multiple installs (HACS + manual, or multiple custom_components copies). Remove duplicates and restart HA.")
    ]),
  ]));

  return root;
}
