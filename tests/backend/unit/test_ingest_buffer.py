"""Guards the write buffer's failure behaviour.

A failed flush returns its events to the buffer. With no ceiling, a database
outage grew that buffer until the process ran out of memory - the one failure
mode guaranteed to take the API down alongside the database it depends on.
Unrecoverable failures, meanwhile, discarded events with nothing but a log line.
"""


import pytest
from sqlalchemy.exc import OperationalError

from server.services import kafka_stream as ks


@pytest.fixture(autouse=True)
def clean_pipeline_state():
    ks.batch_buffer.clear()
    for key in ("events_dropped_overflow", "events_dropped_rejected", "flush_failures"):
        ks.METRICS[key] = 0
    ks.METRICS["last_error"] = None
    yield
    ks.batch_buffer.clear()


def _events(count, start=0):
    return [{"session_id": f"s{i}", "event_type": "page_view"} for i in range(start, start + count)]


@pytest.mark.asyncio
async def test_a_recoverable_failure_returns_events_for_a_retry(monkeypatch):
    class _Boom:
        async def __aenter__(self): raise OperationalError("stmt", {}, Exception("down"))
        async def __aexit__(self, *a): return False

    monkeypatch.setattr(ks, "AsyncSessionLocal", lambda: _Boom())
    ks.batch_buffer.extend(_events(5))

    await ks.save_batch()

    assert len(ks.batch_buffer) == 5, "a transient outage must not lose events"
    assert ks.METRICS["flush_failures"] == 1
    assert ks.METRICS["events_dropped_overflow"] == 0


@pytest.mark.asyncio
async def test_the_buffer_never_grows_past_its_cap(monkeypatch):
    class _Boom:
        async def __aenter__(self): raise OperationalError("stmt", {}, Exception("down"))
        async def __aexit__(self, *a): return False

    monkeypatch.setattr(ks, "AsyncSessionLocal", lambda: _Boom())
    monkeypatch.setattr(ks, "MAX_BUFFERED_EVENTS", 10)

    # Six flushes of four events against a dead database: 24 events, cap of 10.
    for round_index in range(6):
        ks.batch_buffer.extend(_events(4, start=round_index * 4))
        await ks.save_batch()

    assert len(ks.batch_buffer) == 10, "buffer exceeded its ceiling"
    assert ks.METRICS["events_dropped_overflow"] == 14
    # The newest events are the ones kept.
    assert ks.batch_buffer[-1]["session_id"] == "s23"


@pytest.mark.asyncio
async def test_an_unrecoverable_failure_counts_the_events_it_discards(monkeypatch):
    class _Boom:
        async def __aenter__(self): raise ValueError("column does not exist")
        async def __aexit__(self, *a): return False

    monkeypatch.setattr(ks, "AsyncSessionLocal", lambda: _Boom())
    ks.batch_buffer.extend(_events(7))

    await ks.save_batch()

    assert ks.batch_buffer == [], "rejected writes must not lock the queue"
    assert ks.METRICS["events_dropped_rejected"] == 7


@pytest.mark.asyncio
async def test_the_pipeline_stops_reporting_healthy_once_events_are_dropped():
    assert ks.pipeline_snapshot()["stages"]["postgres"]["health"] == "ok"

    ks.METRICS["events_dropped_rejected"] = 3
    postgres = ks.pipeline_snapshot()["stages"]["postgres"]
    assert postgres["health"] == "error", "silent data loss must not read as healthy"
    assert postgres["dropped_rejected"] == 3


@pytest.mark.asyncio
async def test_a_failed_flush_keeps_events_in_arrival_order(monkeypatch):
    """Events that arrive *during* a failed flush are newer than the batch.

    The retry used to `extend`, appending the older batch after them. That both
    scrambled the order and, because the cap trims from the front, made an
    outage evict the newest arrivals while keeping the stale backlog - the
    opposite of what the buffer's own comment promises.
    """
    class _BoomAfterArrivals:
        """Fails the write, but only after new events have landed behind it."""

        async def __aenter__(self):
            ks.batch_buffer.extend(_events(2, start=100))
            raise OperationalError("stmt", {}, Exception("down"))

        async def __aexit__(self, *a): return False

    ks.batch_buffer.extend(_events(3))          # the batch about to be flushed
    monkeypatch.setattr(ks, "AsyncSessionLocal", lambda: _BoomAfterArrivals())

    await ks.save_batch()

    ids = [event["session_id"] for event in ks.batch_buffer]
    assert ids == ["s0", "s1", "s2", "s100", "s101"], (
        "the retried batch belongs before the events that arrived during the flush"
    )


@pytest.mark.asyncio
async def test_the_cap_drops_the_oldest_not_the_newest(monkeypatch):
    class _Boom:
        async def __aenter__(self): raise OperationalError("stmt", {}, Exception("down"))
        async def __aexit__(self, *a): return False

    monkeypatch.setattr(ks, "AsyncSessionLocal", lambda: _Boom())
    monkeypatch.setattr(ks, "MAX_BUFFERED_EVENTS", 4)

    ks.batch_buffer.extend(_events(3, start=200))   # newest, already waiting
    await ks.save_batch()                           # flushes and returns them
    ks.batch_buffer.extend(_events(3, start=300))   # newer still
    await ks.save_batch()

    ids = [event["session_id"] for event in ks.batch_buffer]
    assert len(ids) == 4
    assert ids[-1] == "s302", "the newest event must survive the trim"
    assert "s200" not in ids, "the oldest event is the one to drop"
