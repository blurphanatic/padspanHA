export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"qa"});
  root.className = ctx.state.view==="qa" ? "" : "hidden";
  root.appendChild(el("div",{class:"card"},[
    el("div",{class:"muted"},"QA tools"),
    el("div",{class:"mono"},
`Use Auto Diagnostics + the Diagnostics view to copy/paste info.
Try switching view rapidly to stress-test menu wiring.`),
  ]));
  return root;
}
