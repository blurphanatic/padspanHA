export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"diagnostics"});
  root.className = ctx.state.view==="diagnostics" ? "" : "hidden";
  root.appendChild(el("div",{class:"card"},[
    el("div",{class:"muted"},"Copy/Paste Diagnostics"),
    el("div",{class:"mono", id:"diagOut"},"Loading…"),
    el("div",{class:"muted"},"Copy everything in this box and paste it back here."),
  ]));
  return root;
}
