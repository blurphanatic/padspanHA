export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"events"});
  root.className = ctx.state.view==="events" ? "" : "hidden";
  root.appendChild(el("div",{class:"card"},[
    el("div",{class:"muted"},"Events (panel session log)"),
    el("div",{class:"mono", id:"eventsOut"},"No events yet.")
  ]));
  return root;
}
