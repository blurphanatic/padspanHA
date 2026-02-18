export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"monitor"});
  root.className = ctx.state.view==="monitor" ? "" : "hidden";
  root.appendChild(el("div",{class:"grid"},[
    el("div",{class:"card"},[el("div",{class:"muted"},"Refresh timing"), el("div",{class:"mono", id:"monitorOut"},"Loading…")]),
    el("div",{class:"card"},[el("div",{class:"muted"},"WebSocket calls"), el("div",{class:"mono", id:"wsOut"},"Loading…")]),
  ]));
  return root;
}
