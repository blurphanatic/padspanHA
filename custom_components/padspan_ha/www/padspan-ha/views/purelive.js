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
let _prevDeviceRooms = {};  // {eid: room} for movement ghost detection

// ── CSS ──────────────────────────────────────────────────────────────────────
const STYLES_ID = "purelive-styles";
function injectStyles(root) {
  if (root.querySelector(`#${STYLES_ID}`)) return;
  const s = document.createElement("style");
  s.id = STYLES_ID;
  s.textContent = `
    .pl-root{display:flex;flex-direction:column;height:calc(100vh - 56px);background:#050d08;overflow:hidden}

    /* Map viewport — clips the pannable/zoomable content */
    .pl-viewport{position:absolute;inset:0;overflow:hidden;background:#071008;border-radius:8px;cursor:grab;touch-action:none}
    .pl-viewport:active{cursor:grabbing}
    .pl-viewport-inner{transform-origin:0 0;will-change:transform}

    /* Zoom controls — inside viewport, above the controls bar */
    .pl-zoom{position:absolute;bottom:52px;right:12px;z-index:6;display:flex;flex-direction:column;gap:4px}
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
    .pl-zoom-level{position:absolute;bottom:52px;left:12px;z-index:6;font-size:10px;color:#64748b;
      background:rgba(10,30,15,.5);padding:2px 8px;border-radius:6px;pointer-events:none;
      transition:opacity .3s;opacity:0}
    .pl-zoom-level.visible{opacity:1}

    /* Map controls bar */
    .pl-controls{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);z-index:7;
      background:rgba(10,30,15,.75);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
      border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:6px 14px;
      box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:pointer;display:flex;align-items:center;gap:10px;
      transition:all .2s}
    .pl-controls:hover{border-color:rgba(82,183,136,.2)}
    .pl-controls.expanded{cursor:default;padding:8px 14px;max-width:calc(100% - 120px)}
    .pl-controls input[type="range"]{height:4px;cursor:pointer}
    .pl-controls button{transition:background .15s,border-color .15s}

    /* Override overview SVG constraints inside Pure Live */
    .pl-map-wrap svg{max-height:none !important}
    .pl-map-wrap>div{overflow:visible !important;padding:0 !important}

    /* Info toggle — small button to show/hide bottom panels */
    .pl-info-toggle{position:absolute;bottom:10px;left:12px;z-index:7;width:28px;height:28px;border-radius:8px;
      border:1px solid rgba(255,255,255,.08);background:rgba(10,30,15,.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
      color:#94a3b8;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;
      transition:background .15s,color .15s}
    .pl-info-toggle:hover{background:rgba(82,183,136,.15);color:#e2e8f0}

    /* ── Scanner sonar pulse ───────────────────────── */
    @keyframes pl-sonar-ring{0%{transform:scale(.6);opacity:.5}100%{transform:scale(2.2);opacity:0}}
    .pl-sonar{position:relative;display:inline-block}
    .pl-sonar::before,.pl-sonar::after{content:'';position:absolute;inset:-3px;border-radius:50%;border:1.5px solid var(--sonar-color,#52b788);animation:pl-sonar-ring 2.5s ease-out infinite;pointer-events:none}
    .pl-sonar::after{animation-delay:1.2s}
    .pl-sonar.offline::before,.pl-sonar.offline::after{animation-play-state:paused;opacity:.2}

    /* ── Staggered bump on data change ────────────── */
    @keyframes pl-bump{0%{filter:brightness(1)}30%{filter:brightness(1.4)}100%{filter:brightness(1)}}

    /* ── Device movement ghost ────────────────────── */
    @keyframes pl-ghost-fly{0%{opacity:.8;transform:translateX(0)}100%{opacity:0;transform:translateX(40px) scale(.7)}}
    .pl-ghost{animation:pl-ghost-fly .8s ease-out forwards;pointer-events:none;font-size:10px;color:#5eead4;white-space:nowrap;padding:2px 8px;border-radius:6px;background:rgba(82,183,136,.1);border:1px solid rgba(82,183,136,.2)}

    /* ── Stat value flash on change ───────────────── */
    @keyframes pl-flash{0%{color:#5eead4}100%{color:inherit}}

    /* ── Followed device tracker ──────────────────── */
    @keyframes pl-tracked-pulse{0%,100%{box-shadow:0 0 6px rgba(251,191,36,.3)}50%{box-shadow:0 0 14px rgba(251,191,36,.5)}}
    .pl-tracked{display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;padding:4px 0;-webkit-overflow-scrolling:touch;scrollbar-width:none}
    .pl-tracked::-webkit-scrollbar{display:none}
    .pl-tracked-chip{flex-shrink:0;display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;
      border:1px solid rgba(251,191,36,.3);background:rgba(251,191,36,.06);cursor:pointer;
      animation:pl-tracked-pulse 2.5s ease-in-out infinite;transition:transform .15s}
    .pl-tracked-chip:hover{transform:scale(1.04);border-color:rgba(251,191,36,.5)}

    /* ── Activity feed ────────────────────────────── */
    .pl-feed{position:absolute;bottom:10px;left:10px;z-index:5;max-width:280px;display:flex;flex-direction:column;gap:3px;pointer-events:none}
    .pl-feed-item{font-size:10px;color:#94a3b8;padding:3px 8px;border-radius:6px;
      background:rgba(10,30,15,.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
      border:1px solid rgba(255,255,255,.04);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      animation:pl-feed-in .4s ease-out}
    @keyframes pl-feed-in{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:translateY(0)}}
    .pl-feed-item .pl-feed-time{color:#64748b}
    .pl-feed-item .pl-feed-room{color:#52b788;font-weight:600}

    @media(max-width:640px){
      .pl-stats{padding:6px 10px;gap:10px;border-radius:10px;top:6px;left:6px}
      .pl-stats-val{font-size:18px}
      .pl-scanners{top:auto;bottom:56px;right:6px;left:auto;padding:4px 6px;gap:4px;
        max-width:calc(100vw - 60px);overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
      .pl-scanners::-webkit-scrollbar{display:none}
      .pl-ticker{flex-wrap:wrap;gap:8px;justify-content:center}
      .pl-ticker>div:first-child{width:100%;order:-1}
      .pl-zoom button{width:32px;height:32px;font-size:16px}
      .pl-zoom{bottom:56px;right:6px}
      .pl-feed{bottom:56px;left:6px;max-width:200px}
      .pl-controls{bottom:6px;max-width:calc(100% - 60px);font-size:9px}
      .pl-controls.expanded{padding:6px 10px}
      .pl-info-toggle{bottom:6px;left:6px;width:24px;height:24px;font-size:11px}
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
            <div className="pl-sonar ${online ? "" : "offline"}" style="--sonar-color:${online ? "#52b788" : "#f87171"}">
              <div className="pl-scanner-dot" style="background:${online ? "#52b788" : "#f87171"}"></div>
            </div>
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

// ── SVG counter-scaling ──────────────────────────────────────────────────────
// When the viewport is zoomed, SVG text and small circles scale with it, making
// labels and dots balloon until they obscure the map.  This function stores each
// element's original size on first call, then applies inverse scaling so they
// remain the same visual size regardless of zoom level.
//
// Only targets <text> (room names, scanner labels, object labels) and small
// <circle> elements (scanner dots, object dots, layer index dots are excluded
// by radius threshold).

const _COUNTER_SCALE_ATTR = "_plOrig";

function _counterScaleSVG(container, scale) {
  const svg = container.querySelector("svg");
  if (!svg) return;
  const inv = 1 / scale;

  // Counter-scale ALL visual elements inside data-obj-key and data-scanner-src
  // groups (beacons, objects, scanners) + standalone text.  These are the
  // interactive/informational elements that should stay fixed-size on zoom.
  // Floor slab polygons and room boundary polygons are NOT touched — they
  // represent the map geometry and SHOULD scale with zoom.

  // 1. Every <g> with data-obj-key or data-scanner-src: apply inverse scale
  //    around the group's centroid so the whole beacon/scanner marker stays
  //    constant size.
  for (const g of svg.querySelectorAll("[data-obj-key],[data-scanner-src]")) {
    // Find the primary circle to use as anchor point
    const anchor = g.querySelector("circle");
    if (anchor) {
      const cx = parseFloat(anchor.getAttribute("cx")) || 0;
      const cy = parseFloat(anchor.getAttribute("cy")) || 0;
      g.setAttribute("transform", `translate(${cx},${cy}) scale(${inv}) translate(${-cx},${-cy})`);
    }
  }

  // 2. Standalone text NOT inside a data-obj/scanner group (room names, floor labels)
  for (const txt of svg.querySelectorAll("text")) {
    if (txt.closest("[data-obj-key],[data-scanner-src]")) continue; // handled above
    const x = parseFloat(txt.getAttribute("x")) || 0;
    const y = parseFloat(txt.getAttribute("y")) || 0;
    txt.setAttribute("transform", `translate(${x},${y}) scale(${inv}) translate(${-x},${-y})`);
  }

  // 3. Floor index badges (large circles at slab corners, r=15) — counter-scale
  for (const c of svg.querySelectorAll("circle")) {
    if (c.closest("[data-obj-key],[data-scanner-src]")) continue; // handled above
    const origR = c[_COUNTER_SCALE_ATTR];
    const r = origR != null ? origR : parseFloat(c.getAttribute("r")) || 0;
    if (origR == null) c[_COUNTER_SCALE_ATTR] = r;
    if (r >= 15) {
      // Floor index badge — counter-scale
      c.setAttribute("r", String(Math.max(8, r * inv)));
    }
  }

  // 4. Stroke widths on room polygons and barriers — keep thin at any zoom
  for (const el of svg.querySelectorAll("polygon, polyline")) {
    if (el.closest("[data-obj-key],[data-scanner-src]")) continue;
    const origSW = el[_COUNTER_SCALE_ATTR];
    const sw = origSW != null ? origSW : parseFloat(el.getAttribute("stroke-width")) || 0;
    if (origSW == null) el[_COUNTER_SCALE_ATTR] = sw;
    if (sw > 0) {
      el.setAttribute("stroke-width", String(Math.max(0.3, sw * inv)));
    }
  }
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
      // Counter-scale SVG text and circles so labels and dots stay the same
      // visual size at any zoom level.  Without this, zooming in makes room
      // names, scanner labels, and dots bloat until they obscure the detail
      // you zoomed in to see.
      _counterScaleSVG(innerRef.current, s.scale);
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
// Embeds the overview's 3D isometric SVG.  All overview controls are hidden;
// Pure Live provides its own compact control bar (MapControls component).

function _cleanupMapElement(map) {
  // The overview map element (outer) contains:
  //   ctrlRow, isoOverlayCtrl, isoWrap (position:relative), roomListPanel
  //
  // isoWrap contains: isoDiv (overflow:auto, the SVG scroll container) + isoTipEl
  //
  // Pure Live only needs isoWrap → isoDiv → SVG.  Hide everything else.
  // Only touch DIRECT children of map and DIRECT children of isoWrap — never
  // recurse deeper or we'll break the SVG content itself.

  for (const child of [...map.children]) {
    const css = child.style?.cssText || "";
    if (css.includes("position") && css.includes("relative")) {
      // This is isoWrap — keep it, but fix its direct children only
      child.style.marginTop = "0";
      child.classList.add("pl-map-wrap");
      for (const inner of [...child.children]) {
        if (inner.style) {
          // isoDiv has overflow:auto — change to visible
          if (inner.style.overflow) inner.style.overflow = "visible";
          // Remove padding that adds dead space
          inner.style.padding = "0";
        }
      }
    } else {
      // Hide everything that isn't the SVG wrapper
      child.style.display = "none";
    }
  }
  map.style.margin = "0";
  map.style.padding = "0";
}

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

      _cleanupMapElement(map);
      _mapNode = map;
      ref.current.innerHTML = "";
      ref.current.appendChild(map);
    } catch (e) {
      console.warn("[Pure Live] Map build:", e);
    }
  });

  return html`<div ref=${ref}></div>`;
}

// ── Map Controls (compact floating bar) ──────────────────────────────────────
// Pure Live's own control bar — modifies ctx.state and forces a map rebuild.
// Compact single-row design that sits at the bottom of the map viewport.

function MapControls({ ctx }) {
  const settings = ctx.state.settings || {};
  const floors = ctx.state.model?.floors || [];

  // Floor focus — read from same state the overview uses
  const [focusIdx, setFocusIdx] = useState(ctx.state._overviewIsoFocusIdx ?? settings.overview_iso_focus ?? 0);
  const [gap, setGap] = useState(ctx.state._overviewFloorGap ?? settings.overview_iso_floor_gap ?? 150);
  const [lr, setLr] = useState(ctx.state._overviewHorizGap ?? settings.overview_iso_horiz_gap ?? 0);
  const [expanded, setExpanded] = useState(false);

  // Compute floor label from focus index
  const maps = (ctx.state.maps?.list) || [];
  const sortedLevels = [...new Set(maps.map(m => m.stack?.z_level ?? 0))].sort((a, b) => a - b);
  // Build positions: all → l0 → l0+l1 → l1 → ...
  const positions = useMemo(() => {
    const p = [null];
    for (let i = 0; i < sortedLevels.length; i++) {
      p.push(sortedLevels[i]);
      if (i < sortedLevels.length - 1) p.push([sortedLevels[i], sortedLevels[i + 1]]);
    }
    return p;
  }, [sortedLevels.join(",")]);

  const maxIdx = positions.length - 1;
  const getFocusLabel = (idx) => {
    const pos = positions[Math.max(0, Math.min(idx, maxIdx))];
    if (pos === null) return "All";
    const zArr = Array.isArray(pos) ? pos : [pos];
    return zArr.map(z => {
      const f = floors.find(x => x.level === z);
      return f ? (f.name || `L${z}`) : `L${z}`;
    }).join("+");
  };

  const rebuild = () => {
    _mapNode = null; // force full rebuild on next render
    ctx.actions.renderRooms();
  };

  const onFocus = (e) => {
    const v = parseInt(e.target.value, 10);
    setFocusIdx(v);
    ctx.state._overviewIsoFocusIdx = v;
    rebuild();
  };
  const onGap = (e) => {
    const v = parseInt(e.target.value, 10);
    setGap(v);
    ctx.state._overviewFloorGap = v;
    rebuild();
  };
  const onLr = (e) => {
    const v = parseInt(e.target.value, 10);
    setLr(v);
    ctx.state._overviewHorizGap = v;
    rebuild();
  };

  const save = async () => {
    try {
      await ctx.actions.settingsSet({
        overview_iso_floor_gap: gap,
        overview_iso_horiz_gap: lr,
        overview_iso_focus: focusIdx,
      });
    } catch (e) { /* silent */ }
  };

  // Toggle buttons for walls, persistent pins, heatmap, distortion
  const [walls, setWalls] = useState(!!ctx.state._overviewShowWalls);
  const [pins, setPins] = useState(!!ctx.state._overviewPersistentPins);
  const [heat, setHeat] = useState(!!ctx.state._overviewShowHeatmap);
  const [dist, setDist] = useState(!!ctx.state._overviewShowDistortion);

  const toggleWalls = () => { const v = !walls; setWalls(v); ctx.state._overviewShowWalls = v; rebuild(); };
  const togglePins = () => { const v = !pins; setPins(v); ctx.state._overviewPersistentPins = v; rebuild(); };
  const toggleHeat = () => {
    const v = !heat; setHeat(v); ctx.state._overviewShowHeatmap = v;
    if (v) { setDist(false); ctx.state._overviewShowDistortion = false; }
    rebuild();
  };
  const toggleDist = () => {
    const v = !dist; setDist(v); ctx.state._overviewShowDistortion = v;
    if (v) { setHeat(false); ctx.state._overviewShowHeatmap = false; }
    rebuild();
  };

  const btnStyle = (on, onColor = "#52b788", onBg = "rgba(82,183,136,.15)") =>
    `padding:2px 8px;font-size:10px;border-radius:6px;border:1px solid ${on ? onColor + "80" : "rgba(255,255,255,.1)"};` +
    `background:${on ? onBg : "transparent"};color:${on ? onColor : "#64748b"};cursor:pointer;white-space:nowrap`;

  if (!expanded) {
    return html`
      <div className="pl-controls" onClick=${() => setExpanded(true)}>
        <span style="font-size:10px;color:#94a3b8;cursor:pointer">Controls</span>
        <span style="font-size:10px;color:#64748b">${getFocusLabel(focusIdx)}</span>
      </div>
    `;
  }

  return html`
    <div className="pl-controls expanded">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:10px;color:#94a3b8;white-space:nowrap">Floor:</span>
        <input type="range" min="0" max=${maxIdx} value=${focusIdx} onInput=${onFocus}
               style="width:80px;accent-color:#52b788" />
        <span style="font-size:10px;color:#5eead4;min-width:40px">${getFocusLabel(focusIdx)}</span>

        ${sortedLevels.length > 1 && html`<${_Fragment}>
          <span style="font-size:10px;color:#94a3b8;white-space:nowrap">Gap:</span>
          <input type="range" min="60" max="340" step="10" value=${gap} onInput=${onGap}
                 style="width:60px;accent-color:#52b788" />
          <span style="font-size:10px;color:#94a3b8;white-space:nowrap">L/R:</span>
          <input type="range" min="-120" max="120" step="10" value=${lr} onInput=${onLr}
                 style="width:60px;accent-color:#52b788" />
        </${_Fragment}>`}

        <button style=${btnStyle(walls, "#a5b4fc", "rgba(99,102,241,.15)")} onClick=${toggleWalls}>
          Walls${walls ? " ON" : ""}
        </button>
        <button style=${btnStyle(pins, "#fca5a5", "rgba(239,68,68,.12)")} onClick=${togglePins}>
          Pins${pins ? " ON" : ""}
        </button>
        ${!!(settings.radio_map_enabled) && html`
          <button style=${btnStyle(heat, "#d8b4fe", "rgba(168,85,247,.15)")} onClick=${toggleHeat}>
            Heat${heat ? " ON" : ""}
          </button>
        `}
        ${!!(settings.distortion_map_enabled) && html`
          <button style=${btnStyle(dist, "#fdba74", "rgba(249,115,22,.15)")} onClick=${toggleDist}>
            Warp${dist ? " ON" : ""}
          </button>
        `}

        <button style="padding:2px 8px;font-size:10px;border-radius:6px;border:1px solid rgba(82,183,136,.3);background:transparent;color:#52b788;cursor:pointer"
                onClick=${save}>Save</button>
        <button style="padding:2px 8px;font-size:10px;border-radius:6px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#64748b;cursor:pointer"
                onClick=${() => setExpanded(false)}>Collapse</button>
      </div>
    </div>
  `;
}

// Preact Fragment shim (htm doesn't have <> shorthand)
const _Fragment = ({ children }) => children;

// ── Radio List (bottom strip) ────────────────────────────────────────────────
function RadioStrip({ radios, ctx }) {
  if (!radios.length) return null;
  return html`
    <div style="display:flex;gap:8px;padding:6px 12px;overflow-x:auto;background:rgba(10,21,14,.5);border-top:1px solid rgba(82,183,136,.1);flex-shrink:0;-webkit-overflow-scrolling:touch">
      ${radios.map(r => {
        const sid = ctx.helpers.radioShortId ? ctx.helpers.radioShortId(r.source || "") : "?";
        const online = r.scanning !== false;
        const area = r.area || r.area_name || "";
        const devs = r.device_count ?? 0;
        const color = online ? "#52b788" : "#f87171";
        return html`
          <div key=${r.source} style="flex-shrink:0;display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);cursor:pointer;font-size:11px"
               title="${r.source}"
               onClick=${() => ctx.actions.showScannerDetail?.(r)}>
            <span className="pl-sonar ${online ? "" : "offline"}" style="--sonar-color:${color};width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
            <span style="font-weight:700;color:${color}">${sid}</span>
            ${area && html`<span style="color:#94a3b8">${area}</span>`}
            <span style="color:#64748b">${devs} dev</span>
          </div>
        `;
      })}
    </div>
  `;
}

// ── Movement Ghosts ──────────────────────────────────────────────────────────
// Shows a brief animated label when a device moves between rooms.
function MovementGhosts({ roomTagMap }) {
  const [ghosts, setGhosts] = useState([]);

  useEffect(() => {
    const current = {};
    for (const [room, eids] of Object.entries(roomTagMap || {})) {
      for (const eid of (eids || [])) current[eid] = room;
    }
    const newG = [];
    for (const [eid, room] of Object.entries(current)) {
      const prev = _prevDeviceRooms[eid];
      if (prev && prev !== room) {
        newG.push({ id: `${eid}-${Date.now()}`, label: String(eid).substring(0, 14), from: prev, to: room });
      }
    }
    _prevDeviceRooms = current;
    if (newG.length) {
      setGhosts(g => [...g, ...newG].slice(-8));
      setTimeout(() => setGhosts(g => g.filter(x => !newG.find(n => n.id === x.id))), 900);
    }
  }, [roomTagMap]);

  if (!ghosts.length) return null;
  return html`
    <div style="position:absolute;top:50px;left:10px;z-index:7;display:flex;flex-direction:column;gap:4px;pointer-events:none">
      ${ghosts.map(g => html`<div key=${g.id} className="pl-ghost">${g.label} → ${g.to}</div>`)}
    </div>
  `;
}

// ── Followed Device Tracker ──────────────────────────────────────────────────
// Shows followed devices as golden pulsing chips with their current room.
function FollowedTracker({ ctx, snap }) {
  const followed = ctx.state.followedAddrs;
  if (!followed || !followed.size) return null;

  const objList = snap?.objects?.list || [];
  const devices = [];
  for (const o of objList) {
    const addr = (o.address || o.entity_id || o.key || "").toUpperCase();
    if (!addr) continue;
    const isFollowed = followed.has(addr) ||
      (o.all_addresses && o.all_addresses.some(a => followed.has(String(a).toUpperCase())));
    if (!isFollowed) continue;
    devices.push({
      key: addr,
      label: o.user_label || o.private_ble_name || o.name || addr.substring(0, 12),
      room: o.room || "Unknown",
      rssi: o.rssi,
      age: o.age_s,
    });
  }

  if (!devices.length) return null;

  return html`
    <div style="padding:4px 12px;flex-shrink:0;border-top:1px solid rgba(251,191,36,.1);background:rgba(251,191,36,.02)">
      <div style="font-size:9px;color:#fbbf24;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;font-weight:600">Tracked Devices</div>
      <div className="pl-tracked">
        ${devices.map(d => html`
          <div key=${d.key} className="pl-tracked-chip"
               onClick=${() => ctx.actions.showObjectDetail?.({address: d.key, key: d.key})}>
            <span style="font-size:11px;font-weight:700;color:#fbbf24">${d.label}</span>
            <span style="font-size:10px;color:#94a3b8">in</span>
            <span style="font-size:11px;font-weight:600;color:#5eead4">${d.room}</span>
            ${d.rssi != null && html`<span style="font-size:9px;color:#64748b">${d.rssi}dBm</span>`}
          </div>
        `)}
      </div>
    </div>
  `;
}

// ── Activity Feed ────────────────────────────────────────────────────────────
// Scrolling log of recent room changes, newest at top. Fed by MovementGhosts data.
let _activityLog = [];  // persistent across renders

function ActivityFeed({ roomTagMap }) {
  const [feed, setFeed] = useState(_activityLog);

  useEffect(() => {
    const current = {};
    for (const [room, eids] of Object.entries(roomTagMap || {})) {
      for (const eid of (eids || [])) current[eid] = room;
    }
    const newEntries = [];
    const now = new Date();
    for (const [eid, room] of Object.entries(current)) {
      const prev = _prevDeviceRooms[eid];
      // Don't duplicate — MovementGhosts already updates _prevDeviceRooms, so only
      // capture entries that MovementGhosts would have also detected.
      // We read from _prevDeviceRooms BEFORE MovementGhosts updates it in the same cycle.
      // Since both run in the same render, we need to check our own log to avoid dupes.
      if (prev && prev !== room) {
        const label = String(eid).substring(0, 14);
        const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        newEntries.push({ id: `${eid}-${now.getTime()}`, label, from: prev, to: room, time });
      }
    }
    if (newEntries.length) {
      _activityLog = [...newEntries, ..._activityLog].slice(0, 20);
      setFeed(_activityLog);
    }
  }, [roomTagMap]);

  if (!feed.length) return null;

  return html`
    <div className="pl-feed">
      ${feed.slice(0, 6).map(e => html`
        <div key=${e.id} className="pl-feed-item">
          <span className="pl-feed-time">${e.time}</span>${" "}
          ${e.label} → <span className="pl-feed-room">${e.to}</span>
        </div>
      `)}
    </div>
  `;
}

// ── Info Toggle Button ────────────────────────────────────────────────────────
function InfoToggle({ visible, onToggle }) {
  return html`
    <button className="pl-info-toggle" onClick=${onToggle}
            title=${visible ? "Hide info panels" : "Show info panels"}>
      ${visible ? "\u25BC" : "\u2139"}
    </button>
  `;
}

// ── Root ─────────────────────────────────────────────────────────────────────
function App({ ctx }) {
  const mode = ctx.state.dataMode || "sample";
  const snap = ctx.state.live?.snapshot || null;
  const loading = mode === "live" && !snap;
  const quiet = !!(ctx.state.settings?.quiet_mode);
  const [infoVisible, setInfoVisible] = useState(false);

  const rtm = loading ? {} : (ctx.state.roomTagMap || {});
  const rooms = Object.keys(rtm).length;
  const tags = (() => { const s = new Set(); for (const r of Object.keys(rtm)) (rtm[r]||[]).forEach(e => s.add(e)); return s.size; })();

  const sum = snap?.objects?.summary;
  const objects = sum ? (quiet ? sum.identified : sum.total) : tags;
  const radios = snap?.ble?.radios || [];
  const cal = snap?.calibration_status;

  return html`
    <div className="pl-root">
      <div style="flex:1;position:relative;min-height:0">
        <${MapViewport}>
          <${IsoMap} ctx=${ctx} />
        <//>
        <${Stats} rooms=${rooms} objects=${objects} radios=${radios.length} loading=${loading} />
        <${Scanners} radios=${radios} ctx=${ctx} />
        <${MovementGhosts} roomTagMap=${rtm} />
        <${ActivityFeed} roomTagMap=${rtm} />
        <${MapControls} ctx=${ctx} />
        <${InfoToggle} visible=${infoVisible} onToggle=${() => setInfoVisible(v => !v)} />
      </div>
      ${infoVisible && html`<${_Fragment}>
        <${FollowedTracker} ctx=${ctx} snap=${snap} />
        <${RadioStrip} radios=${radios} ctx=${ctx} />
        <${Ticker} dataMode=${mode} radios=${radios.length} objects=${objects} version=${ctx.state.version} cal=${cal} />
      </${_Fragment}>`}
    </div>
  `;
}

// ── Bridge ───────────────────────────────────────────────────────────────────
let _container = null;

export function render(ctx) {
  if (!_container || !_container.isConnected) {
    _container = document.createElement("div");
    _container.style.cssText = "margin:-16px -16px -80px;";
  }

  const root = _container.getRootNode?.();
  if (root && root !== document) injectStyles(root);

  preactRender(html`<${App} ctx=${ctx} />`, _container);
  return _container;
}
