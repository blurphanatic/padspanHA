/*
  PadSpan HA — Standalone Calibration Panel
  ==========================================
  A lightweight HA sidebar panel that renders ONLY the BLE calibration view.
  No sidebar nav, no complexity toggle, no sample mode — just calibration.
  Designed for phone use during walk-around fingerprint collection.

  REPO NOTES
  - Registered as a second HA panel alongside the main "PadSpan HA" panel.
  - Imports calibration.js directly; provides the same ctx contract it expects.
  - BUILD_ID / APP_VERSION are updated automatically by scripts/release.py.
*/

import * as Calibration from "./views/calibration.js?b=20260224T195822Z";

const APP_VERSION = "0.4.64";
const BUILD_ID = "20260224T195822Z";

// ── Minimal DOM helpers (same signatures as panel.js) ──────────────────────
function el(tag, attrs={}, children=[]){
  const n = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){
    if(k==="class")  n.className = v;
    else if(k==="id") n.id = v;
    else if(k==="style") n.setAttribute("style", v);
    else if(k.startsWith("on") && typeof v==="function") n.addEventListener(k.slice(2), v);
    else if(v!==undefined && v!==null) n.setAttribute(k, String(v));
  }
  if(!Array.isArray(children)) children=[children];
  for(const c of children){
    if(c===null||c===undefined) continue;
    if(typeof c==="string") n.appendChild(document.createTextNode(c));
    else n.appendChild(c);
  }
  return n;
}
function esc(s){ return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }
// pill() stub — calibration.js doesn't use it but ctx.helpers is passed as-is
function pill(text, cls=""){ const s=document.createElement("span"); s.className="pill"+(cls?" "+cls:""); s.textContent=text; return s; }

// ── Custom Element ─────────────────────────────────────────────────────────
class PadSpanCalibApp extends HTMLElement {
  constructor(){
    super();
    this._hass   = null;
    this._booted = false;
    this._pollTimer = null;
    this.state = {
      view:        "calibration",   // always; prevents calibration.js hiding the section
      dataMode:    "live",
      complexity:  "advanced",
      live:        { snapshot: null, error: null },
      maps:        { list: [] },
      calibration: null,
      _calib:      null,
    };
  }

  // HA calls this whenever the hass object changes
  set hass(hass){
    this._hass = hass;
    if(!this._booted){
      this._booted = true;
      this._boot();
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  async _boot(){
    if(!this._hass) return;
    // Fetch map list so the "pin" tab can show floor plan images
    try {
      const res = await this._callWS({ type: "padspan_ha/maps_list" });
      this.state.maps.list = res?.maps || [];
    } catch(e){ /* non-fatal */ }
    // First snapshot fetch then periodic poll (2.5 s, same as main panel)
    await this._pollSnapshot();
    this._pollTimer = setInterval(()=>this._pollSnapshot(), 2500);
    this._render();
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────
  async _callWS(payload){
    return await this._hass.callWS(payload);
  }

  // ── Live BLE snapshot ─────────────────────────────────────────────────────
  async _pollSnapshot(){
    try {
      const res = await this._callWS({ type: "padspan_ha/live_snapshot" });
      this.state.live.snapshot = res?.snapshot || null;
      this.state.live.error    = null;
    } catch(e){
      this.state.live.error = String(e);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  _render(){
    if(!this.shadowRoot) return;
    const $c = this.shadowRoot.querySelector("#content");
    if(!$c) return;
    // Clear previous content
    while($c.firstChild) $c.removeChild($c.firstChild);
    const node = Calibration.render(this._ctx());
    if(node) $c.appendChild(node);
  }

  // ── ctx contract ───────────────────────────────────────────────────────────
  _ctx(){
    const self = this;
    return {
      hass:  this._hass,
      state: this.state,
      helpers: { el, esc, pill },
      actions: {
        renderRooms:             ()=> self._render(),
        refreshSnapshot:         async ()=>{ await self._pollSnapshot(); self._render(); },
        calibrationGet:          async ()=>
          await self._callWS({ type: "padspan_ha/calibration_get" }),
        calibrationSavePoint:    async (point)=>
          await self._callWS({ type: "padspan_ha/calibration_save_point", point }),
        calibrationDeletePoint:  async (point_id)=>
          await self._callWS({ type: "padspan_ha/calibration_delete_point", point_id }),
        calibrationClear:        async ()=>
          await self._callWS({ type: "padspan_ha/calibration_clear" }),
        calibrationComputeModel: async ()=>
          await self._callWS({ type: "padspan_ha/calibration_compute_model" }),
      },
    };
  }

  // ── Shadow DOM ─────────────────────────────────────────────────────────────
  connectedCallback(){
    if(!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.style.display = "block";

    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="/padspan_ha_static/padspan-ha/styles.css?v=${APP_VERSION}&b=${BUILD_ID}">
      <style>
        :host{display:block;min-height:100vh;background:#0a150e;color:#e2e8f0;
              font-family:Inter,system-ui,Arial,sans-serif;box-sizing:border-box}
        #content{padding:16px;max-width:800px;margin:0 auto}
        /* remove the "hidden" class that calibration.js adds when view!="calibration" */
        section.hidden{display:block!important}
      </style>
      <div id="content"></div>
    `;

    // Render immediately if already booted (reconnect after detach)
    if(this._booted) this._render();
  }

  disconnectedCallback(){
    if(this._pollTimer){ clearInterval(this._pollTimer); this._pollTimer = null; }
  }
}

customElements.define("padspan-calib-app", PadSpanCalibApp);
