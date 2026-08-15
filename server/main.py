import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from server.routes import chat_routes
from server.db.database import engine, Base

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("server.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up rjWebApp FastAPI service...")
    # Yield control to the application
    yield
    logger.info("Shutting down rjWebApp FastAPI service...")
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
)

# Register API Routers
app.include_router(chat_routes.router)

@app.get("/health", tags=["System"])
async def health_check():
    return {
        "status": "healthy",
        "service": "rjWebApp API",
        "aws_region": os.getenv("AWS_REGION", "us-east-1"),
        "default_model": os.getenv("DEFAULT_MODEL_ID", "anthropic.claude-3-5-sonnet-20241022-v2:0"),
    }
