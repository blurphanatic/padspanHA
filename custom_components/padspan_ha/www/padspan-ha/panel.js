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

import { SAMPLE_SNAPSHOT } from "./sample_data.js?b=20260224T221746Z";
import { HELP } from "./help_content.js?b=20260224T221746Z";
import * as Follow from "./views/follow.js?b=20260224T221746Z";
import * as Overview from "./views/overview.js?b=20260224T221746Z";
import * as Objects from "./views/objects.js?b=20260224T221746Z";
import * as Devices from "./views/devices.js?b=20260224T221746Z";
import * as Bluetooth from "./views/bluetooth.js?b=20260224T221746Z";
import * as Presence from "./views/presence.js?b=20260224T221746Z";
import * as Zones from "./views/zones.js?b=20260224T221746Z";
import * as Insights from "./views/insights.js?b=20260224T221746Z";
import * as History from "./views/history.js?b=20260224T221746Z";
import * as Monitor from "./views/monitor.js?b=20260224T221746Z";
import * as Maps from "./views/maps.js?b=20260224T221746Z";
import * as Events from "./views/events.js?b=20260224T221746Z";
import * as Health from "./views/health.js?b=20260224T221746Z";
import * as Settings from "./views/settings.js?b=20260224T221746Z";
import * as Manage from "./views/manage.js?b=20260224T221746Z";
import * as Debug from "./views/debug.js?b=20260224T221746Z";
import * as Diagnostics from "./views/diagnostics.js?b=20260224T221746Z";
import * as QA from "./views/qa.js?b=20260224T221746Z";
import * as Training from "./views/training.js?b=20260224T221746Z";
import * as Calibration from "./views/calibration.js?b=20260224T221746Z";
import * as Sandbox from "./views/sandbox.js?b=20260224T221746Z";

const APP_VERSION = "0.4.75";
// Build stamp used for cache-busting and Diagnostics.
const BUILD_ID = "20260224T221746Z";

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
  manage: Manage,
  training: Training,
  calibration: Calibration,
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
  ["monitor","Monitor","mdi:monitor-dashboard"],
  ["maps","Mapping","mdi:map"],
  ["settings","Settings","mdi:cog-outline"],
  ["manage","Manage","mdi:cog-wrench"],
  ["training","Training","mdi:school-outline"],
  ["calibration","Calibration","mdi:crosshairs"],
  ["qa","QA","mdi:clipboard-check-outline"],
  ["sandbox","Sandbox","mdi:flask-outline"],
];

// Tabs shown in Basic (simplified) mode
const BASIC_TABS = new Set(["follow", "overview", "objects", "maps", "settings", "training"]);

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
  manage: "#78909c",
  training: "#4dd0e1",
  calibration: "#26a69a",
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
    if(typeof c==="string" || typeof c==="number") n.appendChild(document.createTextNode(String(c)));
    else n.appendChild(c);
  }
  return n;
}

// Deterministic short ID for a BLE radio: letter-number-letter (e.g. "A3B")
// Stable across sessions — derived solely from the source string.
function radioShortId(source){
  let h = 5381;
  const s = String(source || "");
  for(let i = 0; i < s.length; i++) h = (((h * 33) >>> 0) ^ s.charCodeAt(i)) >>> 0;
  const L1 = String.fromCharCode(65 + (h % 26));
  const N  = (h >>> 5) % 10;
  const L2 = String.fromCharCode(65 + ((h >>> 9) % 26));
  return `${L1}${N}${L2}`;
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
      complexity: "advanced",      // advanced | basic
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

          <div style="margin-top:12px;margin-bottom:8px" class="muted" id="navLabel">Menu</div>
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
              <button class="btn inline" id="complexityToggle" title="Switch between Basic (simplified) and Advanced layout">Advanced</button>
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

    // Restore persisted complexity preference
    try {
      const saved = localStorage.getItem("padspan_complexity");
      if (saved === "basic" || saved === "advanced") this.state.complexity = saved;
    } catch(e) { /* ignore */ }

    this.$("#complexityToggle").addEventListener("click", ()=>{
      this.state.complexity = (this.state.complexity === "basic") ? "advanced" : "basic";
      try { localStorage.setItem("padspan_complexity", this.state.complexity); } catch(e) {}
      // If switching to basic and current view isn't in basic tabs, go to Follow
      if (this.state.complexity === "basic" && !BASIC_TABS.has(this.state.view)) {
        this.state.view = "follow";
      }
      this._updateBadges();
      this._renderNav();
      this._renderCurrentView();
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
      const liveViews = new Set(["overview","objects","devices","bluetooth","presence","zones","insights","history","monitor","events","health","diagnostics","debug","qa","sandbox","manage"]);
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
    const cb = this.$("#complexityToggle");
    if(cb){
      const isBasic = this.state.complexity === "basic";
      cb.textContent = isBasic ? "Basic" : "Advanced";
      cb.style.outline = isBasic ? "2px solid rgba(94,234,212,.6)" : "";
    }
  }

  // ---------- Nav + rendering ----------
  _renderNav(){
    const isBasic = this.state.complexity === "basic";
    this.$nav.innerHTML = "";
    this.$nav.className = isBasic ? "nav basic-nav" : "nav";
    const navLabel = this.shadowRoot.querySelector("#navLabel");
    if(navLabel) navLabel.textContent = isBasic ? "Basic Menu" : "Menu";

    const items = isBasic ? MENU.filter(x => BASIC_TABS.has(x[0])) : MENU;
    for(const [id,label] of items.map(x=>[x[0],x[1]])) {
      const color = MENU_COLORS[id] || "#37588f";
      const btn = el("button",{
        class:"navbtn"+(this.state.view===id?" active":""),
        style:`--navcolor:${color}`,
        onclick:()=>{ this.state.view=id; this._renderNav(); this._renderCurrentView(); }
      }, [el("span",{class:"navdot"}), el("span",{}, label)]);
      this.$nav.appendChild(btn);
    }
  }

  _showHelp(key){
    const h = HELP[key];
    if(!h){ this._toast("No help entry for: " + key, false); return; }
    const body = document.createElement("div");
    body.style.cssText = "line-height:1.75;font-size:14px";
    const paras = Array.isArray(h.body) ? h.body : [h.body];
    for(const p of paras){
      const d = document.createElement("div");
      d.style.cssText = "margin-bottom:12px;color:#cbd5e1";
      d.textContent = p;
      body.appendChild(d);
    }
    this._openModal(h.title, body, "");
  }

  _ctx(){
    const self = this;
    return {
      hass: this._hass,
      state: this.state,
      helpers: {
        el, esc, pill,
        HELP,
        radioShortId,
        roomColor: (n)=>roomColor(n, this.state.model),
        helpBtn: (key)=>{
          const b = document.createElement("button");
          b.className = "btn-help";
          b.title = "Help";
          b.textContent = "?";
          b.addEventListener("click", (e)=>{ e.stopPropagation(); self._showHelp(key); });
          return b;
        },
      },
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
        radioLostSet: async (source, lost)=>await this._callWS({ type:"padspan_ha/radio_lost_set", source, lost }),
        radioDisabledSet: async (source, disabled)=>await this._callWS({ type:"padspan_ha/radio_disabled_set", source, disabled }),
        refreshSnapshot: async ()=>{ await this._getLiveSnapshot(); this._renderCurrentView(); },
        followAlertSave: async (payload)=>await this._callWS({ type:"padspan_ha/follow_alert_save", ...payload }),
        showHelp: (key)=>this._showHelp(key),

        // Area / entity management
        areaDelete: async (area_id) =>
            await this._callWS({ type: "padspan_ha/area_delete", area_id }),
        entityDelete: async (entity_id) =>
            await this._callWS({ type: "padspan_ha/entity_delete", entity_id }),
        roomTagPurgeMissing: async () =>
            await this._callWS({ type: "padspan_ha/room_tag_purge_missing" }),
        integrationReload: async () =>
            await this._callWS({ type: "padspan_ha/integration_reload" }),
        modelRefresh: async () => { await this._getModel(); this._renderCurrentView(); },

        // Detail modals
        showObjectDetail: (obj) => this._showObjectDetail(obj),
        showRoomDetail: (roomName) => this._showRoomDetail(roomName),
        showScannerDetail: (scanner) => this._showScannerDetail(scanner),

        // Mapping suite actions
        setMapsTab: (t)=>{ this.state.mapsTab=t; this._renderCurrentView(); },
        mapsRefresh: async ()=>{ await this._getMapsList(); this._renderCurrentView(); },
        mapsSetActive: (id)=>{ this.state.activeMapId=id; this._renderCurrentView(); },
        mapsDelete: async (id)=>{ await this._callWS({ type:"padspan_ha/maps_delete", map_id:id }); await this._getMapsList(); if(this.state.activeMapId===id) this.state.activeMapId=null; this._renderCurrentView(); },
        mapsUpload: async (payload)=>{ await this._callWS(Object.assign({type:"padspan_ha/maps_upload"}, payload)); await this._getMapsList(); this._renderCurrentView(); },
        mapsUpdate: async (payload)=>{ await this._callWS(Object.assign({type:"padspan_ha/maps_update"}, payload)); await this._getMapsList(); this._renderCurrentView(); },
        modelUpdate: async (payload)=>{ await this._callWS(Object.assign({type:"padspan_ha/model_update"}, payload)); await this._getModel(); this._renderCurrentView(); },

        // BLE calibration actions
        calibrationGet: async () => await this._callWS({ type: "padspan_ha/calibration_get" }),
        calibrationSavePoint: async (point) => await this._callWS({ type: "padspan_ha/calibration_save_point", point }),
        calibrationDeletePoint: async (point_id) => await this._callWS({ type: "padspan_ha/calibration_delete_point", point_id }),
        calibrationClear: async () => await this._callWS({ type: "padspan_ha/calibration_clear" }),
        calibrationComputeModel: async () => await this._callWS({ type: "padspan_ha/calibration_compute_model" }),
        calibrationSwapRadio: async (old_source, new_source) => await this._callWS({ type: "padspan_ha/calibration_swap_radio", old_source, new_source }),
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

  // ----------- Detail modals -----------

  _floorName(floor_id){
    if(!floor_id) return "—";
    const floors = this.state.model?.floors || [];
    const f = floors.find(x => x.id === floor_id);
    return f ? f.name : "—";
  }

  _showObjectDetail(obj){
    const addr = obj.address || "";
    const userLabel = obj.user_label || "";
    const name = userLabel || obj.name || obj.entity_id || addr || "Unknown";
    const kind = obj.kind || "";
    const identified = !!obj.identified;

    const fmtAgo = (age_s) => {
      const s = Number(age_s);
      if(!isFinite(s)) return "—";
      if(s < 1) return "<1s";
      if(s < 60) return `${Math.round(s)}s`;
      const m = Math.floor(s/60), rs = Math.round(s - m*60);
      if(m < 60) return `${m}m ${rs}s`;
      return `${Math.floor(m/60)}h ${m%60}m`;
    };

    const body = el("div", {style:"display:flex;flex-direction:column;gap:14px"});

    // Identity
    body.appendChild(el("div", {}, [
      el("div", {style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px"}, [
        el("div", {style:"font-size:20px;font-weight:800;color:#e2e8f0"}, name),
        el("span", {class:"badge"+(identified?"":" warn")},
          kind==="ble" ? (identified?"BLE · Identified":"BLE · Unidentified") : "HA Entity"),
      ]),
      addr ? el("div", {class:"muted", style:"font-family:monospace;font-size:12px"}, addr) : null,
      obj.entity_id ? el("div", {class:"muted", style:"font-size:12px"}, `Entity: ${obj.entity_id}`) : null,
    ].filter(Boolean)));

    // Location
    const objRoom = obj.room || "—";
    const haArea = (this.state.model?.areas||[]).find(a => a.name === objRoom);
    const floorName = haArea ? this._floorName(haArea.floor_id) : "—";
    const rc = roomColor(objRoom, this.state.model);
    body.appendChild(el("div", {}, [
      el("div", {style:"font-weight:600;margin-bottom:4px"}, "Location"),
      el("div", {style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap"}, [
        el("span", {class:"dot", style:`background:${rc}`}),
        el("span", {}, objRoom),
        el("span", {class:"muted"}, `· ${floorName}`),
      ]),
      obj.nearest_receiver ? el("div", {class:"muted", style:"font-size:12px;margin-top:4px"}, `Nearest: ${obj.nearest_receiver}`) : null,
    ].filter(Boolean)));

    // Detection sources table
    const sources = obj.sources || [];
    const makeSourceRow = (srcName, rssi, age_s) => {
      const pct = Math.max(0, Math.min(100, ((rssi ?? -100) + 100) / 60 * 100));
      const bar = el("div", {style:`width:${pct.toFixed(0)}%;height:6px;background:#52b788;border-radius:3px;min-width:2px`});
      const barWrap = el("div", {style:"width:80px;background:#1a2e1e;border-radius:3px"}, bar);
      return el("tr", {}, [
        el("td", {class:"muted", style:"font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis"}, srcName || "—"),
        el("td", {}, barWrap),
        el("td", {}, rssi != null ? `${rssi}` : "—"),
        el("td", {class:"muted", style:"font-size:11px"}, fmtAgo(age_s)),
      ]);
    };
    if(sources.length || obj.rssi != null){
      const tbody = el("tbody");
      if(sources.length){
        for(const s of sources){
          const srcName = typeof s === "string" ? s : (s.source || "");
          const rssi = typeof s === "object" ? (s.rssi ?? obj.rssi) : obj.rssi;
          const age_s = typeof s === "object" ? (s.age_s ?? obj.age_s) : obj.age_s;
          tbody.appendChild(makeSourceRow(srcName, rssi, age_s));
        }
      } else {
        tbody.appendChild(makeSourceRow("primary", obj.rssi, obj.age_s));
      }
      const srcSection = el("div", {}, [
        el("div", {style:"font-weight:600;margin-bottom:6px"}, "Detection sources"),
        el("table", {class:"table"}, [
          el("thead", {}, el("tr", {}, [el("th",{},"Source"),el("th",{},"Signal"),el("th",{},"dBm"),el("th",{},"Age")])),
          tbody,
        ]),
      ]);
      body.appendChild(srcSection);
    }

    // Device info
    if(obj.device && (obj.device.manufacturer || obj.device.model || obj.device.name)){
      const dev = obj.device;
      body.appendChild(el("div", {}, [
        el("div", {style:"font-weight:600;margin-bottom:4px"}, "Device"),
        el("div", {class:"muted", style:"font-size:12px"}, [dev.manufacturer, dev.model].filter(Boolean).join(" · ") || dev.name || ""),
      ]));
    }

    // Raw BLE data (collapsible)
    const manufData = obj.manufacturer_data || {};
    const svcUUIDs = obj.service_uuids || [];
    if(kind==="ble" && (Object.keys(manufData).length || svcUUIDs.length)){
      const det = document.createElement("details");
      det.style.cssText = "margin-top:4px";
      const sum = document.createElement("summary");
      sum.style.cssText = "cursor:pointer;font-weight:600;font-size:13px;color:#52b788";
      sum.textContent = "Raw BLE data";
      det.appendChild(sum);
      if(Object.keys(manufData).length){
        det.appendChild(el("table", {class:"table", style:"margin-top:8px"}, [
          el("thead", {}, el("tr", {}, [el("th",{},"Manufacturer key"),el("th",{},"Value (hex)")])),
          el("tbody", {}, Object.entries(manufData).map(([k,v]) =>
            el("tr", {}, [el("td",{},String(k)), el("td",{class:"muted",style:"font-family:monospace;font-size:11px"},String(v))])
          )),
        ]));
      }
      if(svcUUIDs.length){
        det.appendChild(el("div", {style:"font-size:12px;color:#94a3b8;margin-top:8px"}, "Service UUIDs:"));
        det.appendChild(el("div", {style:"margin-top:4px;display:flex;flex-wrap:wrap;gap:6px"},
          svcUUIDs.map(u => el("span", {class:"pill"}, String(u)))
        ));
      }
      body.appendChild(det);
    }

    // Linked entities
    const linked = obj.linked_entities || [];
    if(linked.length){
      body.appendChild(el("div", {}, [
        el("div", {style:"font-weight:600;margin-bottom:4px"}, "Linked entities"),
        el("div", {style:"display:flex;flex-wrap:wrap;gap:6px"}, linked.map(eid => el("span", {class:"pill"}, eid))),
      ]));
    }

    // Actions row
    const actionsRow = el("div", {style:"display:flex;gap:8px;flex-wrap:wrap;padding-top:8px;border-top:1px solid #1b3526;margin-top:4px"});
    if(kind==="ble" && addr){
      const tagBtn = el("button", {class:"btn", onclick:()=>{
        this._closeModal();
        this._tagObjectPrompt(addr, userLabel);
      }}, userLabel ? "Relabel" : "Tag");
      actionsRow.appendChild(tagBtn);
      if(userLabel){
        const untagBtn = el("button", {class:"btn", onclick:async()=>{
          try {
            await this._callWS({ type:"padspan_ha/object_label_delete", address:addr });
            this._closeModal();
            this._toast("Label removed.");
            await this._getLiveSnapshot();
            this._renderCurrentView();
          } catch(e){ this._toast("Failed to remove label.", true); }
        }}, "Untag");
        actionsRow.appendChild(untagBtn);
      }
    }
    actionsRow.appendChild(el("button", {class:"btn inline", onclick:()=>this._closeModal()}, "Close"));
    body.appendChild(actionsRow);

    this._openModal(name, body, kind==="ble" ? `BLE object · ${identified?"identified":"unidentified"}` : "HA entity");
  }

  _showRoomDetail(roomName){
    const snap = this.state.live?.snapshot;
    const objects = (snap?.objects?.list||[]).filter(o => o.room === roomName);
    const radios = (snap?.ble?.radios||[]).filter(r => r.area_name === roomName || r.area === roomName);
    const area = (this.state.model?.areas||[]).find(a => a.name === roomName);
    const floorName = area ? this._floorName(area.floor_id) : "—";
    const rc = roomColor(roomName, this.state.model);

    const body = el("div", {style:"display:flex;flex-direction:column;gap:14px"});

    // Header with color swatch + floor
    body.appendChild(el("div", {style:"display:flex;align-items:center;gap:10px"}, [
      el("span", {style:`display:inline-block;width:20px;height:20px;border-radius:50%;background:${rc};flex-shrink:0`}),
      el("div", {}, [
        el("div", {style:"font-weight:700;font-size:16px"}, roomName),
        el("div", {class:"muted", style:"font-size:12px"}, `Floor: ${floorName}`),
      ]),
    ]));

    // Objects in room
    const objSection = el("div", {}, [
      el("div", {style:"font-weight:600;margin-bottom:6px"}, `Objects now (${objects.length})`),
    ]);
    if(objects.length){
      for(const o of objects){
        const oName = o.user_label || o.name || o.entity_id || o.address || "Unknown";
        const oc = o.identified ? "#5eead4" : "#f59e0b";
        const rssiTxt = o.rssi != null ? `${o.rssi} dBm` : "";
        const ageTxt = o.age_s != null ? `${Math.round(o.age_s)}s` : "";
        const oRow = el("div", {style:"display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #0d1f12"}, [
          el("span", {style:`width:8px;height:8px;border-radius:50%;background:${oc};flex-shrink:0`}),
          el("div", {style:"flex:1"}, oName),
          rssiTxt ? el("span", {class:"badge"}, rssiTxt) : null,
          ageTxt ? el("span", {class:"muted", style:"font-size:11px"}, ageTxt) : null,
          el("button", {class:"btn tiny", onclick:()=>{ this._closeModal(); this._showObjectDetail(o); }}, "Details"),
        ].filter(Boolean));
        objSection.appendChild(oRow);
      }
    } else {
      objSection.appendChild(el("div", {class:"muted", style:"font-size:12px"}, "No objects currently detected in this room."));
    }
    body.appendChild(objSection);

    // Radios in room
    const radioSection = el("div", {}, [
      el("div", {style:"font-weight:600;margin-bottom:6px"}, `Bluetooth scanners (${radios.length})`),
    ]);
    if(radios.length){
      for(const r of radios){
        const rName = r.name || r.source || "Scanner";
        const rRow = el("div", {style:"display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #0d1f12"}, [
          el("div", {style:"flex:1"}, [
            el("div", {}, rName),
            r.source ? el("div", {class:"muted", style:"font-size:11px;font-family:monospace"}, r.source) : null,
          ].filter(Boolean)),
          r.scanning ? el("span", {class:"badge"}, "scanning") : null,
          el("button", {class:"btn tiny", onclick:()=>{ this._closeModal(); this._showScannerDetail(r); }}, "Details"),
        ].filter(Boolean));
        radioSection.appendChild(rRow);
      }
    } else {
      radioSection.appendChild(el("div", {class:"muted", style:"font-size:12px"}, "No Bluetooth scanners assigned to this room."));
    }
    body.appendChild(radioSection);

    // HA Entities
    const entities = Object.keys(this.state.roomTagMap?.[roomName] || {});
    if(entities.length){
      body.appendChild(el("div", {}, [
        el("div", {style:"font-weight:600;margin-bottom:6px"}, `HA Entities (${entities.length})`),
        el("div", {style:"display:flex;flex-wrap:wrap;gap:6px"}, entities.map(eid => el("span", {class:"pill"}, eid))),
      ]));
    }

    this._openModal(roomName, body, `Room · ${floorName}`);
  }

  _showScannerDetail(scanner){
    const snap = this.state.live?.snapshot;
    const devices = (snap?.objects?.list||[]).filter(
      o => (o.sources||[]).some(s => (typeof s==="string" ? s : s.source) === scanner.source)
    ).map(o => {
      const srcEntry = (o.sources||[]).find(s => (typeof s==="string" ? s : s.source) === scanner.source);
      return {
        ...o,
        srcRssi: typeof srcEntry==="object" ? (srcEntry?.rssi ?? o.rssi) : o.rssi,
        srcAge: typeof srcEntry==="object" ? (srcEntry?.age_s ?? o.age_s) : o.age_s,
      };
    }).sort((a,b) => (b.srcRssi ?? -999) - (a.srcRssi ?? -999));

    const name = scanner.name || scanner.source || "Scanner";
    const sid  = radioShortId(scanner.source || "");
    const body = el("div", {style:"display:flex;flex-direction:column;gap:14px"});

    // Status badges (include short ID and lost status)
    const statusRow = el("div", {style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center"});
    statusRow.appendChild(el("span", {class:"pill", style:"font-family:monospace;font-weight:700;font-size:13px;letter-spacing:.04em"}, sid));
    if(scanner.lost)     statusRow.appendChild(el("span", {class:"badge warn", style:"background:rgba(245,158,11,.18)"}, "⚠ Lost"));
    if(scanner.disabled) statusRow.appendChild(el("span", {class:"badge warn", style:"background:rgba(148,100,220,.18);color:#c084fc"}, "⊘ Disabled"));
    if(scanner.scanning != null) statusRow.appendChild(el("span", {class:scanner.scanning?"badge":"badge warn"}, scanner.scanning?"scanning":"not scanning"));
    if(scanner.connectable != null) statusRow.appendChild(el("span", {class:"badge"}, scanner.connectable?"connectable":"not connectable"));
    if(scanner.adapter) statusRow.appendChild(el("span", {class:"muted", style:"font-family:monospace;font-size:12px"}, `adapter: ${scanner.adapter}`));
    body.appendChild(statusRow);

    // Area + Lost toggle
    const areaSection = el("div", {});
    areaSection.appendChild(el("div", {style:"font-weight:600;margin-bottom:6px"}, "Area assignment"));
    const areaRow = el("div", {style:"display:flex;gap:8px;align-items:center;flex-wrap:wrap"});
    areaRow.appendChild(
      scanner.area_name
        ? el("span", {class:"badge"}, scanner.area_name)
        : el("span", {class:"muted"}, "Not assigned to an area")
    );
    // Lost toggle button
    const lostBtn = el("button", {class:"btn tiny"+(scanner.lost?" primary":""),
      style: scanner.lost ? "border-color:#f59e0b;color:#f59e0b" : "border-color:#7d5c2b"
    }, scanner.lost ? "Restore Radio" : "Mark as Lost");
    lostBtn.addEventListener("click", async ()=>{
      lostBtn.disabled = true;
      try {
        await this._callWS({ type:"padspan_ha/radio_lost_set", source: scanner.source||"", lost: !scanner.lost });
        this._closeModal();
        this._toast(scanner.lost ? "Radio restored." : "Radio marked as Lost.");
        await this._getLiveSnapshot();
        this._renderCurrentView();
      } catch(e) {
        lostBtn.disabled = false;
        this._toast("Failed to update lost status.", true);
      }
    });
    areaRow.appendChild(lostBtn);
    // Disabled toggle button
    const disabledBtn = el("button", {class:"btn tiny"+(scanner.disabled?" primary":""),
      style: scanner.disabled ? "border-color:#c084fc;color:#c084fc" : "border-color:#5b3b7a"
    }, scanner.disabled ? "Re-enable Radio" : "Mark as Disabled");
    disabledBtn.addEventListener("click", async ()=>{
      disabledBtn.disabled = true;
      try {
        await this._callWS({ type:"padspan_ha/radio_disabled_set", source: scanner.source||"", disabled: !scanner.disabled });
        this._closeModal();
        this._toast(scanner.disabled ? "Radio re-enabled." : "Radio marked as Disabled.");
        await this._getLiveSnapshot();
        this._renderCurrentView();
      } catch(e) {
        disabledBtn.disabled = false;
        this._toast("Failed to update disabled status.", true);
      }
    });
    areaRow.appendChild(disabledBtn);
    areaSection.appendChild(areaRow);
    if(scanner.lost && scanner.lost_since){
      areaSection.appendChild(el("div", {class:"muted", style:"font-size:11px;margin-top:4px"},
        `Marked lost: ${new Date(scanner.lost_since).toLocaleString()}`));
    }
    if(scanner.disabled && scanner.disabled_since){
      areaSection.appendChild(el("div", {class:"muted", style:"font-size:11px;margin-top:4px"},
        `Disabled since: ${new Date(scanner.disabled_since).toLocaleString()}`));
    }
    body.appendChild(areaSection);

    // Visible devices
    const devSection = el("div", {}, [
      el("div", {style:"font-weight:600;margin-bottom:6px"}, `Devices visible (${devices.length})`),
    ]);
    if(devices.length){
      for(const d of devices){
        const dName = d.user_label || d.name || d.address || "Unknown";
        const rssi = d.srcRssi;
        const pct = Math.max(0, Math.min(100, ((rssi ?? -100) + 100) / 60 * 100));
        const bar = el("div", {style:`width:${pct.toFixed(0)}%;height:5px;background:#52b788;border-radius:2px`});
        const barWrap = el("div", {style:"width:60px;background:#1a2e1e;border-radius:2px"}, bar);
        const ageTxt = d.srcAge != null ? `${Math.round(d.srcAge)}s` : "";
        const dRow = el("div", {style:"display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #0d1f12"}, [
          el("div", {style:"flex:1"}, [
            el("div", {style:"font-weight:600"}, dName),
            d.address ? el("div", {class:"muted", style:"font-size:11px;font-family:monospace"}, d.address) : null,
          ].filter(Boolean)),
          barWrap,
          rssi != null ? el("span", {class:"muted", style:"font-size:11px"}, `${rssi}dBm`) : null,
          ageTxt ? el("span", {class:"muted", style:"font-size:11px"}, ageTxt) : null,
          d.identified ? el("span", {class:"badge"}, "identified") : el("span", {class:"badge warn"}, "unknown"),
          el("button", {class:"btn tiny", onclick:()=>{ this._closeModal(); this._showObjectDetail(d); }}, "Details"),
        ].filter(Boolean));
        devSection.appendChild(dRow);
      }
    } else {
      devSection.appendChild(el("div", {class:"muted", style:"font-size:12px"}, "No objects currently visible from this scanner."));
    }
    body.appendChild(devSection);

    // Source ID
    body.appendChild(el("div", {style:"margin-top:4px"}, [
      el("span", {class:"muted", style:"font-size:11px"}, "Source ID: "),
      el("span", {style:"font-family:monospace;font-size:11px;color:#94a3b8"}, scanner.source || "—"),
    ]));

    this._openModal(name, body, `Bluetooth scanner · ${scanner.area_name || "unassigned"}`);
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
