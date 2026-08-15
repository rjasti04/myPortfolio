import json
import time
import os
import boto3
from typing import AsyncGenerator, Dict, Any, List, Optional

DEFAULT_SYSTEM_PROMPT = """You are the AI Assistant for Rajeev Jasti's Portfolio Website.
You provide helpful, accurate, and professional information about Rajeev Jasti's software engineering background, full-stack projects, architecture experience, and technical skills.

Key Information about Rajeev Jasti:
- Role: Senior Full Stack Developer & Architect
- Backend Stack: Python 3.10+, FastAPI, PostgreSQL, SQLAlchemy ORM, Asyncpg, AWS Amazon Bedrock, Supervisord, Docker, Kafka, Microservices
- Frontend Stack: Vanilla JS ES Modules, Three.js, CSS Glassmorphism, Service Worker, PWA Manifest, DOMPurify, Marked.js
- Cloud & Infrastructure: AWS (Amazon Bedrock, CloudWatch, S3, ECS, Lambda), PostgreSQL, Docker containerization, CI/CD pipelines
- Principles: Enterprise-grade patterns, performant async processing, high-security authentication, modular architecture.

Always maintain a professional, concise, and engaging tone. Format output using clean Markdown syntax when helpful.
"""

class BedrockService:
    """Service wrapper for AWS Bedrock runtime with prompt caching and streaming."""

    def __init__(self, region_name: Optional[str] = None, default_model_id: Optional[str] = None):
        self.region_name = region_name or os.getenv("AWS_REGION", "us-east-1")
        self.default_model_id = default_model_id or os.getenv(
            "DEFAULT_MODEL_ID", "anthropic.claude-3-5-sonnet-20241022-v2:0"
        )
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = boto3.client("bedrock-runtime", region_name=self.region_name)
        return self._client

    async def stream_chat_response(
        self,
        messages: List[Dict[str, Any]],
        system_prompt: Optional[str] = None,
        model_id: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Stream chat completions from Amazon Bedrock using prompt caching.
        Yields dictionaries containing either delta content or final metrics metadata.
        """
        target_model = model_id or self.default_model_id
        active_system_prompt = system_prompt or DEFAULT_SYSTEM_PROMPT

        # Structure system prompt payload with Bedrock / Anthropic prompt caching
        system_payload = [
            {
                "type": "text",
                "text": active_system_prompt,
                "cache_control": {"type": "ephemeral"},  # Bedrock Prompt Caching marker
            }
        ]

        payload = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 2048,
            "temperature": 0.7,
            "system": system_payload,
            "messages": messages,
        }

        start_time = time.perf_counter()

        try:
            response = self.client.invoke_model_with_response_stream(
                modelId=target_model,
                contentType="application/json",
                accept="application/json",
                body=json.dumps(payload),
            )

            stream = response.get("body")
            input_tokens = 0
            output_tokens = 0
            cache_read_tokens = 0
            cache_creation_tokens = 0

            if stream:
                for event in stream:
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
                            yield {"type": "delta", "text": text_delta}

                    elif event_type == "message_delta":
                        usage = chunk_data.get("usage", {})
                        output_tokens = usage.get("output_tokens", 0)

            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

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
            yield {"type": "error", "error": str(e)}

bedrock_service = BedrockService()
