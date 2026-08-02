from fastapi import APIRouter
from server.controllers import chat_controller

router = APIRouter(prefix="/chat", tags=["Chat"])

router.add_api_route(
    "",
    chat_controller.chat_endpoint,
    methods=["POST"],
    summary="HTTP Chat Endpoint (Bedrock Converse API – model-agnostic)",
)

router.add_api_route(
    "/history",
    chat_controller.list_chat_histories,
    methods=["GET"],
    summary="List authenticated user chat histories",
)

router.add_api_route(
    "/history/{conversation_id}",
    chat_controller.get_chat_history_detail,
    methods=["GET"],
    summary="Get detailed chat history with decompressed transcript",
)

router.add_api_route(
    "/history/{conversation_id}",
    chat_controller.delete_chat_history,
    methods=["DELETE"],
    summary="Delete a chat conversation",
)

router.add_api_route(
    "/summarize",
    chat_controller.chat_summarize_endpoint,
    methods=["POST"],
    summary="Summarize chat conversation",
)
