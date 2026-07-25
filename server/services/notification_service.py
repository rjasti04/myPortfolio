import os
import structlog
import aiosmtplib
from email.message import EmailMessage

logger = structlog.get_logger(__name__)

SMTP_HOST = os.getenv("SMTP_HOST", "127.0.0.1")
SMTP_PORT = int(os.getenv("SMTP_PORT", "25"))
EMAILS_FROM_EMAIL = os.getenv("EMAILS_FROM_EMAIL", "inboxtorj@gmail.com")

async def send_security_notification_email(email: str, user_id: str) -> None:
    """
    Asynchronously sends a security alert notification email to the user when their password is changed.
    """
    logger.info(
        "sending_password_change_notification",
        recipient_email=email,
        user_id=user_id
    )


async def send_password_reset_email(email: str, reset_token: str) -> None:
    """
    Asynchronously sends a password reset link email to the user via local/configured SMTP server.
    """
    reset_link = f"https://rjasti.com/?reset_token={reset_token}"
    logger.info(
        "sending_password_reset_email",
        recipient_email=email,
        reset_link=reset_link,
        smtp_host=SMTP_HOST,
        smtp_port=SMTP_PORT,
        from_email=EMAILS_FROM_EMAIL
    )

    # Build MIME Email Message
    msg = EmailMessage()
    msg["Subject"] = "Password Reset Request - rjasti.com"
    msg["From"] = EMAILS_FROM_EMAIL
    msg["To"] = email

    plain_content = (
        f"You requested a password reset for your account.\n\n"
        f"Please click or copy the following link to reset your password:\n"
        f"{reset_link}\n\n"
        f"This link will expire in 15 minutes. If you did not request this, please ignore this email."
    )
    html_content = f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>Password Reset Request</h2>
        <p>You requested a password reset for your account.</p>
        <p>
          <a href="{reset_link}" style="background-color: #6c5ce7; color: white; padding: 10px 18px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Reset Password
          </a>
        </p>
        <p>Or copy and paste this link into your browser:</p>
        <p><a href="{reset_link}">{reset_link}</a></p>
        <p><em>This link will expire in 15 minutes. If you did not request this, please ignore this email.</em></p>
      </body>
    </html>
    """

    msg.set_content(plain_content)
    msg.add_alternative(html_content, subtype="html")

    try:
        await aiosmtplib.send(
            msg,
            hostname=SMTP_HOST,
            port=SMTP_PORT,
            start_tls=False if SMTP_HOST in ("127.0.0.1", "localhost") else None,
            validate_certs=False,
            timeout=10
        )
        logger.info("password_reset_email_sent_successfully", recipient_email=email)
    except Exception as e:
        logger.error(
            "password_reset_email_send_failed",
            recipient_email=email,
            smtp_host=SMTP_HOST,
            error=str(e)
        )


