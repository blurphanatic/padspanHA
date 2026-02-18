export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"debug"});
  root.className = ctx.state.view==="debug" ? "" : "hidden";
  root.appendChild(el("div",{class:"card"},[
    el("div",{class:"muted"},"Debug (panel state)"),
    el("pre",{class:"mono", id:"debugOut"},"Loading…"),
  ]));
  return root;
}
