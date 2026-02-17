const template = document.createElement('template');
template.innerHTML = `
<style>
:host { display:block; height:100%; color:#e2e8f0; --bg:#0b1220; --panel:#111a2d; --border:#22304a; font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
.app { display:grid; grid-template-columns: 300px 1fr; min-height:100vh; background:var(--bg); }
.sidebar { border-right:1px solid var(--border); background:var(--panel); padding:14px; transition:all .2s ease; overflow:auto; }
.sidebar.collapsed { width:72px; padding:14px 8px; }
.brand { display:flex; align-items:center; gap:10px; margin-bottom:14px; }
.brand img { width:32px; height:32px; border-radius:8px; }
.brand .t { font-weight:700; white-space:nowrap; overflow:hidden; }
.sidebar.collapsed .brand .t, .sidebar.collapsed .label { display:none; }

.row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.section { margin-top:14px; font-size:12px; color:#90a4c3; text-transform:uppercase; letter-spacing:.08em; }
.nav button { width:100%; display:flex; align-items:center; gap:10px; color:#d3deef; background:transparent; border:1px solid transparent; text-align:left; padding:10px 10px; border-radius:10px; margin-top:6px; cursor:pointer; }
.nav button.active { background:#16243f; border-color:#27406e; }

.main { padding:16px; }
.toolbar { display:flex; align-items:center; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
button, select { background:#1d2d4f; color:#e2e8f0; border:1px solid #355284; border-radius:10px; padding:8px 10px; cursor:pointer; }

.cards { display:grid; grid-template-columns: repeat(auto-fill, minmax(220px,1fr)); gap:10px; }
.card { background:#111a2d; border:1px solid #22304a; border-radius:14px; padding:12px; }
.muted { color:#90a4c3; font-size:12px; }

.badge { display:inline-flex; align-items:center; border-radius:999px; padding:4px 10px; font-size:12px; border:1px solid #334155; }
.badge.ok { color:#4ade80; border-color:#166534; background:#052e16; }
.badge.warn { color:#f59e0b; border-color:#7c2d12; background:#3f1d0a; }
.badge.off { color:#94a3b8; border-color:#334155; background:#111827; }

.state-ok { color:#4ade80; } .state-bad { color:#f59e0b; } .state-off { color:#94a3b8; }
.hidden { display:none !important; }

.split { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
@media (max-width: 1100px) {
  .app { grid-template-columns: 1fr; }
  .sidebar { border-right:none; border-bottom:1px solid var(--border); }
  .split { grid-template-columns: 1fr; }
}

.checklist { background:#111a2d; border:1px solid #22304a; border-radius:14px; padding:12px; }
.checklist h3 { margin:0 0 8px 0; font-size:14px; }
.checkgrid { display:grid; grid-template-columns: 1fr; gap:6px; max-height:380px; overflow:auto; }
.item { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:8px; background:#0d1628; border:1px solid #1e2b44; }
.item small { color:#90a4c3; margin-left:auto; }

.diag { white-space:pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12px; background:#0d1628; border:1px solid #22304a; border-radius:12px; padding:12px; overflow:auto; }
</style>

<div class="app">
  <aside class="sidebar" id="sidebar">
    <div class="brand">
      <img src="/padspan_ha_static/padspan-ha/assets/padspan-mark.svg" alt="PadSpan">
      <div class="t">PadSpan HA</div>
    </div>

    <div class="row">
      <span class="label muted">Cloud</span>
      <span id="badge-cloud" class="badge off">Unknown</span>
    </div>
    <div class="row" style="margin-top:8px;">
      <span class="label muted">Integration</span>
      <span id="badge-status" class="badge off">Loading</span>
    </div>
    <div style="margin-top:10px;" class="row">
      <button id="reconnect">Reconnect cloud now</button>
    </div>

    <div class="section label">Navigation</div>
    <nav class="nav">
      <button class="active" data-view="overview"><ha-icon icon="mdi:radar"></ha-icon><span class="label">Overview</span></button>
      <button data-view="objects"><ha-icon icon="mdi:tag-multiple-outline"></ha-icon><span class="label">Objects by Rooms</span></button>
      <button data-view="diagnostics"><ha-icon icon="mdi:stethoscope"></ha-icon><span class="label">Diagnostics</span></button>
    </nav>
  </aside>

  <main class="main">
    <div class="toolbar">
      <button id="toggle">Toggle Sidebar [</button>
      <button id="refresh">Refresh</button>
      <span class="muted">PadSpan v0.3.7 • local-first</span>
    </div>

    <section id="view-overview">
      <div class="cards">
        <div class="card"><div class="muted">Status</div><div id="status">Loading…</div></div>
        <div class="card"><div class="muted">Cloud Reachable</div><div id="cloud">—</div></div>
        <div class="card"><div class="muted">Cloud Devices</div><div id="devices">—</div></div>
        <div class="card"><div class="muted">Last Error</div><div id="error">—</div></div>
        <div class="card"><div class="muted">Rooms in map</div><div id="roomcount">—</div></div>
      </div>
    </section>

    <section id="view-objects" class="hidden">
      <div class="split">
        <div class="checklist">
          <h3>Rooms</h3>
          <div class="toolbar" style="margin:0 0 8px 0;">
            <button id="rooms-all">All</button>
            <button id="rooms-none">None</button>
          </div>
          <div id="rooms-list" class="checkgrid"></div>
        </div>
        <div class="checklist">
          <h3>Object Tags</h3>
          <div class="toolbar" style="margin:0 0 8px 0;">
            <label class="muted">Show tags seen in:</label>
            <select id="mode">
              <option value="all" selected>ALL selected rooms</option>
              <option value="any">ANY selected room</option>
            </select>
          </div>
          <div id="tags-list" class="checkgrid"></div>
        </div>
      </div>
    </section>

    <section id="view-diagnostics" class="hidden">
      <div class="card">
        <div class="row">
          <div><div style="font-weight:600;">Diagnostics</div><div class="muted">Live integration snapshot</div></div>
          <button id="diag-refresh">Refresh diagnostics</button>
        </div>
        <div id="diag" class="diag" style="margin-top:10px;">Loading…</div>
      </div>
    </section>
  </main>
</div>
`;

class PadSpanHAPanel extends HTMLElement {
  constructor() {
    super();
    this._status = {};
    this._roomTagMap = {};
    this._selectedRooms = new Set();
  }

  set hass(hass) {
    this._hass = hass;
    this._refreshAll();
  }

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({mode:'open'});
    this.shadowRoot.appendChild(template.content.cloneNode(true));
    this.$ = (sel) => this.shadowRoot.querySelector(sel);
    this.$$ = (sel) => [...this.shadowRoot.querySelectorAll(sel)];

    const sidebar = this.$('#sidebar');
    const collapsed = localStorage.getItem('padspan_sidebar_collapsed') === '1';
    if (collapsed) sidebar.classList.add('collapsed');

    this.$('#toggle').addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      localStorage.setItem('padspan_sidebar_collapsed', sidebar.classList.contains('collapsed') ? '1' : '0');
    });

    this.$('#refresh').addEventListener('click', () => this._refreshAll());
    this.$('#reconnect').addEventListener('click', () => this._reconnect());
    this.$('#diag-refresh').addEventListener('click', () => this._refreshAll());

    this.$('#mode').addEventListener('change', () => this._renderTags());
    this.$('#rooms-all').addEventListener('click', () => {
      Object.keys(this._roomTagMap).forEach((r) => this._selectedRooms.add(r));
      this._renderRooms();
      this._renderTags();
    });
    this.$('#rooms-none').addEventListener('click', () => {
      this._selectedRooms.clear();
      this._renderRooms();
      this._renderTags();
    });

    this.$$('.nav button').forEach((btn) => btn.addEventListener('click', () => this._showView(btn.dataset.view)));

    window.addEventListener('keydown', (e) => {
      if (e.key === '[') this.$('#toggle').click();
      if (e.key === 'Escape') this._showView('overview');
    });
  }

  _showView(view) {
    this.$$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    this.$('#view-overview').classList.toggle('hidden', view !== 'overview');
    this.$('#view-objects').classList.toggle('hidden', view !== 'objects');
    this.$('#view-diagnostics').classList.toggle('hidden', view !== 'diagnostics');
  }

  async _refreshAll() {
    if (!this._hass || !this.shadowRoot) return;
    await Promise.all([this._fetchStatus(), this._fetchRoomTags()]);
    this._renderDiagnostics();
  }

  async _reconnect() {
    if (!this._hass) return;
    try {
      await this._hass.callWS({ type: "padspan_ha/refresh" });
      await this._refreshAll();
    } catch (err) {
      this.$('#error').textContent = String(err);
      this.$('#status').textContent = 'refresh_error';
      this.$('#status').className = 'state-bad';
    }
  }

  async _fetchStatus() {
    try {
      const res = await this._hass.callWS({ type: "padspan_ha/status" });
      const first = (res.entries || [])[0] || {};
      this._status = first;

      const status = first.status || 'not_loaded';
      this.$('#status').textContent = status;
      this.$('#cloud').textContent = String(!!first.cloud_reachable);
      this.$('#devices').textContent = String(first.devices ?? 0);
      this.$('#error').textContent = first.last_error || '—';
      this.$('#roomcount').textContent = String(first.room_count ?? 0);

      this.$('#status').className = status === 'cloud_connected'
        ? 'state-ok'
        : status === 'local_only'
          ? 'state-off'
          : 'state-bad';

      const bCloud = this.$('#badge-cloud');
      if (first.cloud_reachable) {
        bCloud.textContent = 'Connected';
        bCloud.className = 'badge ok';
      } else if (first.cloud_enabled) {
        bCloud.textContent = 'Degraded';
        bCloud.className = 'badge warn';
      } else {
        bCloud.textContent = 'Disabled';
        bCloud.className = 'badge off';
      }

      const bStatus = this.$('#badge-status');
      if (status === 'cloud_connected') {
        bStatus.textContent = 'Healthy';
        bStatus.className = 'badge ok';
      } else if (status === 'cloud_degraded') {
        bStatus.textContent = 'Degraded';
        bStatus.className = 'badge warn';
      } else {
        bStatus.textContent = 'Local-only';
        bStatus.className = 'badge off';
      }
    } catch (err) {
      this._status = { status: 'panel_error', last_error: String(err) };
      this.$('#status').textContent = 'panel_error';
      this.$('#status').className = 'state-bad';
      this.$('#error').textContent = String(err);
      this.$('#badge-cloud').textContent = 'Error';
      this.$('#badge-cloud').className = 'badge warn';
      this.$('#badge-status').textContent = 'Error';
      this.$('#badge-status').className = 'badge warn';
    }
  }

  async _fetchRoomTags() {
    try {
      const res = await this._hass.callWS({ type: "padspan_ha/room_tags" });
      this._roomTagMap = res.room_tag_map || {};
      const rooms = Object.keys(this._roomTagMap);
      if (this._selectedRooms.size === 0 && rooms.length) {
        rooms.forEach((r) => this._selectedRooms.add(r));
      } else {
        this._selectedRooms = new Set([...this._selectedRooms].filter((r) => rooms.includes(r)));
      }
      this._renderRooms();
      this._renderTags();
    } catch (err) {
      this.$('#tags-list').innerHTML = `<div class="item">Failed to load room/tag map: ${String(err)}</div>`;
    }
  }

  _renderRooms() {
    const wrap = this.$('#rooms-list');
    const rooms = Object.keys(this._roomTagMap).sort();
    if (!rooms.length) {
      wrap.innerHTML = `<div class="item">No room data available yet.</div>`;
      return;
    }

    wrap.innerHTML = "";
    rooms.forEach((room) => {
      const tagCount = (this._roomTagMap[room] || []).length;
      const row = document.createElement("label");
      row.className = "item";
      row.innerHTML = `
        <input type="checkbox" ${this._selectedRooms.has(room) ? "checked" : ""} />
        <span>${room}</span>
        <small>${tagCount} tags</small>
      `;
      const cb = row.querySelector("input");
      cb.addEventListener("change", () => {
        if (cb.checked) this._selectedRooms.add(room);
        else this._selectedRooms.delete(room);
        this._renderTags();
        this._renderDiagnostics();
      });
      wrap.appendChild(row);
    });
  }

  _computeTags() {
    const mode = this.$('#mode').value; // all or any
    const selected = [...this._selectedRooms];
    if (!selected.length) return [];

    const arrays = selected.map((r) => (this._roomTagMap[r] || []).map(String));
    if (!arrays.length) return [];

    if (mode === "all") {
      let intersection = new Set(arrays[0]);
      for (let i = 1; i < arrays.length; i++) {
        const s = new Set(arrays[i]);
        intersection = new Set([...intersection].filter((x) => s.has(x)));
      }
      return [...intersection].sort((a, b) => a.localeCompare(b));
    }

    const union = new Set();
    arrays.forEach((arr) => arr.forEach((t) => union.add(t)));
    return [...union].sort((a, b) => a.localeCompare(b));
  }

  _renderTags() {
    const wrap = this.$('#tags-list');
    const tags = this._computeTags();
    if (!tags.length) {
      wrap.innerHTML = `<div class="item">No tags match current room selection.</div>`;
      return;
    }

    wrap.innerHTML = "";
    tags.forEach((tag) => {
      const row = document.createElement("label");
      row.className = "item";
      row.innerHTML = `<input type="checkbox" /><span>${tag}</span>`;
      wrap.appendChild(row);
    });
  }

  _renderDiagnostics() {
    const payload = {
      generated_at: new Date().toISOString(),
      status: this._status,
      selected_rooms: [...this._selectedRooms].sort(),
      mode: this.$('#mode')?.value || 'all',
      room_tag_map: this._roomTagMap,
      computed_tags: this._computeTags(),
    };
    this.$('#diag').textContent = JSON.stringify(payload, null, 2);
  }
}
customElements.define('padspan-ha-panel', PadSpanHAPanel);
