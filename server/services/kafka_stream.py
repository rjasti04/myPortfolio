import asyncio
import os
import json
import base64
import random
import logging
from uuid import UUID
from datetime import datetime, timezone
from collections import defaultdict
from typing import Any, Optional, Dict, List

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

# Central store for active SSE streams: session_id -> list of queues
active_streams: Dict[UUID, List[asyncio.Queue]] = defaultdict(list)

# Buffer for batch database writes
batch_buffer: List[Dict[str, Any]] = []
batch_lock = asyncio.Lock()

# Try to import AIOKafkaConsumer
try:
    from aiokafka import AIOKafkaConsumer
    KAFKA_AVAILABLE = True
except ImportError:
    KAFKA_AVAILABLE = False

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
    queue = asyncio.Queue()
    active_streams[session_id].append(queue)
    logger.info("stream_registered", session_id=str(session_id), active_connections=len(active_streams[session_id]))
    return queue

def unregister_stream(session_id: UUID, queue: asyncio.Queue) -> None:
    """Unregisters an SSE listener queue."""
    if session_id in active_streams:
        if queue in active_streams[session_id]:
            active_streams[session_id].remove(queue)
        if not active_streams[session_id]:
            del active_streams[session_id]
    logger.info("stream_unregistered", session_id=str(session_id))

async def broadcast_event(session_id: UUID, event_dict: Dict[str, Any]) -> None:
    """Broadcasts an event to all active streams listening for session_id."""
    if session_id in active_streams:
        logger.info("broadcasting_event", session_id=str(session_id), streams_count=len(active_streams[session_id]))
        # Create a payload copy for broadcast safety
        event_copy = dict(event_dict)
        if "created_at" in event_copy and isinstance(event_copy["created_at"], datetime):
            event_copy["created_at"] = event_copy["created_at"].isoformat()
        if isinstance(event_copy.get("session_id"), UUID):
            event_copy["session_id"] = str(event_copy["session_id"])
            
        for queue in list(active_streams[session_id]):
            try:
                await queue.put(event_copy)
            except Exception as e:
                logger.error("stream_push_error", session_id=str(session_id), error=str(e))

async def save_batch() -> None:
    """Writes accumulated events in the buffer to the PostgreSQL database in bulk."""
    async with batch_lock:
        if not batch_buffer:
            return
            
        events_to_save = list(batch_buffer)
        batch_buffer.clear()

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
            logger.info("kafka_stream_batch_write_success", count=len(db_events))
    except (OperationalError, InterfaceError) as e:
        logger.error("kafka_stream_batch_write_recoverable_error", error=str(e))
        # Restore buffer in case of recoverable DB issues
        async with batch_lock:
            batch_buffer.extend(events_to_save)
    except Exception as e:
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
    except Exception as e:
        logger.error("kafka_connection_failed", error=str(e), action="Falling back to Simulator mode")
        await run_simulated_consumer()
        return

    try:
        async for msg in consumer:
            logger.info("kafka_message_received", partition=msg.partition, offset=msg.offset)
            if isinstance(msg.value, dict):
                await process_incoming_event(msg.value)
    except asyncio.CancelledError:
        logger.info("kafka_consumer_cancelled")
    except Exception as e:
        logger.exception("kafka_consumer_error", error=str(e))
    finally:
        await consumer.stop()

async def run_simulated_consumer() -> None:
    """
    Simulated consumer generator. Only emits when there are active SSE listeners,
    preventing DB bloating when no one is watching the dashboard.
    """
    logger.info("simulated_consumer_started")
    
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

async def periodic_flusher() -> None:
    """Flushes the database buffer periodically."""
    try:
        while True:
            await asyncio.sleep(BATCH_TIMEOUT_SECONDS)
            await save_batch()
    except asyncio.CancelledError:
        logger.info("periodic_flusher_cancelled")
