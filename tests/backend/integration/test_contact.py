"""Coverage for the first-party contact endpoint.

The contact form - the site's conversion path - used to POST to
formsubmit.co, the SPA's only third-party runtime egress. Delivery, spam
handling and failure visibility all sat outside the owner's control, and it
cost two CSP allowances in a page whose whole ADR-016 posture is that no
third-party origin belongs in it.
"""

from unittest.mock import AsyncMock, patch

import pytest


def _payload(**overrides) -> dict:
    body = {
        "name": "Ada Lovelace",
        "email": "ada@example.com",
        "message": "I would like to talk about a role.",
    }
    body.update(overrides)
    return body


@pytest.mark.asyncio
async def test_a_valid_message_is_delivered(async_client):
    with patch(
        "server.routes.contact_routes.send_contact_email", new_callable=AsyncMock
    ) as send:
        send.return_value = True
        response = await async_client.post("/api/contact", json=_payload())

    assert response.status_code == 200
    send.assert_awaited_once()
    assert send.await_args.kwargs["name"] == "Ada Lovelace"
    assert send.await_args.kwargs["email"] == "ada@example.com"


@pytest.mark.asyncio
async def test_a_filled_honeypot_sends_nothing_but_looks_identical(async_client):
    """A bot must not learn which field gave it away."""
    with patch(
        "server.routes.contact_routes.send_contact_email", new_callable=AsyncMock
    ) as send:
        send.return_value = True
        trapped = await async_client.post(
            "/api/contact", json=_payload(_honey="http://spam.example")
        )
        clean = await async_client.post("/api/contact", json=_payload())

    assert trapped.status_code == clean.status_code == 200
    assert trapped.json() == clean.json()
    # One call, from the clean submission only.
    assert send.await_count == 1


@pytest.mark.asyncio
async def test_a_delivery_failure_is_surfaced_not_swallowed(async_client):
    """502 is the status the client is allowed to retry against FormSubmit.

    Unlike the account-recovery senders there is no address to enumerate here,
    and a visitor told "sent" when nothing was is the failure this endpoint
    exists to prevent.
    """
    with patch(
        "server.routes.contact_routes.send_contact_email", new_callable=AsyncMock
    ) as send:
        send.return_value = False
        response = await async_client.post("/api/contact", json=_payload())

    assert response.status_code == 502


@pytest.mark.parametrize(
    "bad",
    [
        {"name": ""},
        {"name": "   "},
        {"message": ""},
        {"email": "not-an-address"},
        {"name": "x" * 101},
        {"message": "x" * 5001},
        # CR/LF in the name would break out of the Subject header this route
        # interpolates it into: a forged Bcc or Reply-To on mail this server
        # sends.
        {"name": "Ada\nBcc: victim@example.com"},
        {"name": "Ada\r\nBcc: victim@example.com"},
    ],
)
@pytest.mark.asyncio
async def test_bad_input_is_rejected_before_any_mail_is_built(async_client, bad):
    with patch(
        "server.routes.contact_routes.send_contact_email", new_callable=AsyncMock
    ) as send:
        response = await async_client.post("/api/contact", json=_payload(**bad))

    assert response.status_code == 422
    send.assert_not_awaited()


@pytest.mark.asyncio
async def test_the_route_is_mounted_at_both_prefixes(async_client):
    """Every router is mounted at /x and /api/x; the client calls /api."""
    with patch(
        "server.routes.contact_routes.send_contact_email", new_callable=AsyncMock
    ) as send:
        send.return_value = True
        assert (await async_client.post("/contact", json=_payload())).status_code == 200
        assert (await async_client.post("/api/contact", json=_payload())).status_code == 200


@pytest.mark.asyncio
async def test_the_message_body_is_escaped_into_the_html_part():
    """The one sender in this module whose body a stranger writes."""
    from server.services import notification_service

    sent = {}

    async def fake_send(msg, **kwargs):
        sent["msg"] = msg

    with patch.object(notification_service.aiosmtplib, "send", fake_send):
        delivered = await notification_service.send_contact_email(
            name="Ada <script>",
            email="ada@example.com",
            message="<img src=x onerror=alert(1)>",
        )

    assert delivered is True
    html = sent["msg"].get_payload()[1].get_payload(decode=True).decode()
    assert "<img src=x onerror" not in html
    assert "&lt;img src=x onerror" in html
    assert "&lt;script&gt;" in html
    # Reply goes to the visitor; From stays this server's own address, because
    # sending as their domain is what SPF and DMARC exist to reject.
    # Quoted, not interpolated: "Ada <script> <ada@example.com>" would parse as
    # display name "Ada" at address "script", so the reply would go nowhere real.
    assert sent["msg"]["Reply-To"] == '"Ada <script>" <ada@example.com>'
    assert sent["msg"]["From"] == notification_service.EMAILS_FROM_EMAIL
