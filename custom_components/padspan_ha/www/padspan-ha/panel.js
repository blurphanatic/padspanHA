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
      .btn, .nav button, select, input[type="text"] {
        width:100%; text-align:left; margin-top:8px; background:#1b2a46; color:#dce7ff;
        border:1px solid #37588f; border-radius:10px; padding:9px; cursor:pointer;
      }
      .btn.inline { width:auto; margin-top:0; }
      .nav button.active { outline:2px solid #7aa2ff; background:#20355b; }
      .grid { display:grid; grid-template-columns: repeat(auto-fill,minmax(220px,1fr)); gap:10px; }
      .card { background:#111a2d; border:1px solid var(--line); border-radius:12px; padding:12px; }
      .muted { color:#9cb1d3; font-size:12px; }
      .hidden{display:none;}
      .mono { white-space:pre-wrap; font-family: ui-monospace,SFMono-Regular,Consolas,monospace; background:#0d1628; border:1px solid var(--line); border-radius:12px; padding:12px; overflow:auto; }
      .rooms, .tags { max-height:420px; overflow:auto; background:#0d1628; border:1px solid var(--line); border-radius:12px; padding:8px; }
      .item { display:flex; gap:8px; align-items:center; padding:6px; border-radius:8px; }
      .kpi { font-size: 24px; font-weight: 700; margin-top: 4px; }
      .pill { display:inline-block; padding:2px 8px; border-radius:999px; border:1px solid #3b4f75; font-size:11px; margin-right:6px; margin-bottom:6px; }
      .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
      .kbd { padding:1px 6px; border:1px solid #506b9d; border-radius:6px; background:#16253f; font-size:11px; }

      .density-compact .left { --pad: 10px; }
      .density-dense .left { --pad: 8px; }
      .density-dense .btn, .density-dense .nav button, .density-dense select, .density-dense input[type="text"] { padding:7px; font-size:13px; }

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

        <div class="muted">v0.3.20 • single HA sidebar entry</div>
        <div class="muted" style="margin-top:6px">
          Keys: <span class="kbd">[</span> toggle • <span class="kbd">Shift+[</span> layout • <span class="kbd">Esc</span> close
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

        <div style="margin-top:12px;margin-bottom:8px" class="muted">Menu (inside this panel)</div>
        <div class="nav">
          <button data-v="overview"><span class="txt">Overview</span></button>
          <button data-v="objects"><span class="txt">Objects by Rooms</span></button>
          <button data-v="devices"><span class="txt">Devices / Objects</span></button>
          <button data-v="presence"><span class="txt">Presence</span></button>
          <button data-v="zones"><span class="txt">Zones</span></button>
          <button data-v="insights"><span class="txt">Insights</span></button>
          <button data-v="history"><span class="txt">History</span></button>
          <button data-v="monitor"><span class="txt">Monitor</span></button>
          <button data-v="events"><span class="txt">Events</span></button>
          <button data-v="health"><span class="txt">Health</span></button>
          <button data-v="settings"><span class="txt">Settings</span></button>
          <button data-v="debug"><span class="txt">Debug</span></button>
          <button data-v="diagnostics"><span class="txt">Diagnostics</span></button>
          <button data-v="qa"><span class="txt">QA</span></button>
          <button data-v="sandbox"><span class="txt">Sandbox</span></button>
        </div>
      </aside>

      <main class="main">
        <div class="row" style="margin-bottom:10px">
          <button class="btn inline" id="mobileMenu">☰ Menu</button>
          <button class="btn inline" id="refresh">Refresh</button>
          <button class="btn inline" id="autodiag">Run Auto Diagnostics</button>
          <span class="pill">Local-first (no API required)</span>
          <span class="pill" id="cloudBadge">Cloud disabled</span>
          <span class="pill" id="scanBadge">Scan: —</span>
        </div>

        <section id="overview">
          <div class="grid">
            <div class="card"><div class="muted">Status</div><div class="kpi" id="status">Loading…</div></div>
            <div class="card"><div class="muted">Rooms</div><div class="kpi" id="roomsKpi">—</div></div>
            <div class="card"><div class="muted">Objects (unique)</div><div class="kpi" id="objectsKpi">—</div></div>
            <div class="card"><div class="muted">Last Error</div><div id="error">—</div></div>
          </div>
          <div class="card" style="margin-top:10px">
            <div class="muted">Quick summary</div>
            <div id="summary"></div>
          </div>
        </section>

        <section id="objects" class="hidden">
          <div class="grid">
            <div class="card">
              <div class="muted">Select rooms</div>
              <div class="toolbar">
                <button class="btn" id="allRooms">All Rooms</button>
                <button class="btn" id="noneRooms">Clear</button>
              </div>
              <div id="rooms" class="rooms"></div>
            </div>
            <div class="card">
              <div class="muted">Object checklist from selected rooms</div>
              <div class="toolbar">
                <select id="mode" class="btn" style="max-width:420px">
                  <option value="all">Show tags in ALL selected rooms (intersection)</option>
                  <option value="any">Show tags in ANY selected room (union)</option>
                </select>
                <input id="tagFilter" type="text" placeholder="Filter tags… (e.g., keys)" />
              </div>
              <div id="tags" class="tags"></div>
            </div>
          </div>
        </section>

        <section id="devices" class="hidden">
          <div class="grid">
            <div class="card">
              <div class="muted">Objects grouped by room</div>
              <div id="roomObjects" class="mono">Loading…</div>
            </div>
            <div class="card">
              <div class="muted">Rooms by object</div>
              <div id="objectRooms" class="mono">Loading…</div>
            </div>
          </div>
        </section>

        <section id="presence" class="hidden">
          <div class="card">
            <div class="muted">Presence model (derived from object↔room sightings)</div>
            <div class="toolbar">
              <input id="presenceTag" type="text" placeholder="Enter object id (e.g., tag.keys)" />
              <button class="btn" id="presenceFind">Find</button>
            </div>
            <div id="presenceOut" class="mono">Enter an object id to see which rooms it appears in.</div>
          </div>
        </section>

        <section id="zones" class="hidden">
          <div class="card">
            <div class="muted">Zones (rooms)</div>
            <div id="zonesOut" class="mono">Loading…</div>
          </div>
        </section>

        <section id="insights" class="hidden">
          <div class="grid">
            <div class="card"><div class="muted">Top objects (by room count)</div><div id="topObjects" class="mono">Loading…</div></div>
            <div class="card"><div class="muted">Room density</div><div id="roomDensity" class="mono">Loading…</div></div>
          </div>
        </section>

        <section id="history" class="hidden">
          <div class="card">
            <div class="muted">History (panel-side session)</div>
            <div id="historyOut" class="mono">No history yet.</div>
          </div>
        </section>

        <section id="monitor" class="hidden">
          <div class="grid">
            <div class="card"><div class="muted">Refresh timing</div><div id="monitorOut" class="mono">Loading…</div></div>
            <div class="card"><div class="muted">WebSocket calls</div><div id="wsOut" class="mono">Loading…</div></div>
          </div>
        </section>

        <section id="events" class="hidden">
          <div class="card">
            <div class="muted">Events (panel-side session log)</div>
            <div id="eventsOut" class="mono">No events yet.</div>
          </div>
        </section>

        <section id="health" class="hidden">
          <div class="grid">
            <div class="card"><div class="muted">Diagnostics summary</div><div id="healthSummary" class="mono">Loading…</div></div>
            <div class="card"><div class="muted">Recommendations</div><div id="healthRecs" class="mono">Loading…</div></div>
          </div>
        </section>

        <section id="settings" class="hidden">
          <div class="card">
            <div class="muted">Settings</div>
            <div class="mono">
              Configure scan interval via the integration's Configure/Options dialog.
              If that dialog errors, we’ll fix the options flow (this build targets that).
            </div>
            <div class="toolbar">
              <button class="btn" id="reload">Reload integration</button>
            </div>
          </div>
        </section>

        <section id="debug" class="hidden">
          <div class="card">
            <div class="muted">Debug</div>
            <pre id="debugOut" class="mono">Loading…</pre>
          </div>
        </section>

        <section id="diagnostics" class="hidden">
          <div class="card">
            <div class="muted">Auto diagnostics + selection state</div>
            <pre id="diag" class="mono">Loading…</pre>
          </div>
        </section>

        <section id="qa" class="hidden">
          <div class="card">
            <div class="muted">QA tools</div>
            <div class="toolbar">
              <button class="btn" id="injectSample">Inject sample data (panel-only)</button>
              <button class="btn" id="clearSample">Clear sample data</button>
            </div>
            <div id="qaOut" class="mono">Use this to test UI without backend changes.</div>
          </div>
        </section>

        <section id="sandbox" class="hidden">
          <div class="card">
            <div class="muted">Sandbox</div>
            <div class="mono">
              This is a safe playground. It doesn’t write back to HA.
              Use it for experimenting with tag naming conventions and room structures.
            </div>
            <div class="toolbar">
              <input id="newRoom" type="text" placeholder="Add room (e.g., Patio)" />
              <input id="newTag" type="text" placeholder="Add tag (e.g., tag.sunglasses)" />
              <button class="btn" id="addRoomTag">Add tag to room</button>
            </div>
            <pre id="sandboxOut" class="mono">Loading…</pre>
          </div>
        </section>

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
        this._history = [];
        this._events = [];
        this._wsCounts = {};
        this._timing = { lastRefreshMs: null, lastDiagMs: null };
        this._sandbox = null;
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

        this.$("#refresh").addEventListener("click", () => this._refreshAll(true));
        this.$("#autodiag").addEventListener("click", () => this._runAutoDiag(true));
        this.$("#mode").addEventListener("change", () => this._renderTags());
        this.$("#tagFilter").addEventListener("input", () => this._renderTags());

        this.$("#allRooms").addEventListener("click", () => {
          Object.keys(this._roomTagMap).forEach((r) => this._selected.add(r));
          this._renderRooms(); this._renderTags(); this._renderDiag();
        });
        this.$("#noneRooms").addEventListener("click", () => {
          this._selected.clear();
          this._renderRooms(); this._renderTags(); this._renderDiag();
        });

        this.$("#presenceFind").addEventListener("click", () => this._presenceLookup());
        this.$("#reload").addEventListener("click", () => this._reloadIntegration());

        this.$("#injectSample").addEventListener("click", () => this._injectSample());
        this.$("#clearSample").addEventListener("click", () => this._clearSample());

        this.$("#addRoomTag").addEventListener("click", () => this._sandboxAdd());

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

      _log(kind, msg, data=null) {
        const entry = { t: new Date().toISOString(), kind, msg, data };
        this._events.unshift(entry);
        this._events = this._events.slice(0, 200);
        this._renderEvents();
      }

      _wsCount(type) {
        this._wsCounts[type] = (this._wsCounts[type] || 0) + 1;
        this._renderMonitor();
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
        app.classList.remove("overlay","inset");
        if (layout !== "fixed") app.classList.add(layout);

        if (collapsed) this._toggleSidebar(false);
      }

      _toggleSidebar(save=true) {
        const app = this.$("#app");
        app.classList.toggle("mini");
        if (save) this._storageSet("collapsed", app.classList.contains("mini"));
      }

      _cycleLayout() {
        const app = this.$("#app");
        this._layoutIndex = (this._layoutIndex + 1) % this._layoutModes.length;
        const mode = this._layoutModes[this._layoutIndex];
        app.classList.remove("overlay","inset");
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
        const ids = ["overview","objects","devices","presence","zones","insights","history","monitor","events","health","settings","debug","diagnostics","qa","sandbox"];
        ids.forEach((id) => this.$("#" + id).classList.toggle("hidden", id !== view));
        // render on view
        if (view === "devices") this._renderDeviceViews();
        if (view === "zones") this._renderZones();
        if (view === "insights") this._renderInsights();
        if (view === "history") this._renderHistory();
        if (view === "monitor") this._renderMonitor();
        if (view === "events") this._renderEvents();
        if (view === "health") this._renderHealth();
        if (view === "sandbox") this._renderSandbox();
        if (view === "debug") this._renderDebug();
      }

      _setActive(view) {
        this.$$(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.v === view));
      }

      _esc(v) {
        return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
      }

      _rooms() { return Object.keys(this._roomTagMap || {}).sort(); }
      _allTagsSet() {
        const s = new Set();
        for (const r of this._rooms()) for (const t of (this._roomTagMap[r] || [])) s.add(String(t));
        return s;
      }
      _tagToRooms() {
        const m = {};
        for (const r of this._rooms()) {
          for (const t of (this._roomTagMap[r] || [])) {
            const key = String(t);
            m[key] = m[key] || [];
            m[key].push(r);
          }
        }
        for (const k of Object.keys(m)) m[k].sort();
        return m;
      }

      async _refreshAll(userAction=false) {
        if (!this._hass || !this.shadowRoot) return;
        const t0 = performance.now();
        if (userAction) this._log("action","Refresh requested");
        await Promise.all([this._getStatus(), this._getRoomTags(), this._runAutoDiag(false)]);
        this._timing.lastRefreshMs = Math.round(performance.now() - t0);
        this._history.unshift({ t: new Date().toISOString(), status: this._status, rooms: this._rooms().length, tags: this._allTagsSet().size });
        this._history = this._history.slice(0, 200);
        this._renderOverview();
        this._renderMonitor();
      }

      async _getStatus() {
        this._wsCount("padspan_ha/status");
        try {
          const res = await this._hass.callWS({ type: "padspan_ha/status" });
          this._status = (res.entries || [])[0] || {};
        } catch (e) {
          this._status = { status: "panel_error", last_error: String(e) };
          this._log("error","Status WS failed", { error: String(e) });
        }
        const cloudBadge = this.$("#cloudBadge");
        if (this._status.cloud_enabled) {
          cloudBadge.textContent = this._status.cloud_reachable ? "Cloud connected" : "Cloud degraded";
        } else {
          cloudBadge.textContent = "Cloud disabled";
        }
      }

      async _getRoomTags() {
        this._wsCount("padspan_ha/room_tags");
        try {
          const res = await this._hass.callWS({ type: "padspan_ha/room_tags" });
          this._roomTagMap = (this._sandbox || res.room_tag_map || {});
          if (!this._selected.size) this._rooms().forEach((r) => this._selected.add(r));
          this._renderRooms();
          this._renderTags();
        } catch (e) {
          this._roomTagMap = {};
          this.$("#rooms").innerHTML = `<div class="item">${this._esc(e)}</div>`;
          this._log("error","room_tags WS failed", { error: String(e) });
        }
      }

      async _runAutoDiag(userAction=false) {
        this._wsCount("padspan_ha/auto_diagnostics");
        const t0 = performance.now();
        if (userAction) this._log("action","Auto diagnostics requested");
        try {
          this._diag = await this._hass.callWS({ type: "padspan_ha/auto_diagnostics" });
        } catch (e) {
          this._diag = { error: String(e) };
          this._log("error","auto_diagnostics WS failed", { error: String(e) });
        }
        this._timing.lastDiagMs = Math.round(performance.now() - t0);
        this._renderDiag();
        this._renderHealth();
      }

      async _reloadIntegration() {
        try {
          // nothing direct to call; instruct user to reload from Integrations if needed
          this._log("info","Requested reload. Use Settings → Devices & Services → PadSpan HA → Reload if needed.");
        } catch (e) {
          this._log("error","Reload request failed", { error: String(e) });
        }
      }

      _renderOverview() {
        const rooms = this._rooms().length;
        const tags = this._allTagsSet().size;
        this.$("#status").textContent = this._status.status || "unknown";
        this.$("#roomsKpi").textContent = String(rooms);
        this.$("#objectsKpi").textContent = String(tags);
        this.$("#error").textContent = this._status.last_error || "—";
        const scan = this._status.scan_interval || "—";
        this.$("#scanBadge").textContent = `Scan: ${scan}`;

        const sampleRooms = this._rooms().slice(0, 5).map(r => this._esc(r)).join(", ");
        const sampleTags = [...this._allTagsSet()].slice(0, 8).map(t => `<span class="pill">${this._esc(t)}</span>`).join(" ");
        this.$("#summary").innerHTML = `
          <div class="muted">Rooms: ${rooms}${rooms ? ` (e.g., ${sampleRooms}${rooms>5?"…":""})` : ""}</div>
          <div style="margin-top:8px">${sampleTags || "<span class='muted'>No tags yet.</span>"}</div>
        `;
      }

      _renderRooms() {
        const wrap = this.$("#rooms");
        const rooms = this._rooms();
        if (!rooms.length) { wrap.innerHTML = `<div class="item">No room data yet.</div>`; return; }
        wrap.innerHTML = "";
        rooms.forEach((room) => {
          const count = (this._roomTagMap[room] || []).length;
          const row = document.createElement("label");
          row.className = "item";
          row.innerHTML = `<input type="checkbox" ${this._selected.has(room) ? "checked" : ""}>
                           <span>${this._esc(room)}</span>
                           <span class="muted">(${count})</span>`;
          row.querySelector("input").addEventListener("change", (e) => {
            if (e.target.checked) this._selected.add(room); else this._selected.delete(room);
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
        const q = (this.$("#tagFilter").value || "").trim().toLowerCase();
        const tags = this._computedTags().filter(t => !q || t.toLowerCase().includes(q));
        if (!tags.length) { wrap.innerHTML = `<div class="item">No tags match current selection.</div>`; return; }
        wrap.innerHTML = "";
        tags.forEach((tag) => {
          const row = document.createElement("label");
          row.className = "item";
          row.innerHTML = `<input type="checkbox"><span>${this._esc(tag)}</span>`;
          wrap.appendChild(row);
        });
      }

      _renderDeviceViews() {
        const roomLines = {};
        for (const r of this._rooms()) roomLines[r] = (this._roomTagMap[r]||[]).slice().sort();

        const a = Object.entries(roomLines).map(([r,t]) => `${r}:
  - ${t.join("
  - ")}`).join("

");
        this.$("#roomObjects").textContent = a || "No data.";

        const tagRooms = this._tagToRooms();
        const b = Object.keys(tagRooms).sort().map(t => `${t}: ${tagRooms[t].join(", ")}`).join("
");
        this.$("#objectRooms").textContent = b || "No data.";
      }

      _presenceLookup() {
        const id = (this.$("#presenceTag").value || "").trim();
        if (!id) { this.$("#presenceOut").textContent = "Enter an object id first."; return; }
        const tagRooms = this._tagToRooms();
        const rooms = tagRooms[id] || [];
        if (!rooms.length) {
          this.$("#presenceOut").textContent = `No sightings for ${id}.`;
          return;
        }
        this.$("#presenceOut").textContent = `Object: ${id}
Seen in rooms:
- ` + rooms.join("
- ");
      }

      _renderZones() {
        const lines = this._rooms().map(r => `- ${r} (${(this._roomTagMap[r]||[]).length} objects)`).join("
");
        this.$("#zonesOut").textContent = lines || "No zones yet.";
      }

      _renderInsights() {
        const tagRooms = this._tagToRooms();
        const top = Object.keys(tagRooms)
          .map(t => ({ t, n: tagRooms[t].length }))
          .sort((a,b)=>b.n-a.n || a.t.localeCompare(b.t))
          .slice(0, 25)
          .map(x => `${x.t}  •  rooms: ${x.n}`)
          .join("
");
        this.$("#topObjects").textContent = top || "No insights yet.";

        const dens = this._rooms()
          .map(r => ({ r, n: (this._roomTagMap[r]||[]).length }))
          .sort((a,b)=>b.n-a.n || a.r.localeCompare(b.r))
          .map(x => `${x.r}  •  objects: ${x.n}`)
          .join("
");
        this.$("#roomDensity").textContent = dens || "No insights yet.";
      }

      _renderHistory() {
        if (!this._history.length) { this.$("#historyOut").textContent = "No history yet."; return; }
        const lines = this._history.slice(0, 50).map(h => `${h.t}  •  rooms=${h.rooms} tags=${h.tags} status=${h.status.status||"?"}`).join("
");
        this.$("#historyOut").textContent = lines;
      }

      _renderMonitor() {
        const t = this._timing;
        this.$("#monitorOut").textContent = `Last refresh: ${t.lastRefreshMs ?? "—"} ms
Last diagnostics: ${t.lastDiagMs ?? "—"} ms`;
        const ws = Object.keys(this._wsCounts).sort().map(k => `${k}: ${this._wsCounts[k]}`).join("
");
        this.$("#wsOut").textContent = ws || "No WS calls yet.";
      }

      _renderEvents() {
        const lines = this._events.slice(0, 80).map(e => `${e.t}  [${e.kind}]  ${e.msg}${e.data ? "  " + JSON.stringify(e.data) : ""}`).join("
");
        this.$("#eventsOut").textContent = lines || "No events yet.";
      }

      _renderHealth() {
        if (!this._diag || this._diag.error) {
          this.$("#healthSummary").textContent = this._diag?.error ? `Error: ${this._diag.error}` : "Loading…";
          this.$("#healthRecs").textContent = "—";
          return;
        }
        const s = this._diag.summary || {};
        const lines = [
          `Version: ${this._diag.version || "—"}`,
          `Checks: ${s.passed ?? 0} passed / ${s.failed ?? 0} failed (total ${s.total ?? 0})`,
          "",
          "Checks:",
          ...(this._diag.checks || []).map(c => `- ${c.name}: ${c.ok ? "OK" : "FAIL"}  •  ${c.detail}`)
        ].join("
");
        this.$("#healthSummary").textContent = lines;

        const recs = (this._diag.recommendations || []).map(r => `- ${r}`).join("
");
        this.$("#healthRecs").textContent = recs || "No recommendations.";
      }

      _renderDebug() {
        const payload = {
          status: this._status,
          room_tag_map: this._roomTagMap,
          selected_rooms: [...this._selected].sort(),
          computed_tags: this._computedTags(),
          ws_counts: this._wsCounts,
          timing: this._timing,
          diag: this._diag,
        };
        this.$("#debugOut").textContent = JSON.stringify(payload, null, 2);
      }

      _renderDiag() {
        const payload = {
          panel_time: new Date().toISOString(),
          status: this._status,
          selected_rooms: [...this._selected].sort(),
          room_count: this._rooms().length,
          mode: this.$("#mode") ? this.$("#mode").value : "all",
          room_tag_map: this._roomTagMap,
          computed_tags: this._computedTags(),
          auto_diagnostics: this._diag,
        };
        this.$("#diag").textContent = JSON.stringify(payload, null, 2);
      }

      _injectSample() {
        this._sandbox = {
          "Kitchen": ["tag.keys","tag.wallet","tag.phone_anna","tag.dog_collar","tag.spoon"],
          "Living Room": ["tag.remote","tag.phone_anna","tag.tablet","tag.keys"],
          "Garage": ["tag.bike","tag.toolbox","tag.keys","tag.car_fob","tag.gloves"],
          "Primary Bedroom": ["tag.watch","tag.phone_garry","tag.tablet","tag.book"],
          "Office": ["tag.laptop","tag.headset","tag.phone_garry","tag.keys","tag.mouse"],
          "Entry": ["tag.keys","tag.mailbag","tag.car_fob","tag.jacket"],
          "Patio": ["tag.sunglasses","tag.keys"],
        };
        this._log("info","Injected sample data (panel-only)");
        this._getRoomTags();
        this._renderSandbox();
        this.$("#qaOut").textContent = "Sample data injected (panel-only).";
      }

      _clearSample() {
        this._sandbox = null;
        this._log("info","Cleared sample data");
        this._getRoomTags();
        this._renderSandbox();
        this.$("#qaOut").textContent = "Sample data cleared.";
      }

      _renderSandbox() {
        const data = this._sandbox || this._roomTagMap || {};
        this.$("#sandboxOut").textContent = JSON.stringify(data, null, 2);
      }

      _sandboxAdd() {
        const r = (this.$("#newRoom").value || "").trim();
        const t = (this.$("#newTag").value || "").trim();
        if (!r || !t) return;
        if (!this._sandbox) this._sandbox = JSON.parse(JSON.stringify(this._roomTagMap || {}));
        this._sandbox[r] = this._sandbox[r] || [];
        if (!this._sandbox[r].includes(t)) this._sandbox[r].push(t);
        this._log("info", "Sandbox add", { room: r, tag: t });
        this._getRoomTags();
        this._renderSandbox();
      }
    }

    if (!customElements.get("padspan-ha-panel")) {
      customElements.define("padspan-ha-panel", PadSpanHaPanel);
    }
