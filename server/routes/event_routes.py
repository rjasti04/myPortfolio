from fastapi import APIRouter
from server.controllers import event_controller

router = APIRouter(tags=["Events"])

router.add_api_route(
    "/events",
    event_controller.create_event,
    methods=["POST"],
    status_code=201,
    summary="Record a single activity event",
)

router.add_api_route(
    "/events/bulk",
    event_controller.create_events_bulk,
    methods=["POST"],
    status_code=201,
    summary="Record multiple events in one shot",
)

router.add_api_route(
    "/sessions/{session_id}/stream",
    event_controller.stream_session_events,
    methods=["GET"],
    summary="Stream live activity events for a session via SSE",
)

router.add_api_route(
    "/sessions/{session_id}/events",
    event_controller.get_session_events,
    methods=["GET"],
    summary="List events for a session",
)
