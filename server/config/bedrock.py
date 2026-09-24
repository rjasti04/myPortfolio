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

# Boto3 Bedrock client. Inference only: nothing here calls the control plane.
bedrock_runtime = boto3.client(
    "bedrock-runtime",
    region_name=AWS_REGION,
    config=bedrock_config,
)

bedrock_semaphore = asyncio.Semaphore(CHAT_MAX_CONCURRENCY)


class BedrockSlot:
    """A held concurrency slot that can be released exactly once.

    A streaming endpoint has to take its slot in the handler, before the
    response object exists, so an over-capacity request can still be answered
    with a real 429 rather than a 200 whose body turns out to be an error. That
    leaves a window: if the client disconnects between the handler returning
    and Starlette starting the body, the response generator is never iterated,
    its `finally` never runs, and the slot is held for the life of the process.
    Four of those and chat answers 429 forever.

    Releasing is therefore driven from both the generator's `finally` and the
    response's background task, whichever happens; the guard makes the second
    one a no-op instead of over-releasing the semaphore.
    """

    __slots__ = ("_released",)

    def __init__(self) -> None:
        self._released = False

    @property
    def released(self) -> bool:
        return self._released

    async def release(self) -> None:
        # Async so Starlette awaits it on the event loop rather than handing it
        # to a worker thread; asyncio.Semaphore is not thread-safe.
        if self._released:
            return
        self._released = True
        bedrock_semaphore.release()


async def acquire_bedrock_slot(
    busy_message: str = "AI service is busy. Try again shortly.",
) -> BedrockSlot:
    try:
        await asyncio.wait_for(bedrock_semaphore.acquire(), timeout=0.1)
    except asyncio.TimeoutError:
        raise HTTPException(429, busy_message) from None
    return BedrockSlot()
