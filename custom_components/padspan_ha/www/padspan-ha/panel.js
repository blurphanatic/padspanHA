class PadSpanPanel extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { display:block; height:100%; }
      iframe { width:100%; height:100vh; border:0; background:#0b0f14; }
    `;
    const iframe = document.createElement("iframe");
    iframe.src = "/padspan_ha_static/index.html";
    root.append(style, iframe);
  }
}
if (!customElements.get("padspan-ha-panel")) {
  customElements.define("padspan-ha-panel", PadSpanPanel);
}
