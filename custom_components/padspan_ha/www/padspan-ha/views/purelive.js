// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
/**
 * Pure Live — zero-flicker immersive dashboard
 *
 * Simple layout: full-width isometric map with floating glass stat pills
 * and a status ticker. Built with Preact for efficient DOM diffing.
 */

import { h, render as preactRender, html } from "../lib/preact-bundle.js";
import { useState, useEffect, useRef, useMemo } from "../lib/preact-bundle.js";

// ── CSS ──────────────────────────────────────────────────────────────────────
const STYLES_ID = "purelive-styles";
function injectStyles(root) {
  if (root.querySelector(`#${STYLES_ID}`)) return;
  const s = document.createElement("style");
  s.id = STYLES_ID;
  s.textContent = `
    .pl-root{display:flex;flex-direction:column;min-height:calc(100vh - 140px);background:#050d08}

    /* Map takes all available space */
    .pl-map{flex:1;position:relative;overflow:auto;background:#071008;border-radius:8px}

    /* Floating stats — absolutely positioned over the map */
    .pl-stats{position:absolute;top:10px;left:10px;z-index:5;display:flex;gap:16px;
      background:rgba(10,30,15,.6);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
      border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:8px 16px;
      box-shadow:0 6px 24px rgba(0,0,0,.3);color:#e2e8f0}
    .pl-stats-item{text-align:center;min-width:48px}
    .pl-stats-val{font-size:22px;font-weight:800;line-height:1.1}
    .pl-stats-lbl{font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-top:1px}

    /* Scanners — top right */
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

    @media(max-width:640px){
      .pl-stats{padding:6px 10px;gap:10px;border-radius:10px}
      .pl-stats-val{font-size:18px}
      .pl-scanners{padding:4px 6px;gap:4px}
      .pl-ticker{flex-wrap:wrap;gap:8px;justify-content:center}
      .pl-ticker>div:first-child{width:100%;order:-1}
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

// ── Iso Map Bridge ───────────────────────────────────────────────────────────
let _mapNode = null;

function IsoMap({ ctx }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;

    // Already mounted and connected — nothing to do
    if (_mapNode && _mapNode.isConnected && _mapNode.parentNode === ref.current) return;

    // Was detached — re-attach
    if (_mapNode && !_mapNode.isConnected) {
      ref.current.innerHTML = "";
      ref.current.appendChild(_mapNode);
      return;
    }

    // Build fresh from overview module
    const ov = window.__PADSPAN_VIEWS?.overview;
    if (!ov) return;

    try {
      const section = ov.render(ctx);
      if (!section) return;

      // Find the tagged map element
      const map = section.querySelector("[data-padspan-map]");
      if (!map) return;

      // Strip overview controls — keep only the SVG wrapper
      for (const child of [...map.children]) {
        const css = child.style?.cssText || "";
        // The iso wrapper has position:relative and contains the SVG
        if (css.includes("position") && css.includes("relative")) continue;
        child.style.display = "none";
      }

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
      <div className="pl-map">
        <${IsoMap} ctx=${ctx} />
        <${Stats} rooms=${rooms} objects=${objects} radios=${radios.length} loading=${loading} />
        <${Scanners} radios=${radios} ctx=${ctx} />
      </div>
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
