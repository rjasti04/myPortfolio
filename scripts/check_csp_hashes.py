#!/usr/bin/env python3
"""Verify every executable inline <script> is allowed by the page's CSP.

`frontend/index.html` ships a Content-Security-Policy whose `script-src` pins
inline scripts by `sha256-` hash. Editing such a script - even its indentation -
invalidates the hash, and the browser then refuses to run it *silently*: no
error the user sees, no failing test, just a feature that quietly stops working.

The theme bootstrap is one of those scripts, so the visible symptom is the
flash-of-wrong-theme it exists to prevent, coming back with nothing to explain
it. `npm run format` reformats both inline scripts and breaks both hashes,
which is why they are in .prettierignore.

Exits non-zero when a script has no matching hash, or when a declared hash
matches no script (dead entries in the allowlist).

    python scripts/check_csp_hashes.py [page.html ...]

With no arguments it checks frontend/index.html and, when present, the built
dist/index.html.
"""

from __future__ import annotations

import base64
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The build rewrites asset references in index.html. It must not touch inline
# script bodies, so the built page is checked too - if a minifier ever reaches
# them, the deployed site breaks silently while the source still passes.
DEFAULT_PAGES = [ROOT / "frontend" / "index.html", ROOT / "dist" / "index.html"]

# <script> with neither src= nor type= (a type makes it a data block, e.g.
# application/ld+json, which is not executed and so is not hash-checked).
INLINE_SCRIPT = re.compile(
    r"<script(?![^>]*\stype=)(?![^>]*\ssrc=)[^>]*>(.*?)</script>", re.S
)
CSP_META = re.compile(
    r'<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"', re.S
)
HASH = re.compile(r"'sha256-([A-Za-z0-9+/=]+)'")


def sha256_b64(body: str) -> str:
    return base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode()


def check(page: Path) -> list[str]:
    html = page.read_text(encoding="utf-8")
    name = page.relative_to(ROOT)

    meta = CSP_META.search(html)
    if not meta:
        # No meta CSP means nothing to keep in sync on this page.
        print(f"  {name}: no meta CSP, skipped")
        return []

    declared = set(HASH.findall(meta.group(1)))
    scripts = INLINE_SCRIPT.findall(html)
    problems: list[str] = []
    matched: set[str] = set()

    for body in scripts:
        digest = sha256_b64(body)
        first = (body.strip().splitlines() or [""])[0][:56]
        if digest in declared:
            matched.add(digest)
            print(f"  ok      {name}: sha256-{digest[:16]}...  {first!r}")
        else:
            problems.append(
                f"{name}: inline script has no matching CSP hash.\n"
                f"    first line : {first!r}\n"
                f"    needs      : 'sha256-{digest}'\n"
                f"    Add that to script-src, or revert the edit."
            )

    for stale in sorted(declared - matched):
        problems.append(
            f"{name}: CSP declares 'sha256-{stale}' but no inline script "
            f"produces it. Remove the dead entry."
        )

    return problems


def main() -> int:
    print("Checking CSP inline-script hashes...")
    pages = [Path(a).resolve() for a in sys.argv[1:]] or DEFAULT_PAGES
    problems = [p for page in pages if page.exists() for p in check(page)]
    if problems:
        print("\nFAILED:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("All inline scripts are allowed by the CSP.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
