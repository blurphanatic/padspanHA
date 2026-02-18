export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"sandbox"});
  root.className = ctx.state.view==="sandbox" ? "" : "hidden";
  root.appendChild(el("div",{class:"card"},[
    el("div",{class:"muted"},"Sandbox"),
    el("div",{class:"mono"},"Safe playground. Does not write back to HA."),
    el("pre",{class:"mono", id:"sandboxOut"},"Loading…"),
  ]));
  return root;
}
