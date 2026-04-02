// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
/**
 * Pure Live — zero-flicker immersive dashboard
 *
 * Full-bleed isometric map with glassmorphism floating overlays,
 * rolling odometer counters, room glow pills, and a status ticker.
 * Built with Preact — only changed values update, no DOM teardown.
 */

import { h, render as preactRender, html } from "../lib/preact-bundle.js";
import { useState, useEffect, useRef, useCallback, useMemo } from "../lib/preact-bundle.js";

// ── CSS Animations (injected once into shadow DOM) ───────────────────────────
const STYLES_ID = "purelive-styles";
function injectStyles(root) {
  if (root.querySelector(`#${STYLES_ID}`)) return;
  const s = document.createElement("style");
  s.id = STYLES_ID;
  s.textContent = `
    /* ── Glass card ─────────────────────────────────────────── */
    .pl-glass{background:rgba(10,30,15,.55);backdrop-filter:blur(16px) saturate(140%);-webkit-backdrop-filter:blur(16px) saturate(140%);border:1px solid rgba(255,255,255,.07);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.35);color:#e2e8f0;padding:14px 16px}
    .pl-glass-sm{background:rgba(10,30,15,.5);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.06);border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.3);padding:8px 12px}

    /* ── Room pill ──────────────────────────────────────────── */
    .pl-room-pill{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;cursor:pointer;transition:all .3s ease;border:1px solid rgba(82,183,136,.2);background:rgba(10,21,14,.6)}
    .pl-room-pill:hover{border-color:rgba(82,183,136,.5);background:rgba(10,21,14,.8)}
    .pl-room-pill.occupied{border-color:rgba(82,183,136,.4);box-shadow:0 0 var(--glow-size,12px) var(--glow-spread,4px) rgba(82,183,136,var(--glow-alpha,.15))}

    /* ── Odometer ───────────────────────────────────────────── */
    .pl-odo{display:inline-flex;overflow:hidden;height:1em;line-height:1em;font-variant-numeric:tabular-nums}
    .pl-odo-digit{display:flex;flex-direction:column;transition:transform .5s cubic-bezier(.22,1,.36,1)}
    .pl-odo-digit span{display:block;height:1em;text-align:center}

    /* ── Value flash ───────────────────────────────────────── */
    @keyframes pl-flash{0%{color:#5eead4}100%{color:inherit}}
    .pl-flash{animation:pl-flash .6s ease-out}

    /* ── Room breathe glow ─────────────────────────────────── */
    @keyframes pl-breathe{0%,100%{opacity:.7}50%{opacity:1}}
    .pl-breathe{animation:pl-breathe 3s ease-in-out infinite}

    /* ── Sonar pulse ───────────────────────────────────────── */
    @keyframes pl-sonar{0%{r:4;opacity:.5}100%{r:18;opacity:0}}

    /* ── Ticker bar ────────────────────────────────────────── */
    .pl-ticker{display:flex;align-items:center;gap:16px;padding:8px 16px;font-size:11px;color:#94a3b8;background:rgba(10,21,14,.7);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid rgba(82,183,136,.15)}
    .pl-ticker-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
    @keyframes pl-poll-bar{0%{width:0}100%{width:100%}}
    .pl-poll-bar{height:2px;background:linear-gradient(90deg,#52b788,#5eead4);border-radius:1px;animation:pl-poll-bar 5s linear infinite}

    /* ── Stat mini card ────────────────────────────────────── */
    .pl-stat{display:flex;flex-direction:column;align-items:center;min-width:64px}
    .pl-stat-val{font-size:28px;font-weight:800;letter-spacing:-.02em;line-height:1.1}
    .pl-stat-lbl{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;margin-top:2px}

    /* ── Layout ────────────────────────────────────────────── */
    .pl-root{position:relative;min-height:calc(100vh - 120px);display:flex;flex-direction:column;background:#050d08}
    .pl-map-area{flex:1;position:relative;overflow:hidden;border-radius:12px;margin:0 0 4px 0}
    .pl-overlay-top{position:absolute;top:12px;left:12px;right:12px;display:flex;justify-content:space-between;align-items:flex-start;pointer-events:none;z-index:5}
    .pl-overlay-top>*{pointer-events:auto}
    .pl-overlay-bottom{position:absolute;bottom:48px;left:12px;right:12px;z-index:5;pointer-events:none}
    .pl-overlay-bottom>*{pointer-events:auto}
    .pl-rooms-strip{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}

    /* ── Scanner donut ─────────────────────────────────────── */
    .pl-donut{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;position:relative}
    .pl-donut::before{content:'';position:absolute;inset:0;border-radius:50%;background:conic-gradient(var(--donut-color,#52b788) 0deg,var(--donut-color,#52b788) calc(var(--donut-pct,0) * 3.6deg),rgba(255,255,255,.06) calc(var(--donut-pct,0) * 3.6deg));mask:radial-gradient(transparent 56%,black 58%);-webkit-mask:radial-gradient(transparent 56%,black 58%)}
  `;
  root.appendChild(s);
}

// ── Odometer Component ───────────────────────────────────────────────────────
function Odometer({ value, size = "28px", color }) {
  const str = String(value ?? 0);
  const digits = str.split("");
  return html`
    <span className="pl-odo" style="font-size:${size};font-weight:800;color:${color || "inherit"}">
      ${digits.map((d, i) => {
        if (d === "," || d === "." || d === "-") {
          return html`<span key=${`s${i}`} style="width:.35em">${d}</span>`;
        }
        const n = parseInt(d, 10);
        if (isNaN(n)) return html`<span key=${`s${i}`}>${d}</span>`;
        return html`
          <span key=${`d${i}`} className="pl-odo-digit" style="transform:translateY(${-n}em);width:.6em">
            ${[0,1,2,3,4,5,6,7,8,9].map(v => html`<span key=${v}>${v}</span>`)}
          </span>
        `;
      })}
    </span>
  `;
}

// ── Scanner Donut ────────────────────────────────────────────────────────────
function ScannerDonut({ label, pct, color }) {
  return html`
    <div className="pl-donut" style="--donut-pct:${pct};--donut-color:${color || "#52b788"}">
      <span style="z-index:1;color:${color || "#52b788"}">${label}</span>
    </div>
  `;
}

// ── Room Pill ────────────────────────────────────────────────────────────────
function RoomPill({ room, count, color, onClick }) {
  const occupied = count > 0;
  const glowSize = Math.min(20, 8 + count * 4) + "px";
  const glowSpread = Math.min(8, 2 + count * 2) + "px";
  const glowAlpha = Math.min(0.4, 0.1 + count * 0.08);
  return html`
    <div className="pl-room-pill ${occupied ? "occupied pl-breathe" : ""}"
         style="--glow-size:${glowSize};--glow-spread:${glowSpread};--glow-alpha:${glowAlpha}"
         onClick=${onClick}>
      <span style="width:10px;height:10px;border-radius:50%;background:${color || "#52b788"};flex-shrink:0;${occupied ? `box-shadow:0 0 6px ${color || "#52b788"}` : "opacity:.4"}"></span>
      <span style="font-size:12px;font-weight:600;color:#e2e8f0;white-space:nowrap">${room}</span>
      <${Odometer} value=${count} size="14px" color=${occupied ? "#5eead4" : "#64748b"} />
    </div>
  `;
}

// ── Stats Overlay (top-left) ─────────────────────────────────────────────────
function StatsOverlay({ roomsCount, objectsTotal, radiosCount, loading }) {
  return html`
    <div className="pl-glass" style="display:flex;gap:20px;padding:10px 18px">
      <div className="pl-stat">
        <${Odometer} value=${loading ? 0 : roomsCount} size="28px" />
        <div className="pl-stat-lbl">Rooms</div>
      </div>
      <div className="pl-stat">
        <${Odometer} value=${loading ? 0 : objectsTotal} size="28px" />
        <div className="pl-stat-lbl">Objects</div>
      </div>
      <div className="pl-stat">
        <${Odometer} value=${loading ? 0 : radiosCount} size="28px" />
        <div className="pl-stat-lbl">Radios</div>
      </div>
    </div>
  `;
}

// ── Scanners Overlay (top-right) ─────────────────────────────────────────────
function ScannersOverlay({ radios, ctx }) {
  if (!radios.length) return null;
  return html`
    <div className="pl-glass-sm" style="display:flex;gap:8px;align-items:center">
      ${radios.slice(0, 8).map(r => {
        const sid = ctx.helpers.radioShortId ? ctx.helpers.radioShortId(r.source || "") : "?";
        const devCount = r.device_count ?? 0;
        const pct = Math.min(100, Math.round((devCount / Math.max(1, radios.reduce((s, x) => Math.max(s, x.device_count || 0), 1))) * 100));
        const online = r.scanning !== false;
        const color = online ? "#52b788" : "#f87171";
        return html`
          <div key=${r.source} style="cursor:pointer;text-align:center" title="${r.source}\n${r.area || "Unassigned"}\n${devCount} devices"
               onClick=${() => ctx.actions.showScannerDetail?.(r)}>
            <${ScannerDonut} label=${sid} pct=${pct} color=${color} />
            <div style="font-size:9px;color:#64748b;margin-top:2px">${devCount}</div>
          </div>
        `;
      })}
    </div>
  `;
}

// ── Room Strip (bottom overlay) ──────────────────────────────────────────────
function RoomStrip({ roomTagMap, ctx }) {
  const rooms = useMemo(() => {
    return Object.entries(roomTagMap || {})
      .map(([room, eids]) => ({ room, count: (eids || []).length }))
      .sort((a, b) => b.count - a.count || a.room.localeCompare(b.room));
  }, [roomTagMap]);

  if (!rooms.length) return null;

  const roomColorFn = ctx.helpers.roomColor;
  return html`
    <div className="pl-rooms-strip">
      ${rooms.map(r => html`
        <${RoomPill}
          key=${r.room}
          room=${r.room}
          count=${r.count}
          color=${roomColorFn ? roomColorFn(r.room) : "#52b788"}
          onClick=${() => ctx.actions.showRoomDetail?.(r.room)}
        />
      `)}
    </div>
  `;
}

// ── Status Ticker ────────────────────────────────────────────────────────────
function StatusTicker({ dataMode, radiosCount, objectsTotal, version, calStatus }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(e => (e + 1) % 5), 1000);
    return () => clearInterval(t);
  }, []);

  const knnActive = calStatus?.knn_active;
  const knnColor = knnActive ? "#52b788" : calStatus?.total_points > 0 ? "#f59e0b" : "#64748b";
  const algoName = calStatus?.positioning_algorithm === "rf" ? "RF" : "k-NN";

  return html`
    <div className="pl-ticker">
      <div style="flex:1;position:relative;height:2px;background:rgba(255,255,255,.05);border-radius:1px;overflow:hidden">
        <div className="pl-poll-bar"></div>
      </div>
      <div style="display:flex;align-items:center;gap:4px">
        <span className="pl-ticker-dot" style="background:${dataMode === "live" ? "#52b788" : "#f59e0b"}"></span>
        <span>${dataMode === "live" ? "Live" : "Sample"}</span>
      </div>
      <span>${radiosCount} scanner${radiosCount !== 1 ? "s" : ""}</span>
      <span>${objectsTotal} device${objectsTotal !== 1 ? "s" : ""}</span>
      <div style="display:flex;align-items:center;gap:4px">
        <span className="pl-ticker-dot" style="background:${knnColor}"></span>
        <span>${algoName} ${knnActive ? "active" : "ready"}</span>
      </div>
      <span style="color:#475569">v${version}</span>
    </div>
  `;
}

// ── Iso Map Bridge ───────────────────────────────────────────────────────────
let _mapNode = null;

function IsoMap({ ctx }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (_mapNode && _mapNode.isConnected && _mapNode.parentNode === containerRef.current) return;
    if (_mapNode && !_mapNode.isConnected) {
      containerRef.current.innerHTML = "";
      containerRef.current.appendChild(_mapNode);
      return;
    }

    const ovMod = window.__PADSPAN_VIEWS?.overview;
    if (!ovMod) return;

    try {
      const section = ovMod.render(ctx);
      if (!section) return;
      const mapEl = section.querySelector("[data-padspan-map]");
      if (mapEl) {
        _mapNode = mapEl;
        containerRef.current.innerHTML = "";
        containerRef.current.appendChild(mapEl);
      } else {
        _mapNode = section;
        containerRef.current.innerHTML = "";
        containerRef.current.appendChild(section);
      }
    } catch (e) {
      console.warn("[PadSpan Pure Live] Map build failed:", e);
    }
  });

  return html`<div ref=${containerRef} style="width:100%;height:100%;min-height:300px"></div>`;
}

// ── Root App ─────────────────────────────────────────────────────────────────
function PureLiveApp({ ctx }) {
  const dataMode = ctx.state.dataMode || "sample";
  const liveSnap = ctx.state.live?.snapshot || null;
  const liveLoading = dataMode === "live" && !liveSnap;
  const quietMode = !!(ctx.state.settings?.quiet_mode);

  const roomTagMap = liveLoading ? {} : (ctx.state.roomTagMap || {});
  const roomsCount = Object.keys(roomTagMap).length;
  const tagsCount = (() => {
    const s = new Set();
    for (const r of Object.keys(roomTagMap)) (roomTagMap[r] || []).forEach(eid => s.add(eid));
    return s.size;
  })();

  const objSummary = liveSnap?.objects?.summary || null;
  const objectsTotal = objSummary ? (quietMode ? objSummary.identified : objSummary.total) : tagsCount;
  const radios = liveSnap?.ble?.radios || [];
  const radiosCount = radios.length;
  const calStatus = liveSnap?.calibration_status;

  return html`
    <div className="pl-root">
      <!-- Full-bleed map area -->
      <div className="pl-map-area">
        <${IsoMap} ctx=${ctx} />

        <!-- Floating overlays on top of the map -->
        <div className="pl-overlay-top">
          <${StatsOverlay}
            roomsCount=${roomsCount}
            objectsTotal=${objectsTotal}
            radiosCount=${radiosCount}
            loading=${liveLoading}
          />
          <${ScannersOverlay} radios=${radios} ctx=${ctx} />
        </div>

        <!-- Room pills at the bottom of the map -->
        <div className="pl-overlay-bottom">
          <${RoomStrip} roomTagMap=${roomTagMap} ctx=${ctx} />
        </div>
      </div>

      <!-- Status ticker bar -->
      <${StatusTicker}
        dataMode=${dataMode}
        radiosCount=${radiosCount}
        objectsTotal=${objectsTotal}
        version=${ctx.state.version}
        calStatus=${calStatus}
      />
    </div>
  `;
}

// ── Bridge: export render(ctx) for panel.js ──────────────────────────────────
let _container = null;

export function render(ctx) {
  if (!_container || !_container.isConnected) {
    _container = document.createElement("div");
    _container.className = "purelive-root";
    _container.style.cssText = "margin:-14px;"; // bleed past panel padding
  }

  // Inject styles into the shadow root (once)
  const shadowRoot = _container.getRootNode?.();
  if (shadowRoot && shadowRoot !== document) injectStyles(shadowRoot);

  preactRender(html`<${PureLiveApp} ctx=${ctx} />`, _container);
  return _container;
}
