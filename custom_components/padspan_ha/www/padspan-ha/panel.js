const tpl = document.createElement("template");
tpl.innerHTML = `
<style>
  :host { display:block; min-height:100vh; color:#e2e8f0; --bg:#0b1220; --panel:#111a2d; --line:#24324b; font-family:Inter,system-ui,Arial,sans-serif; }
  .app { display:grid; grid-template-columns:280px 1fr; min-height:100vh; background:var(--bg); }
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
  .rooms, .tags { max-height:360px; overflow:auto; background:#0d1628; border:1px solid var(--line); border-radius:12px; padding:8px; }
  .item { display:flex; gap:8px; align-items:center; padding:6px; border-radius:8px; }
  @media(max-width:1000px){ .app{grid-template-columns:1fr;} .left{border-right:none;border-bottom:1px solid var(--line);} }
</style>
<div class="app">
  <aside class="left">
    <div class="brand">
      <img src="/padspan_ha_static/padspan-ha/assets/padspan-mark.svg" alt="">
      <div>PadSpan</div>
    </div>
    <div class="muted">v0.3.12 • local-first</div>
    <div class="nav">
      <button data-v="overview">Overview</button>
      <button data-v="objects">Objects by Rooms</button>
      <button data-v="diagnostics">Diagnostics</button>
    </div>
  </aside>
  <main class="main">
    <div class="toolbar">
      <button class="btn" id="refresh">Refresh</button>
      <button class="btn" id="reconnect">Reconnect cloud now</button>
      <button class="btn" id="autodiag">Run auto diagnostics</button>
    </div>

    <section id="overview">
      <div class="grid">
        <div class="card"><div class="muted">Status</div><div id="status">Loading…</div></div>
        <div class="card"><div class="muted">Cloud Reachable</div><div id="cloud">—</div></div>
        <div class="card"><div class="muted">Cloud Devices</div><div id="devices">—</div></div>
        <div class="card"><div class="muted">Last Error</div><div id="error">—</div></div>
      </div>
    </section>

    <section id="objects" class="hidden">
      <div class="grid">
        <div class="card">
          <div class="muted">Rooms</div>
          <div class="toolbar"><button class="btn" id="allRooms">All</button><button class="btn" id="noneRooms">None</button></div>
          <div id="rooms" class="rooms"></div>
        </div>
        <div class="card">
          <div class="muted">Object tags seen in selected rooms</div>
          <div class="toolbar">
            <select id="mode" class="btn" style="max-width:260px">
              <option value="all">ALL selected rooms</option>
              <option value="any">ANY selected room</option>
            </select>
          </div>
          <div id="tags" class="tags"></div>
        </div>
      </div>
    </section>

    <section id="diagnostics" class="hidden">
      <div class="card">
        <div class="muted">Auto diagnostics payload</div>
        <pre id="diag" class="diag">Loading…</pre>
      </div>
    </section>
  </main>
</div>
`;

class PadSpanPanel extends HTMLElement {
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
    this.shadowRoot.appendChild(tpl.content.cloneNode(true));
    this.$ = (s) => this.shadowRoot.querySelector(s);
    this.$$ = (s) => [...this.shadowRoot.querySelectorAll(s)];

    this.$$("#overview, #objects, #diagnostics");

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
    this.$("#overview").classList.toggle("hidden", view !== "overview");
    this.$("#objects").classList.toggle("hidden", view !== "objects");
    this.$("#diagnostics").classList.toggle("hidden", view !== "diagnostics");
  }

  _esc(v) {
    return String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  async _refreshAll() {
    if (!this._hass || !this.shadowRoot) return;
    await Promise.all([this._getStatus(), this._getRoomTags(), this._runAutoDiag()]);
  }

  async _reconnect() {
    try {
      await this._hass.callWS({ type: "padspan_ha/refresh" });
    } catch (e) {}
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
      if (this._selected.size === 0) Object.keys(this._roomTagMap).forEach((r) => this._selected.add(r));
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
      wrap.innerHTML = `<div class="item">No rooms available yet.</div>`;
      return;
    }
    wrap.innerHTML = "";
    rooms.forEach((room) => {
      const row = document.createElement("label");
      row.className = "item";
      const count = (this._roomTagMap[room] || []).length;
      row.innerHTML = `<input type="checkbox" ${this._selected.has(room) ? "checked" : ""} /><span>${this._esc(room)}</span><span class="muted">(${count})</span>`;
      row.querySelector("input").addEventListener("change", (e) => {
        if (e.target.checked) this._selected.add(room);
        else this._selected.delete(room);
        this._renderTags();
        this._renderDiag();
      });
      wrap.appendChild(row);
    });
  }

  _computeTags() {
    const selected = [...this._selected];
    const mode = this.$("#mode").value;
    if (!selected.length) return [];
    const arrays = selected.map((r) => (this._roomTagMap[r] || []).map(String));

    if (mode === "all") {
      let inter = new Set(arrays[0] || []);
      for (let i = 1; i < arrays.length; i++) {
        const s = new Set(arrays[i]);
        inter = new Set([...inter].filter((x) => s.has(x)));
      }
      return [...inter].sort((a, b) => a.localeCompare(b));
    }

    const union = new Set();
    arrays.forEach((arr) => arr.forEach((t) => union.add(t)));
    return [...union].sort((a, b) => a.localeCompare(b));
  }

  _renderTags() {
    const wrap = this.$("#tags");
    const tags = this._computeTags();
    if (!tags.length) {
      wrap.innerHTML = `<div class="item">No tags match current selection.</div>`;
      return;
    }
    wrap.innerHTML = "";
    tags.forEach((tag) => {
      const row = document.createElement("label");
      row.className = "item";
      row.innerHTML = `<input type="checkbox" /><span>${this._esc(tag)}</span>`;
      wrap.appendChild(row);
    });
  }

  _renderDiag() {
    const payload = {
      panel_time: new Date().toISOString(),
      status: this._status,
      selected_rooms: [...this._selected].sort(),
      mode: this.$("#mode") ? this.$("#mode").value : "all",
      room_tag_map: this._roomTagMap,
      computed_tags: this._computeTags(),
      auto_diagnostics: this._diag,
    };
    this.$("#diag").textContent = JSON.stringify(payload, null, 2);
  }
}

customElements.define("padspan-ha-panel", PadSpanPanel);
