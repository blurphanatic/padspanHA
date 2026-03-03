# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
BLE Fingerprint Calibration Store

Persists calibration points (phone-at-known-location + per-scanner RSSI readings)
and computes:
  - Coverage grids (Gaussian falloff, 10x10 per map)
  - Path-loss models per scanner (RSSI = RSSI_1m - 10*n*log10(d), OLS fit)
  - k-NN fingerprint matching for runtime location estimation
  - Leave-one-out cross-validation accuracy estimate

Data layout in .storage/padspan_ha.calibration:
  {
    "points": [ CalibrationPoint, ... ],
    "model":  { ... computed stats ... }
  }
"""

import math
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import CALIBRATION_STORE_KEY

GRID_N = 10           # 10×10 coverage grid per floor map
SIGMA_CELLS = 1.8     # Gaussian sigma in grid-cell units (~20% of map width)
KNN_K = 3             # k for k-NN fingerprint matching


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _gaussian(dist: float, sigma: float) -> float:
    return math.exp(-(dist ** 2) / (2 * sigma ** 2))


def _mean(vals: list[float]) -> float:
    return sum(vals) / len(vals) if vals else 0.0


def _std(vals: list[float]) -> float:
    if len(vals) < 2:
        return 0.0
    m = _mean(vals)
    return math.sqrt(sum((v - m) ** 2 for v in vals) / len(vals))


@dataclass
class CalibrationStore:
    hass: HomeAssistant
    store: Store
    data: dict[str, Any] = field(default_factory=lambda: {"points": [], "model": {}})

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = Store(hass, 1, CALIBRATION_STORE_KEY)
        self.data = {"points": [], "model": {}}

    async def async_setup(self) -> None:
        loaded = await self.store.async_load()
        if isinstance(loaded, dict) and "points" in loaded:
            self.data = loaded
        else:
            self.data = {"points": [], "model": {}}

    def list_points(self) -> list[dict[str, Any]]:
        return list(self.data.get("points", []))

    def get_point(self, point_id: str) -> dict[str, Any] | None:
        for p in self.data.get("points", []):
            if p.get("id") == point_id:
                return p
        return None

    async def async_add_point(self, point: dict[str, Any]) -> dict[str, Any]:
        """Validate, clean, and persist a calibration point."""
        point_id = f"cp_{os.urandom(6).hex()}"

        raw_readings = point.get("scanner_readings") or []
        clean_readings: list[dict[str, Any]] = []
        for r in raw_readings:
            if not isinstance(r, dict):
                continue
            samples = [
                float(x) for x in (r.get("rssi_samples") or [])
                if isinstance(x, (int, float)) and not math.isnan(float(x))
            ]
            if not samples:
                continue
            m = _mean(samples)
            s = _std(samples)
            clean_readings.append({
                "source": str(r.get("source") or "")[:200],
                "name": str(r.get("name") or r.get("source") or "")[:120],
                "rssi_samples": samples[:200],
                "mean_rssi": round(m, 2),
                "std_rssi": round(s, 2),
                "sample_count": len(samples),
            })

        clean: dict[str, Any] = {
            "id": point_id,
            "map_id": str(point.get("map_id") or "")[:80],
            "x_frac": max(0.0, min(1.0, float(point.get("x_frac", 0.5)))),
            "y_frac": max(0.0, min(1.0, float(point.get("y_frac", 0.5)))),
            "floor_id": str(point.get("floor_id") or "")[:40],
            "room": str(point.get("room") or "")[:120],
            "label": str(point.get("label") or "")[:200],
            "device_id": str(point.get("device_id") or "")[:80],
            "collected_at": _now_iso(),
            "duration_s": max(5, min(120, int(point.get("duration_s") or 15))),
            "scanner_readings": clean_readings,
        }
        self.data.setdefault("points", []).append(clean)
        await self.store.async_save(self.data)
        return clean

    async def async_delete_point(self, point_id: str) -> bool:
        before = len(self.data.get("points", []))
        self.data["points"] = [
            p for p in self.data.get("points", []) if p.get("id") != point_id
        ]
        changed = len(self.data["points"]) < before
        if changed:
            await self.store.async_save(self.data)
        return changed

    async def async_clear_all(self) -> int:
        count = len(self.data.get("points", []))
        self.data = {"points": [], "model": {}}
        await self.store.async_save(self.data)
        return count

    async def async_prune_auto_points(self, max_per_beacon: int = 50) -> int:
        """Remove oldest [auto] calibration points when a beacon exceeds the cap."""
        points = self.data.get("points", [])
        # Group auto-points by device_id
        by_dev: dict[str, list[dict]] = {}
        for p in points:
            if str(p.get("label", "")).startswith("[auto]"):
                did = p.get("device_id", "")
                by_dev.setdefault(did, []).append(p)
        remove_ids: set[str] = set()
        for did, auto_pts in by_dev.items():
            if len(auto_pts) > max_per_beacon:
                # Sort by collected_at ascending (oldest first), remove extras
                auto_pts.sort(key=lambda p: p.get("collected_at", ""))
                for p in auto_pts[: len(auto_pts) - max_per_beacon]:
                    remove_ids.add(p.get("id", ""))
        if remove_ids:
            self.data["points"] = [p for p in points if p.get("id") not in remove_ids]
            await self.store.async_save(self.data)
        return len(remove_ids)

    async def async_remove_scanner(self, source: str) -> dict[str, int]:
        """Remove all data for a specific scanner source.

        - Removes scanner_readings entries matching source from all points
        - Deletes points that have zero remaining readings
        - Clears model scanner_stats[source] and path_loss[source]

        Returns counts: {readings_removed, points_pruned, model_keys_removed}.
        """
        readings_removed = 0
        points_pruned = 0
        model_keys_removed = 0

        surviving: list[dict[str, Any]] = []
        for pt in self.data.get("points", []):
            readings = pt.get("scanner_readings", [])
            before = len(readings)
            pt["scanner_readings"] = [
                r for r in readings if r.get("source") != source
            ]
            readings_removed += before - len(pt["scanner_readings"])
            if pt["scanner_readings"]:
                surviving.append(pt)
            else:
                points_pruned += 1
        self.data["points"] = surviving

        model = self.data.get("model", {})
        for section in ("scanner_stats", "path_loss"):
            sec = model.get(section)
            if isinstance(sec, dict) and source in sec:
                del sec[source]
                model_keys_removed += 1

        await self.store.async_save(self.data)
        return {
            "readings_removed": readings_removed,
            "points_pruned": points_pruned,
            "model_keys_removed": model_keys_removed,
        }

    # ── Coverage grid ──────────────────────────────────────────────────────────

    def compute_coverage(self, map_id: str) -> dict[str, Any]:
        """
        Gaussian-weighted coverage grid for one floor map.
        Returns flattened GRID_N×GRID_N scores (row-major), next_target, and stats.
        """
        pts = [p for p in self.data.get("points", []) if p.get("map_id") == map_id]
        grid = [0.0] * (GRID_N * GRID_N)

        for pt in pts:
            px = pt["x_frac"] * GRID_N
            py = pt["y_frac"] * GRID_N
            for cy in range(GRID_N):
                for cx in range(GRID_N):
                    dist = math.sqrt((cx + 0.5 - px) ** 2 + (cy + 0.5 - py) ** 2)
                    contrib = _gaussian(dist, SIGMA_CELLS)
                    idx = cy * GRID_N + cx
                    grid[idx] = min(1.0, grid[idx] + contrib)

        covered = sum(1 for v in grid if v >= 0.5)
        total = GRID_N * GRID_N

        # Greedy next-target: cell with lowest score, tie-break by interior preference
        min_score = 2.0
        nx, ny = GRID_N // 2, GRID_N // 2
        for cy in range(GRID_N):
            for cx in range(GRID_N):
                v = grid[cy * GRID_N + cx]
                # Weight interior cells slightly higher priority than edge cells
                edge_penalty = 0.05 if (cx == 0 or cx == GRID_N - 1 or cy == 0 or cy == GRID_N - 1) else 0.0
                effective = v + edge_penalty
                if effective < min_score:
                    min_score = effective
                    nx, ny = cx, cy

        return {
            "map_id": map_id,
            "point_count": len(pts),
            "covered_cells": covered,
            "total_cells": total,
            "coverage_pct": round(covered / total, 3),
            "grid": [round(v, 3) for v in grid],
            "grid_n": GRID_N,
            "next_target": {
                "x_frac": round((nx + 0.5) / GRID_N, 3),
                "y_frac": round((ny + 0.5) / GRID_N, 3),
                "score": round(grid[ny * GRID_N + nx], 3),
            },
        }

    # ── Path-loss model ────────────────────────────────────────────────────────

    def fit_path_loss(
        self,
        scanner_source: str,
        scanner_x_frac: float,
        scanner_y_frac: float,
        map_id: str | None = None,
    ) -> dict[str, Any] | None:
        """
        OLS fit of RSSI = RSSI_1m - 10*n*log10(d) for one scanner.
        Uses map-fraction distances (accurate enough for comparative purposes).
        Requires ≥3 data points.
        """
        data: list[tuple[float, float]] = []
        pts = self.data.get("points", [])
        if map_id:
            pts = [p for p in pts if p.get("map_id") == map_id]

        for pt in pts:
            for reading in pt.get("scanner_readings", []):
                if reading.get("source") != scanner_source:
                    continue
                dx = pt["x_frac"] - scanner_x_frac
                dy = pt["y_frac"] - scanner_y_frac
                d = math.sqrt(dx ** 2 + dy ** 2)
                if d < 0.02:   # too close — likely at scanner position itself
                    continue
                log_d = math.log10(d)
                data.append((log_d, reading["mean_rssi"]))

        if len(data) < 3:
            return None

        # OLS: RSSI = a + b*log10(d)  where b = -10*n, a = RSSI_1m
        n_pts = len(data)
        sum_x = sum(d[0] for d in data)
        sum_y = sum(d[1] for d in data)
        sum_xx = sum(d[0] ** 2 for d in data)
        sum_xy = sum(d[0] * d[1] for d in data)

        denom = n_pts * sum_xx - sum_x ** 2
        if abs(denom) < 1e-10:
            return None

        b = (n_pts * sum_xy - sum_x * sum_y) / denom
        a = (sum_y - b * sum_x) / n_pts
        n_exp = max(0.5, min(8.0, -b / 10.0))

        # R²
        y_mean = sum_y / n_pts
        ss_tot = sum((d[1] - y_mean) ** 2 for d in data)
        ss_res = sum((d[1] - (a + b * d[0])) ** 2 for d in data)
        r_sq = 1.0 - (ss_res / ss_tot) if ss_tot > 1e-10 else 0.0

        return {
            "n": round(n_exp, 3),
            "rssi_1m": round(a, 1),
            "r_squared": round(max(0.0, r_sq), 3),
            "point_count": n_pts,
        }

    # ── k-NN fingerprint matching ──────────────────────────────────────────────

    def knn_locate(
        self,
        query_rssi: dict[str, float],
        map_id: str | None = None,
        k: int = KNN_K,
    ) -> dict[str, Any] | None:
        """
        Estimate position using k-NN fingerprint matching.

        query_rssi: {source: mean_rssi} for the device being located.
        Returns weighted centroid of top-k nearest calibration points.
        Euclidean distance in RSSI-space (only shared scanners counted).
        """
        pts = self.data.get("points", [])
        if map_id:
            pts = [p for p in pts if p.get("map_id") == map_id]
        if not pts or not query_rssi:
            return None

        scored: list[tuple[float, dict[str, Any]]] = []
        for pt in pts:
            fp: dict[str, float] = {
                r["source"]: r["mean_rssi"] for r in pt.get("scanner_readings", [])
            }
            shared = set(query_rssi.keys()) & set(fp.keys())
            if not shared:
                continue
            dist_sq = sum((query_rssi[s] - fp[s]) ** 2 for s in shared)
            # Penalise points with fewer shared scanners
            penalty = 1.0 + 0.3 * max(0, len(query_rssi) - len(shared))
            scored.append((dist_sq * penalty, pt))

        if not scored:
            return None

        scored.sort(key=lambda t: t[0])
        top_k = scored[: k]

        # Weighted centroid — weight = 1/(dist+ε)
        total_w = 0.0
        wx, wy = 0.0, 0.0
        for dist_sq, pt in top_k:
            w = 1.0 / (math.sqrt(dist_sq) + 1e-3)
            wx += w * pt["x_frac"]
            wy += w * pt["y_frac"]
            total_w += w

        if total_w < 1e-10:
            return None

        return {
            "x_frac": round(wx / total_w, 4),
            "y_frac": round(wy / total_w, 4),
            "confidence": round(1.0 / (1.0 + scored[0][0]), 3),
            "nearest_room": scored[0][1].get("room", ""),
            "k_used": len(top_k),
        }

    # ── Leave-one-out accuracy estimate ───────────────────────────────────────

    def loo_accuracy(self, map_id: str | None = None) -> dict[str, Any] | None:
        """
        Leave-one-out cross-validation accuracy in map-fraction units.
        For each point, remove it, run k-NN on remaining, compute error.
        Returns mean/median/max error in map fractions.
        """
        pts = self.data.get("points", [])
        if map_id:
            pts = [p for p in pts if p.get("map_id") == map_id]
        if len(pts) < KNN_K + 1:
            return None

        errors: list[float] = []
        for i, pt in enumerate(pts):
            # Build leave-one-out store (without modifying self.data)
            loo_pts = [p for j, p in enumerate(pts) if j != i]
            query: dict[str, float] = {
                r["source"]: r["mean_rssi"] for r in pt.get("scanner_readings", [])
            }
            if not query:
                continue

            # Inline k-NN without modifying state
            scored: list[tuple[float, dict[str, Any]]] = []
            for p2 in loo_pts:
                fp = {r["source"]: r["mean_rssi"] for r in p2.get("scanner_readings", [])}
                shared = set(query.keys()) & set(fp.keys())
                if not shared:
                    continue
                dist_sq = sum((query[s] - fp[s]) ** 2 for s in shared)
                penalty = 1.0 + 0.3 * max(0, len(query) - len(shared))
                scored.append((dist_sq * penalty, p2))

            if not scored:
                continue
            scored.sort(key=lambda t: t[0])
            top_k = scored[: KNN_K]
            total_w, wx, wy = 0.0, 0.0, 0.0
            for dist_sq, p2 in top_k:
                w = 1.0 / (math.sqrt(dist_sq) + 1e-3)
                wx += w * p2["x_frac"]
                wy += w * p2["y_frac"]
                total_w += w

            if total_w < 1e-10:
                continue
            pred_x, pred_y = wx / total_w, wy / total_w
            err = math.sqrt((pred_x - pt["x_frac"]) ** 2 + (pred_y - pt["y_frac"]) ** 2)
            errors.append(err)

        if not errors:
            return None

        errors.sort()
        mean_err = _mean(errors)
        median_err = errors[len(errors) // 2]
        return {
            "mean_error_frac": round(mean_err, 4),
            "median_error_frac": round(median_err, 4),
            "max_error_frac": round(errors[-1], 4),
            "point_count": len(errors),
            # Rough metre estimate assuming map width ≈ 15m (typical home)
            "mean_error_m_est": round(mean_err * 15, 2),
        }

    # ── Full model computation ────────────────────────────────────────────────

    def compute_model(
        self,
        maps_data: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """
        Compute and cache full model statistics.

        maps_data: optional list of map dicts (from MapsStore) so scanner positions
                   can be resolved from map.receivers for path-loss fitting.
        """
        pts = self.data.get("points", [])
        map_ids = list({p["map_id"] for p in pts if p.get("map_id")})

        # Per-map coverage
        coverage_by_map: dict[str, Any] = {}
        for mid in map_ids:
            cov = self.compute_coverage(mid)
            loo = self.loo_accuracy(mid)
            coverage_by_map[mid] = {**cov, "loo_accuracy": loo}

        # Aggregate scanner stats
        scanner_stats: dict[str, dict[str, Any]] = {}
        for pt in pts:
            for r in pt.get("scanner_readings", []):
                src = r.get("source", "")
                if src not in scanner_stats:
                    scanner_stats[src] = {
                        "name": r.get("name", src),
                        "rssi_samples": [],
                        "point_count": 0,
                    }
                scanner_stats[src]["rssi_samples"].extend(r.get("rssi_samples", []))
                scanner_stats[src]["point_count"] += 1

        for src, st in scanner_stats.items():
            samples = st.pop("rssi_samples")
            st["mean_rssi"] = round(_mean(samples), 1) if samples else None
            st["std_rssi"] = round(_std(samples), 2) if samples else None

        # Path-loss fits if we have scanner positions from maps
        path_loss: dict[str, Any] = {}
        if maps_data:
            for m in maps_data:
                mid = m.get("id", "")
                for rec in m.get("receivers") or []:
                    src_id = str(rec.get("id") or "")
                    label = str(rec.get("label") or "")
                    rx = float(rec.get("x") or 0.5)
                    ry = float(rec.get("y") or 0.5)
                    # Try to match scanner source by source string containing label or id
                    for src in scanner_stats:
                        if src_id and src_id in src:
                            fit = self.fit_path_loss(src, rx, ry, mid)
                            if fit:
                                path_loss[src] = {**fit, "map_id": mid, "scanner_name": label or src_id}
                        elif label and label.lower() in src.lower():
                            fit = self.fit_path_loss(src, rx, ry, mid)
                            if fit:
                                path_loss[src] = {**fit, "map_id": mid, "scanner_name": label}

        # Global LOO accuracy
        global_loo = self.loo_accuracy()

        model = {
            "point_count": len(pts),
            "scanner_count": len(scanner_stats),
            "map_count": len(map_ids),
            "coverage_by_map": coverage_by_map,
            "scanner_stats": scanner_stats,
            "path_loss": path_loss,
            "loo_accuracy": global_loo,
            "last_computed": _now_iso(),
        }
        self.data["model"] = model
        return model
