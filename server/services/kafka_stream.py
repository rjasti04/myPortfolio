import asyncio
import os
import json
import base64
import random
import time
import logging
from uuid import UUID
from datetime import datetime, timezone
from collections import defaultdict, deque
from typing import Any, Optional, Deque, Dict, List, Set

import structlog
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import OperationalError, InterfaceError
from server.db.database import AsyncSessionLocal
from server.models.event import UserActivityEvent

logger = structlog.get_logger(__name__)

# Constants
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC", "session-activity")
BATCH_SIZE = int(os.getenv("KAFKA_BATCH_SIZE", "10"))
BATCH_TIMEOUT_SECONDS = float(os.getenv("KAFKA_BATCH_TIMEOUT", "3.0"))

# A slow or stalled SSE reader must not be able to grow its queue without
# bound. At the cap the oldest frame is dropped, which is the right trade for a
# live tail: the reader would rather see the newest events than a backlog.
STREAM_QUEUE_MAXSIZE = int(os.getenv("SSE_QUEUE_MAXSIZE", "100"))

# With no broker configured the Kafka stage has no figures of its own to
# report. Rather than leave the DAG's second node blank, synthesise a coherent
# view of what the queue would be doing for the traffic actually flowing
# through the API. Set to "false" to have the stage report `bypass` instead.
SIMULATE_KAFKA_METRICS = os.getenv("SIMULATE_KAFKA_METRICS", "true").lower() == "true"

# Partition count the simulated topic presents. Offsets are split across these.
SIMULATED_PARTITIONS = int(os.getenv("SIMULATED_KAFKA_PARTITIONS", "3"))
SIMULATED_CONSUMER_GROUP = os.getenv("SIMULATED_KAFKA_GROUP", "activity-dashboard")

# Fraction of the simulated backlog still outstanding two seconds later, i.e.
# the modelled consumer clears ~55% of what is queued every 2s.
DRAIN_PER_2S = 0.45

# Cross-instance fan-out. `active_streams` is per-process, so with more than
# one uvicorn worker an event ingested by worker A never reaches an SSE client
# held by worker B. Opt in to relay broadcasts through Postgres LISTEN/NOTIFY,
# which needs no infrastructure beyond the database already in the stack.
# Leave disabled for a single-instance deployment: it is pure overhead there.
ENABLE_PG_FANOUT = os.getenv("ENABLE_PG_FANOUT", "false").lower() == "true"
PG_FANOUT_CHANNEL = os.getenv("PG_FANOUT_CHANNEL", "activity_events")

# Identifies frames this process published, so its own notification is ignored
# rather than delivered to local listeners twice.
INSTANCE_ID = os.getenv("HOSTNAME") or str(os.getpid())

# NOTIFY payloads are capped at 8000 bytes by PostgreSQL. event_data is
# validated to 4 KB, but the envelope can still push a pathological frame over;
# such frames stay local rather than killing the notification.
PG_NOTIFY_MAX_BYTES = 7800

# Per-session ring of recently broadcast events, used to answer `Last-Event-ID`
# on reconnect. Without it every event that lands while the browser is
# reconnecting is lost, since the broadcast is fire-and-forget.
REPLAY_BUFFER_SIZE = int(os.getenv("SSE_REPLAY_BUFFER", "200"))

# Central store for active SSE streams: session_id -> list of queues
active_streams: Dict[UUID, List[asyncio.Queue]] = defaultdict(list)

# Replayable tail per session, trimmed to REPLAY_BUFFER_SIZE. Created when a
# session first connects and deliberately kept after it disconnects - the
# reconnect gap is precisely what replay exists to cover - then reaped by
# `prune_replay_buffers` once the session has been quiet for long enough.
replay_buffers: Dict[UUID, Deque[Dict[str, Any]]] = {}
replay_last_touched: Dict[UUID, float] = {}

# How long a disconnected session's replay tail is retained. Comfortably longer
# than the 3s client reconnect delay, short enough to bound memory.
REPLAY_TTL_SECONDS = float(os.getenv("SSE_REPLAY_TTL", "300"))

# Monotonic timestamps of recent broadcasts, used to derive simulated queue
# figures from the real event rate rather than from noise.
_recent_broadcasts: Deque[float] = deque(maxlen=2000)

# Simulated queue depth, plus when it was last advanced. Held across calls so
# the series moves like a real consumer catching up rather than jumping on
# every poll, and decays against wall time so the curve does not depend on how
# often the snapshot happens to be read.
_sim_lag: float = 0.0
_sim_lag_at: float = 0.0

# Holds the dedicated LISTEN connection when cross-instance fan-out is on.
_fanout_state: Dict[str, Any] = {"conn": None}

# Buffer for batch database writes
batch_buffer: List[Dict[str, Any]] = []
batch_lock = asyncio.Lock()

# Strong references to in-flight fire-and-forget tasks. asyncio only holds a
# weak reference to a running task, so a bare `create_task(...)` whose result is
# discarded can be garbage-collected mid-await and silently drop the work.
_background_tasks: Set[asyncio.Task] = set()

# Observability counters surfaced by `pipeline_snapshot()`.
METRICS: Dict[str, Any] = {
    # Every event entering the pipeline, whatever its source. Incremented once
    # per event on the instance that publishes it.
    "events_broadcast": 0,
    "frames_dropped": 0,
    "kafka_messages": 0,
    "kafka_lag": None,
    "kafka_connected": False,
    "simulator_running": False,
    "rows_written": 0,
    "flush_count": 0,
    "flush_failures": 0,
    "last_flush_ms": None,
    "last_event_at": None,
    "last_error": None,
    # Events received per client flush trigger. A high `unload` share means the
    # timed flush is not keeping up and data depends on the unreliable path.
    "flush_reasons": {},
}


def record_flush_reason(reason: str, count: int) -> None:
    """Tallies how a batch of `count` events was triggered client-side."""
    METRICS["flush_reasons"][reason] = METRICS["flush_reasons"].get(reason, 0) + count

# Try to import AIOKafkaConsumer
try:
    from aiokafka import AIOKafkaConsumer
    KAFKA_AVAILABLE = True
except ImportError:
    KAFKA_AVAILABLE = False


def spawn_background(coro) -> asyncio.Task:
    """
    Schedules `coro` and retains a strong reference until it settles.

    Use instead of a bare `asyncio.create_task` for anything whose result is
    discarded; see `_background_tasks`.
    """
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


async def drain_background_tasks() -> None:
    """Awaits any in-flight fire-and-forget tasks, used on shutdown."""
    if _background_tasks:
        await asyncio.gather(*list(_background_tasks), return_exceptions=True)


def decode_payload(data: Any) -> Any:
    """
    Decodes the data payload which might be base64-encoded or a JSON string.
    Returns a Python dictionary/list/primitive, or None.
    """
    if data is None:
        return None

    if isinstance(data, bytes):
        try:
            data = data.decode("utf-8")
        except Exception:
            try:
                return json.loads(base64.b64decode(data).decode("utf-8"))
            except Exception:
                return data

    if isinstance(data, str):
        data_stripped = data.strip()
        # Try base64 decoding first
        try:
            decoded = base64.b64decode(data_stripped).decode("utf-8")
            return json.loads(decoded)
        except Exception:
            pass

        # Try direct JSON parsing
        try:
            return json.loads(data_stripped)
        except Exception:
            return data_stripped

    if isinstance(data, (dict, list)):
        if isinstance(data, dict):
            # Check nested keys for base64 encoded payload
            for key in ["event_data", "data", "payload"]:
                if key in data and isinstance(data[key], str):
                    try:
                        decoded_val = base64.b64decode(data[key].strip()).decode("utf-8")
                        data[key] = json.loads(decoded_val)
                    except Exception:
                        pass
        return data

    return data

async def register_stream(session_id: UUID) -> asyncio.Queue:
    """Registers an SSE listener queue for a session."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=STREAM_QUEUE_MAXSIZE)
    active_streams[session_id].append(queue)
    replay_buffers.setdefault(session_id, deque(maxlen=REPLAY_BUFFER_SIZE))
    replay_last_touched[session_id] = time.monotonic()
    logger.info("stream_registered", session_id=str(session_id), active_connections=len(active_streams[session_id]))
    return queue

def unregister_stream(session_id: UUID, queue: asyncio.Queue) -> None:
    """Unregisters an SSE listener queue."""
    if session_id in active_streams:
        if queue in active_streams[session_id]:
            active_streams[session_id].remove(queue)
        if not active_streams[session_id]:
            del active_streams[session_id]
            # The replay tail is intentionally retained here so a reconnecting
            # browser can recover the gap; `prune_replay_buffers` reaps it.
            replay_last_touched[session_id] = time.monotonic()
    logger.info("stream_unregistered", session_id=str(session_id))


def _serialisable(event_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Copy of `event_dict` with UUID/datetime coerced to JSON-safe scalars."""
    event_copy = dict(event_dict)
    if isinstance(event_copy.get("created_at"), datetime):
        event_copy["created_at"] = event_copy["created_at"].isoformat()
    if isinstance(event_copy.get("session_id"), UUID):
        event_copy["session_id"] = str(event_copy["session_id"])
    return event_copy


def replay_since(session_id: UUID, last_event_id: Optional[int]) -> List[Dict[str, Any]]:
    """
    Events buffered for `session_id` newer than `last_event_id`.

    Answers the SSE `Last-Event-ID` request header so a reconnecting browser
    recovers the gap instead of silently missing it.
    """
    if last_event_id is None or session_id not in replay_buffers:
        return []
    return [
        event
        for event in replay_buffers[session_id]
        if isinstance(event.get("event_id"), int) and event["event_id"] > last_event_id
    ]


def deliver_local(session_id: UUID, event_copy: Dict[str, Any]) -> None:
    """
    Fans one already-serialised event out to this process's listeners.

    Split from `broadcast_event` so the LISTEN/NOTIFY relay can deliver a frame
    that originated on another instance without re-publishing it.
    """
    METRICS["events_broadcast"] += 1
    METRICS["last_event_at"] = datetime.now(timezone.utc).isoformat()
    _recent_broadcasts.append(time.monotonic())

    # Buffer for replay even with no current listener: the browser may be
    # mid-reconnect, which is precisely the gap replay exists to close.
    tail = replay_buffers.get(session_id)
    if tail is not None:
        tail.append(event_copy)
        replay_last_touched[session_id] = time.monotonic()

    if session_id not in active_streams:
        return

    logger.info("broadcasting_event", session_id=str(session_id), streams_count=len(active_streams[session_id]))
    for queue in list(active_streams[session_id]):
        try:
            queue.put_nowait(event_copy)
        except asyncio.QueueFull:
            # Drop the oldest frame rather than the newest - a live tail is
            # more useful than a stale backlog.
            try:
                queue.get_nowait()
                queue.put_nowait(event_copy)
            except (asyncio.QueueEmpty, asyncio.QueueFull):
                pass
            METRICS["frames_dropped"] += 1
            logger.warning("stream_queue_full", session_id=str(session_id))
        except Exception as e:
            logger.error("stream_push_error", session_id=str(session_id), error=str(e))


async def broadcast_event(session_id: UUID, event_dict: Dict[str, Any]) -> None:
    """Broadcasts an event to all active streams listening for session_id."""
    event_copy = _serialisable(event_dict)
    deliver_local(session_id, event_copy)

    if ENABLE_PG_FANOUT:
        await _publish_fanout(session_id, event_copy)


def _asyncpg_dsn() -> str:
    """DATABASE_URL with the SQLAlchemy driver marker stripped for raw asyncpg."""
    return os.getenv("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")


async def _publish_fanout(session_id: UUID, event_copy: Dict[str, Any]) -> None:
    """Relays one event to the other instances via NOTIFY."""
    conn = _fanout_state.get("conn")
    if conn is None:
        return
    try:
        payload = json.dumps({
            "origin": INSTANCE_ID,
            "session_id": str(session_id),
            "event": event_copy,
        })
        if len(payload.encode("utf-8")) > PG_NOTIFY_MAX_BYTES:
            logger.warning("pg_fanout_payload_too_large", session_id=str(session_id))
            return
        await conn.execute("SELECT pg_notify($1, $2)", PG_FANOUT_CHANNEL, payload)
    except Exception as e:
        logger.error("pg_fanout_publish_error", error=str(e))


def _on_fanout_notify(_conn, _pid, _channel, payload: str) -> None:
    """LISTEN callback: deliver locally unless this process published it."""
    try:
        message = json.loads(payload)
        if message.get("origin") == INSTANCE_ID:
            return
        deliver_local(UUID(message["session_id"]), message["event"])
    except Exception as e:
        logger.error("pg_fanout_receive_error", error=str(e))


async def run_pg_fanout() -> None:
    """
    Holds the LISTEN connection for cross-instance SSE fan-out.

    A no-op unless ENABLE_PG_FANOUT is set; single-instance deployments should
    leave it off. Uses its own dedicated connection rather than the SQLAlchemy
    pool, because a listening connection cannot be returned to a pool.
    """
    if not ENABLE_PG_FANOUT:
        logger.info("pg_fanout_disabled")
        return

    dsn = _asyncpg_dsn()
    if not dsn.startswith("postgresql://"):
        logger.warning("pg_fanout_unsupported_backend", reason="DATABASE_URL is not PostgreSQL")
        return

    try:
        import asyncpg
    except ImportError:
        logger.warning("pg_fanout_unavailable", reason="asyncpg not installed")
        return

    while True:
        conn = None
        try:
            conn = await asyncpg.connect(dsn)
            await conn.add_listener(PG_FANOUT_CHANNEL, _on_fanout_notify)
            _fanout_state["conn"] = conn
            logger.info("pg_fanout_listening", channel=PG_FANOUT_CHANNEL, instance=INSTANCE_ID)
            # Hold the connection open; the listener fires from asyncpg's reader.
            while not conn.is_closed():
                await asyncio.sleep(5)
        except asyncio.CancelledError:
            logger.info("pg_fanout_cancelled")
            raise
        except Exception as e:
            logger.error("pg_fanout_connection_error", error=str(e))
            await asyncio.sleep(5)
        finally:
            _fanout_state["conn"] = None
            if conn is not None and not conn.is_closed():
                await conn.close()


def prune_replay_buffers() -> None:
    """Drops replay tails for sessions that have been gone longer than the TTL."""
    now = time.monotonic()
    stale = [
        sid
        for sid, touched in replay_last_touched.items()
        if sid not in active_streams and now - touched > REPLAY_TTL_SECONDS
    ]
    for sid in stale:
        replay_buffers.pop(sid, None)
        replay_last_touched.pop(sid, None)


async def broadcast_pipeline(session_id: UUID) -> None:
    """Pushes a pipeline health snapshot onto one session's stream."""
    if session_id not in active_streams:
        return
    frame = {"__channel__": "pipeline", **pipeline_snapshot()}
    for queue in list(active_streams[session_id]):
        try:
            queue.put_nowait(frame)
        except asyncio.QueueFull:
            # Health frames are periodic; skipping one costs nothing.
            METRICS["frames_dropped"] += 1


def pipeline_mode() -> str:
    """Which ingest path is reported: kafka, simulator, or bypass."""
    if METRICS["kafka_connected"]:
        return "kafka"
    if METRICS["simulator_running"]:
        return "simulator"
    if SIMULATE_KAFKA_METRICS:
        return "simulated"
    return "bypass"


def _simulated_kafka_stats() -> Dict[str, Any]:
    """
    Queue figures modelled on the traffic the API is actually handling.

    Derived from the real broadcast stream rather than invented from noise, so
    the numbers stay internally consistent: throughput matches the observed
    event rate, offsets match the total processed, and depth rises during a
    burst and drains afterwards the way a consumer keeping up would.

    The response carries `simulated: true` so a reader of the API can always
    tell these apart from broker-reported figures.
    """
    global _sim_lag, _sim_lag_at

    now = time.monotonic()
    while _recent_broadcasts and now - _recent_broadcasts[0] > 60:
        _recent_broadcasts.popleft()

    per_minute = len(_recent_broadcasts)
    throughput = round(per_minute / 60, 2)

    # Depth tracks the last couple of seconds of arrivals. A backlog builds as
    # fast as the producer creates it and drains at the consumer's pace, so the
    # curve is asymmetric: it rises immediately to the arrival burst, then
    # decays geometrically. An exponential approach in both directions would
    # let depth keep climbing after the producer had already stopped.
    burst = sum(1 for t in _recent_broadcasts if now - t <= 2.0)

    # Jitter keeps the series from looking like a step function, but it is
    # seeded per two-second bucket rather than resampled per call. Resampling
    # let a fast poller take the maximum of many rolls and ratchet the depth
    # upward, so how often the snapshot was read changed the reported queue.
    jitter = random.Random(int(now // 2.0)).uniform(0.6, 1.4)
    target = burst * jitter

    # Decay against elapsed wall time, not per call: the snapshot is read by
    # the 2s SSE cadence and by anything polling /system/pipeline, and a fast
    # reader must not drain the queue faster than a slow one.
    elapsed = max(0.0, now - _sim_lag_at) if _sim_lag_at else 0.0
    _sim_lag_at = now
    if target > _sim_lag:
        _sim_lag = target
    elif elapsed:
        _sim_lag *= DRAIN_PER_2S ** (elapsed / 2.0)
    # Snap to empty rather than trailing a fractional phantom depth forever.
    if _sim_lag < 0.5:
        _sim_lag = 0.0
    lag = int(round(_sim_lag))

    processed = METRICS["events_broadcast"]
    # Offsets split round-robin across partitions, summing to the real total.
    partitions = [
        {
            "partition": index,
            "offset": processed // SIMULATED_PARTITIONS
            + (1 if index < processed % SIMULATED_PARTITIONS else 0),
            "lag": lag // SIMULATED_PARTITIONS
            + (1 if index < lag % SIMULATED_PARTITIONS else 0),
        }
        for index in range(SIMULATED_PARTITIONS)
    ]

    if lag >= 60:
        health = "error"
    elif lag >= 15:
        health = "warn"
    else:
        health = "ok"

    return {
        "health": health,
        "mode": "simulated",
        "simulated": True,
        "messages": processed,
        "lag": lag,
        "throughput": throughput,
        "topic": KAFKA_TOPIC,
        "consumer_group": SIMULATED_CONSUMER_GROUP,
        "partitions": partitions,
    }


def pipeline_snapshot() -> Dict[str, Any]:
    """
    Per-stage health for the dashboard DAG.

    Every figure is measured. When Kafka is not actually in the path the stage
    reports `bypass` rather than a synthesised depth - an honest disabled state
    is more informative than a fabricated number.
    """
    mode = pipeline_mode()
    listeners = sum(len(queues) for queues in active_streams.values())
    queued = sum(q.qsize() for queues in active_streams.values() for q in queues)

    return {
        "mode": mode,
        "fanout": "postgres" if _fanout_state.get("conn") is not None else "local",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "stages": {
            "ingress": {
                "health": "ok" if METRICS["events_broadcast"] else "idle",
                "events": METRICS["events_broadcast"],
                "last_event_at": METRICS["last_event_at"],
                "flush_reasons": dict(METRICS["flush_reasons"]),
            },
            "kafka": _simulated_kafka_stats() if mode == "simulated" else {
                "health": {"kafka": "ok", "simulator": "warn", "bypass": "bypass"}[mode],
                "mode": mode,
                "simulated": mode == "simulator",
                "messages": METRICS["kafka_messages"],
                "lag": METRICS["kafka_lag"],
                "topic": KAFKA_TOPIC if mode == "kafka" else None,
            },
            "fastapi": {
                "health": "ok" if listeners else "idle",
                "listeners": listeners,
                "queued_frames": queued,
                "dropped_frames": METRICS["frames_dropped"],
            },
            "postgres": {
                "health": "error" if METRICS["last_error"] else "ok",
                "rows_written": METRICS["rows_written"],
                "buffer_depth": len(batch_buffer),
                "flushes": METRICS["flush_count"],
                "flush_failures": METRICS["flush_failures"],
                "last_flush_ms": METRICS["last_flush_ms"],
                "last_error": METRICS["last_error"],
            },
        },
    }


async def save_batch() -> None:
    """Writes accumulated events in the buffer to the PostgreSQL database in bulk."""
    async with batch_lock:
        if not batch_buffer:
            return

        events_to_save = list(batch_buffer)
        batch_buffer.clear()

    started = time.perf_counter()
    try:
        async with AsyncSessionLocal() as session:
            db_events = []
            for item in events_to_save:
                # Resolve created_at timezone
                created_at_val = item.get("created_at")
                if not created_at_val:
                    created_at_val = datetime.now(timezone.utc)
                elif isinstance(created_at_val, str):
                    try:
                        created_at_val = datetime.fromisoformat(created_at_val)
                    except ValueError:
                        created_at_val = datetime.now(timezone.utc)

                db_event = UserActivityEvent(
                    session_id=UUID(str(item["session_id"])),
                    event_type=item["event_type"],
                    page_path=item.get("page_path"),
                    event_data=item.get("event_data"),
                    created_at=created_at_val
                )
                db_events.append(db_event)

            session.add_all(db_events)
            await session.commit()
            METRICS["rows_written"] += len(db_events)
            METRICS["flush_count"] += 1
            METRICS["last_flush_ms"] = round((time.perf_counter() - started) * 1000, 1)
            METRICS["last_error"] = None
            logger.info("kafka_stream_batch_write_success", count=len(db_events))
    except (OperationalError, InterfaceError) as e:
        METRICS["flush_failures"] += 1
        METRICS["last_error"] = "database unavailable"
        logger.error("kafka_stream_batch_write_recoverable_error", error=str(e))
        # Restore buffer in case of recoverable DB issues
        async with batch_lock:
            batch_buffer.extend(events_to_save)
    except Exception as e:
        METRICS["flush_failures"] += 1
        METRICS["last_error"] = "write rejected"
        logger.error("kafka_stream_batch_write_unrecoverable_error", error=str(e), count=len(events_to_save))
        # Discard unrecoverable failed events to prevent queue lockup

async def add_to_batch(event_dict: Dict[str, Any]) -> None:
    """Adds a single event to the batch buffer, flushing if limit is reached."""
    async with batch_lock:
        batch_buffer.append(event_dict)
        trigger_flush = len(batch_buffer) >= BATCH_SIZE

    if trigger_flush:
        await save_batch()

async def process_incoming_event(event_data: Dict[str, Any], is_simulated: bool = False) -> None:
    """
    Decodes data payload, adds event to the batch buffer (if not simulated),
    and broadcasts it to any active SSE clients.
    """
    try:
        session_id_str = event_data.get("session_id")
        if not session_id_str:
            return

        session_id = UUID(str(session_id_str))

        # Decode the event_data payload
        raw_event_data = event_data.get("event_data")
        decoded_event_data = decode_payload(raw_event_data)

        processed_event = {
            "session_id": session_id,
            "event_type": event_data["event_type"],
            "page_path": event_data.get("page_path"),
            "event_data": decoded_event_data,
            "created_at": event_data.get("created_at") or datetime.now(timezone.utc)
        }

        # Add to batch and broadcast in parallel (skip batching for simulated events)
        if is_simulated:
            await broadcast_event(session_id, processed_event)
        else:
            await asyncio.gather(
                add_to_batch(processed_event),
                broadcast_event(session_id, processed_event)
            )
    except Exception as e:
        logger.error("process_incoming_event_error", error=str(e))


async def _record_lag(consumer) -> None:
    """Best-effort consumer lag: highwater minus current position, summed."""
    try:
        total = 0
        measured = False
        for tp in consumer.assignment():
            highwater = consumer.highwater(tp)
            if highwater is None:
                continue
            position = await consumer.position(tp)
            if position is None:
                continue
            total += max(0, highwater - position)
            measured = True
        METRICS["kafka_lag"] = total if measured else None
    except Exception:
        # Lag is diagnostic only; never let it break consumption.
        METRICS["kafka_lag"] = None


async def run_kafka_consumer() -> None:
    """
    Main loop running the Kafka consumer client.
    Automatically falls back to simulated/mock mode if Kafka is not available/configured.
    """
    if not KAFKA_AVAILABLE or not KAFKA_BOOTSTRAP_SERVERS:
        logger.warning("kafka_client_unavailable",
                       reason="AIOKafka or KAFKA_BOOTSTRAP_SERVERS not configured. Falling back to Simulator mode.")
        await run_simulated_consumer()
        return

    logger.info("kafka_client_connecting", servers=KAFKA_BOOTSTRAP_SERVERS, topic=KAFKA_TOPIC)

    try:
        consumer = AIOKafkaConsumer(
            KAFKA_TOPIC,
            bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
            value_deserializer=lambda m: json.loads(m.decode("utf-8")),
            auto_offset_reset="latest"
        )
        await consumer.start()
        METRICS["kafka_connected"] = True
    except Exception as e:
        METRICS["kafka_connected"] = False
        logger.error("kafka_connection_failed", error=str(e), action="Falling back to Simulator mode")
        await run_simulated_consumer()
        return

    try:
        async for msg in consumer:
            logger.info("kafka_message_received", partition=msg.partition, offset=msg.offset)
            METRICS["kafka_messages"] += 1
            await _record_lag(consumer)
            if isinstance(msg.value, dict):
                await process_incoming_event(msg.value)
    except asyncio.CancelledError:
        logger.info("kafka_consumer_cancelled")
        raise
    except Exception as e:
        logger.exception("kafka_consumer_error", error=str(e))
    finally:
        METRICS["kafka_connected"] = False
        await consumer.stop()

async def run_simulated_consumer() -> None:
    """
    Simulated consumer generator. Only emits when there are active SSE listeners,
    preventing DB bloating when no one is watching the dashboard.
    """
    if os.getenv("ENABLE_EVENT_SIMULATOR", "false").lower() != "true":
        logger.info("simulated_consumer_disabled", reason="ENABLE_EVENT_SIMULATOR environment variable is not set to 'true'")
        return

    logger.info("simulated_consumer_started")
    METRICS["simulator_running"] = True

    mock_events = [
        {"event_type": "page_view", "page_path": "/portfolio", "event_data": {"referrer": "https://google.com"}},
        {"event_type": "click", "page_path": "/about", "event_data": {"element_id": "contact-button", "text": "Contact"}},
        {"event_type": "theme_change", "page_path": "/", "event_data": {"theme": "dark"}},
        {"event_type": "scroll_depth", "page_path": "/resume", "event_data": {"percent": 75}},
        {"event_type": "copy_email", "page_path": "/contact", "event_data": {"success": True}},
        {
            "event_type": "terminal_command",
            "page_path": "/activity",
            # Send a base64 encoded event data payload to verify decoders work!
            "event_data": "eyRhcmdzIjogWyItbGEiXSwgImNvbW1hbmQiOiAibHMifQ=="  # {"args": ["-la"], "command": "ls"}
        }
    ]

    try:
        while True:
            # Only generate events if there are active SSE connections to observe them
            if active_streams:
                for active_session_id in list(active_streams.keys()):
                    mock_template = random.choice(mock_events)
                    event_payload = {
                        "session_id": str(active_session_id),
                        "event_type": mock_template["event_type"],
                        "page_path": mock_template["page_path"],
                        "event_data": mock_template["event_data"],
                        "created_at": datetime.now(timezone.utc)
                    }
                    logger.info("simulated_event_generated", session_id=str(active_session_id), type=event_payload["event_type"])
                    await process_incoming_event(event_payload, is_simulated=True)

            # Wait between 2.0 and 5.0 seconds
            await asyncio.sleep(random.uniform(2.0, 5.0))
    except asyncio.CancelledError:
        logger.info("simulated_consumer_cancelled")
        raise
    finally:
        METRICS["simulator_running"] = False

async def periodic_flusher() -> None:
    """Flushes the database buffer periodically."""
    try:
        while True:
            await asyncio.sleep(BATCH_TIMEOUT_SECONDS)
            await save_batch()
            prune_replay_buffers()
    except asyncio.CancelledError:
        logger.info("periodic_flusher_cancelled")
        raise
