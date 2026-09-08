import os
import time
import random
from collections import defaultdict
from fastapi import Request
from fastapi.responses import JSONResponse
from server.config.settings import (
    CHAT_RATE_LIMIT_PER_MINUTE,
    CONTACT_RATE_LIMIT_PER_HOUR,
    TRUSTED_PROXY_NETWORKS,
)
from server.utils.ip_utils import client_ip_from_request

# Credential-guessing surfaces, held to the stricter budget below. Kept as
# unprefixed paths and matched after normalisation - see `_normalise_path`.
AUTH_RATE_LIMITED_PATHS = frozenset({
    "/auth/login",
    "/auth/register",
    "/auth/forgot-password",
    "/auth/reset-password",
    # Both hand out a login on a guessable secret, so they belong on the
    # strict budget alongside the password routes.
    "/auth/2fa/verify",
    "/auth/magic-link/request",
    # Sends mail on an address the caller names, and redeems a mailed
    # credential respectively - the same shape as the two above.
    "/auth/resend-verification",
    "/auth/verify-email",
})

# Bedrock inference. These sat on the general 60/min budget, which is far too
# generous for the only endpoint on the service that spends money per call and
# takes no authentication. Paired with the size caps in `schemas/chat.py`, this
# is what bounds the worst case an anonymous IP can bill.
CHAT_RATE_LIMITED_PATHS = frozenset({
    "/chat",
    "/chat/",
    "/chat/stream",
    "/chat/summarize",
})

# The contact form. Unauthenticated by necessity - a stranger is the point -
# and every accepted request sends mail, so it gets an hourly budget of its
# own rather than the general per-minute one.
CONTACT_RATE_LIMITED_PATHS = frozenset({
    "/contact",
    "/contact/",
})
CONTACT_WINDOW_SECONDS = 3600


def _normalise_path(path: str) -> str:
    """Strips the optional `/api` mount prefix before matching.

    Every router is mounted twice, at `/x` and at `/api/x`. Matching the raw
    path meant `/api/auth/login` missed the strict auth budget entirely and
    fell through to the general limit, so the brute-force guard could be
    sidestepped by adding four characters to the URL.
    """
    if path == "/api":
        return "/"
    if path.startswith("/api/"):
        return path[len("/api"):]
    return path


class RateLimitMiddleware:
    """Simple sliding-window rate limiter. Good enough for single-instance
    deployments; use Redis-backed limiting for multi-instance."""

    def __init__(self, app, max_requests: int = 60, window_seconds: int = 60):
        self.app = app
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._auth_hits: dict[str, list[float]] = defaultdict(list)
        self._chat_hits: dict[str, list[float]] = defaultdict(list)
        self._contact_hits: dict[str, list[float]] = defaultdict(list)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or os.getenv("TESTING") == "true":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)
        path = scope.get("path", "")
        normalised_path = _normalise_path(path)
        is_auth_route = normalised_path in AUTH_RATE_LIMITED_PATHS
        is_chat_route = normalised_path in CHAT_RATE_LIMITED_PATHS
        is_contact_route = normalised_path in CONTACT_RATE_LIMITED_PATHS
        client_ip = client_ip_from_request(request, TRUSTED_PROXY_NETWORKS)

        now = time.time()

        if is_chat_route:
            chat_window = 60
            self._chat_hits[client_ip] = [
                t for t in self._chat_hits[client_ip] if now - t < chat_window
            ]
            if len(self._chat_hits[client_ip]) >= CHAT_RATE_LIMIT_PER_MINUTE:
                response = JSONResponse(
                    {"detail": "Too many AI requests. Try again in a minute."},
                    status_code=429,
                )
                await response(scope, receive, send)
                return
            self._chat_hits[client_ip].append(now)
        elif is_contact_route:
            self._contact_hits[client_ip] = [
                t for t in self._contact_hits[client_ip]
                if now - t < CONTACT_WINDOW_SECONDS
            ]
            if len(self._contact_hits[client_ip]) >= CONTACT_RATE_LIMIT_PER_HOUR:
                response = JSONResponse(
                    {"detail": "Too many messages sent. Try again later."},
                    status_code=429,
                )
                await response(scope, receive, send)
                return
            self._contact_hits[client_ip].append(now)
        elif is_auth_route:
            # Stricter limit: 5 requests per 60 seconds for login/registration
            auth_window = 60
            max_auth_requests = 5
            self._auth_hits[client_ip] = [
                t for t in self._auth_hits[client_ip] if now - t < auth_window
            ]
            if len(self._auth_hits[client_ip]) >= max_auth_requests:
                response = JSONResponse(
                    {"detail": "Too many login or registration attempts. Try again later."},
                    status_code=429,
                )
                await response(scope, receive, send)
                return
            self._auth_hits[client_ip].append(now)
        else:
            # Standard limit
            window = self.window_seconds
            self._hits[client_ip] = [
                t for t in self._hits[client_ip] if now - t < window
            ]
            if len(self._hits[client_ip]) >= self.max_requests:
                response = JSONResponse(
                    {"detail": "Rate limit exceeded. Try again later."},
                    status_code=429,
                )
                await response(scope, receive, send)
                return
            self._hits[client_ip].append(now)

        # Prune empty or expired entries to prevent unbounded memory growth
        if random.random() < 0.01:
            for ip in list(self._hits.keys()):
                self._hits[ip] = [t for t in self._hits[ip] if now - t < self.window_seconds]
                if not self._hits[ip]:
                    del self._hits[ip]
            for ip in list(self._auth_hits.keys()):
                self._auth_hits[ip] = [t for t in self._auth_hits[ip] if now - t < 60]
                if not self._auth_hits[ip]:
                    del self._auth_hits[ip]
            for ip in list(self._chat_hits.keys()):
                self._chat_hits[ip] = [t for t in self._chat_hits[ip] if now - t < 60]
                if not self._chat_hits[ip]:
                    del self._chat_hits[ip]
            for ip in list(self._contact_hits.keys()):
                self._contact_hits[ip] = [
                    t for t in self._contact_hits[ip]
                    if now - t < CONTACT_WINDOW_SECONDS
                ]
                if not self._contact_hits[ip]:
                    del self._contact_hits[ip]

        await self.app(scope, receive, send)
