// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
/**
 * Pure Live — zero-flicker immersive dashboard
 *
 * Full isometric map with pan/zoom controls, floating glass stat overlays,
 * and a status ticker. Built with Preact for efficient DOM diffing.
 * Map supports: scroll-to-zoom, pinch-to-zoom, click-drag pan, double-tap reset.
 */

import { h, render as preactRender, html } from "../lib/preact-bundle.js";
import { useState, useEffect, useRef, useMemo } from "../lib/preact-bundle.js";

// ── Persistent state ─────────────────────────────────────────────────────────
let _mapNode = null;

// ── CSS ──────────────────────────────────────────────────────────────────────
const STYLES_ID = "purelive-styles";
function injectStyles(root) {
  if (root.querySelector(`#${STYLES_ID}`)) return;
  const s = document.createElement("style");
  s.id = STYLES_ID;
  s.textContent = `
    .pl-root{display:flex;flex-direction:column;min-height:calc(100vh - 140px);background:#050d08}

    /* Map viewport — clips the pannable/zoomable content */
    .pl-viewport{flex:1;position:relative;overflow:hidden;background:#071008;border-radius:8px;cursor:grab;touch-action:none}
    .pl-viewport:active{cursor:grabbing}
    .pl-viewport-inner{transform-origin:0 0;will-change:transform}

    /* Zoom controls */
    .pl-zoom{position:absolute;bottom:12px;right:12px;z-index:6;display:flex;flex-direction:column;gap:4px}
    .pl-zoom button{width:36px;height:36px;border-radius:10px;border:1px solid rgba(255,255,255,.1);
      background:rgba(10,30,15,.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
      color:#e2e8f0;font-size:18px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;
      transition:background .15s}
    .pl-zoom button:hover{background:rgba(82,183,136,.2)}
    .pl-zoom button:active{transform:scale(.92)}

    /* Floating stats */
    .pl-stats{position:absolute;top:10px;left:10px;z-index:5;display:flex;gap:16px;
      background:rgba(10,30,15,.6);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
      border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:8px 16px;
      box-shadow:0 6px 24px rgba(0,0,0,.3);color:#e2e8f0}
    .pl-stats-item{text-align:center;min-width:48px}
    .pl-stats-val{font-size:22px;font-weight:800;line-height:1.1}
    .pl-stats-lbl{font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-top:1px}

    /* Scanners */
    .pl-scanners{position:absolute;top:10px;right:10px;z-index:5;display:flex;gap:6px;
      background:rgba(10,30,15,.5);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
      border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:6px 10px;
      box-shadow:0 4px 16px rgba(0,0,0,.25)}
    .pl-scanner{text-align:center;cursor:pointer;min-width:32px}
    .pl-scanner-id{font-size:10px;font-weight:700}
    .pl-scanner-cnt{font-size:8px;color:#64748b;margin-top:1px}
    .pl-scanner-dot{width:6px;height:6px;border-radius:50%;margin:2px auto 0}

    /* Odometer */
    .pl-odo{display:inline-flex;overflow:hidden;height:1em;line-height:1em;font-variant-numeric:tabular-nums}
    .pl-odo-digit{display:flex;flex-direction:column;transition:transform .5s cubic-bezier(.22,1,.36,1)}
    .pl-odo-digit span{display:block;height:1em;text-align:center}

    /* Ticker */
    .pl-ticker{display:flex;align-items:center;gap:14px;padding:6px 14px;font-size:11px;color:#94a3b8;
      background:rgba(10,21,14,.7);border-top:1px solid rgba(82,183,136,.12);flex-shrink:0}
    .pl-ticker-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
    @keyframes pl-poll{0%{width:0}100%{width:100%}}
    .pl-poll{height:2px;background:linear-gradient(90deg,#52b788,#5eead4);border-radius:1px;animation:pl-poll 5s linear infinite}

    /* Zoom level indicator */
    .pl-zoom-level{position:absolute;bottom:12px;left:12px;z-index:6;font-size:10px;color:#64748b;
      background:rgba(10,30,15,.5);padding:2px 8px;border-radius:6px;pointer-events:none;
      transition:opacity .3s;opacity:0}
    .pl-zoom-level.visible{opacity:1}

    @media(max-width:640px){
      .pl-stats{padding:6px 10px;gap:10px;border-radius:10px}
      .pl-stats-val{font-size:18px}
      .pl-scanners{padding:4px 6px;gap:4px}
      .pl-ticker{flex-wrap:wrap;gap:8px;justify-content:center}
      .pl-ticker>div:first-child{width:100%;order:-1}
      .pl-zoom button{width:32px;height:32px;font-size:16px}
    }
  `;
  root.appendChild(s);
}

// ── Odometer ─────────────────────────────────────────────────────────────────
function Odometer({ value, size = "22px", color }) {
  const str = String(value ?? 0);
  return html`
    <span className="pl-odo" style="font-size:${size};font-weight:800;color:${color || "inherit"}">
      ${str.split("").map((d, i) => {
        const n = parseInt(d, 10);
        if (isNaN(n)) return html`<span key=${`s${i}`} style="width:.3em">${d}</span>`;
        return html`
          <span key=${`d${i}`} className="pl-odo-digit" style="transform:translateY(${-n}em);width:.6em">
            ${[0,1,2,3,4,5,6,7,8,9].map(v => html`<span key=${v}>${v}</span>`)}
          </span>
        `;
      })}
    </span>
  `;
}

// ── Stats Overlay ────────────────────────────────────────────────────────────
function Stats({ rooms, objects, radios, loading }) {
  return html`
    <div className="pl-stats">
      <div className="pl-stats-item">
        <div className="pl-stats-val"><${Odometer} value=${loading ? 0 : rooms} /></div>
        <div className="pl-stats-lbl">Rooms</div>
      </div>
      <div className="pl-stats-item">
        <div className="pl-stats-val"><${Odometer} value=${loading ? 0 : objects} /></div>
        <div className="pl-stats-lbl">Objects</div>
      </div>
      <div className="pl-stats-item">
        <div className="pl-stats-val"><${Odometer} value=${loading ? 0 : radios} /></div>
        <div className="pl-stats-lbl">Radios</div>
      </div>
    </div>
  `;
}

// ── Scanners Overlay ─────────────────────────────────────────────────────────
function Scanners({ radios, ctx }) {
  if (!radios.length) return null;
  return html`
    <div className="pl-scanners">
      ${radios.slice(0, 10).map(r => {
        const sid = ctx.helpers.radioShortId ? ctx.helpers.radioShortId(r.source || "") : "?";
        const online = r.scanning !== false;
        return html`
          <div key=${r.source} className="pl-scanner"
               title="${r.source}\n${r.area || ""}\n${r.device_count ?? 0} devices"
               onClick=${() => ctx.actions.showScannerDetail?.(r)}>
            <div className="pl-scanner-id" style="color:${online ? "#52b788" : "#f87171"}">${sid}</div>
            <div className="pl-scanner-cnt">${r.device_count ?? 0}</div>
            <div className="pl-scanner-dot" style="background:${online ? "#52b788" : "#f87171"}"></div>
          </div>
        `;
      })}
    </div>
  `;
}

// ── Ticker ───────────────────────────────────────────────────────────────────
function Ticker({ dataMode, radios, objects, version, cal }) {
  const knn = cal?.knn_active;
  const algo = cal?.positioning_algorithm === "rf" ? "RF" : "k-NN";
  return html`
    <div className="pl-ticker">
      <div style="flex:1;height:2px;background:rgba(255,255,255,.05);border-radius:1px;overflow:hidden">
        <div className="pl-poll"></div>
      </div>
      <div style="display:flex;align-items:center;gap:4px">
        <span className="pl-ticker-dot" style="background:${dataMode === "live" ? "#52b788" : "#f59e0b"}"></span>
        ${dataMode === "live" ? "Live" : "Sample"}
      </div>
      <span>${radios} scanners</span>
      <span>${objects} devices</span>
      <div style="display:flex;align-items:center;gap:4px">
        <span className="pl-ticker-dot" style="background:${knn ? "#52b788" : "#64748b"}"></span>
        ${algo} ${knn ? "active" : "ready"}
      </div>
      <span style="color:#475569">v${version}</span>
    </div>
  `;
}

// ── Pan/Zoom Map Viewport ────────────────────────────────────────────────────
// Wraps the iso map with mouse drag-to-pan, scroll-to-zoom, pinch-to-zoom,
// and double-click/double-tap to reset.

function MapViewport({ children }) {
  const viewportRef = useRef(null);
  const innerRef = useRef(null);
  const stateRef = useRef({ scale: 1, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0, startTx: 0, startTy: 0, pinchDist: 0, pinchScale: 1 });
  const [zoomPct, setZoomPct] = useState(100);
  const [showZoom, setShowZoom] = useState(false);
  const zoomTimerRef = useRef(null);

  const MIN_SCALE = 0.3;
  const MAX_SCALE = 5;

  const applyTransform = () => {
    const s = stateRef.current;
    if (innerRef.current) {
      innerRef.current.style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.scale})`;
    }
    setZoomPct(Math.round(s.scale * 100));
    setShowZoom(true);
    clearTimeout(zoomTimerRef.current);
    zoomTimerRef.current = setTimeout(() => setShowZoom(false), 1500);
  };

  const zoomAt = (cx, cy, factor) => {
    const s = stateRef.current;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s.scale * factor));
    const ratio = newScale / s.scale;
    s.tx = cx - ratio * (cx - s.tx);
    s.ty = cy - ratio * (cy - s.ty);
    s.scale = newScale;
    applyTransform();
  };

  const resetView = () => {
    const s = stateRef.current;
    s.scale = 1; s.tx = 0; s.ty = 0;
    applyTransform();
  };

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    // Mouse wheel zoom
    const onWheel = (e) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      zoomAt(cx, cy, factor);
    };

    // Mouse drag pan
    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      // Don't start pan if clicking on a button, input, or interactive element
      if (e.target.closest("button,input,select,a,[data-tip],[data-obj-key],[data-scanner-src]")) return;
      const s = stateRef.current;
      s.dragging = true; s.startX = e.clientX; s.startY = e.clientY; s.startTx = s.tx; s.startTy = s.ty;
    };
    const onMouseMove = (e) => {
      const s = stateRef.current;
      if (!s.dragging) return;
      s.tx = s.startTx + (e.clientX - s.startX);
      s.ty = s.startTy + (e.clientY - s.startY);
      applyTransform();
    };
    const onMouseUp = () => { stateRef.current.dragging = false; };

    // Touch: pinch zoom + drag pan
    const onTouchStart = (e) => {
      const s = stateRef.current;
      if (e.touches.length === 1) {
        if (e.target.closest("button,input,select,a,[data-tip],[data-obj-key],[data-scanner-src]")) return;
        s.dragging = true; s.startX = e.touches[0].clientX; s.startY = e.touches[0].clientY; s.startTx = s.tx; s.startTy = s.ty;
      } else if (e.touches.length === 2) {
        s.dragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        s.pinchDist = Math.sqrt(dx * dx + dy * dy);
        s.pinchScale = s.scale;
      }
    };
    const onTouchMove = (e) => {
      e.preventDefault();
      const s = stateRef.current;
      if (e.touches.length === 1 && s.dragging) {
        s.tx = s.startTx + (e.touches[0].clientX - s.startX);
        s.ty = s.startTy + (e.touches[0].clientY - s.startY);
        applyTransform();
      } else if (e.touches.length === 2 && s.pinchDist > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s.pinchScale * (dist / s.pinchDist)));
        const rect = vp.getBoundingClientRect();
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        const ratio = newScale / s.scale;
        s.tx = cx - ratio * (cx - s.tx);
        s.ty = cy - ratio * (cy - s.ty);
        s.scale = newScale;
        applyTransform();
      }
    };
    const onTouchEnd = () => { stateRef.current.dragging = false; stateRef.current.pinchDist = 0; };

    // Double-click/tap to reset
    const onDblClick = (e) => {
      if (e.target.closest("button,input,select,a")) return;
      resetView();
    };

    vp.addEventListener("wheel", onWheel, { passive: false });
    vp.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    vp.addEventListener("touchstart", onTouchStart, { passive: false });
    vp.addEventListener("touchmove", onTouchMove, { passive: false });
    vp.addEventListener("touchend", onTouchEnd);
    vp.addEventListener("dblclick", onDblClick);

    return () => {
      vp.removeEventListener("wheel", onWheel);
      vp.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      vp.removeEventListener("touchstart", onTouchStart);
      vp.removeEventListener("touchmove", onTouchMove);
      vp.removeEventListener("touchend", onTouchEnd);
      vp.removeEventListener("dblclick", onDblClick);
    };
  }, []);

  return html`
    <div className="pl-viewport" ref=${viewportRef}>
      <div className="pl-viewport-inner" ref=${innerRef}>
        ${children}
      </div>
      <div className="pl-zoom">
        <button onClick=${() => { const r = viewportRef.current?.getBoundingClientRect(); if(r) zoomAt(r.width/2, r.height/2, 1.3); }} title="Zoom in">+</button>
        <button onClick=${() => { const r = viewportRef.current?.getBoundingClientRect(); if(r) zoomAt(r.width/2, r.height/2, 0.77); }} title="Zoom out">−</button>
        <button onClick=${resetView} title="Reset view" style="font-size:13px">⌂</button>
      </div>
      <div className="pl-zoom-level ${showZoom ? "visible" : ""}">${zoomPct}%</div>
    </div>
  `;
}

// ── Iso Map Bridge ───────────────────────────────────────────────────────────
// Keeps ALL overview controls (floor slider, spacing, etc.) — no stripping.

function IsoMap({ ctx }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    if (_mapNode && _mapNode.isConnected && _mapNode.parentNode === ref.current) return;
    if (_mapNode && !_mapNode.isConnected) {
      ref.current.innerHTML = "";
      ref.current.appendChild(_mapNode);
      return;
    }

    const ov = window.__PADSPAN_VIEWS?.overview;
    if (!ov) return;

    try {
      const section = ov.render(ctx);
      if (!section) return;
      const map = section.querySelector("[data-padspan-map]");
      if (!map) return;

      // Keep everything — controls, SVG, room list. No stripping.
      _mapNode = map;
      ref.current.innerHTML = "";
      ref.current.appendChild(map);
    } catch (e) {
      console.warn("[Pure Live] Map build:", e);
    }
  });

  return html`<div ref=${ref}></div>`;
}

// ── Root ─────────────────────────────────────────────────────────────────────
function App({ ctx }) {
  const mode = ctx.state.dataMode || "sample";
  const snap = ctx.state.live?.snapshot || null;
  const loading = mode === "live" && !snap;
  const quiet = !!(ctx.state.settings?.quiet_mode);

  const rtm = loading ? {} : (ctx.state.roomTagMap || {});
  const rooms = Object.keys(rtm).length;
  const tags = (() => { const s = new Set(); for (const r of Object.keys(rtm)) (rtm[r]||[]).forEach(e => s.add(e)); return s.size; })();

  const sum = snap?.objects?.summary;
  const objects = sum ? (quiet ? sum.identified : sum.total) : tags;
  const radios = snap?.ble?.radios || [];
  const cal = snap?.calibration_status;

  return html`
    <div className="pl-root">
      <${MapViewport}>
        <${IsoMap} ctx=${ctx} />
        <${Stats} rooms=${rooms} objects=${objects} radios=${radios.length} loading=${loading} />
        <${Scanners} radios=${radios} ctx=${ctx} />
      <//>
      <${Ticker} dataMode=${mode} radios=${radios.length} objects=${objects} version=${ctx.state.version} cal=${cal} />
    </div>
  `;
}

// ── Bridge ───────────────────────────────────────────────────────────────────
let _container = null;

export function render(ctx) {
  if (!_container || !_container.isConnected) {
    _container = document.createElement("div");
    _container.style.cssText = "margin:-14px;";
  }

  const root = _container.getRootNode?.();
  if (root && root !== document) injectStyles(root);

  preactRender(html`<${App} ctx=${ctx} />`, _container);
  return _container;
}
