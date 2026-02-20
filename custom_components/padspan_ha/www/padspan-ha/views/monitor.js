export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"monitor"});
  root.className = ctx.state.view==="monitor" ? "" : "hidden";

  const wsCounts = ctx.state.wsCounts || {};
  const lines = Object.keys(wsCounts).sort().map(k=>`${k}: ${wsCounts[k]}`).join("\n") || "No websocket calls yet.";

  // BLE object metrics from live snapshot
  const snap = ctx.state.live && ctx.state.live.snapshot;
  const objSummary = snap && snap.objects && snap.objects.summary;
  const unidentifiedCount = objSummary ? (objSummary.unidentified||0) : null;
  const totalCount = objSummary ? (objSummary.total||0) : null;
  const bleCount = objSummary ? (objSummary.ble||0) : null;

  const bleMetrics = objSummary ? el("div",{class:"card"},[
    el("div",{style:"font-weight:700"},"BLE Objects"),
    el("div",{class:"row", style:"gap:8px;flex-wrap:wrap;margin-top:8px"},[
      el("span",{class:"badge"}, `${totalCount} total`),
      el("span",{class:"badge"}, `${bleCount} BLE ads`),
      unidentifiedCount > 0
        ? el("span",{class:"badge warn"}, `${unidentifiedCount} unidentified`)
        : el("span",{class:"badge"}, "All identified"),
    ]),
    el("div",{class:"muted", style:"margin-top:6px"}, "Switch to Objects or Bluetooth view to tag unidentified devices."),
  ]) : el("div",{class:"card"},[
    el("div",{style:"font-weight:700"},"BLE Objects"),
    el("div",{class:"muted"}, "No live snapshot — switch to Live mode to see BLE metrics."),
  ]);

  root.appendChild(el("div",{class:"grid"},[
    el("div",{class:"card"},[
      el("div",{style:"font-weight:700"},"Websocket call counts (UI)"),
      el("pre",{class:"mono", style:"max-height:320px;overflow:auto"}, lines),
      el("div",{class:"muted"},"Helps detect if a button is wired (counts should increase when clicked)."),
    ]),
    el("div",{class:"card"},[
      el("div",{style:"font-weight:700"},"Timing"),
      el("div",{class:"mono"}, `Last refresh: ${ctx.state.timing.lastRefreshMs ?? "—"}ms`),
      el("div",{class:"mono"}, `Last diagnostics: ${ctx.state.timing.lastDiagMs ?? "—"}ms`),
    ]),
    bleMetrics,
  ]));
  return root;
}
