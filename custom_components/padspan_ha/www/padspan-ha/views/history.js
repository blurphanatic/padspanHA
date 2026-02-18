export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"history"});
  root.className = ctx.state.view==="history" ? "" : "hidden";
  root.appendChild(el("div",{class:"card"},[
    el("div",{class:"muted"},"History (panel session)"),
    el("div",{class:"mono", id:"historyOut"},"No history yet.")
  ]));
  return root;
}
