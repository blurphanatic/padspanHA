export function render(ctx){
  const { el } = ctx.helpers;
  const diag = ctx.state.diag || {};
  const root = el("section",{id:"health"});
  root.className = ctx.state.view==="health" ? "" : "hidden";

  let summary = "Loading…";
  let recs = "—";
  if(diag.error){
    summary = `Error: ${diag.error}`;
    recs = "Run Auto Diagnostics again and share the Diagnostics view JSON.";
  } else if (diag.summary){
    summary = [
      `Version: ${diag.version || "—"}`,
      `Checks: ${diag.summary.passed}/${diag.summary.total} (failed ${diag.summary.failed})`,
      "",
      "Checks:",
      ...(diag.checks||[]).map(c => `- ${c.name}: ${c.ok ? "OK" : "FAIL"}  •  ${c.detail}`),
    ].join("\n");
    recs = (diag.recommendations||[]).length ? (diag.recommendations||[]).map(r => `- ${r}`).join("\n") : "No recommendations.";
  }

  root.appendChild(el("div",{class:"grid"},[
    el("div",{class:"card"},[el("div",{class:"muted"},"Diagnostics summary"), el("div",{class:"mono"}, summary)]),
    el("div",{class:"card"},[el("div",{class:"muted"},"Recommendations"), el("div",{class:"mono"}, recs)]),
  ]));
  return root;
}
