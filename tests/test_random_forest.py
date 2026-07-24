"""Unit tests for the pure-Python Random Forest locator in random_forest.py.

Covers the three P0-12 fixes (docs/improvement-review-2026-07-15.md):
1. Bootstrap-index bug — leaf indices must map back to original training
   points, so room votes come from the right points.
2. Confidence collapse — metre-space training must not use the 0-1 fraction
   reference variance.
3. Floor-blind — metre-space predictions must return the dominant floor_id.
"""

from __future__ import annotations

from custom_components.padspan_ha.random_forest import RandomForestLocator


# ---------------------------------------------------------------------------
# Inline helpers — self-contained, no conftest dependency
# ---------------------------------------------------------------------------


def _make_rf_point(
    *,
    room: str,
    readings: dict[str, float],
    map_id: str = "map1",
    floor_id: str = "floor1",
    x_frac: float | None = 0.5,
    y_frac: float | None = 0.5,
    x_m: float | None = None,
    y_m: float | None = None,
) -> dict:
    """Build a calibration point dict with scanner_readings from a {source: rssi} map."""
    scanner_readings = [
        {"source": src, "mean_rssi": rssi} for src, rssi in readings.items()
    ]
    pt: dict = {
        "map_id": map_id,
        "floor_id": floor_id,
        "room": room,
        "scanner_readings": scanner_readings,
    }
    if x_frac is not None:
        pt["x_frac"] = x_frac
        pt["y_frac"] = y_frac
    if x_m is not None:
        pt["x_m"] = x_m
        pt["y_m"] = y_m
    return pt


# ---------------------------------------------------------------------------
# Tests: bug 1 — bootstrap leaf indices map back to original points
# ---------------------------------------------------------------------------


class TestLeafIndexRoundTrip:
    """Room votes must come from the actual training points in each leaf."""

    def _train_distinct_rooms(self) -> tuple[RandomForestLocator, list[dict]]:
        """8 points, each with a distinct room and well-separated RSSI signature."""
        points = []
        for i in range(8):
            points.append(
                _make_rf_point(
                    room=f"room{i}",
                    readings={"s0": -30.0 - 8.0 * i, "s1": -86.0 + 8.0 * i},
                    x_frac=i / 10.0,
                    y_frac=i / 10.0,
                )
            )
        rf = RandomForestLocator(n_trees=40, max_depth=10, min_leaf=1, seed=42)
        rf.train(points, use_metres=False)
        assert rf.is_trained
        return rf, points

    def test_predict_at_training_point_votes_own_room(self) -> None:
        """Predicting at a training point's exact RSSI must vote for its room."""
        rf, points = self._train_distinct_rooms()
        for i, pt in enumerate(points):
            query = {r["source"]: r["mean_rssi"] for r in pt["scanner_readings"]}
            result = rf.predict(query)
            assert result is not None
            assert result["nearest_room"] == f"room{i}", (
                f"point {i}: expected room{i}, got {result['nearest_room']}"
            )

    def test_high_index_point_can_receive_votes(self) -> None:
        """Points with index >= 0.8n could never win under the bootstrap-index bug."""
        rf, points = self._train_distinct_rooms()
        # Index 7 >= 0.8 * 8 = 6.4 — unreachable with un-mapped bootstrap indices.
        pt = points[7]
        query = {r["source"]: r["mean_rssi"] for r in pt["scanner_readings"]}
        result = rf.predict(query)
        assert result is not None
        assert result["nearest_room"] == "room7"


# ---------------------------------------------------------------------------
# Tests: bug 2 — confidence must not collapse in metre space
# ---------------------------------------------------------------------------


class TestMetreSpaceConfidence:
    """A tight metre-space cluster must yield high confidence."""

    def _cluster_readings(self, near: bool) -> dict[str, float]:
        if near:
            return {"s0": -40.0, "s1": -42.0, "s2": -80.0, "s3": -82.0}
        return {"s0": -80.0, "s1": -82.0, "s2": -40.0, "s3": -42.0}

    def _train_two_clusters(self) -> RandomForestLocator:
        """Two 10-point clusters 12 m apart; each cluster spread is < ±0.5 m.

        10 points per cluster keeps the odds of a bootstrap sample drawing
        exclusively from one cluster (which would put a rogue far-cluster
        tree in the forest) negligible.
        """
        points = []
        offsets = [-0.45, -0.35, -0.25, -0.15, -0.05, 0.05, 0.15, 0.25, 0.35, 0.45]
        for j, off in enumerate(offsets):
            base = self._cluster_readings(near=True)
            points.append(
                _make_rf_point(
                    room="kitchen",
                    readings={s: v + 0.5 * j for s, v in base.items()},
                    x_frac=None,
                    y_frac=None,
                    x_m=0.0 + off,
                    y_m=0.0 - off,
                )
            )
        for j, off in enumerate(offsets):
            base = self._cluster_readings(near=False)
            points.append(
                _make_rf_point(
                    room="garage",
                    readings={s: v + 0.5 * j for s, v in base.items()},
                    x_frac=None,
                    y_frac=None,
                    x_m=12.0 + off,
                    y_m=12.0 - off,
                )
            )
        rf = RandomForestLocator(n_trees=30, max_depth=8, min_leaf=1, seed=42)
        rf.train(points, use_metres=True)
        assert rf.is_trained
        return rf

    def test_tight_cluster_high_confidence(self) -> None:
        """±0.5 m tree spread must clear the 0.15 live threshold by a wide margin."""
        rf = self._train_two_clusters()
        result = rf.predict(self._cluster_readings(near=True))
        assert result is not None
        assert result["shared_scanners"] == 4
        assert result["confidence"] > 0.5
        assert result["nearest_room"] == "kitchen"
        # Sanity: the regression itself lands in the right cluster
        assert abs(result["x_m"]) < 2.0
        assert abs(result["y_m"]) < 2.0

    def test_other_cluster_also_confident(self) -> None:
        """Symmetry check — the far cluster resolves confidently too."""
        rf = self._train_two_clusters()
        result = rf.predict(self._cluster_readings(near=False))
        assert result is not None
        assert result["confidence"] > 0.5
        assert result["nearest_room"] == "garage"


# ---------------------------------------------------------------------------
# Tests: bug 3 — predict returns the dominant floor
# ---------------------------------------------------------------------------


class TestDominantFloor:
    """Metre-space predictions must carry floor_id like knn_locate does."""

    def _train_two_floors(self) -> RandomForestLocator:
        """Two overlapping floors with distinct RSSI signatures."""
        points = []
        for j in range(5):
            points.append(
                _make_rf_point(
                    room="living",
                    floor_id="floor1",
                    readings={"up0": -85.0 - j, "up1": -87.0 - j,
                              "dn0": -40.0 - j, "dn1": -42.0 - j},
                    x_frac=None,
                    y_frac=None,
                    x_m=2.0 + 0.2 * j,
                    y_m=2.0 - 0.2 * j,
                )
            )
        for j in range(5):
            points.append(
                _make_rf_point(
                    room="bedroom",
                    floor_id="floor2",
                    map_id="map2",
                    readings={"up0": -40.0 - j, "up1": -42.0 - j,
                              "dn0": -85.0 - j, "dn1": -87.0 - j},
                    x_frac=None,
                    y_frac=None,
                    x_m=2.0 + 0.2 * j,
                    y_m=2.0 - 0.2 * j,
                )
            )
        rf = RandomForestLocator(n_trees=30, max_depth=8, min_leaf=1, seed=42)
        rf.train(points, use_metres=True)
        assert rf.is_trained
        return rf

    def test_returns_dominant_floor_and_map(self) -> None:
        """floor_id must be the floor of the voting leaf points."""
        rf = self._train_two_floors()
        result = rf.predict({"up0": -40.0, "up1": -42.0, "dn0": -85.0, "dn1": -87.0})
        assert result is not None
        assert result["floor_id"] == "floor2"
        assert result["map_id"] == "map2"
        assert result["nearest_room"] == "bedroom"

        result = rf.predict({"up0": -85.0, "up1": -87.0, "dn0": -40.0, "dn1": -42.0})
        assert result is not None
        assert result["floor_id"] == "floor1"
        assert result["map_id"] == "map1"
        assert result["nearest_room"] == "living"

    def test_metre_result_has_knn_locate_keys(self) -> None:
        """Metre-space result shape matches knn_locate's metre-space contract."""
        rf = self._train_two_floors()
        result = rf.predict({"up0": -40.0, "up1": -42.0, "dn0": -85.0, "dn1": -87.0})
        assert result is not None
        for key in ("x_frac", "y_frac", "confidence", "nearest_room", "map_id",
                    "k_used", "shared_scanners", "x_m", "y_m", "floor_id"):
            assert key in result, f"missing key: {key}"

    def test_fraction_result_has_no_floor_id(self) -> None:
        """Fraction-space results omit floor_id, mirroring knn_locate."""
        points = [
            _make_rf_point(
                room=f"room{i % 2}",
                readings={"s0": -40.0 - 8.0 * i, "s1": -80.0 + 8.0 * i},
                x_frac=i / 10.0,
                y_frac=i / 10.0,
            )
            for i in range(6)
        ]
        rf = RandomForestLocator(n_trees=20, max_depth=8, min_leaf=1, seed=42)
        rf.train(points, use_metres=False)
        assert rf.is_trained
        result = rf.predict({"s0": -40.0, "s1": -80.0})
        assert result is not None
        assert "floor_id" not in result
        assert "x_m" not in result
