import asyncio
import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server.routes import (
    analytics_routes,
    chat_routes,
    contact_routes,
    session_routes,
    event_routes,
    auth_routes,
    system_routes,
)
from server.config.settings import origins
from server.db.database import engine
from server.middlewares.body_size import BodySizeLimitMiddleware
from server.middlewares.rate_limit import RateLimitMiddleware
from server.middlewares.request_id import RequestIDMiddleware
from server.middlewares.server_timing import ServerTimingMiddleware
from server.services import kafka_stream
from server.services.auth_service import run_account_purger
from server.utils.logging_config import setup_logging

# Every module logs through structlog, but nothing ever called this, so the
# library ran on its defaults and LOG_LEVEL did nothing. Configuring it here
# turns the application's logs into the JSON the aggregator expects.
setup_logging()
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
        # Soft-deleted accounts past their reactivation window. Nothing ran this
        # before, so "scheduled for deletion" deleted nothing.
        background.append(asyncio.create_task(run_account_purger(), name="account-purger"))
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

# Middleware stack. `add_middleware` prepends, so the LAST registration here is
# the OUTERMOST layer at request time; these calls read innermost-first.
#
# The rate limiter, the body-size cap and the request-ID tagger were all
# implemented but never registered, which left the API with no request
# throttling, no body ceiling (`MAX_BODY_BYTES` was dead config) and
# `request_id=unknown` on every structured log line.

# Innermost: measures handler work only, not time spent in the layers above.
app.add_middleware(ServerTimingMiddleware)
app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(RateLimitMiddleware)

# Above the limiter, so 413/429 replies still carry CORS headers and the
# browser can read the status instead of reporting an opaque network error.
# `origins` comes from settings, which honours CORS_ORIGINS and always appends
# the production domains; main.py used to hardcode a divergent list.
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

# Outermost, so every response - including one rejected by the limiter - is
# tagged and correlatable in the logs.
app.add_middleware(RequestIDMiddleware)

# Register Routers under both /api and root / for dual-prefix resilience
routers = [
    analytics_routes.router,
    chat_routes.router,
    contact_routes.router,
    session_routes.router,
    event_routes.router,
    auth_routes.router,
    system_routes.router,
]

for router in routers:
    app.include_router(router, prefix="/api")
    # The same routers are mounted again at the root. Whether Apache strips the
    # /api prefix before proxying decides which of the two actually serves
    # production, and dropping either without knowing would be an outage, so
    # both stay. The root copy is kept out of the schema: it made /openapi.json
    # advertise 66 paths for 33 endpoints and made FastAPI warn about duplicate
    # operation ids on every start. Routing is unchanged.
    app.include_router(router, include_in_schema=False)

# NOTE: /health and /api/health are served by system_routes -> system_controller
# .health_check, which also verifies the database connection. An app-level
# handler for the same paths used to sit here; it was shadowed by the router
# (registered first, so it matched first) and never executed.
