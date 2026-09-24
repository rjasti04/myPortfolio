import structlog
from fastapi import Request, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from server.db.database import get_db

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
