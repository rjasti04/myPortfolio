import json
import time
import logging
import asyncio
import threading
from typing import AsyncGenerator, Callable, Dict, Any, Iterable, List, Optional

import boto3
from server.config.bedrock import bedrock_config, bedrock_runtime
from server.config.settings import (
    AWS_REGION,
    BEDROCK_QUEUE_PUT_TIMEOUT_SECONDS,
    CHAT_STREAM_QUEUE_SIZE,
    DEFAULT_MODEL_ID,
)
from server.utils.role_utils import ensure_alternating_roles

logger = logging.getLogger("server.bedrock_service")

# How long the reader thread waits for room in the queue before concluding the
# consumer is gone. Bounds how long a worker thread outlives an abandoned
# request; it never blocks the event loop.
#
# Both of these were hardcoded here while settings.py defined, validated and
# documented BEDROCK_QUEUE_PUT_TIMEOUT_SECONDS and CHAT_STREAM_QUEUE_SIZE for
# exactly this purpose - so the README described two knobs that turned nothing.
_QUEUE_PUT_TIMEOUT_SECONDS = BEDROCK_QUEUE_PUT_TIMEOUT_SECONDS

# Bounded so a fast model cannot buffer an unlimited response in memory while a
# slow client drains it.
_STREAM_QUEUE_SIZE = CHAT_STREAM_QUEUE_SIZE

_STREAM_DONE = object()


async def _iter_blocking_stream(
    open_stream: Callable[[], Optional[Iterable[Any]]],
    queue_size: int = _STREAM_QUEUE_SIZE,
) -> AsyncGenerator[Any, None]:
    """Yields items from a blocking iterator without occupying the event loop.

    botocore's EventStream is a synchronous iterator whose `__next__` performs a
    socket read. Iterating it directly inside an async generator - which is what
    this service used to do - pins the event loop for the whole duration of the
    model's response, stalling every other request the worker is handling,
    including SSE keep-alives and the health check the deploy now gates on. The
    interleaved `await asyncio.sleep(0)` calls did not help: the blocking happens
    inside `__next__`, before control ever returns to the loop.

    `open_stream` runs on the worker thread too, so the initial API call is also
    off the loop, and anything it raises is re-raised to the consumer.
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue(maxsize=queue_size)
    stop = threading.Event()

    def _put(item: Any) -> bool:
        """Hands one item to the loop. False means the consumer is gone."""
        try:
            asyncio.run_coroutine_threadsafe(queue.put(item), loop).result(
                timeout=_QUEUE_PUT_TIMEOUT_SECONDS
            )
            return True
        except Exception:
            stop.set()
            return False

    def pump() -> None:
        stream = None
        try:
            stream = open_stream()
            for item in stream or ():
                if stop.is_set() or not _put(item):
                    break
        except BaseException as exc:  # surfaced to the consumer, never swallowed
            _put(exc)
        finally:
            close = getattr(stream, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass
            _put(_STREAM_DONE)

    loop.run_in_executor(None, pump)
    try:
        while True:
            item = await queue.get()
            if item is _STREAM_DONE:
                break
            if isinstance(item, BaseException):
                raise item
            yield item
    finally:
        # Tell the reader to stop pulling from Bedrock if the client hung up.
        # The thread exits on its next loop or its next put timeout; it is
        # deliberately not awaited, so tearing down a response stays non-blocking.
        stop.set()

DEFAULT_SYSTEM_PROMPT = """You are the AI Assistant for Rajeev Jasti's Portfolio Website.
You provide helpful, accurate, and professional information about Rajeev Jasti's software engineering background, full-stack projects, architecture experience, and technical skills.

Key Information about Rajeev Jasti:
- Current Role: Principal Data Engineer & Architect at Nicholas and Company (Nov 2022 – Present, Salt Lake City & Remote)
- Previous Role: Data Engineer at Nicholas and Company (Feb 2018 – Oct 2022)
- Specialization: Enterprise Data Engineering & OLAP modeling, OLTP Database Engines, Real-time Streaming, Cloud Migrations, Full-Stack & Generative AI Web Applications
- Backend Stack: Python 3.10+, FastAPI, PostgreSQL, SQLAlchemy ORM (asyncpg), Alembic, AWS Bedrock, Lambda, API Gateway, Boomi, Supervisord, Docker, Kafka, Microservices
- Frontend Stack: Vanilla JS ES Modules, Three.js, CSS Glassmorphism, Service Worker, PWA Manifest, DOMPurify, Marked.js
- Cloud & Infrastructure: AWS (Redshift, Bedrock, S3, Glue, Lambda, Athena, DynamoDB, API Gateway, CloudWatch, EKS, ECS, EC2, RDS), Kubernetes, Docker, GitHub Actions CI/CD
- Principles: Enterprise-grade patterns, performant async processing, high-availability reliability, strict ACID transactions, modular architecture.

Always maintain a professional, concise, and engaging tone. Format output using clean Markdown syntax when helpful.
"""

class BedrockService:
    """Service wrapper for AWS Bedrock runtime with prompt caching and streaming."""

    def __init__(self, region_name: Optional[str] = None, default_model_id: Optional[str] = None):
        # Defaults come from settings, which requires them; hardcoded fallbacks
        # here meant a misconfigured deployment silently billed a different
        # region or model than the operator intended.
        self.region_name = region_name or AWS_REGION
        self.default_model_id = default_model_id or DEFAULT_MODEL_ID
        self._client = None

    @property
    def client(self):
        """The configured bedrock-runtime client.

        This used to build its own with `boto3.client(...)` and no Config, so
        the chat path - the only one that actually streams inference - ran on
        botocore defaults: a 60s read timeout instead of BEDROCK_TIMEOUT_SECONDS
        and no retry policy. Meanwhile config/bedrock.py built a properly tuned
        client that nothing imported. A hung Bedrock connection therefore held
        one of the CHAT_MAX_CONCURRENCY slots for a minute rather than thirty
        seconds.
        """
        if self._client is None:
            self._client = (
                bedrock_runtime
                if self.region_name == AWS_REGION
                # A caller asking for another region still gets the same timeout
                # and retry policy rather than silently falling back to defaults.
                else boto3.client(
                    "bedrock-runtime",
                    region_name=self.region_name,
                    config=bedrock_config,
                )
            )
        return self._client

    async def stream_chat_response(
        self,
        messages: List[Dict[str, Any]],
        system_prompt: Optional[str] = None,
        model_id: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Stream chat completions from Amazon Bedrock using converse_stream or raw invoke model stream.
        Yields dictionaries containing either delta content or final metrics metadata.
        """
        target_model = model_id or self.default_model_id
        active_system_prompt = system_prompt or DEFAULT_SYSTEM_PROMPT
        sanitized_messages = ensure_alternating_roles(messages)

        start_time = time.perf_counter()
        input_tokens = 0
        output_tokens = 0
        cache_read_tokens = 0
        cache_creation_tokens = 0
        total_text_length = 0

        try:
            # Claude models take the raw invoke API because that is the one
            # supporting prompt caching; everything else goes through Converse.
            # This used to also branch on `isinstance(..., MagicMock)`, so the
            # path under test was selected by whether a mock happened to be
            # installed rather than by the model - production behaviour that
            # existed only for the test suite, and which meant the suite never
            # actually exercised Converse for a non-Claude default model.
            is_anthropic_raw = target_model.startswith(("anthropic.", "us.anthropic.", "eu.anthropic."))

            if is_anthropic_raw and hasattr(self.client, "invoke_model_with_response_stream"):
                system_payload = [
                    {
                        "type": "text",
                        "text": active_system_prompt,
                        "cache_control": {"type": "ephemeral"},
                    }
                ]
                payload = {
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 2048,
                    "temperature": 0.7,
                    "system": system_payload,
                    "messages": sanitized_messages,
                }
                def _open_invoke_stream():
                    response = self.client.invoke_model_with_response_stream(
                        modelId=target_model,
                        contentType="application/json",
                        accept="application/json",
                        body=json.dumps(payload),
                    )
                    return response.get("body")

                async for event in _iter_blocking_stream(_open_invoke_stream):
                    chunk = event.get("chunk")
                    if not chunk:
                        continue
                    chunk_data = json.loads(chunk.get("bytes").decode("utf-8"))
                    event_type = chunk_data.get("type")

                    if event_type == "message_start":
                        usage = chunk_data.get("message", {}).get("usage", {})
                        input_tokens = usage.get("input_tokens", 0)
                        cache_read_tokens = usage.get("cache_read_input_tokens", 0)
                        cache_creation_tokens = usage.get("cache_creation_input_tokens", 0)

                    elif event_type == "content_block_delta":
                        text_delta = chunk_data.get("delta", {}).get("text", "")
                        if text_delta:
                            total_text_length += len(text_delta)
                            yield {"type": "delta", "text": text_delta}

                    elif event_type == "message_delta":
                        usage = chunk_data.get("usage", {})
                        output_tokens = usage.get("output_tokens", 0)
            else:
                # Universal Bedrock converse_stream API (supports google.gemma-3-4b-it, Llama, Titan, etc.)
                converse_messages = []
                for msg in sanitized_messages:
                    role = msg.get("role", "user")
                    content = msg.get("content", "")
                    if isinstance(content, str):
                        content_blocks = [{"text": content}]
                    elif isinstance(content, list):
                        content_blocks = []
                        for item in content:
                            if isinstance(item, str):
                                content_blocks.append({"text": item})
                            elif isinstance(item, dict) and "text" in item:
                                content_blocks.append({"text": item["text"]})
                    else:
                        content_blocks = [{"text": str(content)}]
                    converse_messages.append({"role": role, "content": content_blocks})

                system_blocks = [{"text": active_system_prompt}] if active_system_prompt else []

                def _open_converse_stream():
                    response = self.client.converse_stream(
                        modelId=target_model,
                        messages=converse_messages,
                        system=system_blocks,
                        inferenceConfig={"maxTokens": 2048, "temperature": 0.7},
                    )
                    return response.get("stream")

                async for event in _iter_blocking_stream(_open_converse_stream):
                    if "contentBlockDelta" in event:
                        text_delta = event["contentBlockDelta"].get("delta", {}).get("text", "")
                        if text_delta:
                            total_text_length += len(text_delta)
                            yield {"type": "delta", "text": text_delta}
                    elif "metadata" in event:
                        usage = event["metadata"].get("usage", {})
                        input_tokens = usage.get("inputTokens", input_tokens)
                        output_tokens = usage.get("outputTokens", output_tokens)
                        cache_read_tokens = usage.get("cacheReadInputTokens", cache_read_tokens)
                        cache_creation_tokens = usage.get("cacheWriteInputTokens", cache_creation_tokens)

            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

            if total_text_length == 0 and output_tokens == 0:
                logger.warning(
                    f"Bedrock stream for model {target_model} completed with 0 tokens generated (latency: {elapsed_ms}ms)."
                )

            # Yield final observability metrics payload
            yield {
                "type": "metrics",
                "metrics": {
                    "model_id": target_model,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cache_read_tokens": cache_read_tokens,
                    "cache_creation_tokens": cache_creation_tokens,
                    "cache_hit": cache_read_tokens > 0,
                    "latency_ms": elapsed_ms,
                },
            }

        except Exception as e:
            logger.error(f"Error in stream_chat_response for model {target_model}: {e}")
            yield {"type": "error", "error": str(e)}

bedrock_service = BedrockService()


