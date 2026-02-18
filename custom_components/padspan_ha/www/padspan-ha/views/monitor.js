export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"monitor"});
  root.className = ctx.state.view==="monitor" ? "" : "hidden";

  const wsCounts = ctx.state.wsCounts || {};
  const lines = Object.keys(wsCounts).sort().map(k=>`${k}: ${wsCounts[k]}`).join("\n") || "No websocket calls yet.";

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
  ]));
  return root;
}
