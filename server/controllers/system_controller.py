import asyncio
import structlog
from fastapi import Request, HTTPException, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from server.db.database import get_db
from server.config.bedrock import bedrock_mgmt

logger = structlog.get_logger(__name__)

async def health_check(request: Request, db: AsyncSession = Depends(get_db)):
    """Verify application and database health."""
    request_id = request.scope.get("request_id", "unknown")
    try:
        # Check DB connection
        await db.execute(select(1))
            
        logger.info(
            "health_check_ok",
            request_id=request_id,
        )
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        logger.error(
            "health_check_failed",
            request_id=request_id,
            error=str(e),
            error_type=type(e).__name__
        )
        return JSONResponse(status_code=503, content={"status": "error", "detail": "Database unavailable"})


async def pipeline_status():
    """
    Per-stage health for the activity dashboard's ETL visualiser.

    Read-only over in-process counters, so it costs no database round trip and
    is safe to poll. Clients holding an SSE connection get the same payload
    pushed on the `pipeline` channel and need not call this at all.
    """
    from server.services.kafka_stream import pipeline_snapshot

    return pipeline_snapshot()


async def list_models():
    """Returns Bedrock foundation models available in the configured region."""
    try:
        resp = await asyncio.to_thread(
            bedrock_mgmt.list_foundation_models,
        )
        models = [
            {
                "modelId": m["modelId"],
                "modelName": m.get("modelName", ""),
                "provider": m.get("providerName", ""),
                "inputModalities": m.get("inputModalities", []),
                "outputModalities": m.get("outputModalities", []),
            }
            for m in resp.get("modelSummaries", [])
        ]
        return {"models": models}
    except Exception as e:
        logger.error(f"Error listing Bedrock models: {e}")
        raise HTTPException(500, "Unable to list models")
