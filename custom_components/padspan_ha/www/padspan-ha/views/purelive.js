// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
/**
 * Overview (Experimental) — Preact-based "control tower" dashboard
 *
 * Proof-of-concept: identical look to the vanilla JS overview, but built with
 * Preact + htm for efficient DOM diffing.  No build step — uses ESM imports
 * from esm.sh CDN.
 *
 * Key differences from overview.js:
 *   - Components re-render via Preact's virtual DOM (no full DOM teardown)
 *   - State changes trigger targeted updates (no guard flags needed)
 *   - Same ctx.actions / ctx.state API — drop-in replacement pattern
 */

// ── Preact + htm (vendored locally — no CDN, no build step) ──────────────────
// Preact 10.25.4 + htm 3.1.1 — total ~16KB unminified, ~5KB over the wire.
// Files live in ../lib/ — zero external dependencies.
import { h, render as preactRender, html } from "../lib/preact-bundle.js";
import { useState, useEffect, useRef, useCallback } from "../lib/preact-bundle.js";

// ── Utility functions ────────────────────────────────────────────────────────
const fmtNum = (n) => {
  try { return new Intl.NumberFormat().format(Number(n || 0)); } catch { return String(n || 0); }
};

const fmtAgo = (sec) => {
  if (sec == null || isNaN(sec)) return "";
  const s = Math.max(0, Math.round(Number(sec)));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h2 = Math.round(m / 60);
  if (h2 < 48) return `${h2}h ago`;
  return `${Math.round(h2 / 24)}d ago`;
};

// ── Experimental Banner ──────────────────────────────────────────────────────
function PureLiveBanner() {
  return html`
    <div style="background:linear-gradient(90deg,rgba(124,58,237,.15),rgba(139,92,246,.08));border:1px solid rgba(124,58,237,.4);border-radius:12px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
      <span style="font-size:20px">⚡</span>
      <div>
        <div style="font-weight:700;font-size:13px;color:#a78bfa">Pure Live</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px">
          Zero-flicker dashboard — only changed values update. Built with Preact virtual DOM diffing.
        </div>
      </div>
    </div>
  `;
}

// ── Summary Bar (Basic mode) ─────────────────────────────────────────────────
function SummaryBar({ roomsCount, objectsTotal, radiosCount, calUsable, calColor, loading }) {
  const items = [
    { label: "Rooms", value: loading ? "--" : String(roomsCount), color: null },
    { label: "Objects", value: loading ? "--" : String(objectsTotal), color: null },
    { label: "Scanners", value: loading ? "--" : String(radiosCount), color: null },
    { label: "Cal pts", value: loading ? "--" : String(calUsable), color: calColor },
  ];
  return html`
    <div className="basic-summary">
      ${items.map(it => html`
        <div style="text-align:center;min-width:60px">
          <div className="basic-summary-num" style=${it.color ? `color:${it.color}` : ""}>${it.value}</div>
          <div className="basic-summary-lbl">${it.label}</div>
        </div>
      `)}
    </div>
  `;
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ title, value, color, children }) {
  return html`
    <div className="card">
      <div className="kpi">
        <div className="k">${title}</div>
        <div className="v" style=${color ? `color:${color}` : ""}>${value}</div>
      </div>
      ${children}
    </div>
  `;
}

// ── Rooms KPI Card ───────────────────────────────────────────────────────────
function RoomsCard({ roomsCount, loading, ctx }) {
  const openRoomsList = useCallback(() => {
    const roomTagMap = ctx.state.roomTagMap || {};
    const rows = Object.keys(roomTagMap).sort().map(room => {
      const eids = roomTagMap[room] || [];
      return html`<tr><td>${room}</td><td>${eids.length}</td></tr>`;
    });
    const container = document.createElement("div");
    preactRender(html`
      <div className="table-wrap" style="max-height:50vh">
        <table className="table">
          <thead><tr><th>Room</th><th>Objects</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `, container);
    ctx.actions.openModal("Rooms", container);
  }, [ctx]);

  return html`
    <${KpiCard} title="Rooms" value=${loading ? "--" : String(roomsCount)}>
      <div className="row">
        <button className="btn" onClick=${openRoomsList}>View rooms list</button>
      </div>
    <//>
  `;
}

// ── Objects KPI Card ─────────────────────────────────────────────────────────
function ObjectsCard({ objectsTotal, unidentifiedCount, quietMode, loading, ctx }) {
  return html`
    <${KpiCard} title="Objects" value=${loading ? "--" : String(objectsTotal)}>
      <div className="row">
        <button className="btn" onClick=${() => ctx.state.view = "objects"}>
          ${quietMode ? "Tracked objects" : "All objects"}
        </button>
        ${!quietMode && html`
          <button className="btn" onClick=${() => ctx.state.view = "objects"}>
            Unidentified (${loading ? "--" : unidentifiedCount})
          </button>
        `}
      </div>
    <//>
  `;
}

// ── Radios KPI Card ──────────────────────────────────────────────────────────
function RadiosCard({ radiosCount, dataMode, loading, ctx }) {
  const openRadiosList = useCallback(() => {
    const liveSnap = ctx.state.live?.snapshot;
    const radios = (liveSnap?.ble?.radios) || [];
    const rows = radios.map(r => {
      const sid = ctx.helpers.radioShortId ? ctx.helpers.radioShortId(r.source || "") : "";
      return html`<tr>
        <td><span style="color:#52b788;font-weight:700">${sid}</span></td>
        <td>${r.source || ""}</td>
        <td>${r.area || ""}</td>
        <td>${r.device_count ?? ""}</td>
      </tr>`;
    });
    const container = document.createElement("div");
    preactRender(html`
      <div className="table-wrap" style="max-height:50vh">
        <table className="table">
          <thead><tr><th>ID</th><th>Source</th><th>Area</th><th>Devices</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `, container);
    ctx.actions.openModal("Bluetooth Radios", container);
  }, [ctx]);

  return html`
    <${KpiCard} title="Bluetooth radios" value=${loading ? "--" : String(radiosCount)}>
      <div className="row">
        <button className="btn" onClick=${openRadiosList}>View radios list</button>
      </div>
      <div style="margin-top:8px;color:#94a3b8;font-size:12px">
        ${dataMode === "live" ? "Live snapshot" : "Sample data — switch to Live to see your real devices"}
      </div>
    <//>
  `;
}

// ── Calibration KPI Card ─────────────────────────────────────────────────────
function CalibrationCard({ liveSnap }) {
  const cs = liveSnap?.calibration_status;
  if (!cs) return null;

  const total = cs.total_points || 0;
  const empty = cs.empty_points || 0;
  const usable = total - empty;
  const ready = usable >= (cs.knn_min_required || 5);
  const storeOk = cs.store_initialized !== false;
  const knnPos = cs.knn_positioned_objects || 0;
  const color = !storeOk ? "#f87171" : !total ? "#f87171" : empty > 0 ? "#f59e0b" : ready ? "#52b788" : "#f59e0b";
  const algoLabel = cs.positioning_algorithm === "rf" ? "Random Forest" : "k-NN";
  const statusText = !storeOk ? "Store not loaded (restart HA)" :
    !total ? "No data" : !ready ? `Need ${(cs.knn_min_required || 5) - usable} more` :
    knnPos > 0 ? `${algoLabel} — ${knnPos} objects positioned` : `${algoLabel} ready (no objects matched yet)`;

  const parts = [];
  if (cs.manual_points > 0) parts.push(`${cs.manual_points} manual`);
  if (cs.auto_points > 0) parts.push(`${cs.auto_points} auto`);
  if (empty > 0) parts.push(`${empty} empty (no RSSI)`);

  const [diagOpen, setDiagOpen] = useState(false);

  return html`
    <${KpiCard} title="Calibration" value=${`${usable} pts`} color=${color}>
      <div style="font-size:11px;color:#94a3b8;margin-top:4px">
        ${parts.join(" · ")}${cs.scanners ? ` · ${cs.scanners} scanners` : ""}${cs.maps ? ` · ${cs.maps} maps` : ""}
      </div>
      <div style="font-size:11px;margin-top:4px;color:${color}">
        k-NN: ${statusText}
      </div>
      ${!storeOk && html`
        <div style="font-size:11px;margin-top:4px;color:#f87171;font-weight:600">
          CalibrationStore was not loaded at startup. Restart Home Assistant to activate k-NN positioning.
        </div>
      `}
      ${empty > 0 && html`
        <div style="font-size:11px;margin-top:4px;color:#f59e0b">
          ${empty} point(s) have no RSSI data — re-calibrate to fix
        </div>
      `}
      ${cs.source_overlap !== undefined && html`
        <div style="font-size:10px;margin-top:6px;padding:6px;background:#0f172a;border:1px solid #1e293b;border-radius:4px;color:#94a3b8">
          <div style="display:flex;align-items:center;gap:6px;cursor:pointer" onClick=${() => setDiagOpen(!diagOpen)}>
            <span style="font-size:9px;color:#60a5fa;transition:transform .2s;${diagOpen ? "transform:rotate(90deg)" : ""}">▶</span>
            <span style="font-weight:600;color:#e2e8f0">${algoLabel} Diagnostic</span>
          </div>
          ${diagOpen && html`
            <div style="margin-top:4px">
              <div>Cal sources: ${(cs.cal_sources || []).length} · Live EMA sources: ${(cs.ema_sources || []).length} · Overlap: ${cs.source_overlap}</div>
              ${cs.source_overlap === 0 && html`
                <div style="color:#f87171;font-weight:600;margin-top:3px">
                  No scanner overlap between calibration data and live objects — cannot match!
                </div>
              `}
            </div>
          `}
        </div>
      `}
    <//>
  `;
}

// ── Mode Subtitle ────────────────────────────────────────────────────────────
function ModeSubtitle({ dataMode, version }) {
  return html`
    <div style="font-size:11px;color:#64748b;margin-top:4px;margin-bottom:12px">
      ${dataMode === "live" ? "Live data" : "Sample mode"} · v${version}
    </div>
  `;
}

// ── Iso Map Bridge ───────────────────────────────────────────────────────────
// Renders the vanilla JS isometric floor stack inside a Preact-managed ref.
// overview.js tags the map element with data-padspan-map="true".
// We call overview.render(ctx) once, find that element, and mount it here.
// On poll updates, ctx.state._isoUpdateObjects() handles efficient dot swaps.

let _mapNode = null;

function IsoMap({ ctx }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // If map node exists and is already in our container, nothing to do
    if (_mapNode && _mapNode.isConnected && _mapNode.parentNode === containerRef.current) return;

    // If map node exists but was detached, re-attach it
    if (_mapNode && !_mapNode.isConnected) {
      containerRef.current.innerHTML = "";
      containerRef.current.appendChild(_mapNode);
      return;
    }

    // Build fresh: call overview.render(ctx) and extract the tagged map element
    const ovMod = window.__PADSPAN_VIEWS?.overview;
    if (!ovMod) {
      console.warn("[PadSpan Pure Live] Overview module not loaded yet");
      return;
    }

    try {
      const section = ovMod.render(ctx);
      if (!section) return;

      // Find the tagged map element
      const mapEl = section.querySelector("[data-padspan-map]");
      if (mapEl) {
        _mapNode = mapEl;
        containerRef.current.innerHTML = "";
        containerRef.current.appendChild(mapEl);
      } else {
        // Fallback: mount the entire overview section (includes map + KPIs)
        _mapNode = section;
        containerRef.current.innerHTML = "";
        containerRef.current.appendChild(section);
      }
    } catch (e) {
      console.warn("[PadSpan Pure Live] Map build failed:", e);
    }
  });

  return html`<div ref=${containerRef} style="min-height:200px"></div>`;
}

// ── Root App Component ───────────────────────────────────────────────────────
function OverviewApp({ ctx }) {
  const dataMode = ctx.state.dataMode || "sample";
  const liveSnap = ctx.state.live?.snapshot || null;
  const liveLoading = dataMode === "live" && !liveSnap;
  const isBasic = ctx.state.complexity === "basic";
  const quietMode = !!(ctx.state.settings?.quiet_mode);

  // Derived counts
  const roomTagMap = liveLoading ? {} : (ctx.state.roomTagMap || {});
  const roomsCount = Object.keys(roomTagMap).length;
  const tagsCount = (() => {
    const s = new Set();
    for (const r of Object.keys(roomTagMap)) {
      (roomTagMap[r] || []).forEach(eid => s.add(eid));
    }
    return s.size;
  })();

  const objSummary = liveSnap?.objects?.summary || null;
  const objectsTotal = objSummary ? (quietMode ? objSummary.identified : objSummary.total) : tagsCount;
  const unidentifiedCount = quietMode ? 0 : (objSummary ? objSummary.unidentified : 0);
  const radios = liveSnap?.ble?.radios || [];
  const radiosCount = radios.length;

  // Calibration
  const cs = liveSnap?.calibration_status;
  const calTotal = cs?.total_points || 0;
  const calEmpty = cs?.empty_points || 0;
  const calUsable = calTotal - calEmpty;
  const calReady = calUsable >= (cs?.knn_min_required || 5);
  const calStoreOk = cs?.store_initialized !== false;
  const calColor = !calStoreOk ? "#f87171" : !calTotal ? "#f87171" : calEmpty > 0 ? "#f59e0b" : calReady ? "#52b788" : "#f59e0b";

  return html`
    <section style="padding:0">
      <h2 style="margin:0 0 4px 0;font-size:18px;color:#e2e8f0">Pure Live</h2>
      <${ModeSubtitle} dataMode=${dataMode} version=${ctx.state.version} />
      <${PureLiveBanner} />

      ${isBasic && html`
        <${SummaryBar}
          roomsCount=${roomsCount}
          objectsTotal=${objectsTotal}
          radiosCount=${radiosCount}
          calUsable=${calUsable}
          calColor=${calColor}
          loading=${liveLoading}
        />
      `}

      <${IsoMap} ctx=${ctx} />

      ${!isBasic && html`
        <div className="grid" style="margin-top:16px">
          <${RoomsCard} roomsCount=${roomsCount} loading=${liveLoading} ctx=${ctx} />
          <${ObjectsCard}
            objectsTotal=${objectsTotal}
            unidentifiedCount=${unidentifiedCount}
            quietMode=${quietMode}
            loading=${liveLoading}
            ctx=${ctx}
          />
          <${RadiosCard} radiosCount=${radiosCount} dataMode=${dataMode} loading=${liveLoading} ctx=${ctx} />
          <${CalibrationCard} liveSnap=${liveSnap} />
        </div>
      `}
    </section>
  `;
}

// ── Bridge: export render(ctx) for panel.js ──────────────────────────────────
// This is the contract: panel.js calls render(ctx) and expects an HTMLElement.
// We create a persistent container and let Preact manage rendering inside it.

let _container = null;

export function render(ctx) {
  // Reuse the container if it's still in the DOM (Preact diffing FTW).
  // If panel.js did innerHTML="" and destroyed it, create a fresh one.
  if (!_container || !_container.isConnected) {
    _container = document.createElement("div");
    _container.className = "overview-experimental-root";
  }

  // Preact renders into the container — diffing only updates changed nodes.
  // This is the key advantage: no full DOM teardown on every poll/refresh.
  preactRender(html`<${OverviewApp} ctx=${ctx} />`, _container);

  return _container;
}
