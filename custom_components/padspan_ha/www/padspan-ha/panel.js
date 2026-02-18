
import * as Overview from "./views/overview.js";
import * as Objects from "./views/objects.js";
import * as Devices from "./views/devices.js";
import * as Presence from "./views/presence.js";
import * as Zones from "./views/zones.js";
import * as Insights from "./views/insights.js";
import * as History from "./views/history.js";
import * as Monitor from "./views/monitor.js";
import * as Events from "./views/events.js";
import * as Health from "./views/health.js";
import * as Settings from "./views/settings.js";
import * as Debug from "./views/debug.js";
import * as Diagnostics from "./views/diagnostics.js";
import * as QA from "./views/qa.js";
import * as Sandbox from "./views/sandbox.js";
import * as Maps from "./views/maps.js";

const VIEWS = {
  overview: Overview,
  objects: Objects,
  devices: Devices,
  presence: Presence,
  zones: Zones,
  insights: Insights,
  history: History,
  monitor: Monitor,
  events: Events,
  health: Health,
  settings: Settings,
  debug: Debug,
  diagnostics: Diagnostics,
  qa: QA,
  sandbox: Sandbox,
  maps: Maps,
};

function esc(s){
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}
function el(tag, attrs={}, children=[]){
  const n=document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})) {
    if(k==="class") n.className=v;
    else if(k==="id") n.id=v;
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
function pill(text){ return el("span",{class:"pill"}, text); }

class PadSpanHaApp extends HTMLElement {
  constructor(){
    super();
    this._hass = null;

    this.state = {
      version: "0.3.23",
      view: "overview",
      status: {},
      roomTagMap: {},
      diag: null,
      selectedRooms: new Set(),
      mode: "all",
      tagFilter: "",
      history: [],
      events: [],
      wsCounts: {},
      timing: { lastRefreshMs: null, lastDiagMs: null },
      sandbox: null,
      maps: [],
      activeMapId: null,
      activeMap: null,
      mapUi: { zoom: 1, panX: 0, panY: 0, snap: false, showGrid: false },
      mapDraft: { receivers: [], calibration: { mode:"none", px_per_meter:null, reference_points: [] }, notes:"" },
    };
  }

  set hass(hass){
    this._hass = hass;
    this._refreshAll();
  }

  connectedCallback(){
    if(!this.shadowRoot) this.attachShadow({mode:"open"});
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="/padspan_ha_static/padspan-ha/styles.css?v=0.3.23">
      <div id="app" class="app">
        <aside class="left">
          <div class="brand">
            <img src="/padspan_ha_static/padspan-ha/assets/padspan-mark.svg" alt="PadSpan">
            <div class="label">PadSpan HA</div>
          </div>
          <div class="muted">v0.3.23 • local-first</div>

          <div class="toolbar" style="margin-top:10px">
            <button class="btn inline" id="mobileMenu">☰ Menu</button>
            <button class="btn inline" id="refresh">Refresh</button>
            <button class="btn inline" id="autodiag">Run Auto Diagnostics</button>
            <button class="btn inline" id="toggleSide">Toggle</button>
          </div>

          <div style="margin-top:12px;margin-bottom:8px" class="muted">Menu (inside this panel)</div>
          <div class="nav" id="nav"></div>
        </aside>
        <main class="main">
          <div class="row" style="margin-bottom:10px">
            <span class="pill" id="cloudBadge">Cloud disabled</span>
            <span class="pill" id="scanBadge">Scan: —</span>
            <span class="pill" id="statusBadge">Status: —</span>
          </div>
          <div id="content"></div>
        </main>
      </div>
    `;

    this.$ = (q)=>this.shadowRoot.querySelector(q);
    this.$nav = this.$("#nav");
    this.$content = this.$("#content");

    this.$("#refresh").addEventListener("click", ()=>this._refreshAll(true));
    this.$("#autodiag").addEventListener("click", ()=>this._runAutoDiag(true));
    this.$("#toggleSide").addEventListener("click", ()=>this.$("#app").classList.toggle("mini"));
    this.$("#mobileMenu").addEventListener("click", ()=>this.$("#app").classList.toggle("mobile-open"));

    this._renderNav();
    this._renderAllViews();
    this.mapsRefresh().then(()=>this._renderAllViews());
  }

  _wsCount(type){
    this.state.wsCounts[type] = (this.state.wsCounts[type]||0)+1;
  }

  async _callWS(payload){
    this._wsCount(payload.type);
    return await this._hass.callWS(payload);
  }

async _apiJson(method, path, body=null){
  if (this._hass?.callApi){
    return await this._hass.callApi(method, path, body || undefined);
  }
  if (this._hass?.fetchWithAuth){
    const res = await this._hass.fetchWithAuth(path, {
      method,
      headers: {"Content-Type":"application/json"},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return await res.json();
  }
  throw new Error("No callApi/fetchWithAuth available on hass");
}

async _apiBlob(path){
  if (this._hass?.fetchWithAuth){
    const res = await this._hass.fetchWithAuth(path, { method:"GET" });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return await res.blob();
  }
  throw new Error("fetchWithAuth not available");
}

async _downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

async mapsRefresh(){
  try{
    const res = await this._callWS({ type:"padspan_ha/maps_list" });
    this.state.maps = res.maps || [];
    if (this.state.activeMapId){
      const m = this.state.maps.find(x=>x.id===this.state.activeMapId);
      if (!m) { this.state.activeMapId = null; this.state.activeMap = null; }
    }
    this._log("info","Maps refreshed",{count:this.state.maps.length});
  } catch(e){
    this._log("error","Maps refresh failed",{error:String(e)});
  }
}

async mapsSelect(mapId){
  this.state.activeMapId = mapId;
  try{
    const res = await this._callWS({ type:"padspan_ha/maps_get_meta", map_id: mapId });
    this.state.activeMap = res.map || null;
    this.state.mapDraft = {
      receivers: (this.state.activeMap?.receivers || []).map(r=>({...r})),
      calibration: this.state.activeMap?.calibration || { mode:"none", px_per_meter:null, reference_points: [] },
      notes: this.state.activeMap?.notes || "",
    };
    this._log("info","Map selected",{mapId});
  } catch(e){
    this._log("error","Map select failed",{error:String(e), mapId});
  }
  this._renderAllViews();
}

async mapsUpload(info){
  const created = await this._apiJson("POST", "/api/padspan_ha/maps", info);
  await this.mapsRefresh();
  await this.mapsSelect(created.id);
  return created;
}

async mapsDelete(mapId){
  await this._apiJson("DELETE", `/api/padspan_ha/maps/${mapId}`);
  await this.mapsRefresh();
  if (this.state.activeMapId === mapId){
    this.state.activeMapId = null;
    this.state.activeMap = null;
  }
  this._renderAllViews();
}

async mapsSaveMeta(mapId, meta){
  const res = await this._callWS({ type:"padspan_ha/maps_update_meta", map_id: mapId, meta });
  this.state.activeMap = res.map || this.state.activeMap;
  await this.mapsRefresh();
  this._renderAllViews();
  return res.map;
}

mapLocalImageUrl(map){
  const sha = map?.image?.sha256 ? map.image.sha256.slice(0,12) : "x";
  return `/local/padspan_ha/maps/${map?.id}.png?v=${sha}`;
}

async mapsDownloadPng(map){
  const blob = await this._apiBlob(`/api/padspan_ha/maps/${map.id}/file`);
  await this._downloadBlob(blob, `${map.name || map.id}.png`);
}

async mapsDownloadJson(map){
  const blob = new Blob([JSON.stringify(map, null, 2)], { type:"application/json" });
  await this._downloadBlob(blob, `${map.name || map.id}.json`);
}

  async _refreshAll(userAction=false){
    if(!this._hass || !this.shadowRoot) return;
    const t0 = performance.now();
    if(userAction) this._log("action","Refresh requested");
    await Promise.all([this._getStatus(), this._getRoomTags(), this._runAutoDiag(false)]);
    this.state.timing.lastRefreshMs = Math.round(performance.now() - t0);
    this.state.history.unshift({ t:new Date().toISOString(), rooms:Object.keys(this.state.roomTagMap||{}).length });
    this.state.history = this.state.history.slice(0,200);
    this._updateBadges();
    this._renderAllViews();
  }

  _updateBadges(){
    const st=this.state.status||{};
    this.$("#cloudBadge").textContent = st.cloud_enabled ? (st.cloud_reachable ? "Cloud connected" : "Cloud degraded") : "Cloud disabled";
    this.$("#scanBadge").textContent = `Scan: ${st.scan_interval ?? "—"}`;
    this.$("#statusBadge").textContent = `Status: ${st.status ?? "—"}`;
  }

  _log(kind,msg,data=null){
    this.state.events.unshift({t:new Date().toISOString(), kind, msg, data});
    this.state.events = this.state.events.slice(0,200);
  }

  async _getStatus(){
    try {
      const res = await this._callWS({ type:"padspan_ha/status" });
      this.state.status = (res.entries||[])[0] || {};
    } catch(e) {
      this.state.status = { status:"panel_error", last_error:String(e) };
      this._log("error","Status WS failed", {error:String(e)});
    }
  }

  async _getRoomTags(){
    try {
      const res = await this._callWS({ type:"padspan_ha/room_tags" });
      this.state.roomTagMap = res.room_tag_map || {};
      const rooms = Object.keys(this.state.roomTagMap||{});
      if(!this.state.selectedRooms.size) rooms.forEach(r=>this.state.selectedRooms.add(r));
    } catch(e) {
      this.state.roomTagMap = {};
      this._log("error","room_tags WS failed", {error:String(e)});
    }
  }

  async _runAutoDiag(userAction=false){
    const t0 = performance.now();
    try {
      this.state.diag = await this._callWS({ type:"padspan_ha/auto_diagnostics" });
      if(userAction) this._log("action","Auto diagnostics run");
    } catch(e) {
      this.state.diag = { error:String(e) };
      this._log("error","auto_diagnostics WS failed", {error:String(e)});
    }
    this.state.timing.lastDiagMs = Math.round(performance.now() - t0);
  }

  _renderNav(){
    const items = [
      ["overview","Overview"],
      ["objects","Objects by Rooms"],
      ["maps","Maps"],
      ["devices","Devices / Objects"],
      ["presence","Presence"],
      ["zones","Zones"],
      ["insights","Insights"],
      ["history","History"],
      ["monitor","Monitor"],
      ["events","Events"],
      ["health","Health"],
      ["settings","Settings"],
      ["debug","Debug"],
      ["diagnostics","Diagnostics"],
      ["qa","QA"],
      ["sandbox","Sandbox"],
    ];
    this.$nav.innerHTML = "";
    for(const [id,label] of items){
      const b = document.createElement("button");
      b.dataset.v = id;
      b.textContent = label;
      b.addEventListener("click", ()=>{ 
        this.state.view=id; 
        this._renderAllViews(); 
        this._setActiveNav(); 
        if(window.matchMedia("(max-width:1100px)").matches) this.$("#app").classList.remove("mobile-open"); 
      });
      this.$nav.appendChild(b);
    }
    this._setActiveNav();
  }

  _setActiveNav(){
    [...this.$nav.querySelectorAll("button")].forEach(b=>b.classList.toggle("active", b.dataset.v===this.state.view));
  }

  _helpers(){
    return { el, esc, pill };
  }

  actions(){
    return {
      renderTags: (forcedWrap=null)=>this._renderTags(forcedWrap),
      renderRooms: ()=>this._renderAllViews(),
      renderDiag: ()=>this._updateDiagnosticsBlocks(),
    };
  }

  _computedTags(){
    const selectedRooms = [...this.state.selectedRooms];
    const roomTagMap = this.state.roomTagMap || {};
    const mode = this.state.mode || "all";
    const arrays = selectedRooms.map(r => (roomTagMap[r]||[]).map(String));
    if(!arrays.length) return [];
    if(mode==="all"){
      let inter = new Set(arrays[0]||[]);
      for(let i=1;i<arrays.length;i++){ const s=new Set(arrays[i]); inter = new Set([...inter].filter(x=>s.has(x))); }
      return [...inter].sort((a,b)=>a.localeCompare(b));
    }
    const u=new Set(); arrays.forEach(arr=>arr.forEach(t=>u.add(t)));
    return [...u].sort((a,b)=>a.localeCompare(b));
  }

  _renderTags(forcedWrap=null){
    const wrap = forcedWrap || this.shadowRoot.getElementById("tags");
    if(!wrap) return;
    const q = (this.state.tagFilter||"").trim().toLowerCase();
    const tags = this._computedTags().filter(t=>!q || t.toLowerCase().includes(q));
    wrap.innerHTML = "";
    if(!tags.length){ wrap.appendChild(el("div",{class:"item"},"No tags match current selection.")); return; }
    for(const tag of tags){
      const row = el("label",{class:"item"});
      row.appendChild(el("input",{type:"checkbox"}));
      row.appendChild(el("span",{}, esc(tag)));
      wrap.appendChild(row);
    }
  }

  _updateDiagnosticsBlocks(){
    const diagBlock = this.shadowRoot.getElementById("diagOut");
    const dbgBlock = this.shadowRoot.getElementById("debugOut");
    const mon = this.shadowRoot.getElementById("monitorOut");
    const ws = this.shadowRoot.getElementById("wsOut");
    const ev = this.shadowRoot.getElementById("eventsOut");
    const hist = this.shadowRoot.getElementById("historyOut");
    const sb = this.shadowRoot.getElementById("sandboxOut");

    const payload = {
      version: this.state.version,
      time: new Date().toISOString(),
      view: this.state.view,
      status: this.state.status,
      room_tag_map: this.state.roomTagMap,
      selected_rooms: [...this.state.selectedRooms].sort(),
      mode: this.state.mode,
      tag_filter: this.state.tagFilter,
      computed_tags: this._computedTags(),
      diag: this.state.diag,
      ws_counts: this.state.wsCounts,
      timing: this.state.timing,
      events: this.state.events.slice(0,50),
      history: this.state.history.slice(0,50),
    };

    if(diagBlock) diagBlock.textContent = JSON.stringify(payload, null, 2);
    if(dbgBlock) dbgBlock.textContent = JSON.stringify(payload, null, 2);

    if(mon) mon.textContent = `Last refresh: ${this.state.timing.lastRefreshMs ?? "—"} ms\nLast diagnostics: ${this.state.timing.lastDiagMs ?? "—"} ms`;
    if(ws) ws.textContent = Object.keys(this.state.wsCounts).sort().map(k=>`${k}: ${this.state.wsCounts[k]}`).join("\n") || "No WS calls yet.";
    if(ev) ev.textContent = this.state.events.slice(0,80).map(e=>`${e.t} [${e.kind}] ${e.msg}${e.data ? " "+JSON.stringify(e.data) : ""}`).join("\n") || "No events yet.";
    if(hist) hist.textContent = this.state.history.slice(0,50).map(h=>`${h.t}  •  rooms=${h.rooms}`).join("\n") || "No history yet.";
    if(sb) sb.textContent = JSON.stringify(this.state.roomTagMap||{}, null, 2);
  }

  _renderAllViews(){
    if(!this.$content) return;
    this.$content.innerHTML = "";

    const ctx = {
      root: this.$content,
      host: this,
      state: this.state,
      helpers: this._helpers(),
      actions: this.actions(),
    };

    for(const key of Object.keys(VIEWS)){
      const mod = VIEWS[key];
      const node = mod.render(ctx);
      this.$content.appendChild(node);
    }

    // keep badges + diagnostics blocks up to date
    this._updateBadges();
    this._updateDiagnosticsBlocks();
    this._setActiveNav();
  }
}

if(!customElements.get("padspan-ha-app")){
  customElements.define("padspan-ha-app", PadSpanHaApp);
}
