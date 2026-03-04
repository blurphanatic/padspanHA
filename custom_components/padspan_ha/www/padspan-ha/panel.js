// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
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

const APP_VERSION = "0.6.43";
// Build stamp used for cache-busting and Diagnostics.
const BUILD_ID = "20260304T051728Z";

// ── Dynamic view imports ─────────────────────────────────────────────────────
// Using dynamic import() instead of static imports so that a single failing
// module cannot prevent customElements.define() from running (which would blank
// the entire panel). All imports run in parallel via Promise.allSettled; a
// failure in one view makes only that view unavailable, not the whole panel.
let SAMPLE_SNAPSHOT = null;
let HELP = {};
const VIEWS = {};

const _viewsPromise = Promise.allSettled([
  import(`./sample_data.js?b=${BUILD_ID}`).then(m => { SAMPLE_SNAPSHOT = m.SAMPLE_SNAPSHOT || null; }),
  import(`./help_content.js?b=${BUILD_ID}`).then(m => { HELP = m.HELP || {}; }),
  import(`./views/follow.js?b=${BUILD_ID}`).then(m => { VIEWS.follow = m; }),
  import(`./views/overview.js?b=${BUILD_ID}`).then(m => { VIEWS.overview = m; }),
  import(`./views/objects.js?b=${BUILD_ID}`).then(m => { VIEWS.objects = m; }),
  import(`./views/devices.js?b=${BUILD_ID}`).then(m => { VIEWS.devices = m; }),
  import(`./views/bluetooth.js?b=${BUILD_ID}`).then(m => { VIEWS.bluetooth = m; }),
  import(`./views/presence.js?b=${BUILD_ID}`).then(m => { VIEWS.presence = m; }),
  import(`./views/history.js?b=${BUILD_ID}`).then(m => { VIEWS.history = m; }),
  import(`./views/monitor.js?b=${BUILD_ID}`).then(m => { VIEWS.monitor = m; }),
  import(`./views/maps.js?b=${BUILD_ID}`).then(m => { VIEWS.maps = m; }),
  import(`./views/events.js?b=${BUILD_ID}`).then(m => { VIEWS.events = m; }),
  import(`./views/health.js?b=${BUILD_ID}`).then(m => { VIEWS.health = m; }),
  import(`./views/settings.js?b=${BUILD_ID}`).then(m => { VIEWS.settings = m; }),
  import(`./views/manage.js?b=${BUILD_ID}`).then(m => { VIEWS.manage = m; }),
  import(`./views/debug.js?b=${BUILD_ID}`).then(m => { VIEWS.debug = m; }),
  import(`./views/diagnostics.js?b=${BUILD_ID}`).then(m => { VIEWS.diagnostics = m; }),
  import(`./views/qa.js?b=${BUILD_ID}`).then(m => { VIEWS.qa = m; }),
  import(`./views/training.js?b=${BUILD_ID}`).then(m => { VIEWS.training = m; }),
  import(`./views/calibration.js?b=${BUILD_ID}`).then(m => { VIEWS.calibration = m; }),
  import(`./views/sandbox.js?b=${BUILD_ID}`).then(m => { VIEWS.sandbox = m; }),
]).then(results => {
  results.forEach((r, i) => {
    if(r.status === "rejected") console.warn("PadSpan: view module [" + i + "] failed to load:", r.reason);
  });
});

const MENU = [
  ["overview","Overview","mdi:view-dashboard-outline"],
  ["follow","Follow","mdi:crosshairs-gps"],
  ["objects","Objects","mdi:tag-multiple-outline"],
  ["devices","Devices","mdi:devices"],
  ["bluetooth","Bluetooth","mdi:bluetooth"],
  ["presence","Presence","mdi:map-marker-radius-outline"],
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
const BASIC_TABS = new Set(["follow", "overview", "maps", "settings", "training"]);
// Tabs shown in Advanced mode by default (user can add more via Settings → UI Structure)
const ADVANCED_DEFAULT = new Set(["follow","overview","maps","settings","training","manage","calibration"]);
// Tabs that only appear in Development mode unless opted into Advanced
const DEV_ONLY_TABS = ["objects","devices","bluetooth","presence","monitor","qa","sandbox"];

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
      complexity: "advanced",      // basic | advanced | development
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
      _sessionEvents: [],
      _sessionStart: Date.now(),
      lastToast: null,
      versionInfo: null,
      settings: {},               // full settings dict from settings_get
      // Followed beacons — persisted to localStorage
      followedAddrs: new Set(JSON.parse(localStorage.getItem("padspan_followed") || "[]")),
      followAddr: localStorage.getItem("padspan_followAddr") || "",
    };

    this.$ = null;
    this.$nav = null;
    this.$content = null;

    // Live polling (keeps 'Live' mode actually live)
    this._pollTimer = null;
    this._pollInFlight = false;
    // Anti-blank: activity simulation + watchdog (independent of polling)
    this._activityTimer = null;
    this._watchdogTimer = null;
    // Render health tracking — used by watchdog to detect persistent blank screens
    this._lastGoodRender = performance.now();
    this._renderFailCount = 0;
  }

  set hass(hass){
    const prevHass = this._hass;
    this._hass = hass;
    // Avoid spamming refresh on every hass set (HA calls it often)
    if(!this._booted){
      this._booted = true;
      // Wait for all view modules to be ready before the first full refresh
      _viewsPromise.then(() => {
        this._refreshAll(false);
        if(this.state.dataMode === "live") this._startPolling();
      });
    } else if(hass && prevHass && hass !== prevHass && hass.connection !== prevHass.connection){
      // HA reconnected with a new WS connection — re-bootstrap
      this._pollInFlight = false; // clear any stuck poll
      _viewsPromise.then(() => {
        this._ensureShadowDom();
        this._refreshAll(false);
        if(this.state.dataMode === "live") this._startDataPoll();
      });
    }
  }

  connectedCallback(){
    if(!this.shadowRoot) this.attachShadow({mode:"open"});
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="/padspan_ha_static/padspan-ha/styles.css?v=${APP_VERSION}&b=${BUILD_ID}">
      <style>
        /* Only :host fallback — do not override layout classes that styles.css already handles */
        :host{display:block;min-height:100vh;background:#0a150e;color:#e2e8f0;font-family:Inter,system-ui,Arial,sans-serif;box-sizing:border-box}
      </style>
      <div id="app" class="app">
        <aside class="left">
          <div class="brand">
            <img src="/padspan_ha_static/padspan-ha/assets/padspan-mark.svg?b=${BUILD_ID}" alt="PadSpan" onerror="this.style.display='none'">
            <div>
              <div class="label">PadSpan™ HA</div>
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
              <button class="btn inline" id="complexityToggle" title="Cycle between Basic, Advanced, and Development modes">Advanced</button>
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
      if (saved === "basic" || saved === "advanced" || saved === "development") this.state.complexity = saved;
    } catch(e) { /* ignore */ }

    this.$("#complexityToggle").addEventListener("click", ()=>{
      const cur = this.state.complexity;
      this.state.complexity = cur === "basic" ? "advanced" : cur === "advanced" ? "development" : "basic";
      try { localStorage.setItem("padspan_complexity", this.state.complexity); } catch(e) {}
      // If switching to basic/advanced and current view isn't visible, go to follow
      if (this.state.complexity !== "development") {
        const visible = this._getVisibleTabs();
        if (!visible.has(this.state.view)) this.state.view = "follow";
      }
      this._updateBadges();
      this._renderNav();
      this._renderCurrentView();
    });

    this._renderNav();
    // Load persisted mode (sample/live) even before hass is set.
    // When hass arrives we refresh.
    this._loadSettings();

    // Always start keep-alive (activity ping + watchdog) regardless of data mode.
    this._startKeepAlive();

    // If views are already populated (reconnect after detach), render immediately.
    // Otherwise show a loading placeholder then render once dynamic imports settle.
    if(Object.keys(VIEWS).length > 0){
      this._renderCurrentView();
      this._startPolling();
      // On reconnect (not first boot), refresh data to recover from stale state
      if(this._booted && this._hass){
        this._pollInFlight = false;
        this._refreshAll(false);
      }
    } else {
      // Show loading placeholder — purely inline so it works with no CSS loaded yet
      if(this.$content){
        const lo = document.createElement("div");
        lo.style.cssText = "padding:24px;color:#52b788;font-family:monospace;font-size:13px";
        lo.textContent = `Loading PadSpan HA v${APP_VERSION}\u2026`;
        this.$content.appendChild(lo);
      }
      _viewsPromise.then(() => {
        this._renderNav();       // rebuild nav after complexity may have been restored
        this._renderCurrentView();
        this._startPolling();
      });
    }
  }


  disconnectedCallback(){
    // Stop data poll only. Keep activity/watchdog/visibility alive for reconnect.
    // HA may reconnect the element shortly after disconnect; preserving these
    // handlers ensures the panel recovers immediately.
    this._stopDataPoll();
    this._pollInFlight = false; // ensure next reconnect isn't blocked
    if(this._modalEsc){
      window.removeEventListener("keydown", this._modalEsc);
      this._modalEsc = null;
    }
  }

  // ── Anti-blank system ─────────────────────────────────────────────────────
  // Four independent mechanisms prevent the panel from going blank:
  // 1. Activity ping — synthetic pointer events keep HA's idle overlay away
  // 2. Watchdog — detects empty/stale content and forces a full rebuild
  // 3. Visibility handler — immediate recovery when tab regains focus
  // 4. hass reconnect detection — re-bootstraps on WS connection change

  _ensureShadowDom(){
    // Verify shadowRoot has the expected structure. If not, rebuild entirely.
    if(!this.shadowRoot) return false;
    const liveContent = this.shadowRoot.querySelector("#content");
    if(!liveContent || !this.shadowRoot.querySelector("#app")){
      // Shadow DOM was cleared externally — full rebuild
      this.connectedCallback();
      return true;
    }
    // Fix stale references: this.$content might point at a detached node
    if(this.$content !== liveContent){
      this.$ = (q)=>this.shadowRoot.querySelector(q);
      this.$content = liveContent;
      this.$nav = this.$("#nav");
      this.$modal = this.$("#modal");
      return true;
    }
    return false;
  }

  _startKeepAlive(){
    // Activity ping: dispatch on both document and window every 30s.
    // HA's idle timer checks for user interaction; we simulate it.
    // 30s is well inside the default 5-minute HA idle threshold.
    if(!this._activityTimer){
      const ping = ()=>{
        try {
          const ev = new PointerEvent("pointermove", {bubbles:true, composed:true});
          document.dispatchEvent(ev);
          window.dispatchEvent(ev);
          // Also poke the HA root if available (some HA versions listen there)
          const haRoot = document.querySelector("home-assistant");
          if(haRoot) haRoot.dispatchEvent(ev);
        } catch(e){}
      };
      ping(); // immediate first ping
      this._activityTimer = setInterval(ping, 30_000);
    }

    // Watchdog: every 10s, verify DOM integrity and re-render if needed.
    if(!this._watchdogTimer){
      this._watchdogTimer = setInterval(()=>{
        try {
          if(!this.isConnected) return;

          // 1. Check for stale $content references (shadow DOM rebuilt externally)
          const rebuilt = this._ensureShadowDom();
          if(rebuilt){
            this._renderCurrentView();
            return;
          }

          // 2. Check if content area is empty
          if(this.$content && !this.$content.children.length){
            this._renderCurrentView();
          }

          // 3. Unstick deadlocked poll (WS call hung > 30s)
          if(this._pollInFlight && this._pollStartedAt){
            if(performance.now() - this._pollStartedAt > 30_000){
              this._pollInFlight = false;
              this._renderCurrentView();
            }
          }

          // 4. Ensure data poll is alive in live mode
          if(this.state.dataMode === "live" && !this._pollTimer){
            this._startDataPoll();
          }

          // 5. Escalation: if no successful render in 60s, full rebuild.
          // This catches cases where _renderCurrentView keeps failing silently
          // (e.g. stale WS connection, view module error, detached DOM).
          const sinceGoodRender = this._lastGoodRender ? performance.now() - this._lastGoodRender : 0;
          if(sinceGoodRender > 60_000 && (this._renderFailCount || 0) >= 3){
            console.warn("PadSpan watchdog: no successful render in 60s, rebuilding panel");
            this._renderFailCount = 0;
            this._lastGoodRender = performance.now(); // prevent rebuild loop
            this._pollInFlight = false;
            this.connectedCallback();
          }
        } catch(e){}
      }, 10_000);
    }

    // Visibility handler: immediate wake-up when tab becomes visible again.
    if(!this._visibilityHandler){
      this._visibilityHandler = ()=>{
        if(document.visibilityState === "visible" && this._hass && this.isConnected){
          this._pollInFlight = false; // clear any stuck poll from background throttling
          this._ensureShadowDom();
          this._renderCurrentView();
          this._refreshAll(false);
          if(this.state.dataMode === "live" && !this._pollTimer) this._startDataPoll();
        }
      };
      document.addEventListener("visibilitychange", this._visibilityHandler);
    }
  }

  _startDataPoll(){
    if(this._pollTimer) return;
    this._pollTimer = setInterval(()=>this._pollTick(), 5000);
  }

  _startPolling(){
    this._startDataPoll();
    this._startKeepAlive();
  }

  _stopDataPoll(){
    if(this._pollTimer){
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _stopPolling(){
    this._stopDataPoll();
    // Activity timer + watchdog + visibility handler intentionally NOT stopped.
    // They are lightweight and keep the panel alive across disconnects.
  }

  async _pollTick(){
    if(!this._hass) return;
    if(this.state.dataMode !== "live") return;
    if(this._pollInFlight) return;
    // Avoid interrupting map drawing
    if(this.state.view === "maps") return;

    this._pollInFlight = true;
    this._pollStartedAt = performance.now();
    const t0 = this._pollStartedAt;
    try{
      // Race WS calls against a 15s timeout to prevent indefinite hangs
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("poll_timeout")), 15_000));
      await Promise.race([
        (async ()=>{
          await this._getLiveSnapshot();
          await this._getStatus();
        })(),
        timeout,
      ]);
      this.state.timing.lastRefreshMs = Math.round(performance.now() - t0);
      this._updateBadges();

      // Re-render views that show live data.
      const liveViews = new Set(["overview","follow","objects","devices","bluetooth","presence","history","monitor","events","health","diagnostics","debug","qa","sandbox","manage","calibration"]);
      if(liveViews.has(this.state.view)) this._renderCurrentView();
    } catch(e){
      // Non-fatal — still re-render with whatever data we have to prevent blank screen
      try { this._renderCurrentView(); } catch(e2){}
    } finally {
      this._pollInFlight = false;
      this._pollStartedAt = null;
    }
  }

  // ---------- WS helpers ----------
  _wsCount(type){
    this.state.wsCounts[type] = (this.state.wsCounts[type]||0)+1;
  }

  _logEvent(type, detail){
    this.state._sessionEvents.push({ ts: Date.now(), type, detail: detail || "" });
    if(this.state._sessionEvents.length > 500) this.state._sessionEvents.shift();
  }

  async _callWS(payload){
    if(!this._hass) throw new Error("hass not ready");
    this._wsCount(payload.type);
    this._logEvent("ws_call", payload.type);
    return await this._hass.callWS(payload);
  }

  // Fetch settings and store quietly (no re-render, no toast) — called from _refreshAll
  async _fetchSettings(){
    try{
      const res = await this._callWS({ type: "padspan_ha/settings_get" });
      if(res?.settings){
        this.state.settings = res.settings;
        const mode = (res.settings.data_mode || "sample").toLowerCase();
        this.state.dataMode = (mode === "live") ? "live" : "sample";
        // Load followed addrs from server ONCE on boot (not on every poll,
        // which would race with local toggles and revert user clicks)
        if(!this._followedLoadedFromServer && Array.isArray(res.settings.followed_addrs)){
          this.state.followedAddrs = new Set(res.settings.followed_addrs);
          this._followedLoadedFromServer = true;
        }
      }
    }catch(e){}
  }
  async _loadAlertConfigs(){
    try{
      const res = await this._callWS({ type: "padspan_ha/follow_alert_get" });
      if(res?.configs) this.state.followAlertConfig = res.configs;
    }catch(e){}
  }

  // ---------- Data loading ----------
  async _loadSettings(){
    try {
      if(!this._hass) return;
      const res = await this._callWS({ type: "padspan_ha/settings_get" });
      this.state.settings = res?.settings || {};
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
    const objCount = this.state.live.snapshot?.objects?.summary?.total ?? 0;
    this._logEvent("snapshot", `${objCount} objects`);
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
    // allSettled: individual WS failures don't abort the whole refresh
    const results = await Promise.allSettled([
      this._getVersionInfo(),
      this._getStatus(),
      this._getRoomTags(),
      this._getLiveSnapshot(),
      this._getMapsList(),
      this._getModel(),
      this._runAutoDiag(false),
      this._fetchSettings(),
      this._loadAlertConfigs(),
    ]);
    // Log any WS failures to console for debugging
    const names = ["getVersionInfo","getStatus","getRoomTags","getLiveSnapshot","getMapsList","getModel","runAutoDiag"];
    results.forEach((r,i)=>{ if(r.status==="rejected") console.warn("PadSpan refresh:", names[i], "failed:", r.reason); });
    this._recomputeDerived();
    try { this.state.timing.lastRefreshMs = Math.round(performance.now() - t0); } catch(e){}
    try { this._updateBadges(); } catch(e){}
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
      const mode = this.state.complexity;
      cb.textContent = mode === "basic" ? "Basic" : mode === "advanced" ? "Advanced" : "Dev";
      cb.style.outline = mode === "basic" ? "2px solid rgba(94,234,212,.6)"
                       : mode === "development" ? "2px solid rgba(239,83,80,.5)" : "";
    }
  }

  // ---------- Nav + rendering ----------
  _getVisibleTabs(){
    const mode = this.state.complexity;
    if (mode === "development") return new Set(MENU.map(x => x[0]));
    if (mode === "basic") return BASIC_TABS;
    // Advanced: base + any user-opted extra tabs
    const extras = this.state.settings?.advanced_extra_tabs || [];
    const s = new Set(ADVANCED_DEFAULT);
    for (const t of extras) s.add(t);
    return s;
  }

  _renderNav(){
    const isBasic = this.state.complexity === "basic";
    const visible = this._getVisibleTabs();
    this.$nav.innerHTML = "";
    this.$nav.className = isBasic ? "nav basic-nav" : "nav";
    const navLabel = this.shadowRoot.querySelector("#navLabel");
    if(navLabel) navLabel.textContent = isBasic ? "Basic Menu" : this.state.complexity === "development" ? "Dev Menu" : "Menu";

    const items = MENU.filter(x => visible.has(x[0]));
    for(const [id,label] of items.map(x=>[x[0],x[1]])) {
      const color = MENU_COLORS[id] || "#37588f";
      const btn = el("button",{
        class:"navbtn"+(this.state.view===id?" active":""),
        style:`--navcolor:${color}`,
        onclick:()=>{ this.state.view=id; this._logEvent("view_change", id); this._renderNav(); this._renderCurrentView(); }
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
        renderNav: ()=>this._renderNav(),
        // Objects view updates its tag list in-place to avoid full re-render loops.
        renderTags: (target=null)=>{
          const node = target || this.shadowRoot?.querySelector("#content #tags");
          if(!node) return;
          try { VIEWS.objects?.renderTags?.(this._ctx(), node); } catch (e) { console.error(e); }
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
        objectLabelList: async ()=>{
          return await this._callWS({ type:"padspan_ha/object_label_list" });
        },
        tagObjectPrompt: (addr, currentLabel)=>this._tagObjectPrompt(addr, currentLabel),
        radioAreaSet: async (payload)=>await this._callWS({ type:"padspan_ha/radio_area_set", ...payload }),
        radioLostSet: async (source, lost)=>await this._callWS({ type:"padspan_ha/radio_lost_set", source, lost }),
        radioDisabledSet: async (source, disabled)=>await this._callWS({ type:"padspan_ha/radio_disabled_set", source, disabled }),
        radioReset: async (source)=>{ const r = await this._callWS({ type:"padspan_ha/radio_reset", source }); await this._getLiveSnapshot(); await this._loadSettings(); this._renderCurrentView(); return r; },
        radioResetQuiet: async (source)=>{ return await this._callWS({ type:"padspan_ha/radio_reset", source }); },
        refreshSnapshot: async ()=>{ await this._getLiveSnapshot(); this._renderCurrentView(); },
        refreshSnapshotQuiet: async ()=>{ await this._getLiveSnapshot(); },
        clearSessionEvents: ()=>{ this.state._sessionEvents.length = 0; this._renderCurrentView(); },
        followAlertSave: async (payload)=>await this._callWS({ type:"padspan_ha/follow_alert_save", ...payload }),
        followAlertGet: async ()=>{
          try {
            const res = await this._callWS({ type:"padspan_ha/follow_alert_get" });
            if(res && res.configs) this.state.followAlertConfig = res.configs;
          } catch(e){ /* non-fatal */ }
        },
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
        mapsUpdateQuiet: async (payload)=>{ await this._callWS(Object.assign({type:"padspan_ha/maps_update"}, payload)); },
        mapsReplaceImage: async (payload)=>{ await this._callWS(Object.assign({type:"padspan_ha/maps_replace_image"}, payload)); await this._getMapsList(); this._renderCurrentView(); },
        modelUpdate: async (payload)=>{ await this._callWS(Object.assign({type:"padspan_ha/model_update"}, payload)); await this._getModel(); this._renderCurrentView(); },

        // Settings actions
        settingsSet: async (payload) => {
          const res = await this._callWS(Object.assign({ type: "padspan_ha/settings_set", data_mode: this.state.dataMode }, payload));
          this.state.settings = res?.settings || this.state.settings;
          this._renderCurrentView();
          return res;
        },
        scannerOffsetSet: async (source, offset_db) => {
          const res = await this._callWS({ type: "padspan_ha/scanner_offset_set", source, offset_db });
          await this._getLiveSnapshot();
          await this._loadSettings();
          return res;
        },
        // BLE calibration actions
        calibrationGet: async () => await this._callWS({ type: "padspan_ha/calibration_get" }),
        calibrationSavePoint: async (point) => await this._callWS({ type: "padspan_ha/calibration_save_point", point }),
        calibrationDeletePoint: async (point_id) => await this._callWS({ type: "padspan_ha/calibration_delete_point", point_id }),
        calibrationClear: async () => await this._callWS({ type: "padspan_ha/calibration_clear" }),
        calibrationClearMap: async (map_id) => await this._callWS({ type: "padspan_ha/calibration_clear_map", map_id }),
        calibrationComputeModel: async () => await this._callWS({ type: "padspan_ha/calibration_compute_model" }),
        calibrationSwapRadio: async (old_source, new_source) => await this._callWS({ type: "padspan_ha/calibration_swap_radio", old_source, new_source }),
        calibrationHealthCheck: async () => await this._callWS({ type: "padspan_ha/calibration_health_check" }),
        wsCall: async (type, data={}) => await this._callWS({ type, ...data }),
        // Followed beacons — multi-device follow; persisted to server via settings
        followedHas: (addr) => !!addr && this.state.followedAddrs.has(String(addr).toUpperCase()),
        followedToggle: (addr) => {
          if(!addr) return;
          const key = String(addr).toUpperCase();
          if(this.state.followedAddrs.has(key)){
            this.state.followedAddrs.delete(key);
          } else {
            this.state.followedAddrs.add(key);
          }
          // Persist to server (fire-and-forget)
          this._callWS({
            type: "padspan_ha/settings_set",
            data_mode: this.state.dataMode,
            followed_addrs: [...this.state.followedAddrs],
          }).catch(()=>{});
          // Also mirror to localStorage as fallback
          try { localStorage.setItem("padspan_followed", JSON.stringify([...this.state.followedAddrs])); } catch(e){}
          this._renderCurrentView();
        },
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

    // ESC closes — remove stale handler before registering new one
    if(this._modalEsc) window.removeEventListener("keydown", this._modalEsc);
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
    input.style.minWidth = "min(240px, 100%)";

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
        this._logEvent("tag", `${addr} → ${label}`);
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
        this._logEvent("tag", `${addr} untagged`);
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

    // Canonical address for rename (varies by kind)
    const tagAddr = kind === "private_ble" ? (obj.canonical_id || addr)
                  : kind === "ibeacon"     ? (obj.key || "")
                  : addr;
    const canRename = (kind==="ble"||kind==="private_ble"||kind==="ibeacon") && !!tagAddr;

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
      // Enrichment badges
      (obj.company_name || obj.device_type || (obj.service_names && obj.service_names.length) || obj.connectable != null)
        ? el("div", {style:"display:flex;flex-wrap:wrap;gap:5px;margin-top:6px"}, [
            obj.company_name ? el("span",{class:"badge",style:"background:#1a2a3a;color:#7dd3fc;border-color:#1e4976"}, obj.company_name) : null,
            obj.device_type  ? el("span",{class:"badge",style:"background:#2a1a3a;color:#c4b5fd;border-color:#5b21b6"}, obj.device_type) : null,
            ...(obj.service_names || []).map(sn =>
              el("span",{class:"badge",style:"background:#1a3a2a;color:#86efac;border-color:#166534"}, sn)
            ),
            obj.connectable === true  ? el("span",{class:"badge",style:"font-size:10px"}, "Connectable") : null,
            obj.connectable === false ? el("span",{class:"badge",style:"font-size:10px;background:#2a1a0a;color:#fbbf24;border-color:#92400e"}, "Non-connectable") : null,
          ].filter(Boolean))
        : null,
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
    const svcUuidMap = obj.service_uuid_map || {};
    if((kind==="ble"||kind==="private_ble"||kind==="ibeacon") && (Object.keys(manufData).length || svcUUIDs.length)){
      const det = document.createElement("details");
      det.style.cssText = "margin-top:4px";
      const sum = document.createElement("summary");
      sum.style.cssText = "cursor:pointer;font-weight:600;font-size:13px;color:#52b788";
      sum.textContent = "Raw BLE data";
      det.appendChild(sum);
      if(Object.keys(manufData).length){
        det.appendChild(el("table", {class:"table", style:"margin-top:8px"}, [
          el("thead", {}, el("tr", {}, [el("th",{},"Company ID"),el("th",{},"Company"),el("th",{},"Payload (hex)")])),
          el("tbody", {}, Object.entries(manufData).map(([k,v]) =>
            el("tr", {}, [
              el("td",{},String(k)),
              el("td",{style:"font-size:11px;color:#7dd3fc"}, obj.company_name && String(k) === Object.keys(manufData)[0] ? obj.company_name : "—"),
              el("td",{class:"muted",style:"font-family:monospace;font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis"},String(v)),
            ])
          )),
        ]));
      }
      if(svcUUIDs.length){
        det.appendChild(el("div", {style:"font-size:12px;color:#94a3b8;margin-top:8px"}, "Service UUIDs:"));
        det.appendChild(el("div", {style:"margin-top:4px;display:flex;flex-wrap:wrap;gap:6px"},
          svcUUIDs.map(u => {
            const uStr = String(u);
            const svcName = svcUuidMap[uStr];
            const label = svcName ? `${uStr} (${svcName})` : uStr;
            return el("span", {class:"pill"}, label);
          })
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

    // Inline rename section (BLE / private_ble / ibeacon)
    if(canRename){
      const renameInput = el("input",{type:"text",placeholder:"Enter a label…",style:"flex:1;min-width:160px"});
      renameInput.value = userLabel;
      const renameStatus = el("div",{class:"muted",style:"min-height:16px;font-size:12px;margin-top:4px"});
      const saveRenameBtn = el("button",{class:"btn"}, userLabel ? "Update" : "Tag");
      saveRenameBtn.addEventListener("click", async()=>{
        const label = renameInput.value.trim();
        if(!label){ renameStatus.textContent = "Label cannot be empty."; return; }
        try {
          await this._callWS({ type:"padspan_ha/object_label_set", address: tagAddr, label });
          this._closeModal();
          this._toast(`Renamed: ${label}`);
          await this._getLiveSnapshot();
          this._renderCurrentView();
        } catch(e){ renameStatus.textContent = "Failed to save. Check HA logs."; }
      });
      renameInput.addEventListener("keydown",(e)=>{ if(e.key==="Enter") saveRenameBtn.click(); });
      const renameRow = el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center"},[renameInput, saveRenameBtn]);
      if(userLabel){
        const untagBtn = el("button",{class:"btn"}, "Untag");
        untagBtn.addEventListener("click", async()=>{
          try {
            await this._callWS({ type:"padspan_ha/object_label_delete", address: tagAddr });
            this._closeModal();
            this._toast("Label removed.");
            await this._getLiveSnapshot();
            this._renderCurrentView();
          } catch(e){ renameStatus.textContent = "Failed to remove label."; }
        });
        renameRow.appendChild(untagBtn);
      }
      body.appendChild(el("div",{style:"padding-top:12px;border-top:1px solid #1b3526;margin-top:4px"},[
        el("div",{style:"font-weight:600;margin-bottom:6px"}, "Rename"),
        renameRow,
        renameStatus,
      ]));
      requestAnimationFrame(()=>{ try{ renameInput.focus(); }catch(e){} });
    }

    // Actions row
    const actionsRow = el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;padding-top:8px;border-top:1px solid #1b3526;margin-top:8px"});
    // Follow toggle (multi-device Set)
    const _followKey = (addr || obj.entity_id || "").toUpperCase();
    if(_followKey){
      const _isFollowed = this.state.followedAddrs.has(_followKey);
      const followBtn = el("button",{
        class:"btn inline",
        style: _isFollowed ? "background:#1a3a2a;border-color:#52b788;color:#52b788" : "",
      }, _isFollowed ? "Following" : "Follow");
      followBtn.addEventListener("click", ()=>{
        const wasFollowed = this.state.followedAddrs.has(_followKey);
        if(wasFollowed) this.state.followedAddrs.delete(_followKey);
        else this.state.followedAddrs.add(_followKey);
        // Persist to server
        this._callWS({
          type: "padspan_ha/settings_set",
          data_mode: this.state.dataMode,
          followed_addrs: [...this.state.followedAddrs],
        }).catch(()=>{});
        try { localStorage.setItem("padspan_followed", JSON.stringify([...this.state.followedAddrs])); } catch(e){}
        const nowFollowed = this.state.followedAddrs.has(_followKey);
        followBtn.textContent = nowFollowed ? "Following" : "Follow";
        followBtn.style.cssText = nowFollowed
          ? "width:auto;margin-top:0;background:#1a3a2a;border-color:#52b788;color:#52b788" : "width:auto;margin-top:0";
      });
      actionsRow.appendChild(followBtn);
    }
    actionsRow.appendChild(el("button",{class:"btn inline",onclick:()=>this._closeModal()}, "Close"));
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
        const oKey = (o.address || o.entity_id || "").toUpperCase();
        const isFollowed = oKey && this.state.followedAddrs.has(oKey);
        const oc = isFollowed ? "#fbbf24" : (o.identified ? "#5eead4" : "#f59e0b");
        const rssiTxt = o.rssi != null ? `${o.rssi} dBm` : "";
        const ageTxt = o.age_s != null ? `${Math.round(o.age_s)}s` : "";
        const oRow = el("div", {style:"display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #0d1f12"}, [
          el("span", {style:`width:8px;height:8px;border-radius:50%;background:${oc};flex-shrink:0`}),
          el("div", {style:"flex:1"}, oName),
          isFollowed ? el("span", {class:"badge", style:"background:#fbbf2422;color:#fbbf24;border-color:#fbbf24"}, "Following") : null,
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
        const sid = radioShortId(r.source || "");
        const rRow = el("div", {style:"display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #0d1f12"}, [
          el("span", {style:"font-family:monospace;font-weight:700;font-size:12px;letter-spacing:.04em;color:#52b788;flex-shrink:0"}, sid),
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

    // Network info (IP, SSID, WiFi signal)
    if(scanner.ip || scanner.ssid || scanner.wifi_signal != null || scanner.connection_type){
      const netRow = el("div", {style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center"});
      if(scanner.ip) netRow.appendChild(el("span", {class:"badge", style:"font-family:monospace;font-size:11px"}, scanner.ip));
      if(scanner.ssid) netRow.appendChild(el("span", {class:"badge", style:"font-size:11px"}, scanner.ssid));
      else if(scanner.connection_type) netRow.appendChild(el("span", {class:"badge", style:"font-size:11px"}, scanner.connection_type));
      if(scanner.wifi_signal != null) netRow.appendChild(el("span", {class:"muted", style:"font-size:11px"}, `WiFi ${scanner.wifi_signal} dBm`));
      body.appendChild(netRow);
    }

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
    // Skip re-render during active drag to prevent DOM destruction mid-interaction
    if(this.state._calibTune?._dragging || this.state._calibBeacon?._dragging || this.state._calibTune?._confirming || this.state._calibBeacon?._confirming) return;
    // Verify $content is a live node in the shadow DOM (not a stale detached reference)
    if(!this.$content || !this.$content.isConnected){
      this._ensureShadowDom();
      if(!this.$content) return;
    }
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

    // ── Build new content into a fragment BEFORE clearing ──────────────────
    // This prevents blank-screen: if render throws, old content stays visible.
    const frag = document.createDocumentFragment();

    // BLE health banner — show once per session when Bluetooth feed is unhealthy
    if(!this.state._bleBannerDismissed){
      const snap = this.state.live?.snapshot;
      const bleDiag = snap?.ble?.diag;
      if(bleDiag && (bleDiag.ok === false || (Array.isArray(bleDiag.errors) && bleDiag.errors.length))){
        const banner = document.createElement("div");
        banner.style.cssText = "background:#1a0a0a;border:1px solid #7f1d1d;border-radius:8px;padding:12px 16px;margin-bottom:12px;display:flex;align-items:flex-start;gap:10px";
        const msg = document.createElement("div");
        msg.style.cssText = "flex:1;font-size:12px;color:#fca5a5;line-height:1.5";
        msg.innerHTML = "<b style='font-size:13px'>Bluetooth feed unavailable</b><br>"
          + "PadSpan™ can't see BLE scanners. This usually means Home Assistant needs a <b>full restart</b> "
          + "(Settings → System → Restart) — a reload isn't enough after first install.";
        const dismissBtn = document.createElement("button");
        dismissBtn.className = "btn inline";
        dismissBtn.style.cssText = "padding:2px 8px;font-size:11px;color:#fca5a5;border-color:#7f1d1d;flex-shrink:0";
        dismissBtn.textContent = "Dismiss";
        dismissBtn.addEventListener("click", ()=>{ this.state._bleBannerDismissed = true; banner.remove(); });
        banner.appendChild(msg);
        banner.appendChild(dismissBtn);
        frag.appendChild(banner);
      }
    }

    // First-run welcome banner (dismissible, once per session)
    if(!this.state._welcomeDismissed && this.state.view === "follow"){
      this.state._welcomeDismissed = true;
      const welcome = el("div",{class:"card",style:"border:1px solid #1a4228;background:#0f1a12;margin-bottom:14px"});
      welcome.appendChild(el("div",{style:"display:flex;align-items:center;justify-content:space-between"},[
        el("div",{style:"font-weight:700;font-size:14px;color:#52b788"}, "Welcome to PadSpan\u2122 HA"),
        (() => {
          const x = el("span",{style:"cursor:pointer;color:#64748b;font-size:16px;padding:2px 6px"}, "\u2715");
          x.addEventListener("click", ()=>welcome.remove());
          return x;
        })(),
      ]));
      welcome.appendChild(el("div",{style:"display:flex;flex-direction:column;gap:8px;margin-top:10px;font-size:12px;color:#94a3b8"},[
        el("div",{}, [el("span",{style:"color:#5eead4;font-weight:700;margin-right:6px"},"1."), "Upload a floor plan in the ", el("span",{style:"color:#5eead4"},"Maps"), " tab"]),
        el("div",{}, [el("span",{style:"color:#5eead4;font-weight:700;margin-right:6px"},"2."), "Place your scanners on the map in ", el("span",{style:"color:#5eead4"},"Maps \u2192 3D Stack")]),
        el("div",{}, [el("span",{style:"color:#5eead4;font-weight:700;margin-right:6px"},"3."), "Tag your devices in the ", el("span",{style:"color:#5eead4"},"Objects"), " tab, then track them here"]),
      ]));
      frag.appendChild(welcome);
    }

    if(!mod || typeof mod.render !== "function") {
      // Skeleton loading placeholder while views load
      const skel = el("div",{style:"display:flex;flex-direction:column;gap:12px"});
      for(let i = 0; i < 3; i++){
        const card = el("div",{class:"card",style:"min-height:80px"});
        card.appendChild(el("div",{style:"height:14px;width:40%;background:rgba(255,255,255,0.06);border-radius:4px;margin-bottom:12px"}));
        card.appendChild(el("div",{style:"height:10px;width:70%;background:rgba(255,255,255,0.04);border-radius:3px;margin-bottom:8px"}));
        card.appendChild(el("div",{style:"height:10px;width:55%;background:rgba(255,255,255,0.04);border-radius:3px"}));
        skel.appendChild(card);
      }
      frag.appendChild(skel);
      // Swap only after new content is ready
      this.$content.innerHTML = "";
      this.$content.appendChild(frag);
      this._lastGoodRender = performance.now();
      this._renderFailCount = 0;
      return;
    }
    try {
      const node = mod.render(this._ctx());
      frag.appendChild(node);

      // ── Swap: clear old content and append new content atomically ────────
      this.$content.innerHTML = "";
      this.$content.appendChild(frag);
      this._lastGoodRender = performance.now();
      this._renderFailCount = 0;

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
      // Render failed — OLD content is still visible (not cleared).
      // Only show error UI if content is actually empty (e.g. first render).
      console.error("PadSpan render error:", e);
      this._renderFailCount = (this._renderFailCount || 0) + 1;
      if(!this.$content.children.length){
        this.$content.innerHTML = "";
        this.$content.appendChild(frag); // banners at least
        const errDiv = document.createElement("div");
        errDiv.style.cssText = "background:#1a0a0a;border:1px solid #7f1d1d;border-radius:8px;padding:16px;margin:16px 0;color:#fca5a5";
        const h = document.createElement("div");
        h.style.cssText = "font-weight:700;font-size:15px;margin-bottom:8px";
        h.textContent = "UI render error — view: " + this.state.view;
        const sub = document.createElement("div");
        sub.style.cssText = "font-size:12px;margin-bottom:8px;color:#fca5a5";
        sub.textContent = "A JavaScript error prevented this view from rendering. Open browser console (F12) for details.";
        const pre = document.createElement("pre");
        pre.style.cssText = "font-size:11px;white-space:pre-wrap;word-break:break-all;background:#0a0000;padding:10px;border-radius:4px;overflow:auto;max-height:300px;color:#f87171";
        pre.textContent = String(e?.stack || e);
        const retryBtn = document.createElement("button");
        retryBtn.className = "btn";
        retryBtn.style.cssText = "margin-top:10px";
        retryBtn.textContent = "Retry";
        retryBtn.addEventListener("click", ()=>{ this._renderFailCount = 0; this._refreshAll(true); });
        errDiv.appendChild(h); errDiv.appendChild(sub); errDiv.appendChild(pre); errDiv.appendChild(retryBtn);
        this.$content.appendChild(errDiv);
      }
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
