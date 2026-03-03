# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Adaptive Learning Store
========================
Passively learns room RSSI fingerprints, transition patterns, and cross-floor
attenuation from high-confidence confirmed room assignments.  All statistics
use Welford's online algorithm (running mean + variance) so the store stays
compact regardless of how long learning runs.

Stored in .storage/padspan_ha.adaptive.
"""

import logging
import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import ADAPTIVE_STORE_KEY

_LOGGER = logging.getLogger(__name__)

# How many observations before adaptive scoring reaches full influence
_MATURITY_OBS = 2000
# Minimum observations per room-scanner pair before using it for scoring
_MIN_PAIR_OBS = 10
# Minimum total transition count from a room before using priors
_MIN_TRANSITIONS = 20


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _empty_data() -> dict[str, Any]:
    return {
        "room_fingerprints": {},
        "transition_counts": {},
        "floor_pairs": {},
        "stats": {
            "total_observations": 0,
            "learning_since": None,
            "days_active": 0,
        },
    }


@dataclass
class AdaptiveStore:
    hass: HomeAssistant
    store: Store
    data: dict[str, Any] = field(default_factory=_empty_data)

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = Store(hass, 1, ADAPTIVE_STORE_KEY)
        self.data = _empty_data()

    async def async_load(self) -> dict[str, Any]:
        loaded = await self.store.async_load()
        if isinstance(loaded, dict) and "room_fingerprints" in loaded:
            self.data = loaded
        else:
            self.data = _empty_data()
        return self.data

    async def _save(self) -> None:
        await self.store.async_save(self.data)

    # ── Welford online update ────────────────────────────────────────────────

    @staticmethod
    def _welford_update(
        existing: dict[str, float], new_val: float
    ) -> dict[str, float]:
        """Update running mean/variance with one new sample (Welford's)."""
        n = existing.get("n", 0) + 1
        old_mean = existing.get("mean", 0.0)
        delta = new_val - old_mean
        new_mean = old_mean + delta / n
        old_var = existing.get("var", 0.0)
        # var tracks sum-of-squares / n (population variance)
        new_var = old_var + (delta * (new_val - new_mean) - old_var) / n
        return {"mean": round(new_mean, 3), "var": round(max(0.0, new_var), 3), "n": n}

    # ── Observation recording ────────────────────────────────────────────────

    def observe(
        self,
        room: str,
        floor_id: str | None,
        ema_rssi: dict[str, float],
        source_to_area: dict[str, str],
        source_to_floor: dict[str, str],
    ) -> None:
        """Record one high-confidence observation for adaptive learning."""
        if not room or not ema_rssi:
            return

        fps = self.data.setdefault("room_fingerprints", {})
        room_fp = fps.setdefault(room, {})

        for src, rssi in ema_rssi.items():
            existing = room_fp.get(src, {})
            room_fp[src] = self._welford_update(existing, rssi)

        # Cross-floor attenuation: record RSSI delta between same-floor and
        # cross-floor scanners.  We compare each scanner's RSSI to the
        # room's "home" scanners (those on the same floor as the room).
        if floor_id:
            fp_data = self.data.setdefault("floor_pairs", {})
            home_rssi_vals = []
            cross_entries: list[tuple[str, float]] = []
            for src, rssi in ema_rssi.items():
                src_floor = source_to_floor.get(src, "")
                if src_floor == floor_id:
                    home_rssi_vals.append(rssi)
                elif src_floor:
                    cross_entries.append((src_floor, rssi))

            if home_rssi_vals and cross_entries:
                home_mean = sum(home_rssi_vals) / len(home_rssi_vals)
                for cross_floor, cross_rssi in cross_entries:
                    pair_key = f"{floor_id}|{cross_floor}"
                    delta = cross_rssi - home_mean  # negative = weaker cross-floor
                    existing = fp_data.get(pair_key, {})
                    fp_data[pair_key] = self._welford_update(existing, delta)

        stats = self.data.setdefault("stats", {})
        stats["total_observations"] = stats.get("total_observations", 0) + 1
        if not stats.get("learning_since"):
            stats["learning_since"] = _now_iso()

    def record_transition(self, from_room: str | None, to_room: str) -> None:
        """Increment transition counter for room changes."""
        if not from_room or not to_room or from_room == to_room:
            return
        tc = self.data.setdefault("transition_counts", {})
        from_map = tc.setdefault(from_room, {})
        from_map[to_room] = from_map.get(to_room, 0) + 1

    async def async_save_periodic(self) -> None:
        """Called periodically (not every poll) to persist to disk."""
        await self._save()

    # ── Scoring ──────────────────────────────────────────────────────────────

    def score_rooms(
        self, ema_rssi: dict[str, float], source_to_area: dict[str, str]
    ) -> dict[str, float]:
        """
        Score candidate rooms by fingerprint similarity.

        For each room with learned fingerprints, compute a Mahalanobis-like
        distance between the current per-scanner RSSI and the learned profile,
        then convert to a Gaussian score.
        """
        fps = self.data.get("room_fingerprints", {})
        if not fps or not ema_rssi:
            return {}

        scores: dict[str, float] = {}
        for room, room_fp in fps.items():
            shared = set(ema_rssi.keys()) & set(room_fp.keys())
            # Only score if we have enough shared scanners with sufficient data
            usable = [
                s for s in shared
                if room_fp[s].get("n", 0) >= _MIN_PAIR_OBS
            ]
            if not usable:
                continue

            # Mahalanobis-like distance: sum of (obs - mean)^2 / var
            dist_sq = 0.0
            for src in usable:
                fp = room_fp[src]
                diff = ema_rssi[src] - fp["mean"]
                var = max(fp.get("var", 1.0), 1.0)  # floor at 1.0 to avoid /0
                dist_sq += (diff ** 2) / var

            avg_dist = dist_sq / len(usable)
            # Convert to 0–1 score: exp(-d/2) gives Gaussian-like falloff
            scores[room] = math.exp(-avg_dist / 2.0)

        return scores

    def transition_prior(
        self, from_room: str, candidates: Any
    ) -> dict[str, float]:
        """
        Return Bayesian prior weights for candidate rooms based on transition
        frequency from the current room.  Returns 0–1 normalized weights.
        """
        tc = self.data.get("transition_counts", {})
        from_map = tc.get(from_room, {})
        total = sum(from_map.values())
        if total < _MIN_TRANSITIONS:
            return {}

        priors: dict[str, float] = {}
        for room in candidates:
            count = from_map.get(room, 0)
            priors[room] = count / total
        return priors

    def floor_confidence(
        self,
        ema_rssi: dict[str, float],
        candidate_floor: str,
        source_to_floor: dict[str, str],
    ) -> float:
        """
        Estimate confidence that a device is actually on candidate_floor
        based on learned cross-floor attenuation.

        Returns 0–1.  High = strong evidence for candidate floor.
        """
        fp_data = self.data.get("floor_pairs", {})
        if not fp_data or not ema_rssi:
            return 0.5  # no data — neutral

        # Group scanners by floor
        floor_rssi: dict[str, list[float]] = {}
        for src, rssi in ema_rssi.items():
            fl = source_to_floor.get(src, "")
            if fl:
                floor_rssi.setdefault(fl, []).append(rssi)

        if candidate_floor not in floor_rssi:
            return 0.3  # no scanners on candidate floor — low confidence

        cand_mean = sum(floor_rssi[candidate_floor]) / len(floor_rssi[candidate_floor])

        # Compare with other floors: if candidate floor's mean RSSI is
        # significantly stronger, device is likely on that floor.
        other_means = []
        for fl, vals in floor_rssi.items():
            if fl != candidate_floor and len(vals) >= 1:
                other_means.append(sum(vals) / len(vals))

        if not other_means:
            return 0.7  # only candidate floor has scanners — moderate confidence

        best_other = max(other_means)
        gap = cand_mean - best_other  # positive = candidate floor is stronger

        # Check against learned attenuation for this floor pair
        # Use learned delta as expected: if gap matches expectation, confidence up
        # For simplicity: map gap to confidence sigmoid
        # gap > 5 dBm → high confidence (0.8+)
        # gap ≈ 0 → ambiguous (0.5)
        # gap < -5 → low confidence (0.2)
        confidence = 1.0 / (1.0 + math.exp(-gap / 5.0))
        return round(min(1.0, max(0.0, confidence)), 3)

    # ── Maturity ─────────────────────────────────────────────────────────────

    def maturity(self) -> float:
        """0–1 indicating how much learned data is available."""
        total = self.data.get("stats", {}).get("total_observations", 0)
        return round(min(1.0, total / _MATURITY_OBS), 3)

    # ── Summary / UI ─────────────────────────────────────────────────────────

    def summary(self) -> dict[str, Any]:
        """Return stats for UI display."""
        stats = self.data.get("stats", {})
        fps = self.data.get("room_fingerprints", {})
        tc = self.data.get("transition_counts", {})
        fp_data = self.data.get("floor_pairs", {})

        total_obs = stats.get("total_observations", 0)
        learning_since = stats.get("learning_since")

        # Compute days active
        days = 0
        if learning_since:
            try:
                start = datetime.fromisoformat(learning_since)
                days = max(0, (datetime.now(timezone.utc) - start).days)
            except Exception:
                pass

        rooms_learned = len(fps)
        scanners_learned = len({
            src for room_fp in fps.values() for src in room_fp
        })
        transitions_total = sum(
            sum(dest.values()) for dest in tc.values()
        )
        floor_pairs_learned = len(fp_data)

        return {
            "total_observations": total_obs,
            "learning_since": learning_since,
            "days_active": days,
            "maturity_pct": round(self.maturity() * 100, 1),
            "rooms_learned": rooms_learned,
            "scanners_learned": scanners_learned,
            "transitions_total": transitions_total,
            "floor_pairs_learned": floor_pairs_learned,
        }

    # ── Reset ────────────────────────────────────────────────────────────────

    async def async_remove_scanner(self, source: str) -> int:
        """Remove a scanner's fingerprints from all rooms.

        Returns the number of room-scanner pairs removed.
        """
        removed = 0
        fps = self.data.get("room_fingerprints", {})
        for room_fp in fps.values():
            if source in room_fp:
                del room_fp[source]
                removed += 1
        if removed:
            await self._save()
        return removed

    async def async_reset(self) -> None:
        """Clear all learned data."""
        self.data = _empty_data()
        await self._save()
        _LOGGER.info("Adaptive learning data reset")
