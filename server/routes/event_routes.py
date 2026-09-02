from fastapi import APIRouter
from server.controllers import event_controller
from server.schemas.event import BulkEventResult, SessionEventSummary

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
    response_model=BulkEventResult,
    summary="Record multiple events in one shot",
)

router.add_api_route(
    "/sessions/{session_id}/stream",
    event_controller.stream_session_events,
    methods=["GET"],
    summary="Stream live activity events for a session via SSE",
)

# Registered before the paginated list route so the literal /summary segment is
# never shadowed by a future catch-all under /events.
router.add_api_route(
    "/sessions/{session_id}/events/summary",
    event_controller.get_session_event_summary,
    methods=["GET"],
    response_model=SessionEventSummary,
    summary="Aggregate event counts by type for a session",
)

router.add_api_route(
    "/sessions/{session_id}/events/funnel",
    event_controller.get_session_path_funnel,
    methods=["GET"],
    summary="Path funnel and transition edges for a session",
)

router.add_api_route(
    "/sessions/{session_id}/events",
    event_controller.get_session_events,
    methods=["GET"],
    summary="List events for a session",
)
