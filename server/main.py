import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server.utils.logging_config import setup_logging
from server.config.settings import (
    origins,
    MAX_BODY_BYTES,
)
from server.db.database import engine
from server.middlewares.request_id import RequestIDMiddleware
from server.middlewares.body_size import BodySizeLimitMiddleware
from server.middlewares.rate_limit import RateLimitMiddleware

from server.routes.auth_routes import router as auth_router
from server.routes.chat_routes import router as chat_router
from server.routes.event_routes import router as event_router
from server.routes.session_routes import router as session_router
from server.routes.system_routes import router as system_router

# Setup logging configuration
setup_logging()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start background Kafka consumer and flusher tasks
    from server.services.kafka_stream import run_kafka_consumer, periodic_flusher
    consumer_task = asyncio.create_task(run_kafka_consumer())
    flusher_task = asyncio.create_task(periodic_flusher())
    
    yield
    
    # Clean up background tasks on shutdown
    consumer_task.cancel()
    flusher_task.cancel()
    await asyncio.gather(consumer_task, flusher_task, return_exceptions=True)
    await engine.dispose()


app = FastAPI(title="Activity Tracker API", version="1.0.0", lifespan=lifespan)

# Register custom middlewares
app.add_middleware(RequestIDMiddleware)
app.add_middleware(BodySizeLimitMiddleware, max_bytes=MAX_BODY_BYTES)
app.add_middleware(RateLimitMiddleware, max_requests=60, window_seconds=60)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# Register routes
app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(event_router)
app.include_router(session_router)
app.include_router(system_router)
