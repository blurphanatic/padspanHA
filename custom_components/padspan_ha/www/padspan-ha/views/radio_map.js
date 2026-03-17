// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Radio Map & Distortion Map — SVG overlay generators for map views.
 *
 * Radio Map: RSSI heatmap from calibration data, interpolated across the map
 *   using barrier-aware IDW (Inverse Distance Weighting). RF barriers (walls)
 *   defined in the map editor are drawn on the overlay and penalize the IDW
 *   weights — signal from a calibration point that must pass through a wall
 *   contributes less to grid cells on the other side.
 *
 * Distortion Map: For each calibration point, computes the LOO k-NN predicted
 *   position vs actual position, rendering disagreement vectors as arrows.
 *   Reveals where walls/furniture/interference cause positioning errors.
 *
 * Both output SVG strings in viewBox="0 0 1 1" space for compositing into
 * any map overlay (2D Overview, Maps tab, 3D Stack).
 *
 * Gated behind: settings.radio_map_enabled / settings.distortion_map_enabled
 */

const GRID_RES = 20;       // 20x20 interpolation grid (400 cells)
const IDW_POWER = 2.0;     // IDW exponent (higher = more local)
const KNN_K = 3;           // k for LOO cross-validation
const BARRIER_PENALTY_DB_TO_DIST = 0.01; // each dB of barrier attenuation adds this much "virtual distance"

// ── Color Scales ─────────────────────────────────────────────────────────────

// RSSI → color: green (strong) → yellow → red (weak) → gray (no data)
function _rssiColor(rssi, minR, maxR) {
  if (rssi == null) return "rgba(100,100,100,0.08)";
  const t = Math.max(0, Math.min(1, (rssi - minR) / (maxR - minR))); // 0=weak, 1=strong
  // green(strong) → yellow(mid) → red(weak)
  const r = Math.round(t < 0.5 ? 240 - t * 2 * 120 : 120 * (1 - (t - 0.5) * 2));
  const g = Math.round(t < 0.5 ? 60 + t * 2 * 180 : 240);
  const b = Math.round(40);
  return `rgba(${r},${g},${b},0.35)`;
}

// Error magnitude → color: green (low) → yellow → red (high)
function _errorColor(errFrac) {
  const t = Math.max(0, Math.min(1, errFrac / 0.25)); // 0=accurate, 1=25%+ error
  const r = Math.round(t < 0.5 ? 80 + t * 2 * 168 : 248);
  const g = Math.round(t < 0.5 ? 183 : 183 - (t - 0.5) * 2 * 120);
  const b = 40;
  return `rgb(${r},${g},${b})`;
}

// ── Line Segment Intersection ────────────────────────────────────────────────
// Returns true if segment (ax,ay)→(bx,by) intersects segment (cx,cy)→(dx,dy)

function _segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(denom) < 1e-12) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Compute total barrier attenuation (dBm) between two points.
 * Checks every barrier segment for intersections with the line (x1,y1)→(x2,y2).
 */
function _barrierAttenuation(x1, y1, x2, y2, barriers) {
  let totalDb = 0;
  for (const bar of barriers) {
    const pts = bar.points || [];
    const atten = bar.attenuation_dbm || 6;
    for (let i = 0; i < pts.length - 1; i++) {
      const [cx, cy] = pts[i];
      const [dx, dy] = pts[i + 1];
      if (_segmentsIntersect(x1, y1, x2, y2, cx, cy, dx, dy)) {
        totalDb += atten;
      }
    }
  }
  return totalDb;
}

// ── Barrier-aware IDW Interpolation ──────────────────────────────────────────

/**
 * Interpolate RSSI at (qx, qy) from calibration points using barrier-aware IDW.
 * Barriers between query point and calibration point add virtual distance,
 * reducing the weight of points on the other side of walls.
 */
function _idw(qx, qy, points, barriers) {
  if (!points.length) return null;
  let wSum = 0, vSum = 0;
  for (const p of points) {
    const dx = qx - p.x_frac;
    const dy = qy - p.y_frac;
    let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.001) return p.rssi; // exact match

    // Add virtual distance for barriers crossed
    if (barriers && barriers.length) {
      const attenDb = _barrierAttenuation(qx, qy, p.x_frac, p.y_frac, barriers);
      if (attenDb > 0) {
        dist += attenDb * BARRIER_PENALTY_DB_TO_DIST;
      }
    }

    const w = 1.0 / Math.pow(dist, IDW_POWER);
    wSum += w;
    vSum += w * p.rssi;
  }
  return wSum > 0 ? vSum / wSum : null;
}

// ── Barrier SVG Renderer ─────────────────────────────────────────────────────

/**
 * Render RF barriers as dashed lines on the overlay.
 */
function _barriersSVG(barriers) {
  if (!barriers || !barriers.length) return "";
  let s = "";
  const matColors = { metal: "#f87171", concrete: "#fb923c", brick: "#fbbf24", custom: "#94a3b8" };
  for (const bar of barriers) {
    const pts = bar.points || [];
    if (pts.length < 2) continue;
    const color = matColors[bar.material] || matColors.custom;
    const atten = bar.attenuation_dbm || 6;
    // Thicker line for higher attenuation
    const sw = Math.max(0.003, Math.min(0.008, atten * 0.0006));
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(" ");
    s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw.toFixed(4)}" stroke-dasharray="0.012,0.006" opacity="0.7"/>`;
  }
  return s;
}

// ── Radio Map SVG Generator ──────────────────────────────────────────────────

/**
 * Generate radio map heatmap SVG string for a specific map.
 * @param {Array} calPoints - calibration points from calibrationGet()
 * @param {string} mapId - which map to render
 * @param {string|null} scannerSource - specific scanner source, or null for combined
 * @param {Array} receivers - map receivers [{source, x, y, label}]
 * @param {Array} barriers - RF barriers [{points, attenuation_dbm, material}]
 * @returns {string} SVG string (viewBox 0 0 1 1), empty string if no data
 */
export function radioMapSVG(calPoints, mapId, scannerSource, receivers, barriers) {
  // Filter calibration points for this map
  const mapPts = (calPoints || []).filter(p => p.map_id === mapId);
  if (!mapPts.length) return "";

  // Extract per-point RSSI for the target scanner or combined
  const dataPoints = [];
  for (const pt of mapPts) {
    const readings = pt.scanner_readings || [];
    if (scannerSource) {
      const r = readings.find(rd => rd.source === scannerSource);
      if (r && r.mean_rssi != null) {
        dataPoints.push({ x_frac: pt.x_frac, y_frac: pt.y_frac, rssi: r.mean_rssi });
      }
    } else {
      // Combined: strongest scanner signal at each point
      const rssis = readings.map(r => r.mean_rssi).filter(v => v != null);
      if (rssis.length) {
        const maxRssi = Math.max(...rssis);
        dataPoints.push({ x_frac: pt.x_frac, y_frac: pt.y_frac, rssi: maxRssi });
      }
    }
  }

  if (!dataPoints.length) return "";

  // Compute RSSI range for color scaling
  const allRssi = dataPoints.map(p => p.rssi);
  const minR = Math.min(...allRssi);
  const maxR = Math.max(...allRssi);
  const mapBarriers = (barriers || []);

  // Build interpolation grid with barrier-aware IDW
  const cellW = 1.0 / GRID_RES;
  const cellH = 1.0 / GRID_RES;
  let s = "";

  for (let gy = 0; gy < GRID_RES; gy++) {
    for (let gx = 0; gx < GRID_RES; gx++) {
      const qx = (gx + 0.5) * cellW;
      const qy = (gy + 0.5) * cellH;
      const rssi = _idw(qx, qy, dataPoints, mapBarriers);
      const color = _rssiColor(rssi, minR, maxR);
      s += `<rect x="${(gx * cellW).toFixed(4)}" y="${(gy * cellH).toFixed(4)}" width="${cellW.toFixed(4)}" height="${cellH.toFixed(4)}" fill="${color}" rx="0.005"/>`;
    }
  }

  // RF barrier overlay (dashed wall lines)
  s += _barriersSVG(mapBarriers);

  // Calibration point markers (small circles at actual positions)
  for (const dp of dataPoints) {
    s += `<circle cx="${dp.x_frac.toFixed(4)}" cy="${dp.y_frac.toFixed(4)}" r="0.008" fill="#e2e8f0" stroke="#071008" stroke-width="0.002" opacity="0.8"/>`;
    // RSSI value label next to point
    s += `<text x="${(dp.x_frac + 0.012).toFixed(4)}" y="${(dp.y_frac + 0.004).toFixed(4)}" fill="#e2e8f0" font-size="0.016" font-family="system-ui,sans-serif" opacity="0.7">${Math.round(dp.rssi)}</text>`;
  }

  // Scanner position marker (if single scanner + position known)
  if (scannerSource && receivers) {
    const rx = receivers.find(r => (r.source || r.id || "") === scannerSource || (r.label || "") === scannerSource);
    if (rx) {
      const px = rx.x != null ? rx.x : 0.5;
      const py = rx.y != null ? rx.y : 0.5;
      // Pulsing rings around scanner
      s += `<circle cx="${px}" cy="${py}" r="0.035" fill="none" stroke="#52b788" stroke-width="0.002" opacity="0.3"/>`;
      s += `<circle cx="${px}" cy="${py}" r="0.022" fill="none" stroke="#52b788" stroke-width="0.003" opacity="0.5"/>`;
      s += `<circle cx="${px}" cy="${py}" r="0.010" fill="#52b788" opacity="0.9"/>`;
    }
  }

  // RSSI legend (bottom-left corner)
  const legendY = 0.90;
  s += `<rect x="0.02" y="${legendY - 0.01}" width="0.32" height="0.09" rx="0.008" fill="rgba(7,16,8,0.85)"/>`;
  s += `<text x="0.035" y="${legendY + 0.01}" fill="#e2e8f0" font-size="0.018" font-weight="600" font-family="system-ui,sans-serif">${scannerSource ? "Scanner" : "Combined"} Radio Map</text>`;
  const steps = 5;
  const barW = 0.04;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const rssiVal = minR + t * (maxR - minR);
    const color = _rssiColor(rssiVal, minR, maxR).replace(",0.35)", ",0.8)");
    s += `<rect x="${(0.035 + i * barW).toFixed(3)}" y="${legendY + 0.025}" width="${barW.toFixed(3)}" height="0.015" fill="${color}"/>`;
  }
  s += `<text x="0.035" y="${legendY + 0.06}" fill="#94a3b8" font-size="0.015" font-family="system-ui,sans-serif">${Math.round(minR)} dBm</text>`;
  s += `<text x="${(0.035 + (steps - 1) * barW + 0.005).toFixed(3)}" y="${legendY + 0.06}" fill="#94a3b8" font-size="0.015" font-family="system-ui,sans-serif">${Math.round(maxR)} dBm</text>`;
  // Wall legend
  if (mapBarriers.length) {
    s += `<line x1="0.035" y1="${legendY + 0.072}" x2="0.075" y2="${legendY + 0.072}" stroke="#f87171" stroke-width="0.003" stroke-dasharray="0.012,0.006" opacity="0.7"/>`;
    s += `<text x="0.082" y="${legendY + 0.076}" fill="#94a3b8" font-size="0.013" font-family="system-ui,sans-serif">RF barrier (wall)</text>`;
  }

  return s;
}

/**
 * Get unique scanner sources from calibration points for a given map.
 * Returns [{source, name, pointCount}] sorted by point count descending.
 */
export function getMapScanners(calPoints, mapId) {
  const mapPts = (calPoints || []).filter(p => p.map_id === mapId);
  const scannerMap = {};
  for (const pt of mapPts) {
    for (const r of (pt.scanner_readings || [])) {
      if (!r.source) continue;
      if (!scannerMap[r.source]) scannerMap[r.source] = { source: r.source, name: r.name || r.source, pointCount: 0 };
      scannerMap[r.source].pointCount++;
    }
  }
  return Object.values(scannerMap).sort((a, b) => b.pointCount - a.pointCount);
}


// ── Distortion Map SVG Generator ─────────────────────────────────────────────

/**
 * Generate distortion map SVG: arrows from actual → predicted position.
 * Uses LOO k-NN to compute where the system THINKS each calibration point is,
 * then draws a vector from actual to predicted position.
 * @param {Array} calPoints - calibration points from calibrationGet()
 * @param {string} mapId - which map to render
 * @param {Array} barriers - RF barriers [{points, attenuation_dbm, material}]
 * @returns {string} SVG string (viewBox 0 0 1 1), empty string if insufficient data
 */
export function distortionMapSVG(calPoints, mapId, barriers) {
  const mapPts = (calPoints || []).filter(p => p.map_id === mapId);
  if (mapPts.length < KNN_K + 1) return "";

  const vectors = [];
  let maxErr = 0;

  for (let i = 0; i < mapPts.length; i++) {
    const pt = mapPts[i];
    const query = {};
    for (const r of (pt.scanner_readings || [])) {
      if (r.source && r.mean_rssi != null) query[r.source] = r.mean_rssi;
    }
    if (!Object.keys(query).length) continue;

    // LOO k-NN: find k nearest neighbors by RSSI distance, excluding self
    const scored = [];
    for (let j = 0; j < mapPts.length; j++) {
      if (j === i) continue;
      const p2 = mapPts[j];
      const fp = {};
      for (const r of (p2.scanner_readings || [])) {
        if (r.source && r.mean_rssi != null) fp[r.source] = r.mean_rssi;
      }
      const shared = Object.keys(query).filter(s => fp[s] != null);
      if (!shared.length) continue;
      let distSq = 0;
      for (const s of shared) distSq += (query[s] - fp[s]) ** 2;
      const penalty = 1.0 + 0.3 * Math.max(0, Object.keys(query).length - shared.length);
      scored.push({ distSq: distSq * penalty, p: p2 });
    }

    if (scored.length < KNN_K) continue;
    scored.sort((a, b) => a.distSq - b.distSq);
    const topK = scored.slice(0, KNN_K);

    let wTotal = 0, wx = 0, wy = 0;
    for (const { distSq, p } of topK) {
      const w = 1.0 / (Math.sqrt(distSq) + 0.001);
      wx += w * p.x_frac;
      wy += w * p.y_frac;
      wTotal += w;
    }
    if (wTotal < 1e-10) continue;

    const predX = wx / wTotal;
    const predY = wy / wTotal;
    const errFrac = Math.sqrt((predX - pt.x_frac) ** 2 + (predY - pt.y_frac) ** 2);
    maxErr = Math.max(maxErr, errFrac);

    vectors.push({
      actualX: pt.x_frac, actualY: pt.y_frac,
      predX, predY,
      errFrac,
      room: pt.room || "",
    });
  }

  if (!vectors.length) return "";

  let s = "";

  // RF barrier overlay (dashed wall lines)
  s += _barriersSVG(barriers || []);

  // Draw vectors (actual → predicted)
  for (const v of vectors) {
    const color = _errorColor(v.errFrac);
    const opacity = Math.max(0.4, Math.min(1.0, v.errFrac / 0.15));
    const sw = Math.max(0.002, Math.min(0.006, v.errFrac * 0.04));

    if (v.errFrac > 0.005) { // Skip negligible errors
      // Arrow line
      s += `<line x1="${v.actualX.toFixed(4)}" y1="${v.actualY.toFixed(4)}" x2="${v.predX.toFixed(4)}" y2="${v.predY.toFixed(4)}" stroke="${color}" stroke-width="${sw.toFixed(4)}" opacity="${opacity.toFixed(2)}"/>`;

      // Arrowhead at predicted end
      const dx = v.predX - v.actualX;
      const dy = v.predY - v.actualY;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0.01) {
        const ux = dx / len, uy = dy / len;
        const headLen = Math.min(0.015, len * 0.4);
        const headW = headLen * 0.6;
        const tipX = v.predX, tipY = v.predY;
        const baseX = tipX - ux * headLen, baseY = tipY - uy * headLen;
        const lx = baseX - uy * headW, ly = baseY + ux * headW;
        const rx = baseX + uy * headW, ry = baseY - ux * headW;
        s += `<polygon points="${tipX.toFixed(4)},${tipY.toFixed(4)} ${lx.toFixed(4)},${ly.toFixed(4)} ${rx.toFixed(4)},${ry.toFixed(4)}" fill="${color}" opacity="${opacity.toFixed(2)}"/>`;
      }
    }

    // Dot at actual position
    s += `<circle cx="${v.actualX.toFixed(4)}" cy="${v.actualY.toFixed(4)}" r="0.007" fill="${color}" stroke="#071008" stroke-width="0.002" opacity="0.9"/>`;
  }

  // Summary stats
  const meanErr = vectors.reduce((a, v) => a + v.errFrac, 0) / vectors.length;
  const meanErrM = (meanErr * 15).toFixed(1); // assume 15m map width
  const maxErrM = (maxErr * 15).toFixed(1);

  // Legend (bottom-right corner)
  const ly = 0.88;
  s += `<rect x="0.60" y="${ly - 0.01}" width="0.38" height="0.11" rx="0.008" fill="rgba(7,16,8,0.85)"/>`;
  s += `<text x="0.62" y="${ly + 0.015}" fill="#e2e8f0" font-size="0.02" font-weight="600" font-family="system-ui,sans-serif">Distortion Map</text>`;
  s += `<text x="0.62" y="${ly + 0.04}" fill="#94a3b8" font-size="0.016" font-family="system-ui,sans-serif">Mean: ${meanErrM}m (${(meanErr * 100).toFixed(1)}%) \u2022 Max: ${maxErrM}m</text>`;
  s += `<text x="0.62" y="${ly + 0.06}" fill="#94a3b8" font-size="0.016" font-family="system-ui,sans-serif">${vectors.length} point${vectors.length !== 1 ? "s" : ""} analysed (LOO k-NN)</text>`;

  // Color scale
  const scaleSteps = 4;
  const scaleW = 0.035;
  for (let i = 0; i < scaleSteps; i++) {
    const t = i / (scaleSteps - 1);
    s += `<rect x="${(0.62 + i * scaleW).toFixed(3)}" y="${ly + 0.07}" width="${scaleW.toFixed(3)}" height="0.012" fill="${_errorColor(t * 0.25)}"/>`;
  }
  s += `<text x="0.62" y="${ly + 0.095}" fill="#64748b" font-size="0.013" font-family="system-ui,sans-serif">0m</text>`;
  s += `<text x="${(0.62 + (scaleSteps - 1) * scaleW).toFixed(3)}" y="${ly + 0.095}" fill="#64748b" font-size="0.013" font-family="system-ui,sans-serif">\u22653.8m</text>`;

  return s;
}


// ── Isometric Heatmap Generator ──────────────────────────────────────────────
// For 3D isometric views: generates heatmap polygons projected through the
// caller's mapPt + iso transform chain.

const ISO_GRID = 12; // coarser grid for 3D (144 cells per map — performance)

/**
 * Compute heatmap grid data for a map (not yet projected).
 * Returns {grid: Float32Array, minR, maxR, res} or null if no data.
 */
export function computeHeatmapGrid(calPoints, mapId, scannerSource, barriers) {
  const mapPts = (calPoints || []).filter(p => p.map_id === mapId);
  if (!mapPts.length) return null;

  const dataPoints = [];
  for (const pt of mapPts) {
    const readings = pt.scanner_readings || [];
    if (scannerSource) {
      const r = readings.find(rd => rd.source === scannerSource);
      if (r && r.mean_rssi != null) {
        dataPoints.push({ x_frac: pt.x_frac, y_frac: pt.y_frac, rssi: r.mean_rssi });
      }
    } else {
      const rssis = readings.map(r => r.mean_rssi).filter(v => v != null);
      if (rssis.length) {
        dataPoints.push({ x_frac: pt.x_frac, y_frac: pt.y_frac, rssi: Math.max(...rssis) });
      }
    }
  }
  if (!dataPoints.length) return null;

  const allRssi = dataPoints.map(p => p.rssi);
  const minR = Math.min(...allRssi);
  const maxR = Math.max(...allRssi);
  const res = ISO_GRID;
  const cellW = 1.0 / res;
  const grid = new Float32Array(res * res);
  const mapBarriers = barriers || [];

  for (let gy = 0; gy < res; gy++) {
    for (let gx = 0; gx < res; gx++) {
      const qx = (gx + 0.5) * cellW;
      const qy = (gy + 0.5) * cellW;
      const rssi = _idw(qx, qy, dataPoints, mapBarriers);
      grid[gy * res + gx] = rssi != null ? rssi : NaN;
    }
  }

  return { grid, minR, maxR, res, dataPoints };
}

/**
 * Generate isometric heatmap SVG fragment for one map.
 * The caller provides mapPt (normalized → world) and iso (world → screen) functions.
 *
 * @param {Object} heatData - from computeHeatmapGrid()
 * @param {Function} mapPt - (x_frac, y_frac) → [wx, wy]
 * @param {Function} iso - (wx, wy, z) → [sx, sy]
 * @param {number} z - z-level for this map
 * @returns {string} SVG polygon elements
 */
export function isoHeatmapSVG(heatData, mapPt, iso, z) {
  if (!heatData) return "";
  const { grid, minR, maxR, res } = heatData;
  const cellW = 1.0 / res;
  let s = "";

  for (let gy = 0; gy < res; gy++) {
    for (let gx = 0; gx < res; gx++) {
      const rssi = grid[gy * res + gx];
      if (isNaN(rssi)) continue;

      const color = _rssiColor(rssi, minR, maxR);
      // Project 4 corners of the grid cell through the iso transform
      const x0 = gx * cellW, y0 = gy * cellW;
      const x1 = x0 + cellW, y1 = y0 + cellW;
      const [w0x, w0y] = mapPt(x0, y0);
      const [w1x, w1y] = mapPt(x1, y0);
      const [w2x, w2y] = mapPt(x1, y1);
      const [w3x, w3y] = mapPt(x0, y1);
      const p0 = iso(w0x, w0y, z);
      const p1 = iso(w1x, w1y, z);
      const p2 = iso(w2x, w2y, z);
      const p3 = iso(w3x, w3y, z);

      s += `<polygon points="${Math.round(p0[0])},${Math.round(p0[1])} ${Math.round(p1[0])},${Math.round(p1[1])} ${Math.round(p2[0])},${Math.round(p2[1])} ${Math.round(p3[0])},${Math.round(p3[1])}" fill="${color}"/>`;
    }
  }

  // Calibration point markers projected to iso
  for (const dp of heatData.dataPoints) {
    const [wx, wy] = mapPt(dp.x_frac, dp.y_frac);
    const [sx, sy] = iso(wx, wy, z);
    s += `<circle cx="${Math.round(sx)}" cy="${Math.round(sy)}" r="3" fill="#e2e8f0" stroke="#071008" stroke-width="0.8" opacity="0.7"/>`;
  }

  return s;
}
