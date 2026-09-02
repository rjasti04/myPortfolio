"""Guards for the outbound security emails.

Two defects lived here. `send_security_notification_email` logged a line and
returned - no message was ever built, so the account owner was never told their
password had changed. And the magic-link path omitted `validate_certs` while the
reset path set it deliberately, so a live login credential was relayed without
certificate validation on any non-loopback host.
"""

import pytest
from unittest.mock import AsyncMock, patch

from server.services import notification_service as ns


@pytest.fixture
def sent():
    """Captures what aiosmtplib.send would have been given."""
    with patch.object(ns.aiosmtplib, "send", new_callable=AsyncMock) as mock:
        yield mock


# --- BUG-11 -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_password_change_actually_sends_an_email(sent):
    await ns.send_security_notification_email("user@example.com", "user-1")

    assert sent.await_count == 1, "the notification must actually be sent, not just logged"
    message = sent.await_args.args[0]
    assert message["To"] == "user@example.com"
    assert "password" in message["Subject"].lower()


@pytest.mark.asyncio
async def test_password_change_email_tells_the_owner_what_to_do(sent):
    await ns.send_security_notification_email("user@example.com", "user-1")

    body = sent.await_args.args[0].get_body(preferencelist=("plain",)).get_content()
    assert "changed" in body.lower()
    assert "reset" in body.lower(), "a takeover notice has to say what to do next"


@pytest.mark.asyncio
async def test_a_failed_send_does_not_raise(sent):
    """Callers schedule these as background tasks and must not see a failure.

    The recovery endpoints answer identically whether or not an address exists;
    surfacing "the mail server is down" through that channel would also leak
    which addresses are real.
    """
    sent.side_effect = RuntimeError("smtp down")
    await ns.send_security_notification_email("user@example.com", "user-1")
    await ns.send_password_reset_email("user@example.com", "tok")
    await ns.send_magic_link_email("user@example.com", "tok")


# --- SEC-03 -----------------------------------------------------------------


@pytest.mark.parametrize(
    "sender",
    [ns.send_password_reset_email, ns.send_magic_link_email, None],
    ids=["password_reset", "magic_link", "password_change"],
)
@pytest.mark.asyncio
async def test_remote_relays_get_certificate_validation(sent, sender, monkeypatch):
    monkeypatch.setattr(ns, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(ns, "SMTP_USER", None)
    monkeypatch.setattr(ns, "SMTP_PASSWORD", None)

    if sender is None:
        await ns.send_security_notification_email("user@example.com", "user-1")
    else:
        await sender("user@example.com", "token")

    kwargs = sent.await_args.kwargs
    assert kwargs["validate_certs"] is True, (
        "these messages carry account-recovery and login credentials; a relay "
        "that is not loopback must have its certificate checked"
    )


@pytest.mark.asyncio
async def test_authenticated_relay_uses_starttls_and_validates(sent, monkeypatch):
    monkeypatch.setattr(ns, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(ns, "SMTP_USER", "postmaster")
    monkeypatch.setattr(ns, "SMTP_PASSWORD", "hunter2")

    await ns.send_magic_link_email("user@example.com", "tok")

    kwargs = sent.await_args.kwargs
    assert kwargs["start_tls"] is True
    assert kwargs["validate_certs"] is True
    assert kwargs["username"] == "postmaster"


@pytest.mark.asyncio
async def test_loopback_relay_is_the_only_tls_exemption(sent, monkeypatch):
    monkeypatch.setattr(ns, "SMTP_HOST", "127.0.0.1")
    monkeypatch.setattr(ns, "SMTP_USER", None)
    monkeypatch.setattr(ns, "SMTP_PASSWORD", None)

    await ns.send_magic_link_email("user@example.com", "tok")

    kwargs = sent.await_args.kwargs
    assert kwargs["start_tls"] is False
    assert kwargs["validate_certs"] is False


@pytest.mark.asyncio
async def test_no_email_leaks_the_raw_token_into_the_logs(sent, caplog):
    """Reset and magic links used to be logged in full, which put a working
    account-takeover credential in the log stream."""
    await ns.send_magic_link_email("user@example.com", "super-secret-token")
    assert "super-secret-token" not in caplog.text
