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

const APP_VERSION = "0.13.9";
// Build stamp used for cache-busting and Diagnostics.
const BUILD_ID = "20260316T173305Z";
const CHANNEL = "beta";

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
  import(`./views/traceback.js?b=${BUILD_ID}`).then(m => { VIEWS.traceback = m; }),
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
  ["traceback","Traceback","mdi:history"],
  ["qa","QA","mdi:clipboard-check-outline"],
  ["sandbox","Sandbox","mdi:flask-outline"],
];

// Tabs shown in Basic (simplified) mode
const BASIC_TABS = new Set(["follow", "overview", "maps", "settings", "training"]);
// Tabs shown in Advanced mode by default (user can add more via Settings → UI Structure)
const ADVANCED_DEFAULT = new Set(["follow","overview","maps","settings","training","manage","calibration","traceback"]);
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
  traceback: "#fbbf24",
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

/**
 * Determine scanner status: "scanning", "listening", or "idle".
 * @param {object} radio  — radio object with .scanning, .source
 * @param {Array}  ads    — snapshot advertisements array (optional)
 * @returns {{label:string, cls:string, title:string}}
 */
function scannerStatus(radio, ads){
  if(radio.scanning === true)
    return { label:"scanning", cls:"badge", title:"Actively requesting BLE advertisements from nearby devices" };
  // Use last_heard_s (seconds since last ad received, independent of age filter) if available
  const lh = radio.last_heard_s;
  if(typeof lh === "number" && lh < 120)
    return { label:"listening", cls:"badge", style:"background:rgba(56,189,248,.14);color:#38bdf8", title:`Last heard ${Math.round(lh)}s ago — online and receiving BLE broadcasts` };
  const src = radio.source || "";
  const hasAds = Array.isArray(ads) && ads.some(a => a.source === src);
  if(hasAds)
    return { label:"listening", cls:"badge", style:"background:rgba(56,189,248,.14);color:#38bdf8", title:"Online and receiving BLE broadcasts (passive mode)" };
  if(typeof lh === "number" && lh < 600)
    return { label:`heard ${Math.round(lh)}s ago`, cls:"badge warn", title:`Last advertisement received ${Math.round(lh)}s ago — may be in a quiet area` };
  return { label:"idle", cls:"badge warn", title:"No recent BLE data — may be offline, rebooting, or in a quiet area" };
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
    // Track last user interaction to suppress poll re-renders during active use
    this._lastUserInteraction = 0;
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
    // ── Sidebar re-entry recovery ────────────────────────────────────────────
    // HA calls set hass() when the user navigates back to PadSpan in the sidebar.
    // If disconnectedCallback ran (cleared timers/listeners), re-start them here.
    // This catches the case where HA re-attaches without calling connectedCallback.
    if(hass && this._booted && this.isConnected){
      if(!this._watchdogTimer || !this._activityTimer){
        this._startKeepAlive();
      }
      if(this.state.dataMode === "live" && !this._pollTimer){
        this._startDataPoll();
      }
      // If content is blank, rebuild
      if(this.$content && !this.$content.children.length){
        this._renderNav();
        this._renderCurrentView();
        this._refreshAll(false);
      }
    }
  }

  connectedCallback(){
    if(!this.shadowRoot) this.attachShadow({mode:"open"});
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="/padspan_ha_static/padspan-ha/styles.css?v=${APP_VERSION}&b=${BUILD_ID}">
      <style>
        /* Only :host fallback — do not override layout classes that styles.css already handles */
        :host{display:block;background:#0a150e;color:#e2e8f0;font-family:Inter,system-ui,Arial,sans-serif;box-sizing:border-box}
      </style>
      <div id="app" class="app">
        <div class="side-backdrop" id="sideBackdrop"></div>
        <aside class="left">
          <div class="sidebar-mobile-header" id="sidebarMobileHeader">
            <span style="font-weight:700;font-size:15px;flex:1">PadSpan HA</span>
            <button class="btn inline" id="sidebarClose" style="width:auto;font-size:18px;padding:4px 10px">&times;</button>
          </div>
          <div class="brand">
            <img src="/padspan_ha_static/padspan-ha/assets/padspan-mark.svg?b=${BUILD_ID}" alt="PadSpan" onerror="this.style.display='none'">
            <div>
              <div class="label">PadSpan™ HA</div>
              <div class="muted" style="margin-top:2px">v${APP_VERSION}${CHANNEL==='stable'?` <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:#2e7d32;color:#fff;vertical-align:middle">${CHANNEL}</span>`:''}</div>
            </div>
          </div>

          <div class="toolbar" style="margin-top:10px">
            <button class="btn inline" id="refresh">Refresh</button>
            <button class="btn inline" id="autodiag">Auto Diagnostics</button>
            <button class="btn inline" id="toggleSide">Toggle</button>
          </div>

          <div style="margin-top:12px;margin-bottom:8px" class="muted" id="navLabel">Menu</div>
          <div class="nav" id="nav"></div>
        </aside>

        <main class="main">
          <div class="mobile-topbar" id="mobileTopbar">
            <button class="mobile-topbar-btn" id="mobileBackBtn" title="Back to Home Assistant" style="font-size:18px;padding:4px 6px">&#x2190;</button>
            <button class="mobile-topbar-btn" id="mobileMenuBtn">&#9776;</button>
            <span class="mobile-topbar-title" id="mobileTitle">Overview</span>
            <button class="mobile-topbar-pill" id="mobileDataPill">Sample</button>
            <button class="mobile-topbar-pill" id="mobileModePill">Advanced</button>
          </div>
          <div class="row desktop-topbar" style="margin-bottom:10px;align-items:center">
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

        <div class="mobile-bottom-nav" id="mobileBottomNav"></div>
      </div>
    `;

    this.$ = (q)=>this.shadowRoot.querySelector(q);
    this.$nav = this.$("#nav");
    this.$content = this.$("#content");
    this.$modal = this.$("#modal");

    // Measure actual available height — HA's toolbar offsets the panel
    // from the top of the viewport.  --header-height may not propagate
    // through shadow DOM, so measure directly and set on the app element.
    this._fitHeight = () => {
      try {
        const appEl = this.$("#app");
        if (appEl) {
          const rect = appEl.getBoundingClientRect();
          const avail = window.innerHeight - rect.top;
          if (avail > 100) appEl.style.height = avail + "px";
        }
      } catch(e) {}
    };
    requestAnimationFrame(() => this._fitHeight());
    window.addEventListener("resize", () => this._fitHeight());

    this.$("#refresh").addEventListener("click", ()=>this._refreshAll(true));
    this.$("#autodiag").addEventListener("click", ()=>this._runAutoDiag(true));
    this.$("#toggleSide").addEventListener("click", ()=>this.$("#app").classList.toggle("mini"));

    // Mobile navigation wiring
    const _openDrawer = () => {
      this.$("#app").classList.add("mobile-open");
      this.$("#sideBackdrop").classList.add("active");
    };
    const _closeDrawer = () => {
      this.$("#app").classList.remove("mobile-open");
      this.$("#sideBackdrop").classList.remove("active");
    };
    this.$("#mobileBackBtn").addEventListener("click", () => {
      // Navigate back to HA dashboard — works in Companion App on iPhone
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = "/";
      }
    });
    this.$("#mobileMenuBtn").addEventListener("click", _openDrawer);
    this.$("#sidebarClose").addEventListener("click", _closeDrawer);
    this.$("#sideBackdrop").addEventListener("click", _closeDrawer);
    this._closeDrawer = _closeDrawer;

    // Mobile topbar pills mirror the desktop toggles
    this.$("#mobileDataPill").addEventListener("click", async () => {
      const next = (this.state.dataMode === "sample") ? "live" : "sample";
      await this._setDataMode(next);
    });
    this.$("#mobileModePill").addEventListener("click", () => {
      // Re-use the same complexity toggle logic
      this.$("#complexityToggle").click();
    });

    // Track user interaction to suppress poll re-renders during active use
    const _markInteraction = () => { this._lastUserInteraction = performance.now(); };
    this.$content.addEventListener("input", _markInteraction, true);
    this.$content.addEventListener("change", _markInteraction, true);
    this.$content.addEventListener("click", _markInteraction, true);
    this.$content.addEventListener("focusin", _markInteraction, true);
    this.$content.addEventListener("scroll", _markInteraction, true);

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
    // Full cleanup: clear ALL timers to prevent zombie timers if HA creates a
    // new element instance. connectedCallback will recreate them fresh.
    this._stopDataPoll();
    this._pollInFlight = false;
    if(this._activityTimer){ clearInterval(this._activityTimer); this._activityTimer = null; }
    if(this._watchdogTimer){ clearInterval(this._watchdogTimer); this._watchdogTimer = null; }
    if(this._visibilityHandler){
      document.removeEventListener("visibilitychange", this._visibilityHandler);
      this._visibilityHandler = null;
    }
    if(this._focusHandler){
      window.removeEventListener("focus", this._focusHandler);
      this._focusHandler = null;
    }
    if(this._pageshowHandler){
      window.removeEventListener("pageshow", this._pageshowHandler);
      this._pageshowHandler = null;
    }
    if(this._haLocationHandler){
      window.removeEventListener("location-changed", this._haLocationHandler);
      this._haLocationHandler = null;
    }
    if(this._interactionHandler){
      this.removeEventListener("pointerdown", this._interactionHandler);
      this._interactionHandler = null;
    }
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
    // ── Activity ping (30s) ─────────────────────────────────────────────────
    // Synthetic pointer events keep HA's idle overlay away. Dispatches on
    // document, window, AND the HA root element with both trusted event types.
    if(!this._activityTimer){
      const ping = ()=>{
        try {
          for(const EvType of [PointerEvent, MouseEvent]){
            for(const name of ["pointermove","mousemove"]){
              try {
                const ev = new EvType(name, {bubbles:true, composed:true, cancelable:true});
                document.dispatchEvent(ev);
                window.dispatchEvent(ev);
              } catch(e){}
            }
          }
          const haRoot = document.querySelector("home-assistant");
          if(haRoot) haRoot.dispatchEvent(new Event("mousemove", {bubbles:true}));
        } catch(e){}
      };
      ping();
      this._activityTimer = setInterval(ping, 25_000);
    }

    // ── Watchdog (8s) ───────────────────────────────────────────────────────
    // Checks DOM integrity, content visibility, stuck polls, and poll liveness.
    // This is the last line of defense against blank screens.
    if(!this._watchdogTimer){
      this._watchdogTimer = setInterval(()=>{
        try {
          if(!this.isConnected) return;

          // 1. Stale shadow DOM references — fix before anything else
          const rebuilt = this._ensureShadowDom();
          if(rebuilt){ this._renderCurrentView(); return; }

          // 2. Verify $content exists and is live
          if(!this.$content || !this.$content.isConnected){
            console.warn("PadSpan watchdog: $content missing/disconnected — full rebuild");
            this.connectedCallback();
            return;
          }

          // 3. Content area empty OR visually zero-height
          const empty = !this.$content.children.length;
          let zeroHeight = false;
          try { zeroHeight = this.$content.getBoundingClientRect().height < 2; } catch(e){}
          if(empty || zeroHeight){
            console.warn("PadSpan watchdog: content blank (empty=%s, zeroH=%s) — forcing render", empty, zeroHeight);
            // Force render: bypass all guards by not passing fromPoll
            this._renderCurrentView();
            // If still empty after sync render, escalate to full refresh
            if(!this.$content.children.length){
              this._pollInFlight = false;
              this._refreshAll(false);
            }
          }

          // 4. Unstick deadlocked poll (hung > 20s)
          if(this._pollInFlight && this._pollStartedAt){
            if(performance.now() - this._pollStartedAt > 20_000){
              console.warn("PadSpan watchdog: poll stuck for >20s — unsticking");
              this._pollInFlight = false;
              this._renderCurrentView();
            }
          }

          // 5. Ensure data poll is alive in live mode
          if(this.state.dataMode === "live" && !this._pollTimer){
            this._startDataPoll();
          }

          // 6. Escalation: no successful render in 20s → full rebuild
          const sinceGoodRender = this._lastGoodRender ? performance.now() - this._lastGoodRender : 0;
          if(sinceGoodRender > 20_000){
            if((this._renderFailCount || 0) >= 2){
              console.warn("PadSpan watchdog: no successful render in 20s + %d failures — full rebuild", this._renderFailCount);
              this._renderFailCount = 0;
              this._lastGoodRender = performance.now();
              this._pollInFlight = false;
              this.connectedCallback();
            } else {
              // Try a non-poll render first before escalating
              console.warn("PadSpan watchdog: no successful render in 20s — forcing render");
              this._renderCurrentView();
            }
          }
        } catch(e){
          // Even the watchdog crashed — nuclear recovery
          console.error("PadSpan watchdog error — rebuilding:", e);
          try { this.connectedCallback(); } catch(e2){}
        }
      }, 5_000);
    }

    // ── Visibility change (browser tab show/hide) ───────────────────────────
    if(!this._visibilityHandler){
      this._visibilityHandler = ()=>{
        if(document.visibilityState === "visible") this._wakeUp("visibilitychange");
      };
      document.addEventListener("visibilitychange", this._visibilityHandler);
    }

    // ── Window focus (browser window regains focus) ─────────────────────────
    // Fires on Alt-Tab back, clicking the browser from taskbar, etc.
    // visibilitychange does NOT fire for these on all browsers.
    if(!this._focusHandler){
      this._focusHandler = ()=> this._wakeUp("focus");
      window.addEventListener("focus", this._focusHandler);
    }

    // ── Page show (bfcache restore, navigation) ─────────────────────────────
    if(!this._pageshowHandler){
      this._pageshowHandler = (ev)=>{
        if(ev.persisted) this._wakeUp("pageshow");
      };
      window.addEventListener("pageshow", this._pageshowHandler);
    }

    // ── HA location-changed (sidebar navigation within HA) ──────────────────
    // HA fires this custom event on every route change. When the user clicks
    // PadSpan in the sidebar after visiting another panel, this wakes us up
    // even though visibilitychange won't fire (page was never hidden).
    if(!this._haLocationHandler){
      this._haLocationHandler = ()=>{
        // Only wake if we're actually connected (HA re-attached our element)
        if(this.isConnected) this._wakeUp("ha-location");
      };
      window.addEventListener("location-changed", this._haLocationHandler);
    }

    // ── Interaction recovery (user clicks on panel) ─────────────────────────
    // If the panel looks blank and the user clicks anywhere inside it,
    // immediately check health and rebuild if needed.
    if(!this._interactionHandler){
      this._interactionHandler = ()=>{
        if(!this.$content) return;
        if(!this.$content.children.length){
          console.warn("PadSpan: user click on blank panel — recovering");
          this._renderCurrentView();
          this._refreshAll(false);
        }
      };
      this.addEventListener("pointerdown", this._interactionHandler);
    }
  }

  // Unified wake-up handler — called by all recovery triggers
  _wakeUp(source){
    if(!this._hass || !this.isConnected) return;
    this._pollInFlight = false;
    this._ensureShadowDom();
    this._renderCurrentView();
    this._refreshAll(false);
    if(this.state.dataMode === "live" && !this._pollTimer) this._startDataPoll();
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
    // Keep-alive timers + event handlers are NOT stopped here.
    // They protect against blank screens regardless of data mode.
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
      const liveViews = new Set(["overview","follow","objects","devices","bluetooth","presence","history","monitor","events","health","diagnostics","debug","qa","sandbox","manage","calibration","maps"]);
      // Render with poll guard (skips if user is interacting).
      // But if no successful render in 10s, force it regardless.
      const stale = this._lastGoodRender && (performance.now() - this._lastGoodRender > 10_000);
      if(liveViews.has(this.state.view)) this._renderCurrentView(stale ? false : true);
    } catch(e){
      // Non-fatal — snapshot is preserved from last good fetch.
      // Only re-render if screen might be stale (> 10s since last good render).
      if(!this._lastGoodRender || (performance.now() - this._lastGoodRender > 10_000)){
        try { this._renderCurrentView(); } catch(e2){}
      }
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
      this._renderNav();
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
      // When switching to sample, explicitly assign sample snapshot.
      // When switching to live, clear the sample snapshot so _getLiveSnapshot fetches fresh.
      if(this.state.dataMode !== "live"){
        this.state.live.snapshot = SAMPLE_SNAPSHOT;
        this._recomputeDerived();
      } else {
        // Clear sample snapshot so first live fetch replaces it
        if(this.state.live.snapshot === SAMPLE_SNAPSHOT) this.state.live.snapshot = null;
      }
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
      // Sample mode: use the built-in demo snapshot so all views render fully.
      // But only assign if we don't already have a live snapshot cached
      // (prevents race conditions during _refreshAll where settings haven't loaded yet).
      if(!this.state.live.snapshot || this.state.live.snapshot === SAMPLE_SNAPSHOT){
        this.state.live.snapshot = SAMPLE_SNAPSHOT;
      }
      this.state.live.error = null;
      this._recomputeDerived();
      return;
    }
    try {
      const res = await this._callWS({ type: "padspan_ha/live_snapshot" });
      const snap = res?.snapshot;
      // Only replace the snapshot if we got a valid response.
      // Keep the last good snapshot on WS failure to prevent flickering.
      if(snap && typeof snap === "object"){
        this.state.live.snapshot = snap;
        this.state.live.error = null;
        this._recomputeDerived();
        const objCount = snap?.objects?.summary?.total ?? 0;
        this._logEvent("snapshot", `${objCount} objects`);
      }
    } catch(e) {
      // Keep whatever snapshot we had — do NOT wipe to null
      this.state.live.error = String(e);
    }
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
    // IMPORTANT: Fetch settings FIRST so dataMode is correct before _getLiveSnapshot runs.
    // This prevents the race condition where _getLiveSnapshot sees "sample" mode
    // because settings haven't loaded yet, and incorrectly assigns SAMPLE_SNAPSHOT.
    await Promise.allSettled([this._fetchSettings()]);
    // Now run remaining fetches in parallel (dataMode is now correct)
    const results = await Promise.allSettled([
      this._getVersionInfo(),
      this._getStatus(),
      this._getRoomTags(),
      this._getLiveSnapshot(),
      this._getMapsList(),
      this._getModel(),
      this._runAutoDiag(false),
      this._loadAlertConfigs(),
    ]);
    // Log any WS failures to console for debugging
    const names = ["getVersionInfo","getStatus","getRoomTags","getLiveSnapshot","getMapsList","getModel","runAutoDiag","loadAlerts"];
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
    const _switchView = (id) => {
      // Clear traceback active flag when leaving traceback tab
      if (this.state._traceback && this.state.view === "traceback" && id !== "traceback") {
        this.state._traceback.active = false;
        if (this.state._traceback._animTimer) {
          clearInterval(this.state._traceback._animTimer);
          this.state._traceback._animTimer = null;
          this.state._traceback.playing = false;
        }
      }
      this.state.view = id;
      this._logEvent("view_change", id);
      if (this._closeDrawer) this._closeDrawer();
      this._renderNav();
      this._renderCurrentView();
    };

    for(const [id,label] of items.map(x=>[x[0],x[1]])) {
      const color = MENU_COLORS[id] || "#37588f";
      const btn = el("button",{
        class:"navbtn"+(this.state.view===id?" active":""),
        style:`--navcolor:${color}`,
        onclick:()=>_switchView(id)
      }, [el("span",{class:"navdot"}), el("span",{}, label)]);
      this.$nav.appendChild(btn);
    }

    // ── Mobile bottom nav: pinned tabs + "More" button ──────────────
    const bottomNav = this.shadowRoot.querySelector("#mobileBottomNav");
    if (bottomNav) {
      bottomNav.innerHTML = "";
      // Pinned tabs vary by complexity mode
      const pinned = isBasic
        ? ["follow","overview","maps","settings"]
        : ["follow","overview","maps","calibration"];
      for (const pid of pinned) {
        const mi = MENU.find(x => x[0] === pid);
        if (!mi) continue;
        const color = MENU_COLORS[pid] || "#37588f";
        const isActive = this.state.view === pid;
        const btn = document.createElement("button");
        btn.className = "mobile-bottom-nav-btn" + (isActive ? " active" : "");
        btn.style.cssText = `--navcolor:${color}`;
        btn.innerHTML = `<span class="bn-dot" style="background:${color}"></span><span>${esc(mi[1])}</span>`;
        btn.addEventListener("click", () => _switchView(pid));
        bottomNav.appendChild(btn);
      }
      // "More" button opens the sidebar drawer
      const moreBtn = document.createElement("button");
      moreBtn.className = "mobile-bottom-nav-btn";
      moreBtn.style.cssText = "--navcolor:#78909c";
      // Highlight "More" if the current view isn't one of the pinned tabs
      if (!pinned.includes(this.state.view)) {
        moreBtn.classList.add("active");
        moreBtn.style.cssText = `--navcolor:${MENU_COLORS[this.state.view] || "#78909c"}`;
      }
      moreBtn.innerHTML = `<span class="bn-dot" style="background:#78909c"></span><span>More</span>`;
      moreBtn.addEventListener("click", () => {
        if (this.$("#app").classList.contains("mobile-open")) {
          if (this._closeDrawer) this._closeDrawer();
        } else {
          this.$("#app").classList.add("mobile-open");
          this.$("#sideBackdrop").classList.add("active");
        }
      });
      bottomNav.appendChild(moreBtn);
    }

    // ── Mobile topbar: update title and pills ───────────────────────
    const mobileTitle = this.shadowRoot.querySelector("#mobileTitle");
    if (mobileTitle) {
      const mi = MENU.find(x => x[0] === this.state.view);
      mobileTitle.textContent = mi ? mi[1] : this.state.view;
    }
    const mobileDataPill = this.shadowRoot.querySelector("#mobileDataPill");
    if (mobileDataPill) {
      const isLive = this.state.dataMode === "live";
      mobileDataPill.textContent = isLive ? "Live" : "Sample";
      mobileDataPill.className = "mobile-topbar-pill" + (isLive ? " live" : "");
    }
    const mobileModePill = this.shadowRoot.querySelector("#mobileModePill");
    if (mobileModePill) {
      mobileModePill.textContent = isBasic ? "Basic" : this.state.complexity === "development" ? "Dev" : "Adv";
      mobileModePill.className = "mobile-topbar-pill" + (isBasic ? " basic" : "");
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
        /** Map source → friendly name from live radios. Returns "" if no name or same as source. */
        radioName: (source)=>{
          const s = String(source || "");
          const radios = (self.state.live?.snapshot?.ble?.radios) || [];
          const r = radios.find(r => String(r.source || "") === s);
          return (r && r.name && r.name !== s) ? r.name : "";
        },
        scannerStatus,
        roomColor: (n)=>roomColor(n, this.state.model),
        helpBtn: (key)=>{
          const b = document.createElement("button");
          b.className = "btn-help";
          b.title = "Help";
          b.textContent = "?";
          b.addEventListener("click", (e)=>{ e.stopPropagation(); self._showHelp(key); });
          return b;
        },
        /** Set of uppercase addresses/sources belonging to known BLE scanners.
         *  Use to filter scanners out of object/tracking views. */
        scannerAddrs: ()=>{
          const s = new Set();
          const radios = (self.state.live?.snapshot?.ble?.radios) || [];
          for(const r of radios){
            if(r.source) s.add(String(r.source).toUpperCase());
            if(r.name) s.add(String(r.name).toUpperCase());
          }
          return s;
        },
        /** Returns true if this object is a known scanner (not a trackable device). */
        isScanner: (obj)=>{
          const radios = (self.state.live?.snapshot?.ble?.radios) || [];
          const addr = (obj.address || "").toUpperCase();
          const name = (obj.name || "").toUpperCase();
          const eid = (obj.entity_id || "").toUpperCase();
          for(const r of radios){
            const rs = (r.source || "").toUpperCase();
            const rn = (r.name || "").toUpperCase();
            if(rs && (rs === addr || rs === eid || rs === name)) return true;
            if(rn && (rn === addr || rn === name)) return true;
            // Match by MAC in source against any of the object's addresses
            if(rs && Array.isArray(obj.all_addresses)){
              for(const a of obj.all_addresses){ if(a && String(a).toUpperCase() === rs) return true; }
            }
          }
          return false;
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
        callWS: (payload)=>this._callWS(payload),

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
        followAlertDelete: async (addr)=>{
          await this._callWS({ type:"padspan_ha/follow_alert_delete", addr });
          delete this.state.followAlertConfig[addr];
        },
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
        factoryReset: async () => {
            const res = await this._callWS({ type: "padspan_ha/factory_reset", confirm: "FACTORY RESET" });
            // Clear frontend-side localStorage caches so stale data doesn't survive reload
            try { localStorage.removeItem("padspan_followed"); } catch(e){}
            try { localStorage.removeItem("padspan_followAddr"); } catch(e){}
            try { localStorage.removeItem("padspan_hiddenMapIds"); } catch(e){}
            // Reset in-memory followed state immediately
            this.state.followedAddrs = new Set();
            this.state.followAddr = "";
            // Allow _fetchSettings to overwrite followedAddrs from server on next refresh
            this._followedLoadedFromServer = false;
            // Clear cached snapshot so stale objects with labels/followed don't linger
            this.state.live = { snapshot: null, error: null };
            return res;
        },
        refreshAll: async () => { await this._refreshAll(false); },
        modelRefresh: async () => { await this._getModel(); this._renderCurrentView(); },

        // Detail modals
        showObjectDetail: (obj) => this._showObjectDetail(obj),
        showRoomDetail: (roomName) => this._showRoomDetail(roomName),
        showScannerDetail: (scanner) => this._showScannerDetail(scanner),

        // Mapping suite actions
        setMapsTab: (t)=>{ this.state.mapsTab=t; if(t==="library") this._getMapsList().then(()=>this._renderCurrentView()).catch(()=>this._renderCurrentView()); else this._renderCurrentView(); },
        mapsRefresh: async ()=>{ await this._getMapsList(); this._renderCurrentView(); },
        mapsSetActive: (id)=>{ this.state.activeMapId=id; this._renderCurrentView(); },
        mapsDelete: async (id)=>{ await this._callWS({ type:"padspan_ha/maps_delete", map_id:id }); await this._getMapsList(); if(this.state.activeMapId===id) this.state.activeMapId=null; this._renderCurrentView(); },
        mapsDeleteMigrate: async (mapId, targetMapId, extendCanvas=false)=>{ const r = await this._callWS({ type:"padspan_ha/maps_delete_migrate", map_id:mapId, target_map_id:targetMapId, extend_canvas:!!extendCanvas }); await this._getMapsList(); if(this.state.activeMapId===mapId) this.state.activeMapId=null; this._renderCurrentView(); return r; },
        mapsUpload: async (payload)=>{ const r = await this._callWS(Object.assign({type:"padspan_ha/maps_upload"}, payload)); await this._getMapsList(); return r; },
        mapsUpdate: async (payload)=>{ await this._callWS(Object.assign({type:"padspan_ha/maps_update"}, payload)); await this._getMapsList(); this._renderCurrentView(); },
        mapsUpdateQuiet: async (payload)=>{ await this._callWS(Object.assign({type:"padspan_ha/maps_update"}, payload)); },
        mapsReplaceImage: async (payload)=>{ await this._callWS(Object.assign({type:"padspan_ha/maps_replace_image"}, payload)); await this._getMapsList(); this._renderCurrentView(); },
        modelUpdate: async (payload)=>{ await this._callWS(Object.assign({type:"padspan_ha/model_update"}, payload)); await this._getModel(); this._renderCurrentView(); },

        // Settings actions
        settingsSet: async (payload) => {
          const res = await this._callWS(Object.assign({ type: "padspan_ha/settings_set", data_mode: this.state.dataMode }, payload));
          this.state.settings = res?.settings || this.state.settings;
          this._renderNav();
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
        objectEvict: async (key) => await this._callWS({ type: "padspan_ha/object_evict", key }),
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
    const input = el("input",{type:"text", placeholder:"Enter a label…", maxLength:48});
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
      const h = Math.floor(m/60), rm = m - h*60;
      if(h < 24) return `${h}h ${rm}m`;
      const d = Math.floor(h/24), rh = h - d*24;
      return `${d}d ${rh}h`;
    };

    const body = el("div", {style:"display:flex;flex-direction:column;gap:14px"});

    // Identity
    body.appendChild(el("div", {}, [
      el("div", {style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px"}, [
        el("div", {style:"font-size:20px;font-weight:800;color:#e2e8f0"}, name),
        el("span", {class:"badge"+(identified?"":" warn"), style:
          kind==="private_ble" ? (identified?"background:#1a3a5a;color:#7dd3fc;border-color:#3b82f6":"") :
          kind==="ibeacon" ? (identified?"background:#3a2a0a;color:#fbbf24;border-color:#d97706":"") : ""},
          kind==="private_ble" ? (identified?"Private BLE · Identified":"Private BLE · Unidentified") :
          kind==="ibeacon" ? (identified?"iBeacon · Identified":"iBeacon · Unidentified") :
          kind==="ble" ? (identified?"BLE · Identified":"BLE · Unidentified") : "HA Entity"),
      ]),
      addr ? el("div", {class:"muted", style:"font-family:monospace;font-size:12px"}, addr) : null,
      obj.canonical_id ? el("div", {class:"muted", style:"font-size:11px"}, `Canonical: ${obj.canonical_id}`) : null,
      (Array.isArray(obj.all_addresses) && obj.all_addresses.length > 1)
        ? el("div", {class:"muted", style:"font-size:11px"}, `Addresses (${obj.all_addresses.length}): ${obj.all_addresses.slice(0,5).join(", ")}${obj.all_addresses.length>5?" + "+(obj.all_addresses.length-5)+" more":""}`)
        : null,
      obj._dedup_reason ? el("div", {class:"muted", style:"font-size:10px;color:#a78bfa"}, `Merged: ${obj._dedup_reason}`) : null,
      obj.entity_id ? el("div", {class:"muted", style:"font-size:12px"}, `Entity: ${obj.entity_id}`) : null,
      obj.ibeacon_key ? el("div", {class:"muted", style:"font-size:11px;color:#fbbf24"}, `Linked iBeacon: ${obj.ibeacon_key}`) : null,
      (Array.isArray(obj.linked_entities) && obj.linked_entities.length)
        ? el("div", {class:"muted", style:"font-size:11px;color:#60a5fa"}, `Linked entities: ${obj.linked_entities.join(", ")}`)
        : null,
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

    // Status / Last seen
    {
      const statusItems = [];
      // Last seen age
      if (obj.age_s != null) {
        const ageStr = fmtAgo(obj.age_s);
        const isAway = typeof obj.age_s === "number" && obj.age_s > ((this.state.settings?.away_timeout_m ?? 5) * 60);
        statusItems.push(el("div", {style:"display:flex;align-items:center;gap:8px"}, [
          el("span", {style:"font-weight:600"}, "Last seen:"),
          el("span", {}, ageStr + " ago"),
          isAway ? el("span", {class:"badge", style:"background:#3a0a0a;color:#f87171;border-color:#7f1d1d;font-size:10px"}, "Away") : null,
        ].filter(Boolean)));
      }
      // Last seen timestamp
      if (obj.last_seen) {
        try {
          const d = new Date(obj.last_seen);
          statusItems.push(el("div", {class:"muted", style:"font-size:11px"}, `Last seen: ${d.toLocaleString()}`));
        } catch(e){}
      }
      // First seen timestamp
      if (obj.first_seen) {
        try {
          const d = new Date(obj.first_seen);
          statusItems.push(el("div", {class:"muted", style:"font-size:11px"}, `First seen: ${d.toLocaleString()}`));
        } catch(e){}
      }
      // RSSI summary
      if (obj.rssi != null) {
        const pct = Math.max(0, Math.min(100, ((obj.rssi + 100) / 60) * 100));
        const bar = el("div", {style:`width:${pct.toFixed(0)}%;height:6px;background:#52b788;border-radius:3px;min-width:2px`});
        statusItems.push(el("div", {style:"display:flex;align-items:center;gap:8px;margin-top:2px"}, [
          el("span", {style:"font-weight:600"}, "Signal:"),
          el("span", {}, `${obj.rssi} dBm`),
          el("div", {style:"width:80px;background:#1a2e1e;border-radius:3px"}, bar),
        ]));
      }
      // iBeacon details
      if (kind === "ibeacon") {
        if (obj.ibeacon_uuid) statusItems.push(el("div", {class:"muted", style:"font-size:11px;font-family:monospace"}, `UUID: ${obj.ibeacon_uuid}`));
        if (obj.ibeacon_major != null) statusItems.push(el("div", {class:"muted", style:"font-size:11px"}, `Major: ${obj.ibeacon_major} · Minor: ${obj.ibeacon_minor}`));
        if (obj.tx_power != null) statusItems.push(el("div", {class:"muted", style:"font-size:11px"}, `TX Power: ${obj.tx_power} dBm (factory calibrated at 1m)`));
        // Merged protocols badge (iBeacon + Eddystone, etc.)
        if (Array.isArray(obj.merged_protocols) && obj.merged_protocols.length > 1) {
          statusItems.push(el("div", {style:"display:flex;gap:4px;flex-wrap:wrap;margin-top:2px"},
            obj.merged_protocols.map(p => el("span", {class:"badge", style:"font-size:10px;background:#2a1a3a;color:#c4b5fd;border-color:#5b21b6"}, p))
          ));
        }
        // Eddystone service data (UUID feaa)
        const svcData = obj.service_data || {};
        const eddyPayload = svcData["0000feaa-0000-1000-8000-00805f9b34fb"] || svcData["feaa"];
        if (eddyPayload) {
          statusItems.push(el("div", {style:"margin-top:4px"}, [
            el("span", {style:"font-weight:600;font-size:12px;color:#fbbf24"}, "Eddystone: "),
            el("span", {class:"muted", style:"font-family:monospace;font-size:11px"}, String(eddyPayload)),
          ]));
        }
      }
      // Private BLE details
      if (kind === "private_ble") {
        if (obj.private_ble_name) statusItems.push(el("div", {class:"muted", style:"font-size:11px"}, `Identity: ${obj.private_ble_name}`));
        if (Array.isArray(obj.all_addresses) && obj.all_addresses.length > 1)
          statusItems.push(el("div", {class:"muted", style:"font-size:11px"}, `Active rotating MACs: ${obj.all_addresses.length}`));
      }
      // KNN calibration confidence
      if (obj.knn_confidence > 0) {
        statusItems.push(el("div", {style:"display:flex;align-items:center;gap:8px;margin-top:2px"}, [
          el("span", {style:"font-weight:600"}, "Calibrated:"),
          el("span", {style:"color:#52b788"}, `${Math.round(obj.knn_confidence * 100)}% confidence`),
        ]));
      }
      if (statusItems.length) {
        body.appendChild(el("div", {}, [
          el("div", {style:"font-weight:600;margin-bottom:4px"}, "Status"),
          ...statusItems,
        ]));
      }
    }

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
    // Build source→name lookup from live radios so we show friendly names
    const _radioMap = {};
    const _radios = this.state.live?.snapshot?.ble?.radios || [];
    for(const r of _radios){
      if(r.source) _radioMap[r.source] = r.name || r.source;
    }
    const _friendlySource = (src) => _radioMap[src] || src || "—";
    const makeSourceRow = (srcName, rssi, age_s) => {
      const pct = Math.max(0, Math.min(100, ((rssi ?? -100) + 100) / 60 * 100));
      const bar = el("div", {style:`width:${pct.toFixed(0)}%;height:6px;background:#52b788;border-radius:3px;min-width:2px`});
      const barWrap = el("div", {style:"width:80px;background:#1a2e1e;border-radius:3px"}, bar);
      return el("tr", {}, [
        el("td", {style:"font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis"}, _friendlySource(srcName)),
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
          const rssi = typeof s === "object" ? s.rssi : obj.rssi;
          const age_s = typeof s === "object" ? s.age_s : obj.age_s;
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
    const svcData = obj.service_data || {};
    const svcUUIDs = obj.service_uuids || [];
    const svcUuidMap = obj.service_uuid_map || {};
    if((kind==="ble"||kind==="private_ble"||kind==="ibeacon") && (Object.keys(manufData).length || Object.keys(svcData).length || svcUUIDs.length)){
      const det = document.createElement("details");
      det.style.cssText = "margin-top:4px";
      const sum = document.createElement("summary");
      sum.style.cssText = "cursor:pointer;font-weight:600;font-size:13px;color:#52b788";
      sum.textContent = "Raw BLE data";
      det.appendChild(sum);
      if(Object.keys(manufData).length){
        det.appendChild(el("div", {style:"font-size:12px;color:#94a3b8;margin-top:8px"}, "Manufacturer data:"));
        det.appendChild(el("table", {class:"table", style:"margin-top:4px"}, [
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
      if(Object.keys(svcData).length){
        det.appendChild(el("div", {style:"font-size:12px;color:#94a3b8;margin-top:8px"}, "Service data:"));
        det.appendChild(el("table", {class:"table", style:"margin-top:4px"}, [
          el("thead", {}, el("tr", {}, [el("th",{},"Service UUID"),el("th",{},"Name"),el("th",{},"Payload (hex)")])),
          el("tbody", {}, Object.entries(svcData).map(([k,v]) => {
            const uKey = String(k).toLowerCase();
            const sName = svcUuidMap[uKey] || svcUuidMap[k] || (uKey.includes("feaa") ? "Eddystone" : "—");
            return el("tr", {}, [
              el("td",{style:"font-size:11px;font-family:monospace"},String(k)),
              el("td",{style:"font-size:11px;color:#fbbf24"}, sName),
              el("td",{class:"muted",style:"font-family:monospace;font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis"},String(v)),
            ]);
          })),
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
    // Delete button — unfollow + remove label + purge from view
    if(_followKey || canRename){
      const deleteBtn = el("button",{
        class:"btn inline",
        style:"background:#3b1219;border-color:#f87171;color:#f87171",
      }, "Delete");
      deleteBtn.addEventListener("click", async()=>{
        // Unfollow
        if(_followKey && this.state.followedAddrs.has(_followKey)){
          this.state.followedAddrs.delete(_followKey);
          this._callWS({
            type: "padspan_ha/settings_set",
            data_mode: this.state.dataMode,
            followed_addrs: [...this.state.followedAddrs],
          }).catch(()=>{});
          try { localStorage.setItem("padspan_followed", JSON.stringify([...this.state.followedAddrs])); } catch(e){}
        }
        // Remove label
        if(canRename && tagAddr){
          try { await this._callWS({ type:"padspan_ha/object_label_delete", address: tagAddr }); } catch(e){}
        }
        this._closeModal();
        this._toast("Deleted: " + (userLabel || name));
        await this._getLiveSnapshot();
        this._renderCurrentView();
      });
      actionsRow.appendChild(deleteBtn);
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
        const ageTxt = o.age_s != null ? fmtAgo(o.age_s) : "";
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
          (()=>{ const ss = scannerStatus(r, snap?.ble?.advertisements); const b = el("span",{class:ss.cls,title:ss.title},ss.label); if(ss.style) b.style.cssText+=ss.style; return b; })(),
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
    statusRow.appendChild(el("span", {class:"pill", style:"font-family:monospace;font-weight:700;font-size:13px;letter-spacing:.04em", title: name + " \u00b7 " + (scanner.source||"")}, sid));
    if(scanner.lost)     statusRow.appendChild(el("span", {class:"badge warn", style:"background:rgba(245,158,11,.18)"}, "⚠ Lost"));
    if(scanner.disabled) statusRow.appendChild(el("span", {class:"badge warn", style:"background:rgba(148,100,220,.18);color:#c084fc"}, "⊘ Disabled"));
    { const ss = scannerStatus(scanner, snap?.ble?.advertisements); const b = el("span",{class:ss.cls,title:ss.title},ss.label); if(ss.style) b.style.cssText+=ss.style; statusRow.appendChild(b); }
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
        const ageTxt = d.srcAge != null ? fmtAgo(d.srcAge) : "";
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

  _renderCurrentView(fromPoll){
    // Block ALL re-renders during factory reset — the progress UI must survive
    if(this.state._factoryResetInProgress) return;
    // Skip re-render during active drag to prevent DOM destruction mid-interaction
    if(this.state._calibTune?._dragging || this.state._calibBeacon?._dragging || this.state._calibTune?._confirming || this.state._calibBeacon?._confirming) return;
    // Skip re-render during active drag on 3D Stack alignment, Edit tab, or Trim tool
    if(this.state.maps?._stackDragging || this.state.maps?._editDragging) return;
    // Skip ALL re-renders while Point Align mode is active (side-by-side maps)
    if(this.state.maps?._ptAlign?.active) return;
    // Skip ALL re-renders while traceback tab is active (prevents flicker/DOM destruction)
    if(this.state._traceback?.active && this.state.view === "traceback") return;
    // Skip poll-triggered re-renders while on the maps upload/stack/edit tabs.
    // Upload: file input gets destroyed, loses selected file + kills file-picker dialog.
    // Stack: 3D alignment overlay has drag state that breaks on DOM rebuild.
    // Edit: receiver dragging and trim crop tool break on DOM rebuild.
    if(fromPoll && this.state.view === "maps" && (this.state.mapsTab === "upload" || this.state.mapsTab === "stack" || this.state.mapsTab === "edit")) return;
    // Skip poll-triggered re-renders when the user is actively interacting.
    // Checks: (1) a form element has focus, or (2) user interacted within the last 3s.
    // User-initiated renders (tab clicks, saves, etc.) always proceed.
    if(fromPoll){
      try {
        const active = (this.shadowRoot || this).querySelector(":focus");
        if(active){
          const tag = active.tagName;
          if(tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        }
      } catch(e) { /* ignore */ }
      if(this._lastUserInteraction && (performance.now() - this._lastUserInteraction) < 3000) return;
    }
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

      // If the view returned a cached DOM node already displayed in $content,
      // skip the destructive swap on poll renders to preserve scroll positions.
      // ONLY for views with 100% static content (ESPHome Configs YAML blocks).
      // Dynamic views (overview, follow, objects, etc.) MUST always swap so
      // updated object positions, RSSI values, and live data are displayed.
      const _staticViews = new Set(["esphome_configs"]);
      const _isStaticTab = v === "bluetooth" && this.state.btTab === "esphome_configs";
      if(fromPoll && _isStaticTab && node && node.parentNode === this.$content){
        this._lastGoodRender = performance.now();
        this._renderFailCount = 0;
        return;
      }

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
