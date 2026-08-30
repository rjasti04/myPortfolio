import asyncio
import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server.routes import (
    chat_routes,
    session_routes,
    event_routes,
    auth_routes,
    system_routes,
)
from server.db.database import engine
from server.middlewares.server_timing import ServerTimingMiddleware
from server.services import kafka_stream

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("server.main")


async def _cancel_all(tasks: list[asyncio.Task]) -> None:
    """Cancels background tasks and waits for them to unwind."""
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up rjWebApp FastAPI service...")

    # The ingest pipeline runs as two long-lived tasks: a consumer that pulls
    # from Kafka (falling back to the simulator when unconfigured) and a flusher
    # that drains the write buffer on a timer. Both were previously defined but
    # never scheduled, which left the Kafka stage of the pipeline inert and any
    # sub-BATCH_SIZE buffer unwritten.
    background: list[asyncio.Task] = []
    if os.getenv("TESTING", "").lower() != "true":
        background.append(asyncio.create_task(kafka_stream.run_kafka_consumer(), name="kafka-consumer"))
        background.append(asyncio.create_task(kafka_stream.periodic_flusher(), name="batch-flusher"))
        background.append(asyncio.create_task(kafka_stream.run_pg_fanout(), name="pg-fanout"))
        logger.info("Pipeline workers started: %s", [t.get_name() for t in background])

    try:
        yield
    finally:
        logger.info("Shutting down rjWebApp FastAPI service...")
        await _cancel_all(background)
        # Drain whatever the flusher had not yet written.
        await kafka_stream.save_batch()
        await kafka_stream.drain_background_tasks()
        await engine.dispose()

app = FastAPI(
    title="rjWebApp API",
    description="Backend API for Rajeev Jasti's portfolio website featuring Bedrock AI, Analytics, and Auth.",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS Middleware Configuration
origins = [
    "http://localhost:1111",
    "http://127.0.0.1:1111",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "https://rjasti.com",
    "https://www.rjasti.com",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Server-Timing is not a CORS-safelisted response header, so the browser
    # cannot read it cross-origin unless it is explicitly exposed.
    expose_headers=["Server-Timing", "X-Request-ID"],
)

# Measures handler wall time and emits Server-Timing, which the activity
# dashboard reads to split network RTT from actual server work.
app.add_middleware(ServerTimingMiddleware)

# Register Routers under both /api and root / for dual-prefix resilience
routers = [
    chat_routes.router,
    session_routes.router,
    event_routes.router,
    auth_routes.router,
    system_routes.router,
]

for router in routers:
    app.include_router(router, prefix="/api")
    app.include_router(router)

@app.get("/health", tags=["System"])
@app.get("/api/health", tags=["System"])
async def health_check():
    return {
        "status": "healthy",
        "service": "rjWebApp API",
        "aws_region": os.getenv("AWS_REGION", "us-east-1"),
        "default_model": os.getenv("DEFAULT_MODEL_ID", "anthropic.claude-3-5-sonnet-20241022-v2:0"),
    }
