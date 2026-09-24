import hashlib
import html as html_escape
import os
import structlog
import aiosmtplib
from email.message import EmailMessage
from email.utils import formataddr

# Where the contact form delivers. Read through settings rather than os.getenv
# here so every tunable stays on one configuration surface.
from server.config.settings import CONTACT_EMAIL

logger = structlog.get_logger(__name__)


def _token_fingerprint(token: str) -> str:
    """A short, non-reversible tag for correlating a token across log lines.

    Reset and magic links used to be logged in full, which put a working
    account-takeover credential into the log stream for anyone with read
    access. A truncated digest keeps the diagnostic value without the secret.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()[:12]

SMTP_HOST = os.getenv("SMTP_HOST", "127.0.0.1")
SMTP_PORT = int(os.getenv("SMTP_PORT", "25"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
EMAILS_FROM_EMAIL = os.getenv("EMAILS_FROM_EMAIL", "inboxtorj@gmail.com")


def _smtp_kwargs() -> dict:
    """Connection settings shared by every outbound message.

    Certificate validation is on for anything that is not loopback. These
    messages carry live account-recovery and login credentials, so a
    man-in-the-middle on the relay is an account takeover. The magic-link path
    used to omit this and inherit the library default - the reset path set it
    explicitly with a comment saying why, and the two had simply drifted.
    """
    kwargs: dict = {"hostname": SMTP_HOST, "port": SMTP_PORT, "timeout": 10}
    is_loopback = SMTP_HOST in ("127.0.0.1", "localhost")

    if SMTP_USER and SMTP_PASSWORD:
        kwargs["username"] = SMTP_USER
        kwargs["password"] = SMTP_PASSWORD
        kwargs["start_tls"] = True
        kwargs["validate_certs"] = True
    else:
        kwargs["start_tls"] = False if is_loopback else None
        kwargs["validate_certs"] = not is_loopback
    return kwargs


async def _send(subject: str, recipient: str, plain: str, html: str, log_event: str) -> bool:
    """Builds and sends one message. Returns False on failure rather than raising.

    Callers deliberately do not surface the failure: the account-recovery
    endpoints answer identically whether or not an address exists, and leaking
    "your mail server is down" through that channel would also leak which
    addresses are real. The error is logged instead.
    """
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = EMAILS_FROM_EMAIL
    msg["To"] = recipient
    msg.set_content(plain)
    msg.add_alternative(html, subtype="html")

    try:
        await aiosmtplib.send(msg, **_smtp_kwargs())
        logger.info(f"{log_event}_sent_successfully", recipient_email=recipient)
        return True
    except Exception as e:
        logger.error(
            f"{log_event}_send_failed",
            recipient_email=recipient,
            smtp_host=SMTP_HOST,
            error=str(e),
        )
        return False


def _wrap_html(heading: str, body_html: str) -> str:
    return f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>{heading}</h2>
        {body_html}
      </body>
    </html>
    """

async def send_contact_email(name: str, email: str, message: str) -> bool:
    """Delivers one contact-form submission to CONTACT_EMAIL.

    The one sender here whose body is written by a stranger rather than by this
    server, so it is the one that escapes. The plain-text part needs no
    escaping; the HTML part does, and `Reply-To` carries the visitor's address
    so a reply goes to them rather than to the site's own From address.

    Returns True on delivery. Unlike the account-recovery senders this result
    is surfaced: there is no address-enumeration concern on a form anyone may
    submit, and a visitor told "sent" when it was not is the failure mode the
    form exists to avoid.
    """
    plain = (
        f"From: {name} <{email}>\n\n"
        f"{message}\n"
    )
    body = html_escape.escape(message).replace("\n", "<br>")
    rendered = _wrap_html(
        "New message from rjasti.com",
        f"<p><strong>From:</strong> {html_escape.escape(name)} "
        f"&lt;{html_escape.escape(email)}&gt;</p>"
        f"<hr><p>{body}</p>",
    )

    msg = EmailMessage()
    msg["Subject"] = f"Portfolio message from {name}"
    msg["From"] = EMAILS_FROM_EMAIL
    msg["To"] = CONTACT_EMAIL
    # So "Reply" in the mail client goes to the visitor. Not From: sending as
    # the visitor's domain is what SPF and DMARC exist to reject.
    #
    # formataddr, not an f-string: a display name is a stranger's input, and one
    # containing an angle bracket - "Ada <script>" - interpolated raw produces a
    # header that parses as a different address entirely. formataddr quotes it.
    msg["Reply-To"] = formataddr((name, email))
    msg.set_content(plain)
    msg.add_alternative(rendered, subtype="html")

    try:
        await aiosmtplib.send(msg, **_smtp_kwargs())
        logger.info("contact_message_sent", sender_email=email)
        return True
    except Exception as e:
        logger.error(
            "contact_message_send_failed",
            sender_email=email,
            smtp_host=SMTP_HOST,
            error=str(e),
        )
        return False


async def send_security_notification_email(email: str, user_id: str) -> None:
    """Tells the account owner their password just changed.

    This function used to log a line and return - no message was ever built or
    sent. change_user_password schedules it as a background task, so the flow
    reported success and the owner was never told, which is precisely the
    notification that surfaces an account takeover in progress.
    """
    logger.info(
        "sending_password_change_notification",
        recipient_email=email,
        user_id=user_id,
    )

    plain = (
        "The password for your rjasti.com account was just changed.\n\n"
        "If this was you, no action is needed.\n\n"
        "If it was not, your account may be compromised: reset your password "
        "immediately at https://rjasti.com/ and review your active sessions."
    )
    html = _wrap_html(
        "Your password was changed",
        "<p>The password for your rjasti.com account was just changed.</p>"
        "<p>If this was you, no action is needed.</p>"
        "<p><strong>If it was not</strong>, your account may be compromised: "
        '<a href="https://rjasti.com/">reset your password</a> immediately and '
        "review your active sessions.</p>",
    )
    await _send(
        subject="Security alert: your password was changed - rjasti.com",
        recipient=email,
        plain=plain,
        html=html,
        log_event="password_change_notification",
    )


async def send_2fa_change_notification(email: str, user_id: str, enabled: bool) -> None:
    """Tells the account owner their second factor was just turned on or off.

    A separate sender rather than a reuse of `send_security_notification_email`:
    that one's copy names the password specifically, and a mail saying "your
    password was changed" when it was not is worse than no mail at all - it
    sends the owner chasing the wrong credential.

    Disabling is the more dangerous half and reads accordingly. Someone who
    turned 2FA off without knowing it has an attacker holding both their
    password and, until a moment ago, their authenticator.
    """
    action = "enabled" if enabled else "disabled"
    logger.info(
        "sending_2fa_change_notification",
        recipient_email=email,
        user_id=user_id,
        enabled=enabled,
    )

    plain = (
        f"Two-factor authentication was just {action} on your rjasti.com account.\n\n"
        "If this was you, no action is needed.\n\n"
        "If it was not, your account may be compromised: reset your password "
        "immediately at https://rjasti.com/ and review your active sessions."
    )
    html = _wrap_html(
        f"Two-factor authentication {action}",
        f"<p>Two-factor authentication was just <strong>{action}</strong> on your "
        "rjasti.com account.</p>"
        "<p>If this was you, no action is needed.</p>"
        "<p><strong>If it was not</strong>, your account may be compromised: "
        '<a href="https://rjasti.com/">reset your password</a> immediately and '
        "review your active sessions.</p>",
    )
    await _send(
        subject=f"Security alert: two-factor authentication {action} - rjasti.com",
        recipient=email,
        plain=plain,
        html=html,
        log_event="2fa_change_notification",
    )


async def send_password_reset_email(email: str, reset_token: str) -> None:
    """
    Asynchronously sends a password reset link email to the user via local/configured SMTP server.
    """
    reset_link = f"https://rjasti.com/?reset_token={reset_token}"
    logger.info(
        "sending_password_reset_email",
        recipient_email=email,
        token_fingerprint=_token_fingerprint(reset_token),
        smtp_host=SMTP_HOST,
        smtp_port=SMTP_PORT,
        from_email=EMAILS_FROM_EMAIL,
        has_auth=bool(SMTP_USER and SMTP_PASSWORD)
    )

    # Build MIME Email Message
    plain = (
        f"You requested a password reset for your account.\n\n"
        f"Please click or copy the following link to reset your password:\n"
        f"{reset_link}\n\n"
        f"This link will expire in 15 minutes. If you did not request this, please ignore this email."
    )
    html = _wrap_html(
        "Password Reset Request",
        "<p>You requested a password reset for your account.</p>"
        f'<p><a href="{reset_link}" style="background-color: #6c5ce7; color: white; padding: 10px 18px; '
        'text-decoration: none; border-radius: 6px; display: inline-block;">Reset Password</a></p>'
        "<p>Or copy and paste this link into your browser:</p>"
        f'<p><a href="{reset_link}">{reset_link}</a></p>'
        "<p><em>This link will expire in 15 minutes. If you did not request this, "
        "please ignore this email.</em></p>",
    )
    await _send(
        subject="Password Reset Request - rjasti.com",
        recipient=email,
        plain=plain,
        html=html,
        log_event="password_reset_email",
    )


async def send_email_verification_email(email: str, verify_token: str) -> None:
    """Confirms the registrant controls the address."""
    link = f"https://rjasti.com/?verify_token={verify_token}"
    logger.info(
        "sending_email_verification",
        recipient_email=email,
        token_fingerprint=_token_fingerprint(verify_token),
    )

    plain = (
        "Welcome to rjasti.com.\n\n"
        "Confirm this address to finish setting up your account:\n\n"
        f"{link}\n\n"
        "The link is valid for 24 hours.\n\n"
        "If you did not create an account, ignore this message - nothing was "
        "set up, and the address will not be used again."
    )
    html = _wrap_html(
        "Confirm your email address",
        "<p>Welcome to rjasti.com. Confirm this address to finish setting up "
        "your account.</p>"
        f'<p><a href="{link}">Confirm my email address</a></p>'
        "<p>The link is valid for 24 hours.</p>"
        "<p>If you did not create an account, ignore this message - nothing "
        "was set up, and the address will not be used again.</p>",
    )
    await _send(
        subject="Confirm your email address - rjasti.com",
        recipient=email,
        plain=plain,
        html=html,
        log_event="email_verification",
    )


async def send_existing_account_email(email: str) -> None:
    """Someone tried to register an address that already has an account.

    Registration answers the same whatever the address, so this mail is where
    the difference goes: the owner of the inbox learns it, and nobody else
    does. It carries no token - signing in, or resetting the password, is the
    ordinary flow from the site.
    """
    logger.info("sending_existing_account_email", recipient_email=email)

    plain = (
        "Someone tried to create an rjasti.com account with this address, but "
        "it already has one.\n\n"
        "If that was you, sign in at https://rjasti.com/ - or use \"Forgot "
        "password\" there if you no longer remember it.\n\n"
        "If it was not you, ignore this message. Nothing about your account has "
        "changed."
    )
    html = _wrap_html(
        "You already have an account",
        "<p>Someone tried to create an rjasti.com account with this address, "
        "but it already has one.</p>"
        '<p>If that was you, <a href="https://rjasti.com/">sign in</a> - or use '
        "<em>Forgot password</em> there if you no longer remember it.</p>"
        "<p>If it was not you, ignore this message. Nothing about your account "
        "has changed.</p>",
    )
    await _send(
        subject="You already have an account - rjasti.com",
        recipient=email,
        plain=plain,
        html=html,
        log_event="existing_account_email",
    )


async def send_magic_link_email(email: str, magic_token: str) -> None:
    magic_link = f"https://rjasti.com/?magic_token={magic_token}"
    logger.info(
        "sending_magic_link_email",
        recipient_email=email,
        token_fingerprint=_token_fingerprint(magic_token),
    )

    plain = (
        f"You requested a passwordless login link for your account.\n\n"
        f"Click or copy the link below to log in instantly:\n"
        f"{magic_link}\n\n"
        f"This link will expire in 10 minutes."
    )
    html = _wrap_html(
        "Passwordless Login Link",
        "<p>Click the button below to log in to your account instantly:</p>"
        f'<p><a href="{magic_link}" style="background-color: #6c5ce7; color: white; padding: 10px 18px; '
        'text-decoration: none; border-radius: 6px; display: inline-block;">Log In Instantly</a></p>'
        "<p>Or copy and paste this link into your browser:</p>"
        f'<p><a href="{magic_link}">{magic_link}</a></p>'
        "<p><em>This link will expire in 10 minutes. If you did not request this, "
        "please ignore this email.</em></p>",
    )
    # Via _send, which sets validate_certs for any non-loopback relay. This path
    # used to omit it entirely while the reset path set it deliberately - and a
    # magic link is a live login credential, so it needed it at least as much.
    await _send(
        subject="Passwordless Magic Link - rjasti.com",
        recipient=email,
        plain=plain,
        html=html,
        log_event="magic_link_email",
    )



