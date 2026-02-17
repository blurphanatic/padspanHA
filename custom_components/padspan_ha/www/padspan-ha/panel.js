const template = document.createElement("template");
template.innerHTML = `
<style>
  :host { display:block; min-height:100vh; color:#e2e8f0; --bg:#0b1220; --panel:#111a2d; --line:#24324b; font-family:Inter,system-ui,Arial,sans-serif; }
  .app { display:grid; grid-template-columns:300px 1fr; min-height:100vh; background:var(--bg); }
  .left { background:var(--panel); border-right:1px solid var(--line); padding:14px; overflow:auto; }
  .main { padding:16px; }
  .brand { display:flex; align-items:center; gap:10px; font-weight:700; margin-bottom:14px; }
  .brand img { width:30px; height:30px; border-radius:8px; }
  .nav button, .btn { width:100%; text-align:left; margin-top:8px; background:#1b2a46; color:#dce7ff; border:1px solid #37588f; border-radius:10px; padding:9px; cursor:pointer; }
  .grid { display:grid; grid-template-columns: repeat(auto-fill,minmax(220px,1fr)); gap:10px; }
  .card { background:#111a2d; border:1px solid var(--line); border-radius:12px; padding:12px; }
  .muted { color:#9cb1d3; font-size:12px; }
  .hidden{display:none;}
  .toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
  .diag { white-space:pre-wrap; font-family: ui-monospace,SFMono-Regular,Consolas,monospace; background:#0d1628; border:1px solid var(--line); border-radius:12px; padding:12px; }
  .rooms, .tags { max-height:420px; overflow:auto; background:#0d1628; border:1px solid var(--line); border-radius:12px; padding:8px; }
  .item { display:flex; gap:8px; align-items:center; padding:6px; border-radius:8px; }
  .kpi { font-size: 24px; font-weight: 700; margin-top: 4px; }
  .pill { display:inline-block; padding:2px 8px; border-radius:999px; border:1px solid #3b4f75; font-size:11px; margin-right:6px; margin-bottom:6px; }
  @media(max-width:1100px){ .app{grid-template-columns:1fr;} .left{border-right:none;border-bottom:1px solid var(--line);} }
</style>
<div class="app">
  <aside class="left">
    <div class="brand">
      <img src="/padspan_ha_static/padspan-ha/assets/padspan-mark.svg" alt="PadSpan">
      <div>PadSpan HA</div>
    </div>
    <div class="muted">v0.3.14 • full restore</div>

    <div style="margin-top:12px;margin-bottom:8px" class="muted">Menu variations (testing)</div>
    <div class="nav">
      <button data-v="overview">Overview</button>
      <button data-v="objects">Objects by Rooms</button>
      <button data-v="diagnostics">Diagnostics</button>
      <button data-v="live">Live Map (preview)</button>
      <button data-v="events">Events (preview)</button>
      <button data-v="health">Health (preview)</button>
      <button data-v="debug">Debug (preview)</button>
      <button data-v="qa">QA (preview)</button>
      <button data-v="sandbox">Sandbox (preview)</button>
      <button data-v="settings">Settings (preview)</button>
    </div>
  </aside>

  <main class="main">
    <div class="toolbar">
      <button class="btn" id="refresh">Refresh</button>
      <button class="btn" id="reconnect">Reconnect Cloud</button>
      <button class="btn" id="autodiag">Run Auto Diagnostics</button>
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
            <select id="mode" class="btn" style="max-width:300px">
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

    this.$$("#refresh, #reconnect, #autodiag");
    this.$("#refresh").addEventListener("click", () => this._refreshAll());
    this.$("#reconnect").addEventListener("click", () => this._reconnect());
    this.$("#autodiag").addEventListener("click", () => this._runAutoDiag());

    this.$("#mode").addEventListener("change", () => this._renderTags());

    this.$("#allRooms").addEventListener("click", () => {
      Object.keys(this._roomTagMap).forEach((r) => this._selected.add(r));
      this._renderRooms();
      this._renderTags();
      this._renderDiag();
    });
    this.$("#noneRooms").addEventListener("click", () => {
      this._selected.clear();
      this._renderRooms();
      this._renderTags();
      this._renderDiag();
    });

    this.$$(".nav button").forEach((b) => b.addEventListener("click", () => this._show(b.dataset.v)));
  }

  _show(view) {
    const ids = ["overview","objects","diagnostics","live","events","health","debug","qa","sandbox","settings"];
    ids.forEach((id) => this.$("#" + id).classList.toggle("hidden", id !== view));
  }

  _esc(v) {
    return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
  }

  async _refreshAll() {
    if (!this._hass || !this.shadowRoot) return;
    await Promise.all([this._getStatus(), this._getRoomTags(), this._runAutoDiag()]);
  }

  async _reconnect() {
    try { await this._hass.callWS({ type: "padspan_ha/refresh" }); } catch (e) {}
    await this._refreshAll();
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
