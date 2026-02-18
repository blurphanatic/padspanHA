export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"sandbox"});
  root.className = ctx.state.view==="sandbox" ? "" : "hidden";

  root.appendChild(el("div",{class:"card"},[
    el("div",{style:"font-weight:700"},"Sandbox"),
    el("div",{class:"muted"},"A place to prototype new UI widgets without risking other pages."),
    el("div",{class:"mono"}, `Current mode: ${ctx.state.dataMode.toUpperCase()}`),
    el("div",{class:"muted", style:"margin-top:10px"},"Next: room geometry editor, receiver calibration tools, and distortion/heat maps."),
  ]));
  return root;
}
