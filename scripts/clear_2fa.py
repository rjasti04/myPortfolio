#!/usr/bin/env python3
"""Clear a lost second factor from one account.

The escape hatch for the one 2FA failure mode the application cannot fix
itself: an authenticator that is simply gone. `docs/review/2fa.md` finding 9
records why every in-app route out is closed - `disable_2fa` wants a live TOTP
code, `/2fa/setup` refuses to reissue a secret while one is enrolled, password
reset never touches the 2FA columns, and the magic-link path re-challenges.
Until recovery codes exist (same finding, still open), a write to `users` is
the only way back in.

This is that write, with the two parts a hand-typed UPDATE forgets: the lockout
counters that repeated wrong codes will have set - clear the secret but leave
`locked_until` and the owner is still shut out - and the sessions still live on
whatever device is being replaced.

    python scripts/clear_2fa.py --email you@example.com

Needs DATABASE_URL and nothing else; see the import note below. Two things it
deliberately does not do:

  * **No security email.** `send_2fa_change_notification` is scheduled through
    FastAPI's BackgroundTasks inside the running service, which a standalone
    script has no way to reach. Tell the account holder yourself.
  * **No audit trail** beyond the line it prints. There is no account-level
    audit log (`docs/SECURITY.md`, "Known limitations"), and this is an
    unauthenticated write - anyone who can run it already holds the database.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# `.env` has to be loaded before the ORM import below, because
# `server/db/database.py` reads DATABASE_URL at import time. Same two files in
# the same order as `server/alembic/env.py`, for the same reason: this runs over
# SSH on the host, outside the service's environment.
load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "server" / ".env")

from sqlalchemy import func, select, update  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

# `db.database` reads DATABASE_URL through `config/env.py` rather than
# `config/settings.py`, so importing the ORM does not also demand JWT_SECRET and
# the Bedrock configuration - which is exactly why that split exists. Note what
# is NOT imported: `services/auth_service.py` has the two revocation statements
# below already written, but importing it pulls in settings, Bedrock and the
# notification service, and would put the whole service's required configuration
# back on a script that needs one variable.
from server.db.database import AsyncSessionLocal, engine  # noqa: E402
from server.models.one_time_token import OneTimeToken  # noqa: E402
from server.models.token import RefreshToken  # noqa: E402
from server.models.user import User  # noqa: E402


@dataclass
class Outcome:
    """What the write actually did."""

    changed: bool
    reason: str = ""
    sessions_revoked: int = 0
    links_voided: int = 0


def normalise_email(email: str) -> str:
    """The form the accounts table actually holds.

    `register_user` and `authenticate_user` both `.strip().lower()` before they
    store or look up, so an address typed with any capital letter would match no
    row at all - the script would report "no such account" for an account that
    is right there.
    """
    return email.strip().lower()


async def fetch_account(session: AsyncSession, email: str) -> Optional[User]:
    result = await session.execute(select(User).where(User.email == normalise_email(email)))
    return result.scalars().first()


async def count_live_sessions(session: AsyncSession, user: User) -> int:
    """Unrevoked, unexpired refresh tokens - one row per live login."""
    result = await session.execute(
        select(func.count())
        .select_from(RefreshToken)
        .where(RefreshToken.user_id == user.id)
        .where(RefreshToken.is_revoked == False)  # noqa: E712 - SQL, not Python truthiness
        .where(RefreshToken.expires_at > datetime.now(timezone.utc))
    )
    return int(result.scalar_one())


async def clear_second_factor(
    session: AsyncSession, user: User, *, revoke_sessions: bool = True
) -> Outcome:
    """Take the second factor off `user`, and by default end its sessions.

    The four assignments mirror `disable_2fa` (`services/auth_service.py`)
    exactly, lockout clear included. That is the point: this leaves the row in
    the state the supported path would have left it in, so nothing downstream
    can tell an emergency unlock from an ordinary one.
    """
    if not user.is_totp_enabled and user.totp_secret is None:
        return Outcome(changed=False, reason="2FA is already off for this account")

    user.is_totp_enabled = False
    user.totp_secret = None
    # Wrong codes feed `register_failed_attempt`, so an account reaching this
    # script has usually tripped the lockout as well. Clearing the factor
    # without clearing these two would swap one closed door for another.
    user.failed_login_attempts = 0
    user.locked_until = None
    session.add(user)

    sessions_revoked = 0
    links_voided = 0
    if revoke_sessions:
        # The reason to run this is normally a phone that is lost, wiped or
        # gone, so anything still authenticated on it should go with it. Same
        # two statements as `revoke_user_tokens`: live logins, then pending
        # reset and magic links, which are credentials too.
        revoked = await session.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user.id)
            .where(RefreshToken.is_revoked == False)  # noqa: E712 - SQL, not Python truthiness
            .values(is_revoked=True)
        )
        sessions_revoked = revoked.rowcount or 0
        voided = await session.execute(
            update(OneTimeToken)
            .where(OneTimeToken.user_id == user.id)
            .where(OneTimeToken.used_at.is_(None))
            .values(used_at=datetime.now(timezone.utc))
        )
        links_voided = voided.rowcount or 0

    await session.commit()
    return Outcome(changed=True, sessions_revoked=sessions_revoked, links_voided=links_voided)


def _print_summary(user: User, live_sessions: int) -> None:
    # The secret itself is never printed. It is stored in plaintext
    # (`docs/review/2fa.md` finding 10); putting it on a terminal and into shell
    # history would be the one way to make that worse.
    rows = [
        ("id", str(user.id)),
        ("email", user.email),
        ("2FA enabled", "yes" if user.is_totp_enabled else "no"),
        ("TOTP secret", "set" if user.totp_secret else "none"),
        ("failed attempts", str(user.failed_login_attempts)),
        ("locked until", str(user.locked_until) if user.locked_until else "not locked"),
        ("soft-deleted", str(user.deleted_at) if user.deleted_at else "no"),
        ("live sessions", str(live_sessions)),
    ]
    width = max(len(label) for label, _ in rows)
    print("\nAccount as it stands:\n")
    for label, value in rows:
        print(f"  {label.rjust(width)}  {value}")


def _confirm(email: str) -> bool:
    print(f"\nThis removes the second factor from {email} and ends its sessions.")
    try:
        answer = input("Type the email address to confirm: ")
    except EOFError:
        return False
    return normalise_email(answer) == normalise_email(email)


async def _run(args: argparse.Namespace) -> int:
    try:
        async with AsyncSessionLocal() as session:
            user = await fetch_account(session, args.email)
            if user is None:
                print(f"No account with email {normalise_email(args.email)!r}.")
                print("Addresses are stored lower-cased, so this is a typo or the wrong database.")
                return 1

            live_sessions = await count_live_sessions(session, user)
            _print_summary(user, live_sessions)

            if not user.is_totp_enabled and user.totp_secret is None:
                print("\nNothing to do: this account has no second factor.")
                return 1

            if user.deleted_at is not None and not args.yes:
                print("\nThis account is soft-deleted. Pass --yes to clear its factor anyway.")
                return 1

            if not args.yes and not _confirm(user.email):
                print("\nThat did not match. Nothing was changed.")
                return 1

            outcome = await clear_second_factor(
                session, user, revoke_sessions=not args.keep_sessions
            )

        if not outcome.changed:
            print(f"\nNothing was changed: {outcome.reason}.")
            return 1

        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
        print(f"\n[{stamp}] Cleared the second factor for {user.email} (id {user.id}).")
        print(f"  sessions revoked: {outcome.sessions_revoked}")
        print(f"  pending links voided: {outcome.links_voided}")
        if args.keep_sessions:
            print("  (--keep-sessions: existing logins were left alive)")
        print("\nNo security email was sent - tell the account holder yourself.")
        print("They can now sign in with email and password, then re-enrol from Manage 2FA.")
        return 0
    finally:
        await engine.dispose()


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Remove a lost second factor from one account, for an operator with database access.",
        epilog="Reads DATABASE_URL from the environment or from .env / server/.env.",
    )
    parser.add_argument("--email", required=True, help="the account to unlock")
    parser.add_argument(
        "--yes",
        action="store_true",
        help="skip the confirmation prompt (also required for a soft-deleted account)",
    )
    parser.add_argument(
        "--keep-sessions",
        action="store_true",
        help="leave existing logins and pending links alive; only clear the factor",
    )
    args = parser.parse_args(argv)
    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
