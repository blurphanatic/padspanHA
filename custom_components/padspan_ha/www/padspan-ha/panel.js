const template = document.createElement("template");
template.innerHTML = `
<style>
  :host {
    display:block; min-height:100vh; color:#e2e8f0;
    --bg:#0b1220; --panel:#111a2d; --line:#24324b; --text:#e2e8f0;
    --sidebar-w: 300px; --sidebar-mini: 92px;
    --pad: 14px;
    font-family: Inter, system-ui, Arial, sans-serif;
  }
  .app { display:grid; grid-template-columns: var(--sidebar-w) 1fr; min-height:100vh; background:var(--bg); }
  .app.mini { grid-template-columns: var(--sidebar-mini) 1fr; }
  .app.overlay .left { position: fixed; z-index: 12; left: 0; top: 0; bottom: 0; width: var(--sidebar-w); box-shadow: 0 8px 28px rgba(0,0,0,.35); }
  .app.overlay.closed .left { transform: translateX(-100%); transition: transform .2s ease; }
  .left {
    background:var(--panel); border-right:1px solid var(--line);
    padding:var(--pad); overflow:auto; transition: width .2s ease, transform .2s ease;
  }
  .left.glass { background: rgba(17,26,45,.8); backdrop-filter: blur(8px); }
  .left.segmented { border-right:0; box-shadow: inset -1px 0 0 var(--line); }
  .main { padding:16px; }
  .brand { display:flex; align-items:center; gap:10px; font-weight:700; margin-bottom:10px; }
  .brand img { width:30px; height:30px; border-radius:8px; }
  .mini .brand .label, .mini .muted, .mini .nav button span.txt, .mini .ctrl-inline { display:none; }
  .toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
  .btn, .nav button, select {
    width:100%; text-align:left; margin-top:8px; background:#1b2a46; color:#dce7ff;
    border:1px solid #37588f; border-radius:10px; padding:9px; cursor:pointer;
  }
  .btn.inline { width:auto; margin-top:0; }
  .nav button.active { outline:2px solid #7aa2ff; background:#20355b; }
  .grid { display:grid; grid-template-columns: repeat(auto-fill,minmax(220px,1fr)); gap:10px; }
  .card { background:#111a2d; border:1px solid var(--line); border-radius:12px; padding:12px; }
  .muted { color:#9cb1d3; font-size:12px; }
  .hidden{display:none;}
  .diag { white-space:pre-wrap; font-family: ui-monospace,SFMono-Regular,Consolas,monospace; background:#0d1628; border:1px solid var(--line); border-radius:12px; padding:12px; }
  .rooms, .tags { max-height:420px; overflow:auto; background:#0d1628; border:1px solid var(--line); border-radius:12px; padding:8px; }
  .item { display:flex; gap:8px; align-items:center; padding:6px; border-radius:8px; }
  .kpi { font-size: 24px; font-weight: 700; margin-top: 4px; }
  .pill { display:inline-block; padding:2px 8px; border-radius:999px; border:1px solid #3b4f75; font-size:11px; margin-right:6px; margin-bottom:6px; }

  .density-compact .left { --pad: 10px; }
  .density-dense .left { --pad: 8px; }
  .density-dense .btn, .density-dense .nav button, .density-dense select { padding:7px; font-size:13px; }

  .topline { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:8px; }
  .kbd { padding:1px 6px; border:1px solid #506b9d; border-radius:6px; background:#16253f; font-size:11px; }

  @media(max-width:1100px){
    .app{grid-template-columns:1fr;}
    .left{position:fixed;z-index:12;left:0;top:0;bottom:0;width:var(--sidebar-w);transform:translateX(-100%);}
    .app.mobile-open .left{transform:translateX(0);}
  }
</style>
<div id="app" class="app">
  <aside id="left" class="left">
    <div class="brand">
      <img src="/padspan_ha_static/padspan-ha/assets/padspan-mark.svg" alt="PadSpan">
      <div class="label">PadSpan HA</div>
    </div>

    <div class="muted">v0.3.19 • reconfigure + sidebar fix</div>
    <div class="muted" style="margin-top:6px">
      Keys: <span class="kbd">[</span> toggle • <span class="kbd">Shift+[</span> mode • <span class="kbd">Esc</span> close
    </div>

    <div class="toolbar ctrl-inline" style="margin-top:10px">
      <button class="btn inline" id="toggleSide">Toggle</button>
      <button class="btn inline" id="cycleLayout">Cycle Layout</button>
    </div>

    <div class="toolbar ctrl-inline">
      <select id="widthMode" class="btn inline" style="max-width:220px">
        <option value="full">Width: full</option>
        <option value="mini">Width: mini / rail</option>
      </select>
      <select id="density" class="btn inline" style="max-width:220px">
        <option value="cozy">Density: cozy</option>
        <option value="compact">Density: compact</option>
        <option value="dense">Density: dense</option>
      </select>
      <select id="surface" class="btn inline" style="max-width:220px">
        <option value="solid">Surface: solid</option>
        <option value="glass">Surface: glass</option>
        <option value="segmented">Surface: segmented</option>
      </select>
    </div>

    <div style="margin-top:12px;margin-bottom:8px" class="muted">Menu variations (testing)</div>
    <div class="nav">
      <button data-v="overview"><span class="txt">Overview</span></button>
      <button data-v="objects"><span class="txt">Objects by Rooms</span></button>
      <button data-v="diagnostics"><span class="txt">Diagnostics</span></button>
      <button data-v="live"><span class="txt">Live Map</span></button>
      <button data-v="events"><span class="txt">Events</span></button>
      <button data-v="health"><span class="txt">Health</span></button>
      <button data-v="debug"><span class="txt">Debug</span></button>
      <button data-v="qa"><span class="txt">QA</span></button>
      <button data-v="sandbox"><span class="txt">Sandbox</span></button>
      <button data-v="settings"><span class="txt">Settings</span></button>
      <button data-v="zones"><span class="txt">Zones</span></button>
      <button data-v="presence"><span class="txt">Presence</span></button>
      <button data-v="devices"><span class="txt">Devices</span></button>
      <button data-v="insights"><span class="txt">Insights</span></button>
      <button data-v="history"><span class="txt">History</span></button>
      <button data-v="monitor"><span class="txt">Monitor</span></button>
    </div>
  </aside>

  <main class="main">
    <div class="topline">
      <button class="btn inline" id="mobileMenu">☰ Menu</button>
      <button class="btn inline" id="refresh">Refresh</button>
      <button class="btn inline" id="autodiag">Run Auto Diagnostics</button>
      <span class="pill">Local-first (no API required)</span>
      <span class="pill" id="cloudBadge">Cloud disabled</span>
    </div>

    <section id="overview">
      <div class="grid">
        <div class="card"><div class="muted">Status</div><div class="kpi" id="status">Loading…</div></div>
        <div class="card"><div class="muted">Cloud Reachable</div><div class="kpi" id="cloud">—</div></div>
        <div class="card"><div class="muted">Cloud Devices</div><div class="kpi" id="devices">—</div></div>
        <div class="card"><div class="muted">Last Error</div><div id="error">—</div></div>
      </div>
    </section>

    <section id="objects" class="hidden">
      <div class="grid">
        <div class="card">
          <div class="muted">Select rooms (checkboxes)</div>
          <div class="toolbar">
            <button class="btn" id="allRooms">All Rooms</button>
            <button class="btn" id="noneRooms">Clear</button>
          </div>
          <div id="rooms" class="rooms"></div>
        </div>
        <div class="card">
          <div class="muted">Object checklist from selected rooms</div>
          <div class="toolbar">
            <select id="mode" class="btn" style="max-width:360px">
              <option value="all">Show tags in ALL selected rooms (intersection)</option>
              <option value="any">Show tags in ANY selected room (union)</option>
            </select>
          </div>
          <div id="tags" class="tags"></div>
        </div>
      </div>
    </section>

    <section id="diagnostics" class="hidden">
      <div class="card">
        <div class="muted">Auto diagnostics + selection state</div>
        <pre id="diag" class="diag">Loading…</pre>
      </div>
    </section>

    <section id="live" class="hidden"><div class="card"><div class="muted">Live Map</div><div>Preview mode ready.</div></div></section>
    <section id="events" class="hidden"><div class="card"><div class="muted">Events</div><div>Preview mode ready.</div></div></section>
    <section id="health" class="hidden"><div class="card"><div class="muted">Health</div><div>Preview mode ready.</div></div></section>
    <section id="debug" class="hidden"><div class="card"><div class="muted">Debug</div><div>Preview mode ready.</div></div></section>
    <section id="qa" class="hidden"><div class="card"><div class="muted">QA</div><div>Preview mode ready.</div></div></section>
    <section id="sandbox" class="hidden"><div class="card"><div class="muted">Sandbox</div><div>Preview mode ready.</div></div></section>
    <section id="settings" class="hidden"><div class="card"><div class="muted">Settings</div><div>Preview mode ready.</div></div></section>
    <section id="zones" class="hidden"><div class="card"><div class="muted">Zones</div><div>Preview mode ready.</div></div></section>
    <section id="presence" class="hidden"><div class="card"><div class="muted">Presence</div><div>Preview mode ready.</div></div></section>
    <section id="devices" class="hidden"><div class="card"><div class="muted">Devices</div><div>Preview mode ready.</div></div></section>
    <section id="insights" class="hidden"><div class="card"><div class="muted">Insights</div><div>Preview mode ready.</div></div></section>
    <section id="history" class="hidden"><div class="card"><div class="muted">History</div><div>Preview mode ready.</div></div></section>
    <section id="monitor" class="hidden"><div class="card"><div class="muted">Monitor</div><div>Preview mode ready.</div></div></section>
  </main>
</div>
`;

class PadSpanHaPanel extends HTMLElement {
  constructor() {
    super();
    this._roomTagMap = {};
    this._selected = new Set();
    this._status = {};
    this._diag = {};
    this._view = "overview";
    this._layoutModes = ["fixed", "overlay", "inset"];
    this._layoutIndex = 0;
  }

  set hass(hass) {
    this._hass = hass;
    this._refreshAll();
  }

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.appendChild(template.content.cloneNode(true));
    this.$ = (q) => this.shadowRoot.querySelector(q);
    this.$$ = (q) => [...this.shadowRoot.querySelectorAll(q)];

    this.$("#refresh").addEventListener("click", () => this._refreshAll());
    this.$("#autodiag").addEventListener("click", () => this._runAutoDiag());
    this.$("#mode").addEventListener("change", () => this._renderTags());

    this.$("#allRooms").addEventListener("click", () => {
      Object.keys(this._roomTagMap).forEach((r) => this._selected.add(r));
      this._renderRooms(); this._renderTags(); this._renderDiag();
    });
    this.$("#noneRooms").addEventListener("click", () => {
      this._selected.clear();
      this._renderRooms(); this._renderTags(); this._renderDiag();
    });

    this.$$(".nav button").forEach((b) =>
      b.addEventListener("click", () => {
        this._show(b.dataset.v);
        this._setActive(b.dataset.v);
        if (window.matchMedia("(max-width: 1100px)").matches) this.$("#app").classList.remove("mobile-open");
      })
    );
    this._setActive(this._view);

    this.$("#mobileMenu").addEventListener("click", () => this.$("#app").classList.toggle("mobile-open"));
    this.$("#toggleSide").addEventListener("click", () => this._toggleSidebar());
    this.$("#cycleLayout").addEventListener("click", () => this._cycleLayout());
    this.$("#widthMode").addEventListener("change", (e) => this._applyWidth(e.target.value));
    this.$("#density").addEventListener("change", (e) => this._applyDensity(e.target.value));
    this.$("#surface").addEventListener("change", (e) => this._applySurface(e.target.value));

    this._restoreSidebarState();
    this._bindKeys();
  }

  _bindKeys() {
    this._onKey = (e) => {
      if (e.key === "[") {
        if (e.shiftKey) this._cycleLayout();
        else this._toggleSidebar();
      }
      if (e.key === "Escape") this.$("#app").classList.remove("mobile-open");
    };
    window.addEventListener("keydown", this._onKey);
  }

  disconnectedCallback() {
    if (this._onKey) window.removeEventListener("keydown", this._onKey);
  }

  _storageSet(k,v){ try{ localStorage.setItem("padspan_ha_"+k, JSON.stringify(v)); }catch(e){} }
  _storageGet(k,d){ try{ const x=localStorage.getItem("padspan_ha_"+k); return x?JSON.parse(x):d; }catch(e){return d;} }

  _restoreSidebarState() {
    const app = this.$("#app");
    const width = this._storageGet("width","full");
    const dens = this._storageGet("density","cozy");
    const surf = this._storageGet("surface","solid");
    const layout = this._storageGet("layout","fixed");
    const collapsed = this._storageGet("collapsed", false);

    this.$("#widthMode").value = width;
    this.$("#density").value = dens;
    this.$("#surface").value = surf;

    this._applyWidth(width, false);
    this._applyDensity(dens, false);
    this._applySurface(surf, false);

    this._layoutIndex = Math.max(0, this._layoutModes.indexOf(layout));
    app.classList.remove("overlay","inset","closed");
    if (layout !== "fixed") app.classList.add(layout);

    if (collapsed) this._toggleSidebar(false);
  }

  _toggleSidebar(save=true) {
    const app = this.$("#app");
    app.classList.toggle("mini");
    app.classList.toggle("closed");
    if (save) this._storageSet("collapsed", app.classList.contains("mini") || app.classList.contains("closed"));
  }

  _cycleLayout() {
    const app = this.$("#app");
    this._layoutIndex = (this._layoutIndex + 1) % this._layoutModes.length;
    const mode = this._layoutModes[this._layoutIndex];
    app.classList.remove("overlay","inset","closed");
    if (mode !== "fixed") app.classList.add(mode);
    this._storageSet("layout", mode);
  }

  _applyWidth(mode, save=true) {
    const app = this.$("#app");
    app.classList.toggle("mini", mode === "mini");
    if (save) this._storageSet("width", mode);
  }

  _applyDensity(mode, save=true) {
    const app = this.$("#app");
    app.classList.remove("density-compact","density-dense");
    if (mode === "compact") app.classList.add("density-compact");
    if (mode === "dense") app.classList.add("density-dense");
    if (save) this._storageSet("density", mode);
  }

  _applySurface(mode, save=true) {
    const left = this.$("#left");
    left.classList.remove("glass","segmented");
    if (mode === "glass") left.classList.add("glass");
    if (mode === "segmented") left.classList.add("segmented");
    if (save) this._storageSet("surface", mode);
  }

  _show(view) {
    this._view = view;
    const ids = ["overview","objects","diagnostics","live","events","health","debug","qa","sandbox","settings","zones","presence","devices","insights","history","monitor"];
    ids.forEach((id) => this.$("#" + id).classList.toggle("hidden", id !== view));
  }

  _setActive(view) {
    this.$$(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.v === view));
  }

  _esc(v) {
    return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
  }

  async _refreshAll() {
    if (!this._hass || !this.shadowRoot) return;
    await Promise.all([this._getStatus(), this._getRoomTags(), this._runAutoDiag()]);
  }

  async _getStatus() {
    try {
      const res = await this._hass.callWS({ type: "padspan_ha/status" });
      this._status = (res.entries || [])[0] || {};
    } catch (e) {
      this._status = { status: "panel_error", last_error: String(e) };
    }
    this.$("#status").textContent = this._status.status || "unknown";
    this.$("#cloud").textContent = String(!!this._status.cloud_reachable);
    this.$("#devices").textContent = String(this._status.devices || 0);
    this.$("#error").textContent = this._status.last_error || "—";
    const cloudBadge = this.$("#cloudBadge");
    if (this._status.cloud_enabled) {
      cloudBadge.textContent = this._status.cloud_reachable ? "Cloud connected" : "Cloud degraded";
    } else {
      cloudBadge.textContent = "Cloud disabled";
    }
  }

  async _getRoomTags() {
    try {
      const res = await this._hass.callWS({ type: "padspan_ha/room_tags" });
      this._roomTagMap = res.room_tag_map || {};
      if (!this._selected.size) Object.keys(this._roomTagMap).forEach((r) => this._selected.add(r));
      this._renderRooms();
      this._renderTags();
    } catch (e) {
      this.$("#rooms").innerHTML = `<div class="item">${this._esc(e)}</div>`;
    }
  }

  async _runAutoDiag() {
    try {
      this._diag = await this._hass.callWS({ type: "padspan_ha/auto_diagnostics" });
    } catch (e) {
      this._diag = { error: String(e) };
    }
    this._renderDiag();
  }

  _renderRooms() {
    const wrap = this.$("#rooms");
    const rooms = Object.keys(this._roomTagMap).sort();
    if (!rooms.length) {
      wrap.innerHTML = `<div class="item">No room data yet.</div>`;
      return;
    }
    wrap.innerHTML = "";
    rooms.forEach((room) => {
      const count = (this._roomTagMap[room] || []).length;
      const row = document.createElement("label");
      row.className = "item";
      row.innerHTML = `<input type="checkbox" ${this._selected.has(room) ? "checked" : ""}>
                       <span>${this._esc(room)}</span>
                       <span class="muted">(${count})</span>`;
      row.querySelector("input").addEventListener("change", (e) => {
        if (e.target.checked) this._selected.add(room);
        else this._selected.delete(room);
        this._renderTags();
        this._renderDiag();
      });
      wrap.appendChild(row);
    });
  }

  _computedTags() {
    const selectedRooms = [...this._selected];
    const mode = this.$("#mode").value;
    if (!selectedRooms.length) return [];
    const arrays = selectedRooms.map((r) => (this._roomTagMap[r] || []).map(String));

    if (mode === "all") {
      let inter = new Set(arrays[0] || []);
      for (let i = 1; i < arrays.length; i++) {
        const s = new Set(arrays[i]);
        inter = new Set([...inter].filter((x) => s.has(x)));
      }
      return [...inter].sort((a,b)=>a.localeCompare(b));
    }

    const u = new Set();
    arrays.forEach((arr) => arr.forEach((t) => u.add(t)));
    return [...u].sort((a,b)=>a.localeCompare(b));
  }

  _renderTags() {
    const wrap = this.$("#tags");
    const tags = this._computedTags();
    if (!tags.length) {
      wrap.innerHTML = `<div class="item">No tags match current selection.</div>`;
      return;
    }
    wrap.innerHTML = "";
    tags.forEach((tag) => {
      const row = document.createElement("label");
      row.className = "item";
      row.innerHTML = `<input type="checkbox"><span>${this._esc(tag)}</span>`;
      wrap.appendChild(row);
    });
  }

  _renderDiag() {
    const payload = {
      panel_time: new Date().toISOString(),
      status: this._status,
      selected_rooms: [...this._selected].sort(),
      room_count: Object.keys(this._roomTagMap).length,
      mode: this.$("#mode") ? this.$("#mode").value : "all",
      sidebar: {
        layout: this._storageGet("layout","fixed"),
        width: this._storageGet("width","full"),
        density: this._storageGet("density","cozy"),
        surface: this._storageGet("surface","solid"),
        collapsed: this._storageGet("collapsed", false),
      },
      room_tag_map: this._roomTagMap,
      computed_tags: this._computedTags(),
      auto_diagnostics: this._diag
    };
    this.$("#diag").textContent = JSON.stringify(payload, null, 2);
  }
}

if (!customElements.get("padspan-ha-panel")) {
  customElements.define("padspan-ha-panel", PadSpanHaPanel);
}
