export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"settings"});
  root.className = ctx.state.view==="settings" ? "" : "hidden";
  root.appendChild(el("div",{class:"card"},[
    el("div",{class:"muted"},"Settings"),
    el("div",{class:"mono"},
`Configure scan interval via the integration Options/Configure dialog.
Cloud is intentionally disabled by default.`),
  ]));
  return root;
}
