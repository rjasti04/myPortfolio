"""
Behaviour of the simulated Kafka stage reported by `GET /system/pipeline`.

With no broker configured the queue figures are modelled from the API's own
throughput. They are synthetic, but they must still be *coherent*: offsets have
to total the events actually processed, depth has to rise with arrivals and
drain when they stop, and the curve must not depend on how often the snapshot
is read. These tests pin that contract.
"""
import types
from uuid import uuid4

import pytest

from server.services import kafka_stream as ks


class FakeClock:
    """Monotonic clock the test drives explicitly, so no test has to sleep."""

    def __init__(self):
        self.now = 1000.0

    def monotonic(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


@pytest.fixture
def clock(monkeypatch):
    fake = FakeClock()
    # kafka_stream reads the clock as `time.monotonic()`, so swapping the
    # module reference reaches both the broadcast recorder and the decay.
    monkeypatch.setattr(ks, "time", types.SimpleNamespace(monotonic=fake.monotonic, perf_counter=fake.monotonic))
    monkeypatch.setattr(ks, "SIMULATE_KAFKA_METRICS", True)
    ks._recent_broadcasts.clear()
    ks._sim_lag = 0.0
    ks._sim_lag_at = 0.0
    ks.METRICS["events_broadcast"] = 0
    yield fake
    ks._recent_broadcasts.clear()
    ks._sim_lag = 0.0
    ks._sim_lag_at = 0.0
    ks.METRICS["events_broadcast"] = 0


def _emit(clock, count, spread=0.0):
    """Records `count` broadcasts, optionally spread over `spread` seconds."""
    session_id = uuid4()
    for index in range(count):
        ks.deliver_local(session_id, {"event_id": index, "event_type": "click"})
        if spread:
            clock.advance(spread / count)


def _kafka(snapshot=None):
    return (snapshot or ks.pipeline_snapshot())["stages"]["kafka"]


def test_idle_queue_reports_empty(clock):
    """No traffic means no backlog - not a phantom depth."""
    stage = _kafka()
    assert stage["mode"] == "simulated"
    assert stage["simulated"] is True
    assert stage["lag"] == 0
    assert stage["messages"] == 0
    assert stage["throughput"] == 0.0
    assert stage["health"] == "ok"


def test_offsets_total_the_events_actually_processed(clock):
    """Partition offsets must reconcile against the real broadcast count."""
    _emit(clock, 26)
    stage = _kafka()

    assert stage["messages"] == 26
    assert sum(part["offset"] for part in stage["partitions"]) == 26
    assert len(stage["partitions"]) == ks.SIMULATED_PARTITIONS
    assert [part["partition"] for part in stage["partitions"]] == [0, 1, 2]


def test_partition_lag_totals_reported_lag(clock):
    """Per-partition lag must sum to the headline figure, not drift from it."""
    _emit(clock, 40)
    stage = _kafka()
    assert sum(part["lag"] for part in stage["partitions"]) == stage["lag"]


def test_arrivals_build_depth(clock):
    """A burst has to show up as queue depth."""
    _emit(clock, 40)
    assert _kafka()["lag"] > 0


def test_depth_drains_monotonically_to_zero_once_arrivals_stop(clock):
    """
    After the producer stops the backlog must fall on every step and reach
    exactly zero - never climb, and never trail a fractional remainder.
    """
    _emit(clock, 40)
    peak = _kafka()["lag"]
    assert peak > 0

    readings = []
    for _ in range(30):
        clock.advance(2.0)
        readings.append(_kafka()["lag"])

    assert readings[0] <= peak, "depth must not grow after arrivals stop"
    assert all(
        # strict=False is the point: the second sequence is deliberately one
        # shorter, so this walks consecutive pairs.
        later <= earlier for earlier, later in zip(readings, readings[1:], strict=False)
    ), f"drain must be monotonic, got {readings}"
    assert readings[-1] == 0, f"queue must reach empty, ended at {readings[-1]}"


def test_drain_curve_is_independent_of_poll_rate(clock):
    """
    Decay runs against wall time, so over a stretch with no arrivals a client
    polling every 100ms must land on the same depth as one polling once. Decay
    per call, or jitter resampled per call, would let the fast reader move the
    number just by looking at it.

    Only the drain phase is compared. While arrivals are still inside the
    burst window the queue legitimately sits at a plateau, and a reader that
    samples during it should see that.
    """
    _emit(clock, 40)
    # Let the arrival window expire so nothing is topping the queue up.
    clock.advance(2.1)
    _kafka()

    start_lag, start_at = ks._sim_lag, ks._sim_lag_at

    # Fast reader: 40 polls across 4 seconds of drain.
    for _ in range(40):
        clock.advance(0.1)
        _kafka()
    fast_polled = _kafka()["lag"]

    # Slow reader: same 4 seconds, one poll.
    ks._sim_lag, ks._sim_lag_at = start_lag, start_at
    clock.advance(-4.0)
    clock.advance(4.0)
    slow_polled = _kafka()["lag"]

    assert abs(fast_polled - slow_polled) <= 1, (
        f"poll rate changed the curve: {fast_polled} vs {slow_polled}"
    )


def test_throughput_tracks_the_rolling_minute(clock):
    """Throughput is events/sec over the trailing 60s window."""
    _emit(clock, 60, spread=30.0)
    assert _kafka()["throughput"] == pytest.approx(1.0, abs=0.05)

    # Age every sample out of the window.
    clock.advance(61.0)
    assert _kafka()["throughput"] == 0.0


def test_health_escalates_with_depth(clock):
    """Ordinary traffic reads healthy; only a real pile-up goes red."""
    _emit(clock, 4)
    assert _kafka()["health"] == "ok"

    ks._sim_lag = 30.0
    ks._sim_lag_at = clock.monotonic()
    assert _kafka()["health"] == "warn"

    ks._sim_lag = 200.0
    ks._sim_lag_at = clock.monotonic()
    assert _kafka()["health"] == "error"


def test_simulation_can_be_disabled_for_the_honest_bypass_state(clock, monkeypatch):
    """Turning the simulation off restores the truthful `bypass` report."""
    monkeypatch.setattr(ks, "SIMULATE_KAFKA_METRICS", False)
    stage = _kafka()

    assert stage["mode"] == "bypass"
    assert stage["health"] == "bypass"
    assert stage["simulated"] is False


def test_real_broker_metrics_are_never_overwritten_by_the_simulation(clock, monkeypatch):
    """A connected broker must report its own figures, not modelled ones."""
    monkeypatch.setattr(ks, "SIMULATE_KAFKA_METRICS", True)
    ks.METRICS["kafka_connected"] = True
    ks.METRICS["kafka_messages"] = 77
    ks.METRICS["kafka_lag"] = 5
    try:
        stage = _kafka()
        assert stage["mode"] == "kafka"
        assert stage["simulated"] is False
        assert stage["messages"] == 77
        assert stage["lag"] == 5
    finally:
        ks.METRICS["kafka_connected"] = False
        ks.METRICS["kafka_messages"] = 0
        ks.METRICS["kafka_lag"] = None
