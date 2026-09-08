"""Shared helpers for the backend suites.

Deliberately NOT in conftest.py. pytest loads conftest as a plugin, so a test
module that also does `from tests.backend.conftest import ...` executes it a
second time - building a second in-memory engine and rebinding the get_db
dependency override to it, at which point every request hits a database with
no tables. The symptom is "no such table: users" in suites that never touched
auth.
"""

SENT_VERIFICATION_TOKENS: dict[str, str] = {}


async def capture_verification_email(recipient: str, token: str) -> None:
    """Stands in for send_email_verification_email; conftest patches it in."""
    SENT_VERIFICATION_TOKENS[recipient] = token


async def verify_registered_email(async_client, email: str):
    """Redeems the link registration just mailed to `email`."""
    token = SENT_VERIFICATION_TOKENS.get(email)
    assert token, f"no verification email was sent to {email}"
    response = await async_client.post("/api/auth/verify-email", json={"token": token})
    assert response.status_code == 200, response.text
    return response


async def register_verified_account(
    async_client,
    email: str,
    password: str = "Str0ngPassw0rd!",
):
    """Register, confirm the address, and return the credentials.

    Login refuses an unconfirmed address, so every suite that registers an
    account needs this. It goes through the real endpoint with the real token,
    so the verification round trip is exercised by every auth test rather than
    bypassed with a direct database write.
    """
    response = await async_client.post(
        "/api/auth/register", json={"email": email, "password": password}
    )
    assert response.status_code == 201, response.text
    await verify_registered_email(async_client, email)
    return email, password
