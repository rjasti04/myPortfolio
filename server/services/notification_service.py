import structlog

logger = structlog.get_logger(__name__)

async def send_security_notification_email(email: str, user_id: str) -> None:
    """
    Asynchronously sends a security alert notification email to the user when their password is changed.
    """
    logger.info(
        "sending_password_change_notification",
        recipient_email=email,
        user_id=user_id
    )
    # In production environment, dispatch email via SMTP, AWS SES, SendGrid, etc.
    # e.g., await smtp_client.send_message(to=email, subject="Security Alert: Password Changed", ...)
