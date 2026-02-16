class PadSpanHaPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._data = null;
    this._activeEntryId = null;
    this._activeMapId = null;
    this._selectedSource = "";
    this._uploading = false;
    this._refreshTimer = null;
  }

  set hass(hass) {
    this._hass = hass;
    this._ensureData();
  }

  connectedCallback() {
    this._render();
    this._ensureData();
    this._refreshTimer = setInterval(() => this._fetchStatus(), 4000);
  }

  disconnectedCallback() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  async _ensureData() {
    if (!this._hass) return;
    if (!this._data) {
      await this._fetchStatus();
    } else {
      this._render();
    }
  }

  async _fetchStatus() {
    if (!this._hass) return;
    try {
      const result = await this._hass.callApi("GET", "padspan_ha/status");
      this._data = result;
      const entries = result.entries || [];
      if (!this._activeEntryId && entries.length > 0) {
        this._activeEntryId = entries[0].entry_id;
      }
      const entry = this._getActiveEntry();
      if (entry) {
        if (!this._activeMapId) this._activeMapId = entry.active_map || null;
        if (this._activeMapId && !(entry.maps || []).find(m => m.id === this._activeMapId)) {
          this._activeMapId = entry.active_map || ((entry.maps || [])[0] || {}).id || null;
        }
      }
      this._render();
    } catch (err) {
      // swallow transient UI fetch errors
      console.error("[PadSpan] status fetch failed", err);
    }
  }

  _getActiveEntry() {
    const entries = (this._data && this._data.entries) || [];
    if (!entries.length) return null;
    const entry = entries.find(e => e.entry_id === this._activeEntryId);
    return entry || entries[0];
  }

  _getActiveMap(entry) {
    if (!entry) return null;
    const maps = entry.maps || [];
    return maps.find(m => m.id === this._activeMapId) || maps.find(m => m.id === entry.active_map) || maps[0] || null;
  }

  _getActiveAnchors(entry, mapId) {
    if (!entry || !mapId) return {};
    const anchors = entry.anchors || {};
    return anchors[mapId] || {};
  }

  async _setActiveMap(mapId) {
    const entry = this._getActiveEntry();
    if (!entry || !mapId) return;
    this._activeMapId = mapId;
    this._render();
    await this._hass.callService("padspan_ha", "set_active_map", {
      entry_id: entry.entry_id,
      map_id: mapId,
    });
    await this._fetchStatus();
  }

  async _setAnchorFromClick(ev) {
    const entry = this._getActiveEntry();
    const map = this._getActiveMap(entry);
    if (!entry || !map) return;

    if (!this._selectedSource) {
      this._toast("Pick a scanner source first.");
      return;
    }

    const img = this.shadowRoot.querySelector("#mapImg");
    const rect = img.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;

    await this._hass.callService("padspan_ha", "set_map_anchor", {
      entry_id: entry.entry_id,
      map_id: map.id,
      source_id: this._selectedSource,
      x,
      y,
      z: 0,
      weight: 1.0,
      label: this._selectedSource,
    });
    await this._fetchStatus();
  }

  async _deleteAnchor(sourceId) {
    const entry = this._getActiveEntry();
    const map = this._getActiveMap(entry);
    if (!entry || !map) return;
    await this._hass.callService("padspan_ha", "delete_map_anchor", {
      entry_id: entry.entry_id,
      map_id: map.id,
      source_id: sourceId,
    });
    await this._fetchStatus();
  }

  async _uploadMap(formEl) {
    const entry = this._getActiveEntry();
    if (!entry) return;

    const fileInput = formEl.querySelector('input[name="file"]');
    const mapIdInput = formEl.querySelector('input[name="map_id"]');
    const mapNameInput = formEl.querySelector('input[name="name"]');
    const activateInput = formEl.querySelector('input[name="activate"]');

    const file = fileInput.files && fileInput.files[0];
    const mapId = (mapIdInput.value || "").trim();
    const name = (mapNameInput.value || "").trim();

    if (!file) {
      this._toast("Choose an image file.");
      return;
    }
    if (!mapId) {
      this._toast("Map ID is required.");
      return;
    }

    this._uploading = true;
    this._render();

    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      fd.append("entry_id", entry.entry_id);
      fd.append("map_id", mapId);
      fd.append("name", name || mapId);
      fd.append("activate", activateInput.checked ? "true" : "false");

      const headers = {
        Authorization: `Bearer ${this._hass.auth.data.access_token}`,
      };

      const resp = await fetch("/api/padspan_ha/map/upload", {
        method: "POST",
        body: fd,
        headers,
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `Upload failed (${resp.status})`);
      }

      await this._fetchStatus();
      this._toast("Map uploaded.");
      formEl.reset();
    } catch (err) {
      this._toast(err.message || "Upload failed");
    } finally {
      this._uploading = false;
      this._render();
    }
  }

  _toast(msg) {
    const el = this.shadowRoot.querySelector("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2200);
  }

  _render() {
    if (!this.shadowRoot) return;
    const entry = this._getActiveEntry();
    const map = this._getActiveMap(entry);
    const devices = (entry && entry.devices) || [];
    const sources = (entry && entry.sources) || [];
    const anchors = this._getActiveAnchors(entry, map && map.id);

    const anchorRows = Object.values(anchors || {})
      .sort((a, b) => (a.source_id || "").localeCompare(b.source_id || ""))
      .map(a => `
        <tr>
          <td>${a.source_id || ""}</td>
          <td>${Math.round(a.x || 0)}</td>
          <td>${Math.round(a.y || 0)}</td>
          <td><button class="mini danger" data-del-anchor="${a.source_id}">Delete</button></td>
        </tr>
      `)
      .join("");

    const sourceOptions = sources
      .map(s => `<option value="${s}" ${this._selectedSource === s ? "selected" : ""}>${s}</option>`)
      .join("");

    const deviceDots = devices
      .filter(d => Number.isFinite(d.map_x) && Number.isFinite(d.map_y))
      .map(d => {
        const x = Math.max(0, Math.round(d.map_x));
        const y = Math.max(0, Math.round(d.map_y));
        const lbl = `${d.name || d.address} (${d.address})`;
        return `<div class="device-dot" style="left:${x}px; top:${y}px" title="${lbl}"></div>`;
      })
      .join("");

    const anchorDots = Object.values(anchors || {}).map(a => {
      const x = Math.max(0, Math.round(a.x || 0));
      const y = Math.max(0, Math.round(a.y || 0));
      const lbl = a.label || a.source_id || "anchor";
      return `<div class="anchor-dot" style="left:${x}px; top:${y}px" title="${lbl}"></div>`;
    }).join("");

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display:block;
          padding:16px;
          box-sizing:border-box;
          color: var(--primary-text-color);
          font-family: var(--paper-font-body1_-_font-family);
        }
        .grid {
          display:grid;
          grid-template-columns: 360px 1fr;
          gap: 16px;
        }
        .card {
          background: var(--card-background-color);
          border-radius: 12px;
          box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,.18));
          padding: 12px;
        }
        h2, h3 { margin: 0 0 10px 0; }
        .muted { color: var(--secondary-text-color); font-size: 12px; }
        .row { display:flex; gap:8px; align-items:center; margin-bottom:8px; }
        .row > * { flex:1; }
        select, input[type="text"], input[type="file"], button {
          width: 100%;
          box-sizing:border-box;
          padding:8px 10px;
          border-radius:8px;
          border:1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
        }
        button {
          cursor:pointer;
          border:none;
          background: var(--primary-color);
          color: var(--text-primary-color, white);
          font-weight:600;
        }
        button.secondary { background: var(--secondary-background-color); color: var(--primary-text-color); border:1px solid var(--divider-color); }
        button.mini { width:auto; padding:4px 8px; font-size:12px; }
        button.danger { background: #b12626; color: #fff; }
        button:disabled { opacity:.55; cursor:not-allowed; }
        .table-wrap { max-height: 220px; overflow:auto; border:1px solid var(--divider-color); border-radius:8px; }
        table { width:100%; border-collapse: collapse; font-size:12px; }
        th, td { padding:6px 8px; border-bottom:1px solid var(--divider-color); text-align:left; }
        .map-wrap {
          position: relative;
          overflow:auto;
          border:1px solid var(--divider-color);
          border-radius: 12px;
          min-height: 420px;
          background: #0f0f10;
        }
        .map-stage {
          position: relative;
          width: fit-content;
          height: fit-content;
          margin: 0 auto;
        }
        .map-stage img {
          max-width: 100%;
          display:block;
          user-select: none;
        }
        .overlay {
          position:absolute;
          left:0; top:0; right:0; bottom:0;
          pointer-events:none;
        }
        .device-dot, .anchor-dot {
          position:absolute;
          transform: translate(-50%, -50%);
          width: 12px;
          height: 12px;
          border-radius: 999px;
          border: 2px solid #fff;
          box-shadow: 0 0 0 1px rgba(0,0,0,.35);
        }
        .device-dot { background:#32d67a; }
        .anchor-dot { background:#2f7bff; }
        .hint {
          margin-top: 8px;
          font-size: 12px;
          color: var(--secondary-text-color);
        }
        #toast {
          position: fixed;
          right: 16px;
          bottom: 16px;
          background: rgba(20,20,20,0.92);
          color: #fff;
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 13px;
          opacity: 0;
          transform: translateY(10px);
          transition: all .2s ease;
          pointer-events:none;
        }
        #toast.show {
          opacity:1;
          transform: translateY(0);
        }
        @media (max-width: 1100px) {
          .grid { grid-template-columns: 1fr; }
        }
      </style>

      <div class="grid">
        <div class="card">
          <h2>PadSpan HA</h2>
          <div class="muted">Advanced interface • map tools • BLE overlays</div>

          <h3 style="margin-top:14px">Entry</h3>
          <div class="row">
            <select id="entrySelect">
              ${((this._data && this._data.entries) || []).map(e =>
                `<option value="${e.entry_id}" ${e.entry_id === (entry && entry.entry_id) ? "selected" : ""}>${e.title} (${e.entry_id.slice(0,8)})</option>`
              ).join("")}
            </select>
          </div>

          <h3>Map</h3>
          <div class="row">
            <select id="mapSelect">
              ${(entry && entry.maps || []).map(m =>
                `<option value="${m.id}" ${map && m.id === map.id ? "selected" : ""}>${m.name || m.id}</option>`
              ).join("")}
            </select>
          </div>

          <div class="row">
            <select id="sourceSelect">
              <option value="">Pick source for anchor...</option>
              ${sourceOptions}
            </select>
          </div>
          <div class="row">
            <button id="reloadBtn" class="secondary">Refresh now</button>
          </div>

          <h3 style="margin-top:16px">Upload map image</h3>
          <form id="uploadForm">
            <div class="row"><input name="map_id" type="text" placeholder="map_id (e.g. main_floor)" required></div>
            <div class="row"><input name="name" type="text" placeholder="Display name"></div>
            <div class="row"><input name="file" type="file" accept="image/*" required></div>
            <div class="row" style="justify-content:flex-start">
              <label style="display:flex;gap:8px;align-items:center;flex:unset;">
                <input name="activate" type="checkbox" checked style="width:auto;">
                Set active
              </label>
            </div>
            <div class="row"><button type="submit" ${this._uploading ? "disabled" : ""}>${this._uploading ? "Uploading..." : "Upload map"}</button></div>
          </form>

          <h3 style="margin-top:16px">Anchors (${Object.keys(anchors || {}).length})</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Source</th><th>X</th><th>Y</th><th></th></tr></thead>
              <tbody>
                ${anchorRows || `<tr><td colspan="4" class="muted">No anchors yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h3>Live map overlay</h3>
          <div class="muted">
            Click map image to place anchor for selected source.
            Devices with computed positions are shown as green dots.
          </div>

          ${map ? `
            <div class="map-wrap">
              <div class="map-stage" id="mapStage">
                <img id="mapImg" src="${map.image_url}" alt="${map.name || map.id}">
                <div class="overlay">
                  ${anchorDots}
                  ${deviceDots}
                </div>
              </div>
            </div>
            <div class="hint">
              Active map: <b>${map.name || map.id}</b> •
              Devices plotted: <b>${devices.filter(d => Number.isFinite(d.map_x) && Number.isFinite(d.map_y)).length}</b> •
              Sources: <b>${sources.length}</b>
            </div>
          ` : `
            <div class="hint" style="margin-top:12px">
              No map configured yet. Upload one from the left panel.
            </div>
          `}
        </div>
      </div>

      <div id="toast"></div>
    `;

    const entrySelect = this.shadowRoot.querySelector("#entrySelect");
    if (entrySelect) {
      entrySelect.addEventListener("change", async (e) => {
        this._activeEntryId = e.target.value;
        this._activeMapId = null;
        await this._fetchStatus();
      });
    }

    const mapSelect = this.shadowRoot.querySelector("#mapSelect");
    if (mapSelect) {
      mapSelect.addEventListener("change", async (e) => {
        await this._setActiveMap(e.target.value);
      });
    }

    const sourceSelect = this.shadowRoot.querySelector("#sourceSelect");
    if (sourceSelect) {
      sourceSelect.addEventListener("change", (e) => {
        this._selectedSource = e.target.value;
      });
    }

    const reloadBtn = this.shadowRoot.querySelector("#reloadBtn");
    if (reloadBtn && entry) {
      reloadBtn.addEventListener("click", async () => {
        await this._hass.callService("padspan_ha", "reload_ble_cache", { entry_id: entry.entry_id });
        await this._fetchStatus();
      });
    }

    const mapImg = this.shadowRoot.querySelector("#mapImg");
    if (mapImg) {
      mapImg.addEventListener("click", async (ev) => this._setAnchorFromClick(ev));
    }

    this.shadowRoot.querySelectorAll("[data-del-anchor]").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        const sourceId = ev.currentTarget.getAttribute("data-del-anchor");
        if (sourceId) await this._deleteAnchor(sourceId);
      });
    });

    const uploadForm = this.shadowRoot.querySelector("#uploadForm");
    if (uploadForm) {
      uploadForm.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        await this._uploadMap(uploadForm);
      });
    }
  }

  static getConfigElement() {
    return document.createElement("div");
  }

  static getStubConfig() {
    return {};
  }
}

customElements.define("padspan-ha-panel", PadSpanHaPanel);
