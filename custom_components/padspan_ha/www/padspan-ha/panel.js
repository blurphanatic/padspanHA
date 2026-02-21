/*
REPO LOGIC NOTES

PadSpan HA Panel (single sidebar entry).
- All backend calls go through hass.callWS (websocket_api).
- The UI supports Sample vs Live data (toggle top-right).
- Internal navigation renders feature pages. Each page module exports render(ctx).
- A build stamp is shown in the UI so you can *prove* what code HA is serving (avoids cache confusion).

If UI changes don't show:
  - Hard refresh browser (Ctrl+F5)
  - Clear cache for your HA URL
  - Confirm build stamp in Diagnostics page
*/

import { SAMPLE_SNAPSHOT } from "./sample_data.js?b=20260220T200000Z";
import * as Follow from "./views/follow.js?b=20260220T200000Z";
import * as Overview from "./views/overview.js?b=20260220T200000Z";
import * as Objects from "./views/objects.js?b=20260220T200000Z";
import * as Devices from "./views/devices.js?b=20260220T200000Z";
import * as Bluetooth from "./views/bluetooth.js?b=20260220T200000Z";
import * as Presence from "./views/presence.js?b=20260220T200000Z";
import * as Zones from "./views/zones.js?b=20260220T200000Z";
import * as Insights from "./views/insights.js?b=20260220T200000Z";
import * as History from "./views/history.js?b=20260220T200000Z";
import * as Monitor from "./views/monitor.js?b=20260220T200000Z";
import * as Maps from "./views/maps.js?b=20260220T200000Z";
import * as Events from "./views/events.js?b=20260220T200000Z";
import * as Health from "./views/health.js?b=20260220T200000Z";
import * as Settings from "./views/settings.js?b=20260220T200000Z";
import * as Debug from "./views/debug.js?b=20260220T200000Z";
import * as Diagnostics from "./views/diagnostics.js?b=20260220T200000Z";
import * as QA from "./views/qa.js?b=20260220T200000Z";
import * as Sandbox from "./views/sandbox.js?b=20260220T200000Z";

const APP_VERSION = "0.4.32";
// Build stamp used for cache-busting and Diagnostics.
const BUILD_ID = "20260221T074807Z";

const VIEWS = {
  follow: Follow,
  overview: Overview,
  objects: Objects,
  devices: Devices,
  bluetooth: Bluetooth,
  presence: Presence,
  zones: Zones,
  insights: Insights,
  history: History,
  monitor: Monitor,
  maps: Maps,
  events: Events,
  health: Health,
  settings: Settings,
  diagnostics: Diagnostics,
  debug: Debug,
  qa: QA,
  sandbox: Sandbox,
};

const MENU = [
  ["follow","Follow","mdi:crosshairs-gps"],
  ["overview","Overview","mdi:view-dashboard-outline"],
  ["objects","Objects","mdi:tag-multiple-outline"],
  ["devices","Devices","mdi:devices"],
  ["bluetooth","Bluetooth","mdi:bluetooth"],
  ["presence","Presence","mdi:map-marker-radius-outline"],
  ["zones","Zones","mdi:vector-square"],
  ["insights","Insights","mdi:chart-line"],
  ["history","History","mdi:history"],
  ["monitor","Monitor","mdi:monitor-dashboard"],
  ["maps","Mapping","mdi:map"],
  ["events","Events","mdi:calendar"],
  ["health","Health","mdi:heart-pulse"],
  ["settings","Settings","mdi:cog-outline"],
  ["diagnostics","Diagnostics","mdi:stethoscope"],
  ["debug","Debug","mdi:bug-outline"],
  ["qa","QA","mdi:clipboard-check-outline"],
  ["sandbox","Sandbox","mdi:flask-outline"],
];

const MENU_COLORS = {
  follow: "#5eead4",
  overview: "#52b788",
  objects: "#ff8a65",
  devices: "#4db6ac",
  bluetooth: "#43a047",
  presence: "#ba68c8",
  zones: "#81c784",
  insights: "#ffd54f",
  history: "#90a4ae",
  monitor: "#f06292",
  maps: "#4caf50",
  events: "#ffb74d",
  health: "#e57373",
  settings: "#b0bec5",
  diagnostics: "#9575cd",
  debug: "#ef5350",
  qa: "#26c6da",
  sandbox: "#9ccc65",
};


function esc(s){
  return String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}
function el(tag, attrs={}, children=[]){
  const n=document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})) {
    if(k==="class") n.className=v;
    else if(k==="id") n.id=v;
    else if(k==="style") n.setAttribute("style", v);
    else if(k.startsWith("on") && typeof v==="function") n.addEventListener(k.slice(2), v);
    else if(v!==undefined && v!==null) n.setAttribute(k, String(v));
  }
  if(!Array.isArray(children)) children=[children];
  for(const c of children) {
    if(c===null || c===undefined) continue;
    if(typeof c==="string") n.appendChild(document.createTextNode(c));
    else n.appendChild(c);
  }
  return n;
}

function _hash32(str){
  let h = 2166136261;
  for(let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
// Deterministic room color (stable across sessions)
function roomColor(roomName, model){
  const meta = model && model.room_meta ? model.room_meta[String(roomName ?? "")] : null;
  if(meta && meta.color) return String(meta.color);
  const s = String(roomName ?? "");
  const h = _hash32(s) % 360;
  // Slightly different lightness for readability on dark bg
  return `hsl(${h} 70% 55%)`;
}

function pill(text){ return el("span",{class:"pill"}, text); }

class PadSpanHaApp extends HTMLElement {
  constructor(){
    super();
    this._hass = null;

    this.state = {
      version: APP_VERSION,
      buildId: BUILD_ID,
      view: "overview",
      dataMode: "sample",          // sample | live
      status: {},
      roomTagMap: {},
      savedRoomTagMap: {},
      model: { floors: [], room_meta: {} },
      live: { snapshot: null, sources: null, error: null },
      maps: { list: [], lastError: null },
      mapsTab: "library",
      activeMapId: null,
      diag: null,
      selectedRooms: [],
      _roomsInit: false,
      mode: "live",
      tagFilter: "",
      wsCounts: {},
      timing: { lastRefreshMs: null, lastDiagMs: null },
      lastToast: null,
      versionInfo: null,
    };

    this.$ = null;
    this.$nav = null;
    this.$content = null;

    // Live polling (keeps 'Live' mode actually live)
    this._pollTimer = null;
    this._pollInFlight = false;
  }

  set hass(hass){
    this._hass = hass;
    // Avoid spamming refresh on every hass set (HA calls it often)
    if(!this._booted){
      this._booted = true;
      this._refreshAll(false);
      if(this.state.dataMode === "live") this._startPolling();
    }
  }

  connectedCallback(){
    if(!this.shadowRoot) this.attachShadow({mode:"open"});
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="/padspan_ha_static/padspan-ha/styles.css?v=${APP_VERSION}&b=${BUILD_ID}">
      <div id="app" class="app">
        <aside class="left">
          <div class="brand">
            <img src="/padspan_ha_static/padspan-ha/assets/padspan-mark.svg?b=${BUILD_ID}" alt="PadSpan" onerror="this.style.display='none'">
            <div>
              <div class="label">PadSpan HA</div>
              <div class="muted" style="margin-top:2px">v${APP_VERSION} • build ${BUILD_ID}</div>
            </div>
          </div>

          <div class="toolbar" style="margin-top:10px">
            <button class="btn inline" id="mobileMenu">☰ Menu</button>
            <button class="btn inline" id="refresh">Refresh</button>
            <button class="btn inline" id="autodiag">Auto Diagnostics</button>
            <button class="btn inline" id="toggleSide">Toggle</button>
          </div>

          <div style="margin-top:12px;margin-bottom:8px" class="muted">Menu (inside this panel)</div>
          <div class="nav" id="nav"></div>
        </aside>

        <main class="main">
          <div class="row" style="margin-bottom:10px;align-items:center">
            <span class="pill" id="cloudBadge">Cloud disabled</span>
            <span class="pill" id="scanBadge">Scan: —</span>
            <span class="pill" id="statusBadge">Status: —</span>

            <span style="margin-left:auto;display:flex;align-items:center;gap:8px">
              <span class="muted" style="font-size:12px">Data</span>
              <button class="btn inline" id="dataModeToggle" title="Toggle sample vs live data">Sample</button>
            </span>
          </div>
          <div id="toast" class="toast hidden"></div>
          <div id="modal" class="modal hidden"></div>
          <div id="content"></div>
        </main>
      </div>
    `;

    this.$ = (q)=>this.shadowRoot.querySelector(q);
    this.$nav = this.$("#nav");
    this.$content = this.$("#content");
    this.$modal = this.$("#modal");

    this.$("#refresh").addEventListener("click", ()=>this._refreshAll(true));
    this.$("#autodiag").addEventListener("click", ()=>this._runAutoDiag(true));
    this.$("#toggleSide").addEventListener("click", ()=>this.$("#app").classList.toggle("mini"));
    this.$("#mobileMenu").addEventListener("click", ()=>this.$("#app").classList.toggle("mobile-open"));

    this.$("#dataModeToggle").addEventListener("click", async ()=>{
      const next = (this.state.dataMode === "sample") ? "live" : "sample";
      await this._setDataMode(next);
    });

    this._renderNav();
    // Load persisted mode (sample/live) even before hass is set.
    // When hass arrives we refresh.
    this._loadSettings();
    this._renderCurrentView();
    this._startPolling();
  }


  disconnectedCallback(){
    this._stopPolling();
  }

  _startPolling(){
    if(this._pollTimer) return;
    this._pollTimer = setInterval(()=>this._pollTick(), 5000);
  }

  _stopPolling(){
    if(this._pollTimer){
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async _pollTick(){
    if(!this._hass) return;
    if(this.state.dataMode !== "live") return;
    if(this._pollInFlight) return;
    // Avoid interrupting map drawing
    if(this.state.view === "maps") return;

    this._pollInFlight = true;
    const t0 = performance.now();
    try{
      await this._getLiveSnapshot();
      await this._getStatus();
      this.state.timing.lastRefreshMs = Math.round(performance.now() - t0);
      this._updateBadges();

      // Re-render views that show live data.
      const liveViews = new Set(["overview","objects","devices","bluetooth","presence","zones","insights","history","monitor","events","health","diagnostics","debug","qa","sandbox"]);
      if(liveViews.has(this.state.view)) this._renderCurrentView();
    } catch(e){
      // Non-fatal; keep trying.
    } finally {
      this._pollInFlight = false;
    }
  }

  // ---------- WS helpers ----------
  _wsCount(type){
    this.state.wsCounts[type] = (this.state.wsCounts[type]||0)+1;
  }

  async _callWS(payload){
    if(!this._hass) throw new Error("hass not ready");
    this._wsCount(payload.type);
    return await this._hass.callWS(payload);
  }

  // ---------- Data loading ----------
  async _loadSettings(){
    try {
      if(!this._hass) return;
      const res = await this._callWS({ type: "padspan_ha/settings_get" });
      const mode = (res?.settings?.data_mode || "sample").toLowerCase();
      this.state.dataMode = (mode === "live") ? "live" : "sample";
      this._updateBadges();
      this._renderCurrentView();
    } catch (e) {
      // Non-fatal
      this._toast("Settings load failed (will retry on refresh).", true);
    }
  }

  async _setDataMode(mode){
    try {
      const res = await this._callWS({ type: "padspan_ha/settings_set", data_mode: mode });
      const m = (res?.settings?.data_mode || "sample").toLowerCase();
      this.state.dataMode = (m === "live") ? "live" : "sample";
      this._toast(`Data mode: ${this.state.dataMode.toUpperCase()}`);
      await this._refreshAll(false);
      if(this.state.dataMode === "live") this._startPolling();
      else this._stopPolling();
    } catch (e) {
      this._toast("Failed to switch data mode. See Diagnostics.", true);
      console.error(e);
    }
  }

  async _getVersionInfo(){
    try {
      const res = await this._callWS({ type: "padspan_ha/version" });
      this.state.versionInfo = res;
    } catch (e) {
      this.state.versionInfo = null;
    }
  }

  async _getStatus(){
    const res = await this._callWS({ type: "padspan_ha/status" });
    const entry = (res?.entries && res.entries[0]) ? res.entries[0] : {};
    this.state.status = entry;
  }

  _recomputeDerived(){
    // Keep the saved map separate from the effective map the UI should use.
    const saved = this.state.savedRoomTagMap || {};
    const snap = this.state.live?.snapshot;
    if(snap && snap.room_tag_map){
      this.state.roomTagMap = (snap.room_tag_map_live || snap.room_tag_map) || {};
      this.state.missingRoomTagMap = snap.room_tag_map_missing || {};
      // Only update savedRoomTagMap from live data (sample snapshot has no persistent map)
      if(this.state.dataMode === "live"){
        this.state.savedRoomTagMap = snap.room_tag_map_saved || {};
      }
    } else {
      this.state.roomTagMap = saved || {};
    }
  }

  async _getRoomTags(){
    const res = await this._callWS({ type: "padspan_ha/room_tags" });
    this.state.savedRoomTagMap = res?.room_tag_map || {};
    this._recomputeDerived();
    if(res?.sources) this.state.live.sources = res.sources;
  }

  async _getLiveSnapshot(){
    if(this.state.dataMode !== "live") {
      // Sample mode: use the built-in demo snapshot so all views render fully
      this.state.live.snapshot = SAMPLE_SNAPSHOT;
      this.state.live.error = null;
      this._recomputeDerived();
      return;
    }
    const res = await this._callWS({ type: "padspan_ha/live_snapshot" });
    this.state.live.snapshot = res?.snapshot || null;
    this.state.live.error = null;
    this._recomputeDerived();
  }

  async _getMapsList(){
    const res = await this._callWS({ type: "padspan_ha/maps_list" });
    this.state.maps.list = res?.maps || [];
    if(this.state.activeMapId && !this.state.maps.list.find(m=>m.id===this.state.activeMapId)){
      this.state.activeMapId = null;
    }
  }


  async _getModel(){
    try {
      const res = await this._callWS({ type: "padspan_ha/model_get" });
      this.state.model = { floors: res?.floors || [], areas: res?.areas || [], room_meta: res?.room_meta || {} };
    } catch (e) {
      // non-fatal
      console.warn("model_get failed", e);
    }
  }

  async _runAutoDiag(userAction=false){
    try {
      const t0 = performance.now();
      const res = await this._callWS({ type: "padspan_ha/auto_diagnostics" });
      this.state.diag = res;
      this.state.timing.lastDiagMs = Math.round(performance.now() - t0);
      if(userAction) this._toast("Auto diagnostics complete.");
    } catch (e) {
      this.state.diag = {
        version: APP_VERSION,
        error: String(e),
        summary: { ok:false, total:1, passed:0, failed:1 },
        checks: [{ name:"ws_auto_diagnostics", ok:false, detail:String(e) }],
        recommendations: ["Check Home Assistant logs for padspan_ha errors."],
      };
      if(userAction) this._toast("Auto diagnostics failed. See Diagnostics.", true);
    }
  }

  async _refreshAll(userAction=false){
    if(!this._hass) return;
    const t0 = performance.now();
    if(userAction) this._toast("Refreshing…");
    await Promise.all([
      this._getVersionInfo(),
      this._getStatus(),
      this._getRoomTags(),
      this._getLiveSnapshot(),
      this._getMapsList(),
      this._getModel(),
      this._runAutoDiag(false),
    ]);
    this._recomputeDerived();
    this.state.timing.lastRefreshMs = Math.round(performance.now() - t0);
    this._updateBadges();
    this._renderCurrentView();
  }

  _updateBadges(){
    // Top badges
    const scan = this.state.status?.scan_interval ?? "—";
    const st = this.state.status?.status ?? "—";
    this.$("#scanBadge").textContent = `Scan: ${scan}s`;
    this.$("#statusBadge").textContent = `Status: ${st}`;
    this.$("#cloudBadge").textContent = "Cloud disabled";

    const b = this.$("#dataModeToggle");
    if(b) b.textContent = (this.state.dataMode === "live") ? "Live" : "Sample";
  }

  // ---------- Nav + rendering ----------
  _renderNav(){
    this.$nav.innerHTML = "";
    for(const [id,label] of MENU.map(x=>[x[0],x[1]])) {
      const color = MENU_COLORS[id] || "#37588f";
      const btn = el("button",{
        class:"navbtn"+(this.state.view===id?" active":""),
        style:`--navcolor:${color}`,
        onclick:()=>{ this.state.view=id; this._renderNav(); this._renderCurrentView(); }
      }, [el("span",{class:"navdot"}), el("span",{}, label)]);
      this.$nav.appendChild(btn);
    }
  }

  _ctx(){
    return {
      hass: this._hass,
      state: this.state,
      helpers: { el, esc, pill, roomColor: (n)=>roomColor(n, this.state.model) },
      actions: {
        // Simple actions used by views
        renderRooms: ()=>this._renderCurrentView(),
        // Objects view updates its tag list in-place to avoid full re-render loops.
        renderTags: (target=null)=>{
          const node = target || this.shadowRoot?.querySelector("#content #tags");
          if(!node) return;
          try { Objects.renderTags(this._ctx(), node); } catch (e) { console.error(e); }
        },
        renderDiag: ()=>this._renderCurrentView(),
        // Modal used by Overview/Objects drilldowns
        openModal: (title, bodyNode, subtitle="")=>this._openModal(title, bodyNode, subtitle),
        closeModal: ()=>this._closeModal(),

        // Vendor lookup (online, cached server-side)
        vendorLookup: async (mac, force_refresh=false)=>{
          return await this._callWS({ type:"padspan_ha/vendor_lookup", mac, force_refresh: !!force_refresh });
        },

        // Object label actions (tag/untag BLE devices)
        objectLabelSet: async (address, label)=>{
          return await this._callWS({ type:"padspan_ha/object_label_set", address, label });
        },
        objectLabelDelete: async (address)=>{
          return await this._callWS({ type:"padspan_ha/object_label_delete", address });
        },
        tagObjectPrompt: (addr, currentLabel)=>this._tagObjectPrompt(addr, currentLabel),
        radioAreaSet: async (payload)=>await this._callWS({ type:"padspan_ha/radio_area_set", ...payload }),
        refreshSnapshot: async ()=>{ await this._getLiveSnapshot(); this._renderCurrentView(); },
        followAlertSave: async (payload)=>await this._callWS({ type:"padspan_ha/follow_alert_save", ...payload }),

        // Mapping suite actions
        setMapsTab: (t)=>{ this.state.mapsTab=t; this._renderCurrentView(); },
        mapsRefresh: async ()=>{ await this._getMapsList(); this._renderCurrentView(); },
        mapsSetActive: (id)=>{ this.state.activeMapId=id; this._renderCurrentView(); },
        mapsDelete: async (id)=>{ await this._callWS({ type:"padspan_ha/maps_delete", map_id:id }); await this._getMapsList(); if(this.state.activeMapId===id) this.state.activeMapId=null; this._renderCurrentView(); },
        mapsUpload: async (payload)=>{ await this._callWS(Object.assign({type:"padspan_ha/maps_upload"}, payload)); await this._getMapsList(); this._renderCurrentView(); },
        mapsUpdate: async (payload)=>{ await this._callWS(Object.assign({type:"padspan_ha/maps_update"}, payload)); await this._getMapsList(); this._renderCurrentView(); },
        modelUpdate: async (payload)=>{ await this._callWS(Object.assign({type:"padspan_ha/model_update"}, payload)); await this._getModel(); this._renderCurrentView(); },
      },
      toast: (m, isErr=false)=>this._toast(m, isErr),
    };
  }

  // ----------------------------
  // Modal helper (Overview lists)
  // ----------------------------
  _openModal(title, bodyNode, subtitle=""){
    if(!this.$modal) return;
    this.$modal.classList.remove("hidden");
    this.$modal.innerHTML = "";

    const overlay = el("div",{class:"overlay"});
    const panel = el("div",{class:"panel"});

    const closeBtn = el("button",{class:"btn inline close"}, "Close");
    closeBtn.addEventListener("click", ()=>this._closeModal());

    const head = el("div",{class:"head"},[
      el("div",{class:"title"}, title || ""),
      el("div",{class:"sub"}, subtitle || ""),
      closeBtn
    ]);

    const body = el("div",{class:"body"});
    if(typeof bodyNode === "string"){
      body.innerHTML = bodyNode;
    } else if(bodyNode){
      body.appendChild(bodyNode);
    }

    panel.appendChild(head);
    panel.appendChild(body);
    overlay.appendChild(panel);

    overlay.addEventListener("click",(e)=>{ if(e.target === overlay) this._closeModal(); });
    this.$modal.appendChild(overlay);

    // ESC closes
    const esc = (e)=>{ if(e.key === "Escape"){ this._closeModal(); } };
    this._modalEsc = esc;
    window.addEventListener("keydown", esc, { once: true });
  }

  _closeModal(){
    if(!this.$modal) return;
    this.$modal.classList.add("hidden");
    this.$modal.innerHTML = "";
  }


  _tagObjectPrompt(addr, currentLabel){
    const input = el("input",{type:"text", placeholder:"Enter a label…"});
    input.value = currentLabel || "";
    input.style.minWidth = "240px";

    const status = el("div",{class:"muted", style:"min-height:20px;margin-top:6px"});

    const saveBtn = el("button",{class:"btn"}, currentLabel ? "Update label" : "Save label");
    const clearBtn = el("button",{class:"btn"}, "Untag");
    clearBtn.disabled = !currentLabel;
    clearBtn.title = currentLabel ? `Remove label "${currentLabel}"` : "No label to remove";
    const cancelBtn = el("button",{class:"btn inline"}, "Cancel");
    cancelBtn.addEventListener("click", ()=>this._closeModal());

    saveBtn.addEventListener("click", async ()=>{
      const label = input.value.trim();
      if(!label){ status.textContent = "Label cannot be empty."; return; }
      try {
        await this._callWS({ type:"padspan_ha/object_label_set", address: addr, label });
        this._closeModal();
        this._toast(`Tagged: ${label}`);
        await this._getLiveSnapshot();
        this._renderCurrentView();
      } catch(e) {
        status.textContent = "Failed to save label. Check HA logs.";
      }
    });

    clearBtn.addEventListener("click", async ()=>{
      try {
        await this._callWS({ type:"padspan_ha/object_label_delete", address: addr });
        this._closeModal();
        this._toast("Label removed.");
        await this._getLiveSnapshot();
        this._renderCurrentView();
      } catch(e) {
        status.textContent = "Failed to remove label. Check HA logs.";
      }
    });

    // Allow Enter key to save
    input.addEventListener("keydown",(e)=>{ if(e.key==="Enter") saveBtn.click(); });

    const body = el("div",{}, [
      el("div",{class:"muted", style:"margin-bottom:8px"}, `BLE address: ${addr}`),
      el("div",{class:"row", style:"gap:8px;flex-wrap:wrap"}, [input, saveBtn, clearBtn, cancelBtn]),
      status,
    ]);
    this._openModal("Tag BLE Object", body, "Assign a human-readable label to identify this device");
    // Focus input after modal renders
    requestAnimationFrame(()=>{ try{ input.focus(); }catch(e){} });
  }

  _renderCurrentView(){
    if(!this.$content) return;
    const v = this.state.view;
    const mod = VIEWS[v];

    // Preserve scroll positions for common scroll containers so periodic live refreshes
    // don't make the UI "jump" while the user is reading.
    const selectors = [".rooms",".tags",".list-scroll",".bt-adv-list",".bt-list"];
    const scrollState = [];
    try {
      for(const sel of selectors){
        const nodes = this.$content.querySelectorAll(sel);
        nodes.forEach((n,i)=>{ scrollState.push({ sel, i, top: n.scrollTop }); });
      }
    } catch(e) { /* ignore */ }

    this.$content.innerHTML = "";
    if(!mod || typeof mod.render !== "function") {
      this.$content.appendChild(el("div",{class:"card"}, `View missing: ${v}`));
      return;
    }
    try {
      const node = mod.render(this._ctx());
      this.$content.appendChild(node);

      // Restore scroll after DOM paint
      requestAnimationFrame(()=> {
        try {
          for(const s of scrollState){
            const nodes = this.$content.querySelectorAll(s.sel);
            const n = nodes && nodes[s.i];
            if(n) n.scrollTop = s.top;
          }
        } catch(e) { /* ignore */ }
      });
    } catch (e) {
      console.error(e);
      this.$content.appendChild(el("div",{class:"card"},[
        el("div",{style:"font-weight:700"}, "UI render error"),
        el("div",{class:"muted"}, "A JavaScript error prevented this view from rendering. Copy the details below."),
        el("pre",{class:"pre"}, String(e?.stack || e)),
      ]));
    }
  }


  _toast(msg, isErr=false){
    const t = this.$("#toast");
    if(!t) return;
    t.textContent = msg;
    t.classList.toggle("error", !!isErr);
    t.classList.remove("hidden");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(()=>t.classList.add("hidden"), 4500);
  }
}

customElements.define("padspan-ha-app", PadSpanHaApp);
