"""Unit tests for pure helper/math functions in calibration_store.py."""

from __future__ import annotations

import math
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.calibration_store import (
    CalibrationStore,
    GRID_N,
    KNN_K,
    SIGMA_CELLS,
    _gaussian,
    _mean,
    _std,
)


# ---------------------------------------------------------------------------
# Inline helpers — self-contained, no conftest dependency
# ---------------------------------------------------------------------------


def _make_store(points: list[dict] | None = None) -> CalibrationStore:
    """Create a CalibrationStore backed by mocks with optional seed data."""
    hass = MagicMock()
    store = CalibrationStore.__new__(CalibrationStore)
    store.hass = hass
    store.store = AsyncMock()
    store.store.async_load = AsyncMock(return_value=None)
    store.store.async_save = AsyncMock()
    store.data = {"points": list(points or []), "model": {}}
    return store


def _make_point(
    *,
    map_id: str = "map1",
    x_frac: float = 0.5,
    y_frac: float = 0.5,
    room: str = "living",
    readings: dict[str, float] | None = None,
) -> dict:
    """Build a calibration point dict with scanner_readings from a {source: rssi} map."""
    scanner_readings = []
    for src, rssi in (readings or {}).items():
        scanner_readings.append({
            "source": src,
            "name": src,
            "rssi_samples": [rssi],
            "mean_rssi": rssi,
            "std_rssi": 0.0,
            "sample_count": 1,
        })
    return {
        "id": f"cp_{x_frac}_{y_frac}",
        "map_id": map_id,
        "x_frac": x_frac,
        "y_frac": y_frac,
        "floor_id": "floor1",
        "room": room,
        "label": "",
        "device_id": "dev1",
        "collected_at": "2026-01-15T12:00:00+00:00",
        "duration_s": 15,
        "scanner_readings": scanner_readings,
    }


# ---------------------------------------------------------------------------
# Tests: _gaussian
# ---------------------------------------------------------------------------


class TestGaussian:
    """Tests for the _gaussian() helper."""

    def test_peak_at_zero(self) -> None:
        """_gaussian(0, sigma) should always equal 1.0 (peak of Gaussian)."""
        assert _gaussian(0.0, SIGMA_CELLS) == 1.0
        assert _gaussian(0.0, 1.0) == 1.0
        assert _gaussian(0.0, 100.0) == 1.0

    def test_symmetry(self) -> None:
        """_gaussian(d) == _gaussian(-d) for any d."""
        for d in [0.5, 1.0, 2.0, 5.0]:
            assert _gaussian(d, SIGMA_CELLS) == pytest.approx(_gaussian(-d, SIGMA_CELLS))

    def test_decays_with_distance(self) -> None:
        """Values should decrease monotonically as distance grows."""
        vals = [_gaussian(d, SIGMA_CELLS) for d in [0, 1, 2, 3, 4, 5]]
        for i in range(len(vals) - 1):
            assert vals[i] > vals[i + 1]

    def test_known_value_at_one_sigma(self) -> None:
        """At distance == sigma, value should be exp(-0.5) ~= 0.6065."""
        expected = math.exp(-0.5)
        assert _gaussian(SIGMA_CELLS, SIGMA_CELLS) == pytest.approx(expected, rel=1e-9)

    def test_large_distance_approaches_zero(self) -> None:
        """At very large distances the Gaussian should be essentially zero."""
        assert _gaussian(100.0, 1.0) == pytest.approx(0.0, abs=1e-100)


# ---------------------------------------------------------------------------
# Tests: _mean
# ---------------------------------------------------------------------------


class TestMean:
    """Tests for the _mean() helper."""

    def test_empty_returns_zero(self) -> None:
        """Mean of an empty list is defined as 0.0."""
        assert _mean([]) == 0.0

    def test_single_element(self) -> None:
        """Mean of a single-element list is that element."""
        assert _mean([42.0]) == 42.0

    def test_typical_case(self) -> None:
        """Mean of [1, 2, 3, 4, 5] is 3.0."""
        assert _mean([1.0, 2.0, 3.0, 4.0, 5.0]) == pytest.approx(3.0)

    def test_negative_values(self) -> None:
        """Mean works correctly with negative values (typical for RSSI)."""
        assert _mean([-60.0, -70.0, -80.0]) == pytest.approx(-70.0)


# ---------------------------------------------------------------------------
# Tests: _std
# ---------------------------------------------------------------------------


class TestStd:
    """Tests for the _std() (population std-dev) helper."""

    def test_empty_returns_zero(self) -> None:
        """Std of empty list is 0.0."""
        assert _std([]) == 0.0

    def test_single_element_returns_zero(self) -> None:
        """Std of a single-element list is 0.0 (not enough data)."""
        assert _std([99.0]) == 0.0

    def test_identical_values(self) -> None:
        """Std of identical values is 0.0."""
        assert _std([5.0, 5.0, 5.0, 5.0]) == pytest.approx(0.0)

    def test_known_std(self) -> None:
        """Population std of [2, 4, 4, 4, 5, 5, 7, 9] is 2.0."""
        vals = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]
        assert _std(vals) == pytest.approx(2.0)


# ---------------------------------------------------------------------------
# Tests: compute_coverage
# ---------------------------------------------------------------------------


class TestComputeCoverage:
    """Tests for CalibrationStore.compute_coverage()."""

    def test_empty_map_all_zeros(self) -> None:
        """Coverage grid with no points should be all zeros."""
        store = _make_store()
        result = store.compute_coverage("map1")

        assert result["point_count"] == 0
        assert result["covered_cells"] == 0
        assert result["coverage_pct"] == 0.0
        assert len(result["grid"]) == GRID_N * GRID_N
        assert all(v == 0.0 for v in result["grid"])

    def test_center_point_creates_nonzero_coverage(self) -> None:
        """A single point at the center should produce a non-zero coverage grid."""
        store = _make_store(points=[_make_point(x_frac=0.5, y_frac=0.5)])
        result = store.compute_coverage("map1")

        assert result["point_count"] == 1
        assert result["covered_cells"] > 0
        assert result["coverage_pct"] > 0.0
        assert any(v > 0.0 for v in result["grid"])

    def test_next_target_always_present(self) -> None:
        """Result always includes a next_target with valid fractional coordinates."""
        store = _make_store()
        result = store.compute_coverage("map1")

        nt = result["next_target"]
        assert 0.0 <= nt["x_frac"] <= 1.0
        assert 0.0 <= nt["y_frac"] <= 1.0
        assert "score" in nt

    def test_filters_by_map_id(self) -> None:
        """Points on a different map are not included in coverage."""
        store = _make_store(points=[
            _make_point(map_id="mapA", x_frac=0.5, y_frac=0.5),
            _make_point(map_id="mapB", x_frac=0.1, y_frac=0.1),
        ])
        result = store.compute_coverage("mapA")
        assert result["point_count"] == 1

    def test_grid_values_capped_at_one(self) -> None:
        """Even with many overlapping points, grid values should not exceed 1.0."""
        pts = [_make_point(x_frac=0.5, y_frac=0.5) for _ in range(20)]
        store = _make_store(points=pts)
        result = store.compute_coverage("map1")
        assert all(v <= 1.0 for v in result["grid"])


# ---------------------------------------------------------------------------
# Tests: fit_path_loss
# ---------------------------------------------------------------------------


class TestFitPathLoss:
    """Tests for CalibrationStore.fit_path_loss()."""

    def test_fewer_than_three_points_returns_none(self) -> None:
        """fit_path_loss requires at least 3 data points."""
        pts = [
            _make_point(x_frac=0.1, y_frac=0.5, readings={"scannerA": -50.0}),
            _make_point(x_frac=0.3, y_frac=0.5, readings={"scannerA": -60.0}),
        ]
        store = _make_store(points=pts)
        result = store.fit_path_loss("scannerA", 0.0, 0.5)
        assert result is None

    def test_three_points_returns_model(self) -> None:
        """With three valid points the fit should return a model dict."""
        pts = [
            _make_point(x_frac=0.1, y_frac=0.5, readings={"scannerA": -45.0}),
            _make_point(x_frac=0.3, y_frac=0.5, readings={"scannerA": -55.0}),
            _make_point(x_frac=0.6, y_frac=0.5, readings={"scannerA": -65.0}),
        ]
        store = _make_store(points=pts)
        result = store.fit_path_loss("scannerA", 0.0, 0.5)

        assert result is not None
        assert "n" in result
        assert "rssi_1m" in result
        assert "r_squared" in result
        assert result["point_count"] == 3
        # Path-loss exponent should be clamped to [0.5, 8.0]
        assert 0.5 <= result["n"] <= 8.0

    def test_ignores_close_points(self) -> None:
        """Points with distance < 0.02 from the scanner are ignored."""
        pts = [
            _make_point(x_frac=0.005, y_frac=0.5, readings={"scannerA": -30.0}),  # too close
            _make_point(x_frac=0.1, y_frac=0.5, readings={"scannerA": -50.0}),
            _make_point(x_frac=0.3, y_frac=0.5, readings={"scannerA": -60.0}),
            _make_point(x_frac=0.6, y_frac=0.5, readings={"scannerA": -70.0}),
        ]
        store = _make_store(points=pts)
        result = store.fit_path_loss("scannerA", 0.0, 0.5)

        assert result is not None
        # The close point should have been dropped, leaving 3
        assert result["point_count"] == 3

    def test_filters_by_map_id(self) -> None:
        """When map_id is given, only points on that map are used."""
        pts = [
            _make_point(map_id="mapA", x_frac=0.1, y_frac=0.5, readings={"scannerA": -45.0}),
            _make_point(map_id="mapA", x_frac=0.3, y_frac=0.5, readings={"scannerA": -55.0}),
            _make_point(map_id="mapA", x_frac=0.6, y_frac=0.5, readings={"scannerA": -65.0}),
            _make_point(map_id="mapB", x_frac=0.1, y_frac=0.5, readings={"scannerA": -50.0}),
        ]
        store = _make_store(points=pts)
        result = store.fit_path_loss("scannerA", 0.0, 0.5, map_id="mapA")
        assert result is not None
        assert result["point_count"] == 3


# ---------------------------------------------------------------------------
# Tests: knn_locate
# ---------------------------------------------------------------------------


class TestKnnLocate:
    """Tests for CalibrationStore.knn_locate()."""

    def test_empty_store_returns_none(self) -> None:
        """No points means no location estimate."""
        store = _make_store()
        result = store.knn_locate({"scannerA": -60.0})
        assert result is None

    def test_empty_query_returns_none(self) -> None:
        """An empty query RSSI dict returns None."""
        store = _make_store(points=[
            _make_point(readings={"scannerA": -50.0}),
        ])
        result = store.knn_locate({})
        assert result is None

    def test_no_shared_scanners_returns_none(self) -> None:
        """When query and fingerprints share no scanners, return None."""
        store = _make_store(points=[
            _make_point(readings={"scannerA": -50.0}),
        ])
        result = store.knn_locate({"scannerB": -60.0})
        assert result is None

    def test_exact_match_returns_that_point(self) -> None:
        """When query exactly matches one fingerprint, result is near that point."""
        pts = [
            _make_point(x_frac=0.2, y_frac=0.3, room="kitchen",
                        readings={"s1": -50.0, "s2": -60.0}),
            _make_point(x_frac=0.8, y_frac=0.7, room="bedroom",
                        readings={"s1": -70.0, "s2": -40.0}),
        ]
        store = _make_store(points=pts)
        result = store.knn_locate({"s1": -50.0, "s2": -60.0})

        assert result is not None
        assert result["x_frac"] == pytest.approx(0.2, abs=0.05)
        assert result["y_frac"] == pytest.approx(0.3, abs=0.05)
        assert result["nearest_room"] == "kitchen"

    def test_k_used_capped(self) -> None:
        """k_used should not exceed the number of scoreable points."""
        pts = [
            _make_point(x_frac=0.1, y_frac=0.1, readings={"s1": -40.0}),
            _make_point(x_frac=0.9, y_frac=0.9, readings={"s1": -80.0}),
        ]
        store = _make_store(points=pts)
        result = store.knn_locate({"s1": -60.0}, k=5)
        assert result is not None
        assert result["k_used"] == 2  # only 2 points available

    def test_filters_by_map_id(self) -> None:
        """Only points matching the given map_id are considered."""
        pts = [
            _make_point(map_id="mapA", x_frac=0.1, y_frac=0.1, readings={"s1": -40.0}),
            _make_point(map_id="mapB", x_frac=0.9, y_frac=0.9, readings={"s1": -80.0}),
        ]
        store = _make_store(points=pts)
        result = store.knn_locate({"s1": -40.0}, map_id="mapA")
        assert result is not None
        assert result["k_used"] == 1

    def test_confidence_between_zero_and_one(self) -> None:
        """Confidence should be in range (0, 1]."""
        pts = [
            _make_point(x_frac=0.5, y_frac=0.5, readings={"s1": -55.0}),
        ]
        store = _make_store(points=pts)
        result = store.knn_locate({"s1": -55.0})
        assert result is not None
        assert 0.0 < result["confidence"] <= 1.0


# ---------------------------------------------------------------------------
# Tests: loo_accuracy
# ---------------------------------------------------------------------------


class TestLooAccuracy:
    """Tests for CalibrationStore.loo_accuracy()."""

    def test_too_few_points_returns_none(self) -> None:
        """Need at least KNN_K + 1 points for LOO to work."""
        pts = [
            _make_point(x_frac=0.1, y_frac=0.1, readings={"s1": -40.0}),
            _make_point(x_frac=0.5, y_frac=0.5, readings={"s1": -60.0}),
        ]
        store = _make_store(points=pts)
        result = store.loo_accuracy()
        assert result is None

    def test_returns_error_metrics_with_enough_points(self) -> None:
        """With KNN_K+1 points, LOO should return error metrics."""
        # Create KNN_K + 1 = 4 points with shared scanner
        pts = [
            _make_point(x_frac=0.1, y_frac=0.1, readings={"s1": -40.0, "s2": -70.0}),
            _make_point(x_frac=0.3, y_frac=0.3, readings={"s1": -50.0, "s2": -60.0}),
            _make_point(x_frac=0.6, y_frac=0.6, readings={"s1": -60.0, "s2": -50.0}),
            _make_point(x_frac=0.9, y_frac=0.9, readings={"s1": -75.0, "s2": -35.0}),
        ]
        store = _make_store(points=pts)
        result = store.loo_accuracy()

        assert result is not None
        assert "mean_error_frac" in result
        assert "median_error_frac" in result
        assert "max_error_frac" in result
        assert "point_count" in result
        assert "mean_error_m_est" in result
        assert result["point_count"] >= 1
        # Errors should be non-negative
        assert result["mean_error_frac"] >= 0.0
        assert result["median_error_frac"] >= 0.0
        assert result["max_error_frac"] >= 0.0
        # Mean error in metres is ~15x fractional error
        assert result["mean_error_m_est"] == pytest.approx(
            result["mean_error_frac"] * 15, abs=0.02
        )

    def test_filters_by_map_id(self) -> None:
        """LOO only considers points on the specified map."""
        pts_a = [
            _make_point(map_id="mapA", x_frac=i * 0.2, y_frac=i * 0.2,
                        readings={"s1": -40.0 - i * 10})
            for i in range(5)
        ]
        pts_b = [_make_point(map_id="mapB", x_frac=0.5, y_frac=0.5, readings={"s1": -55.0})]
        store = _make_store(points=pts_a + pts_b)

        result_a = store.loo_accuracy(map_id="mapA")
        result_b = store.loo_accuracy(map_id="mapB")

        assert result_a is not None
        assert result_b is None  # only 1 point on mapB, not enough
