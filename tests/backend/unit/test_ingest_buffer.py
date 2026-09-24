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


# --- one bad event must not take its batch with it (C9) ----------------------
# A single message naming an unknown session_id is a foreign-key violation, and
# the whole batch used to go to the unrecoverable branch with it: up to
# BATCH_SIZE valid events discarded for one bad one.


def _uuid_events(count):
    return [
        {"session_id": f"00000000-0000-4000-8000-{i:012d}", "event_type": "page_view"}
        for i in range(count)
    ]


class _ConstraintCheckingSession:
    """Commits a batch unless it holds a refused session_id, as an FK would.

    `outage_on` makes the Nth session opened fail as if the database went away.
    """

    opened = 0

    def __init__(self, refused, written, outage_on=None):
        self.refused, self.written, self.outage_on = refused, written, outage_on
        self.rows = []

    async def __aenter__(self):
        _ConstraintCheckingSession.opened += 1
        if _ConstraintCheckingSession.opened == self.outage_on:
            raise OperationalError("INSERT", {}, Exception("server closed the connection"))
        return self

    async def __aexit__(self, *a):
        return False

    def add_all(self, rows):
        self.rows = list(rows)

    async def commit(self):
        from sqlalchemy.exc import IntegrityError

        ids = [str(row.session_id) for row in self.rows]
        if any(session_id in self.refused for session_id in ids):
            raise IntegrityError("INSERT", {}, Exception("violates foreign key constraint"))
        self.written.extend(ids)


@pytest.mark.asyncio
async def test_one_refused_event_does_not_discard_the_rest_of_its_batch(monkeypatch):
    events = _uuid_events(10)
    refused = {events[6]["session_id"]}
    written = []
    _ConstraintCheckingSession.opened = 0
    monkeypatch.setattr(ks, "AsyncSessionLocal", lambda: _ConstraintCheckingSession(refused, written))
    rows_before = ks.METRICS["rows_written"]
    ks.batch_buffer.extend(events)

    await ks.save_batch()

    expected = [e["session_id"] for e in events if e["session_id"] not in refused]
    assert sorted(written) == sorted(expected), "every valid event is written"
    assert ks.METRICS["events_dropped_rejected"] == 1, "only the refused one is dropped, and counted"
    assert ks.METRICS["rows_written"] - rows_before == 9
    assert ks.batch_buffer == [], "nothing is left to retry a constraint against"
    assert _ConstraintCheckingSession.opened < 1 + len(events), (
        "bisection must cost fewer commits than retrying row by row"
    )


@pytest.mark.asyncio
async def test_an_outage_during_the_salvage_returns_what_was_not_written(monkeypatch):
    events = _uuid_events(10)
    refused = {events[6]["session_id"]}
    written = []
    _ConstraintCheckingSession.opened = 0
    # 1: the whole batch (refused), 2: the first half (written), 3: the database goes away.
    monkeypatch.setattr(
        ks, "AsyncSessionLocal", lambda: _ConstraintCheckingSession(refused, written, outage_on=3)
    )
    ks.batch_buffer.extend(events)

    await ks.save_batch()

    assert written == [e["session_id"] for e in events[:5]]
    assert [e["session_id"] for e in ks.batch_buffer] == [e["session_id"] for e in events[5:]], (
        "the unwritten half goes back to the buffer, in order, for a later attempt"
    )
    assert ks.METRICS["events_dropped_rejected"] == 0, "nothing was refused before the outage"


@pytest.mark.asyncio
async def test_a_refused_batch_of_one_is_dropped_without_a_second_attempt(monkeypatch):
    events = _uuid_events(1)
    written = []
    _ConstraintCheckingSession.opened = 0
    monkeypatch.setattr(
        ks, "AsyncSessionLocal",
        lambda: _ConstraintCheckingSession({events[0]["session_id"]}, written),
    )
    ks.batch_buffer.extend(events)

    await ks.save_batch()

    assert written == []
    assert ks.METRICS["events_dropped_rejected"] == 1
    assert _ConstraintCheckingSession.opened == 1, "a refused single row is not retried"
