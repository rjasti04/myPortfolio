import os
import time
import random
from collections import defaultdict
from fastapi import Request
from fastapi.responses import JSONResponse
from server.config.settings import TRUSTED_PROXY_NETWORKS
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
})


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

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or os.getenv("TESTING") == "true":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)
        path = scope.get("path", "")
        is_auth_route = _normalise_path(path) in AUTH_RATE_LIMITED_PATHS
        client_ip = client_ip_from_request(request, TRUSTED_PROXY_NETWORKS)

        now = time.time()

        if is_auth_route:
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

        await self.app(scope, receive, send)
