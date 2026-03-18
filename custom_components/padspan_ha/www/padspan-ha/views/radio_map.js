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

const GRID_RES = 30;       // 30x30 interpolation grid (900 cells) for 2D
const IDW_POWER = 2.0;     // IDW exponent (higher = more local)
const KNN_K = 3;           // k for LOO cross-validation
const BARRIER_PENALTY_DB_TO_DIST = 0.01; // each dB of barrier attenuation adds this much "virtual distance"

// ── Color Scales ─────────────────────────────────────────────────────────────

// ── Hatch Pattern System ─────────────────────────────────────────────────────
// 16 color buckets from -95 to -30 dBm. Each bucket gets a <pattern> with 45°
// diagonal lines in that color. Grid cells reference url(#rmh_N) instead of
// solid fills, letting the map image show through the gaps.

const HATCH_BUCKETS = 16;
const HATCH_WORST = -95;
const HATCH_BEST  = -30;
const HATCH_RANGE = HATCH_BEST - HATCH_WORST;

// Compute opaque RGB for a bucket index (0 = worst, HATCH_BUCKETS-1 = best)
// Strong areas are CLEARLY green (#22c55e / #16a34a range), weak areas red
function _bucketRGB(idx) {
  const t = idx / (HATCH_BUCKETS - 1); // 0=dead, 1=excellent
  const tb = Math.pow(t, 0.55);
  let r, g, b;
  if (tb < 0.25) {
    // dark red → bright red (dead → very weak)
    const u = tb / 0.25;
    r = Math.round(80 + u * 170);   // 80→250
    g = Math.round(u * 20);         // 0→20
    b = 15;
  } else if (tb < 0.50) {
    // bright red → orange (weak → marginal)
    const u = (tb - 0.25) / 0.25;
    r = 250;
    g = Math.round(20 + u * 140);   // 20→160
    b = Math.round(15 + u * 10);
  } else if (tb < 0.75) {
    // orange → yellow-green (marginal → good)
    const u = (tb - 0.50) / 0.25;
    r = Math.round(250 - u * 140);  // 250→110
    g = Math.round(160 + u * 50);   // 160→210
    b = Math.round(25 + u * 15);    // 25→40
  } else {
    // yellow-green → vivid green (good → excellent)
    const u = (tb - 0.75) / 0.25;
    r = Math.round(110 - u * 80);   // 110→30
    g = Math.round(210 + u * 30);   // 210→240
    b = Math.round(40 + u * 60);    // 40→100
  }
  return `rgb(${r},${g},${b})`;
}

// Map RSSI → bucket index
function _rssiBucket(rssi) {
  if (rssi == null || isNaN(rssi)) return -1;
  return Math.max(0, Math.min(HATCH_BUCKETS - 1,
    Math.round((rssi - HATCH_WORST) / HATCH_RANGE * (HATCH_BUCKETS - 1))
  ));
}

/**
 * Generate <defs> block with 45° crosshatch patterns for heatmap cells.
 * @param {string} prefix - unique prefix to avoid SVG ID collisions (e.g. "rm2d", "rmiso", "rmfl")
 * @param {number} spacing - pattern tile size in the coordinate system (e.g. 0.012 for viewBox 0-1)
 * @param {number} lineW - stroke width of hatch lines
 * @returns {string} SVG <defs>...</defs> block
 */
export function hatchDefs(prefix, spacing, lineW) {
  let s = "<defs>";
  // Airy dotted pattern: short dot, long gap — mostly empty space
  const dotLen = (lineW * 1.2).toFixed(5);
  const gapLen = (lineW * 4.0).toFixed(5);
  const dash = `${dotLen} ${gapLen}`;
  for (let i = 0; i < HATCH_BUCKETS; i++) {
    const c = _bucketRGB(i);
    const sp = spacing.toFixed(5);
    const lw = lineW.toFixed(5);
    // Rotate from 45° (red/worst) to 135° (green/best) — 90° sweep
    const angle = 45 + (i / (HATCH_BUCKETS - 1)) * 90;
    s += `<pattern id="${prefix}_${i}" x="0" y="0" width="${sp}" height="${sp}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle.toFixed(1)})">`;
    s += `<line x1="0" y1="0" x2="0" y2="${sp}" stroke="${c}" stroke-width="${lw}" stroke-dasharray="${dash}" stroke-linecap="round" opacity="0.8"/>`;
    s += `</pattern>`;
  }
  // Null bucket for no-data cells
  s += `<pattern id="${prefix}_null" x="0" y="0" width="${spacing.toFixed(5)}" height="${spacing.toFixed(5)}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`;
  s += `<line x1="0" y1="0" x2="0" y2="${spacing.toFixed(5)}" stroke="#333" stroke-width="${lineW.toFixed(5)}" stroke-dasharray="${dash}" stroke-linecap="round" opacity="0.1"/>`;
  s += `</pattern>`;
  s += "</defs>";
  return s;
}

/** Get fill attribute for a cell: url(#prefix_N) */
function _hatchFill(prefix, rssi) {
  const idx = _rssiBucket(rssi);
  return idx < 0 ? `url(#${prefix}_null)` : `url(#${prefix}_${idx})`;
}

// Legacy solid fill (used for iso 3D cells where patterns don't project well)
function _rssiColor(rssi) {
  if (rssi == null || isNaN(rssi)) return "rgba(60,60,60,0.15)";
  const idx = _rssiBucket(rssi);
  if (idx < 0) return "rgba(60,60,60,0.15)";
  // Reuse bucket RGB with alpha for solid fills
  return _bucketRGB(idx).replace("rgb(", "rgba(").replace(")", ",0.6)");
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
        // Use mean RSSI across all scanners (not max — max is too uniform across points)
        const meanRssi = rssis.reduce((a, b) => a + b, 0) / rssis.length;
        dataPoints.push({ x_frac: pt.x_frac, y_frac: pt.y_frac, rssi: meanRssi });
      }
    }
  }

  if (!dataPoints.length) return "";

  // Compute RSSI range for color scaling
  const allRssi = dataPoints.map(p => p.rssi);
  const minR = Math.min(...allRssi);
  const maxR = Math.max(...allRssi);
  const mapBarriers = (barriers || []);

  // Build interpolation grid with barrier-aware IDW + 45° crosshatch patterns
  const cellW = 1.0 / GRID_RES;
  const cellH = 1.0 / GRID_RES;
  const _pfx = "rm2d";
  let s = hatchDefs(_pfx, 0.010, 0.004);

  for (let gy = 0; gy < GRID_RES; gy++) {
    for (let gx = 0; gx < GRID_RES; gx++) {
      const qx = (gx + 0.5) * cellW;
      const qy = (gy + 0.5) * cellH;
      const rssi = _idw(qx, qy, dataPoints, mapBarriers);
      const fill = _hatchFill(_pfx, rssi);
      s += `<rect x="${(gx * cellW).toFixed(4)}" y="${(gy * cellH).toFixed(4)}" width="${cellW.toFixed(4)}" height="${cellH.toFixed(4)}" fill="${fill}"/>`;
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

  // RSSI legend (bottom-left corner) — absolute dBm scale
  const legendY = 0.90;
  s += `<rect x="0.02" y="${legendY - 0.01}" width="0.34" height="0.09" rx="0.008" fill="rgba(7,16,8,0.85)"/>`;
  s += `<text x="0.035" y="${legendY + 0.01}" fill="#e2e8f0" font-size="0.018" font-weight="600" font-family="system-ui,sans-serif">${scannerSource ? "Scanner" : "Combined"} Radio Map</text>`;
  const legSteps = 8;
  const barW = 0.03;
  for (let i = 0; i < legSteps; i++) {
    const bucketIdx = Math.round(i / (legSteps - 1) * (HATCH_BUCKETS - 1));
    s += `<rect x="${(0.035 + i * barW).toFixed(3)}" y="${legendY + 0.025}" width="${barW.toFixed(3)}" height="0.015" fill="${_bucketRGB(bucketIdx)}"/>`;
  }
  s += `<text x="0.035" y="${legendY + 0.06}" fill="#fca5a5" font-size="0.013" font-family="system-ui,sans-serif">-95 dBm (dead)</text>`;
  s += `<text x="${(0.035 + (legSteps - 1) * barW).toFixed(3)}" y="${legendY + 0.06}" fill="#52b788" font-size="0.013" font-family="system-ui,sans-serif">-35 dBm</text>`;
  s += `<text x="0.035" y="${legendY + 0.075}" fill="#94a3b8" font-size="0.012" font-family="system-ui,sans-serif">${dataPoints.length} cal points \u2022 range ${Math.round(minR)} to ${Math.round(maxR)} dBm</text>`;
  // Wall legend
  if (mapBarriers.length) {
    s += `<line x1="0.22" y1="${legendY + 0.072}" x2="0.26" y2="${legendY + 0.072}" stroke="#f87171" stroke-width="0.003" stroke-dasharray="0.012,0.006" opacity="0.7"/>`;
    s += `<text x="0.265" y="${legendY + 0.076}" fill="#94a3b8" font-size="0.012" font-family="system-ui,sans-serif">RF wall</text>`;
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

const ISO_GRID = 28; // 28x28 interpolation grid for 3D (784 cells per map)

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
        const meanRssi = rssis.reduce((a, b) => a + b, 0) / rssis.length;
        dataPoints.push({ x_frac: pt.x_frac, y_frac: pt.y_frac, rssi: meanRssi });
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
/**
 * Generate <defs> block for 3D iso heatmap patterns. Call ONCE before
 * rendering any isoHeatmapSVG cells (not per-map).
 */
export function isoHatchDefs() {
  return hatchDefs("rmiso", 6, 2.5);
}

export function isoHeatmapSVG(heatData, mapPt, iso, z) {
  if (!heatData) return "";
  const { grid, minR, maxR, res } = heatData;
  const cellW = 1.0 / res;
  const _pfx = "rmiso";
  let s = "";

  // Slight overlap prevents hairline gaps between cells in iso projection
  const pad = cellW * 0.08;
  for (let gy = 0; gy < res; gy++) {
    for (let gx = 0; gx < res; gx++) {
      const rssi = grid[gy * res + gx];
      if (isNaN(rssi)) continue;

      const fill = _hatchFill(_pfx, rssi);
      // Project 4 corners of the grid cell (with slight padding) through the iso transform
      const x0 = gx * cellW - pad, y0 = gy * cellW - pad;
      const x1 = x0 + cellW + pad * 2, y1 = y0 + cellW + pad * 2;
      const [w0x, w0y] = mapPt(x0, y0);
      const [w1x, w1y] = mapPt(x1, y0);
      const [w2x, w2y] = mapPt(x1, y1);
      const [w3x, w3y] = mapPt(x0, y1);
      const p0 = iso(w0x, w0y, z);
      const p1 = iso(w1x, w1y, z);
      const p2 = iso(w2x, w2y, z);
      const p3 = iso(w3x, w3y, z);

      // Sub-pixel precision (1 decimal) prevents cells from collapsing to lines
      const f = v => v.toFixed(1);
      s += `<polygon points="${f(p0[0])},${f(p0[1])} ${f(p1[0])},${f(p1[1])} ${f(p2[0])},${f(p2[1])} ${f(p3[0])},${f(p3[1])}" fill="${fill}"/>`;
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


// ═══════════════════════════════════════════════════════════════════════════════
// World-Space Floor Heatmap
// ═══════════════════════════════════════════════════════════════════════════════
// Merges calibration data from ALL maps on a floor into a single unified
// interpolation in world coordinates. No per-map isolation — a calibration
// point on Map A contributes to the heatmap in Map B's territory if they
// share the same floor. Barriers from all maps are also combined.

const FLOOR_GRID = 32; // 32x32 grid in world space

/**
 * Generate a unified floor heatmap in view-normalized coordinates.
 *
 * @param {Array} calPoints - ALL calibration points from calibrationGet()
 * @param {Array} floorMaps - maps on this floor [{id, rf_barriers, ...}]
 * @param {Object} mapPtFns - {mapId: (lx,ly)=>[wx,wy]} transform per map
 * @param {Function} w2v - (wx,wy)=>[vx,vy] world→view transform
 * @param {Object} wBB - {minX,minY,maxX,maxY} world bounding box
 * @param {string|null} scannerSource - specific scanner or null for combined
 * @returns {string} SVG content (rects + markers in view coords)
 */
export function floorHeatmapSVG(calPoints, floorMaps, mapPtFns, w2v, wBB, scannerSource) {
  if (!calPoints || !floorMaps.length) return "";

  const floorMapIds = new Set(floorMaps.map(m => m.id));

  // ── 1. Collect all calibration points on this floor, transform to world coords ──
  const worldPoints = [];
  for (const pt of calPoints) {
    if (!floorMapIds.has(pt.map_id)) continue;
    const mpt = mapPtFns[pt.map_id];
    if (!mpt) continue;

    const readings = pt.scanner_readings || [];
    let rssi;
    if (scannerSource) {
      const r = readings.find(rd => rd.source === scannerSource);
      if (!r || r.mean_rssi == null) continue;
      rssi = r.mean_rssi;
    } else {
      const rssis = readings.map(r => r.mean_rssi).filter(v => v != null);
      if (!rssis.length) continue;
      rssi = rssis.reduce((a, b) => a + b, 0) / rssis.length;
    }

    const [wx, wy] = mpt(pt.x_frac, pt.y_frac);
    worldPoints.push({ wx, wy, rssi });
  }

  if (!worldPoints.length) return "";

  // ── 2. Collect all barriers from all floor maps, transform to world coords ──
  const worldBarriers = [];
  for (const m of floorMaps) {
    const mpt = mapPtFns[m.id];
    if (!mpt) continue;
    for (const bar of (m.rf_barriers || [])) {
      const pts = bar.points || [];
      if (pts.length < 2) continue;
      worldBarriers.push({
        points: pts.map(p => { const [wx, wy] = mpt(Number(p[0]), Number(p[1])); return [wx, wy]; }),
        attenuation_dbm: bar.attenuation_dbm || 6,
        material: bar.material || "custom",
      });
    }
  }

  // ── 3. IDW interpolation in world space ────────────────────────────────────
  const wW = wBB.maxX - wBB.minX;
  const wH = wBB.maxY - wBB.minY;
  if (wW < 1e-6 || wH < 1e-6) return "";

  // Convert world points to IDW-compatible format (use world coords directly)
  const idwPoints = worldPoints.map(p => ({ x_frac: p.wx, y_frac: p.wy, rssi: p.rssi }));

  const cellW = wW / FLOOR_GRID;
  const cellH = wH / FLOOR_GRID;
  const f = v => v.toFixed(5);
  const _pfx = "rmfl";
  let s = hatchDefs(_pfx, 0.008, 0.003);

  for (let gy = 0; gy < FLOOR_GRID; gy++) {
    for (let gx = 0; gx < FLOOR_GRID; gx++) {
      const qwx = wBB.minX + (gx + 0.5) * cellW;
      const qwy = wBB.minY + (gy + 0.5) * cellH;
      const rssi = _idw(qwx, qwy, idwPoints, worldBarriers);
      const fill = _hatchFill(_pfx, rssi);

      // Convert cell corners from world → view coords
      const [v0x, v0y] = w2v(wBB.minX + gx * cellW, wBB.minY + gy * cellH);
      const [v1x, v1y] = w2v(wBB.minX + (gx+1) * cellW, wBB.minY + gy * cellH);
      const [v2x, v2y] = w2v(wBB.minX + (gx+1) * cellW, wBB.minY + (gy+1) * cellH);
      const [v3x, v3y] = w2v(wBB.minX + gx * cellW, wBB.minY + (gy+1) * cellH);

      s += `<polygon points="${f(v0x)},${f(v0y)} ${f(v1x)},${f(v1y)} ${f(v2x)},${f(v2y)} ${f(v3x)},${f(v3y)}" fill="${fill}"/>`;
    }
  }

  // ── 4. Barrier lines in view coords ────────────────────────────────────────
  const matColors = { metal: "#f87171", concrete: "#fb923c", brick: "#fbbf24", custom: "#94a3b8" };
  for (const bar of worldBarriers) {
    const color = matColors[bar.material] || matColors.custom;
    const sw = Math.max(0.003, Math.min(0.008, (bar.attenuation_dbm || 6) * 0.0006));
    const d = bar.points.map((p, i) => {
      const [vx, vy] = w2v(p[0], p[1]);
      return `${i === 0 ? "M" : "L"}${f(vx)},${f(vy)}`;
    }).join(" ");
    s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(sw)}" stroke-dasharray="0.012,0.006" opacity="0.7"/>`;
  }

  // ── 5. Calibration point markers in view coords ────────────────────────────
  for (const wp of worldPoints) {
    const [vx, vy] = w2v(wp.wx, wp.wy);
    s += `<circle cx="${f(vx)}" cy="${f(vy)}" r="0.006" fill="#e2e8f0" stroke="#071008" stroke-width="0.002" opacity="0.8"/>`;
    s += `<text x="${f(vx + 0.01)}" y="${f(vy + 0.003)}" fill="#e2e8f0" font-size="0.012" font-family="system-ui,sans-serif" opacity="0.6">${Math.round(wp.rssi)}</text>`;
  }

  // ── 6. Legend ──────────────────────────────────────────────────────────────
  const ly = 0.92;
  s += `<rect x="0.02" y="${ly - 0.01}" width="0.34" height="0.07" rx="0.006" fill="rgba(7,16,8,0.85)"/>`;
  s += `<text x="0.035" y="${ly + 0.008}" fill="#e2e8f0" font-size="0.014" font-weight="600" font-family="system-ui,sans-serif">${scannerSource ? "Scanner" : "Floor"} Radio Map</text>`;
  const flLegSteps = 8;
  const bw = 0.028;
  for (let i = 0; i < flLegSteps; i++) {
    const bucketIdx = Math.round(i / (flLegSteps - 1) * (HATCH_BUCKETS - 1));
    s += `<rect x="${(0.035 + i * bw).toFixed(3)}" y="${ly + 0.02}" width="${bw.toFixed(3)}" height="0.012" fill="${_bucketRGB(bucketIdx)}"/>`;
  }
  s += `<text x="0.035" y="${ly + 0.048}" fill="#fca5a5" font-size="0.01" font-family="system-ui,sans-serif">-95</text>`;
  s += `<text x="${(0.035 + (flLegSteps - 1) * bw).toFixed(3)}" y="${ly + 0.048}" fill="#52b788" font-size="0.01" font-family="system-ui,sans-serif">-35 dBm</text>`;
  s += `<text x="0.035" y="${ly + 0.058}" fill="#94a3b8" font-size="0.009" font-family="system-ui,sans-serif">${worldPoints.length} points from ${floorMapIds.size} map${floorMapIds.size > 1 ? "s" : ""}</text>`;

  return s;
}

/**
 * Get unique scanner sources across all maps on a floor.
 */
export function getFloorScanners(calPoints, floorMapIds) {
  const idSet = new Set(floorMapIds);
  const scannerMap = {};
  for (const pt of (calPoints || [])) {
    if (!idSet.has(pt.map_id)) continue;
    for (const r of (pt.scanner_readings || [])) {
      if (!r.source) continue;
      if (!scannerMap[r.source]) scannerMap[r.source] = { source: r.source, name: r.name || r.source, pointCount: 0 };
      scannerMap[r.source].pointCount++;
    }
  }
  return Object.values(scannerMap).sort((a, b) => b.pointCount - a.pointCount);
}
