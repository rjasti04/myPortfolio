from fastapi import APIRouter
from server.controllers import system_controller

router = APIRouter(tags=["System"])

router.add_api_route(
    "/health",
    system_controller.health_check,
    methods=["GET"],
    summary="Health check endpoint",
)

router.add_api_route(
    "/models",
    system_controller.list_models,
    methods=["GET"],
    summary="List available Bedrock foundation models",
)
