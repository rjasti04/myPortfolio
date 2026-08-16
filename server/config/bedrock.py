import asyncio
import boto3
from botocore.config import Config
from fastapi import HTTPException
from server.config.settings import (
    AWS_REGION,
    BEDROCK_TIMEOUT_SECONDS,
    CHAT_MAX_CONCURRENCY,
)

bedrock_config = Config(
    connect_timeout=10,
    read_timeout=BEDROCK_TIMEOUT_SECONDS,
    retries={"max_attempts": 2, "mode": "standard"},
)

# Boto3 Bedrock clients
bedrock_runtime = boto3.client(
    "bedrock-runtime",
    region_name=AWS_REGION,
    config=bedrock_config,
)
bedrock_mgmt = boto3.client(
    "bedrock",
    region_name=AWS_REGION,
    config=bedrock_config,
)

bedrock_semaphore = asyncio.Semaphore(CHAT_MAX_CONCURRENCY)


async def acquire_bedrock_slot(
    busy_message: str = "AI service is busy. Try again shortly.",
) -> None:
    try:
        await asyncio.wait_for(bedrock_semaphore.acquire(), timeout=0.1)
    except asyncio.TimeoutError:
        raise HTTPException(429, busy_message)
