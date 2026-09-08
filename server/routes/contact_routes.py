import logging

from fastapi import APIRouter, HTTPException

from server.schemas.contact import ContactRequest
from server.services.notification_service import send_contact_email

router = APIRouter(tags=["Contact"])
logger = logging.getLogger("server.contact_routes")


@router.post("/contact", summary="Deliver a contact-form message")
@router.post("/contact/", include_in_schema=False)
async def submit_contact(payload: ContactRequest):
    """First-party replacement for the form's POST to formsubmit.co.

    Anonymous by necessity - a stranger reaching out is the point - so the
    guards are the schema's length bounds, the honeypot, and the hourly
    per-IP budget in the rate-limit middleware, not a login.
    """
    if payload.honeypot:
        # A field no human sees was filled in. Answer exactly as success does:
        # telling a bot it was detected only teaches it which field to leave
        # alone next time. Nothing is sent.
        logger.info("contact_honeypot_triggered")
        return {"detail": "Message sent successfully."}

    delivered = await send_contact_email(
        name=payload.name,
        email=str(payload.email),
        message=payload.message,
    )
    if not delivered:
        # Surfaced, unlike the account-recovery senders: there is no address to
        # enumerate on a form anyone may submit, and a visitor told "sent" when
        # nothing was is the failure this endpoint exists to prevent. The client
        # falls back to FormSubmit on this status.
        raise HTTPException(
            status_code=502,
            detail="Could not deliver the message. Please try again shortly.",
        )
    return {"detail": "Message sent successfully."}
