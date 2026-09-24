import time


def _is_auth_path(path: str) -> bool:
    # Both mount prefixes: every router is served at `/x` and at `/api/x`.
    return path.startswith("/auth/") or path.startswith("/api/auth/")


class ServerTimingMiddleware:
    """
    Emits a `Server-Timing` response header carrying handler wall time.

    The activity dashboard subtracts this from its own `performance.now()`
    delta to separate network round-trip from time actually spent in the
    application, which is the figure the pipeline's FastAPI node reports.

    Pure ASGI (matching `RequestIDMiddleware`) so it adds no per-request
    `Request` object construction on the hot event-ingest path.

    Left off `/auth/*`. The header is exposed cross-origin, and on the login
    and registration routes a millisecond-accurate handler time is exactly the
    measurement an account-enumeration attack wants, with the network jitter
    already taken out. The dashboard never reads it from an auth route.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or _is_auth_path(scope.get("path", "")):
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()

        async def send_with_timing(message):
            if message["type"] == "http.response.start":
                elapsed_ms = (time.perf_counter() - started) * 1000
                headers = list(message.get("headers", []))
                headers.append((b"server-timing", f"app;dur={elapsed_ms:.1f}".encode()))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_timing)
