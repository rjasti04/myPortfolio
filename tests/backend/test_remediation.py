import pytest
from httpx import AsyncClient
from server.main import RateLimitMiddleware
from collections import defaultdict
import time
from unittest.mock import patch, MagicMock

from unittest.mock import AsyncMock

@pytest.mark.asyncio
async def test_rate_limit_middleware_cleanup():
    app_mock = AsyncMock()
    middleware = RateLimitMiddleware(app=app_mock, max_requests=60, window_seconds=60)

    # Simulate old hits
    middleware._hits = defaultdict(list, {
        "1.1.1.1": [time.time() - 100, time.time() - 80],  # All old
        "2.2.2.2": [time.time() - 100, time.time() - 10]   # One new
    })

    # Force cleanup trigger by making _last_cleanup very old
    middleware._last_cleanup = time.time() - 61

    # Simulate request
    scope = {"type": "http", "client": ("3.3.3.3", 12345)}
    async def receive(): return {"type": "http.request"}
    async def send(msg): pass

    with patch("server.main._client_ip_from_request", return_value="3.3.3.3"):
        await middleware(scope, receive, send)

    # 1.1.1.1 should be gone, 2.2.2.2 should remain, 3.3.3.3 should be added
    assert "1.1.1.1" not in middleware._hits
    assert "2.2.2.2" in middleware._hits
    assert "3.3.3.3" in middleware._hits
