export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"debug"});
  root.className = ctx.state.view==="debug" ? "" : "hidden";

  const pre = el("pre",{class:"mono", style:"max-height:520px;overflow:auto"}, JSON.stringify(ctx.state, (k,v)=>{
    if(v instanceof Set) return Array.from(v);
    return v;
  }, 2));

  root.appendChild(el("div",{class:"card"},[
    el("div",{style:"font-weight:700"},"Debug (panel state)"),
    el("div",{class:"muted"},"Useful for UI-side issues (dead buttons, missing views)."),
    pre,
  ]));
  return root;
}
