from fastapi import Request
from fastapi.responses import JSONResponse
from server.config.settings import MAX_BODY_BYTES


class BodyTooLargeError(Exception):
    pass


class BodySizeLimitMiddleware:
    """Reject requests whose Content-Length or streamed body exceeds a threshold."""

    def __init__(self, app, max_bytes: int = MAX_BODY_BYTES):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                cl = int(content_length)
            except (ValueError, TypeError):
                cl = self.max_bytes + 1
            if cl > self.max_bytes:
                response = JSONResponse(
                    {"detail": "Request body too large"},
                    status_code=413,
                )
                await response(scope, receive, send)
                return

        received = 0

        async def receive_limited():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise BodyTooLargeError
            return message

        try:
            await self.app(scope, receive_limited, send)
        except BodyTooLargeError:
            response = JSONResponse(
                {"detail": "Request body too large"},
                status_code=413,
            )
            await response(scope, receive, send)
