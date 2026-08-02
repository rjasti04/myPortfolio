from fastapi import APIRouter
from server.controllers import session_controller

router = APIRouter(prefix="/sessions", tags=["Sessions"])

router.add_api_route(
    "",
    session_controller.create_session,
    methods=["POST"],
    status_code=201,
    summary="Start a new session",
)

router.add_api_route(
    "/{session_id}/heartbeat",
    session_controller.session_heartbeat,
    methods=["PATCH"],
    summary="Update last_active_at",
)

router.add_api_route(
    "/{session_id}/end",
    session_controller.end_session,
    methods=["PATCH"],
    summary="End a session",
)

router.add_api_route(
    "/{session_id}",
    session_controller.get_session,
    methods=["GET"],
    summary="Get session details",
)
