"""Capability tokens for anonymous analytics sessions.

The activity endpoints identify a visitor only by the `session_id` in the URL,
and nothing ever checked that the caller was the visitor that session belongs
to. Anyone holding or guessing an id could read that visitor's full behavioural
trail and device metadata, and `POST /events` answered 404 for an unknown
session and 201 for a real one, which turns the id space into something you can
probe.

Requiring a login is not an option - these sessions exist precisely so an
anonymous visitor can be tracked - so the session is handed a capability token
when it is created, and must present it afterwards. The token is an HMAC over
the id, so it needs no storage and cannot be derived from the id alone.
"""

import hmac
from hashlib import sha256
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, Query, Request, status

from server.config.settings import JWT_SECRET

# Domain separator, so a value signed here can never be mistaken for one signed
# elsewhere under the same key.
_PREFIX = "analytics-session:"

SESSION_TOKEN_HEADER = "X-Session-Token"
SESSION_TOKEN_QUERY = "session_token"
# Set at session creation and sent automatically on same-origin requests,
# including EventSource, which cannot set headers. This is what let the token
# come out of the query string.
SESSION_TOKEN_COOKIE = "rj_session_token"


def sign_session(session_id: UUID | str) -> str:
    return hmac.new(
        JWT_SECRET.encode("utf-8"),
        f"{_PREFIX}{session_id}".encode("utf-8"),
        sha256,
    ).hexdigest()


def token_matches(session_id: UUID | str, token: Optional[str]) -> bool:
    if not token:
        return False
    # Constant-time: a plain == leaks the shared prefix length through timing.
    return hmac.compare_digest(sign_session(session_id), token)


def _extract(request: Request, query_token: Optional[str]) -> Optional[str]:
    """Header first, then cookie, then the query parameter.

    The query parameter existed only because EventSource cannot set headers, so
    the SSE endpoint took the token in the URL - where it lands in the web
    server's access log, in browser history, and in any Referer the page emits.
    A cookie covers EventSource on a same-origin API, so the query parameter is
    now a deprecated fallback: still accepted so a client cached from before
    this deploy keeps working, but nothing issues one any more.
    """
    return (
        request.headers.get(SESSION_TOKEN_HEADER)
        or request.cookies.get(SESSION_TOKEN_COOKIE)
        or query_token
    )


def assert_session_access(
    session_id: UUID | str, request: Request, query_token: Optional[str] = None
) -> None:
    """Raises 403 unless the caller holds this session's token.

    Deliberately identical whether or not the session exists, so this cannot be
    used to test which ids are real.
    """
    if not token_matches(session_id, _extract(request, query_token)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A valid session token is required for this session.",
        )


async def require_session_access(
    session_id: UUID,
    request: Request,
    session_token: Optional[str] = Query(
        default=None,
        deprecated=True,
        description=(
            "Deprecated: the session token now travels as a same-origin cookie, "
            "so it no longer appears in access logs or browser history. Still "
            "accepted for clients cached from before that change. Prefer the "
            "X-Session-Token header for non-EventSource calls."
        ),
    ),
) -> UUID:
    """Path-parameter dependency for endpoints scoped to one session."""
    assert_session_access(session_id, request, session_token)
    return session_id
