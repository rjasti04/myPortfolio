"""Renders the Apps shelf thumbnails from each app's real UI.

    /ucl       -> frontend/ucl-tile-640.webp   + ucl-tile-1280.webp
    /worldcup  -> frontend/worldcup-tile-*.webp
    /arcade, /cron, /crypto, /json, /diff  -> the same pair each

These are NOT the Open Graph cards. `scripts/generate_social_previews.py` still
renders those to `frontend/*-preview.png`, and they stay text-heavy on purpose:
a social card is composited into someone else's feed with no surrounding page,
so it has to carry its own title. A shelf thumbnail sits directly above a tile
that already says the name, so a second baked-in headline is the tile reading
as two competing titles - which is what `docs/review/apps-uiux.md` A1 found and
what `--app-media-scrim` in styles.css was working around.

So the two jobs are split. This script screenshots the app itself, with no text
overlay, at the two widths the shelf's `<picture>` asks for.

    python3 scripts/generate_app_tiles.py            # all seven
    python3 scripts/generate_app_tiles.py json       # just one

Needs a Chromium or Chrome binary, found the same way as the social-preview
script: CHROME_BIN, then the usual install paths, then --chrome.

The pages are served over HTTP from a throwaway local server rather than
loaded over file://, because six of the seven are ES-module pages and a module
script is blocked by CORS on a file:// origin - a file:// screenshot would
catch each app before any of its JavaScript had run.
"""

import argparse
import functools
import http.server
import io
import os
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
WEB_ROOT = ROOT / "frontend"

# The tile's aspect ratio, kept identical to the OG cards' 1200x630 so the
# grid's `aspect-ratio` rule holds whichever image a browser picks.
ASPECT = 1200 / 630

# The two widths the <picture> offers. The grid track floors at 320px
# (--app-tile-min) and rarely exceeds ~420px, so 640 covers 1x and most 2x
# phones; 1280 covers a 3x phone and a wide desktop tile.
WIDTHS = (640, 1280)

# Rendered once at the larger width and downscaled, so both come from one
# screenshot rather than two differently-laid-out ones.
RENDER_WIDTH = 1280
RENDER_HEIGHT = int(round(RENDER_WIDTH / ASPECT))

# WebP quality. 82 is where these screenshots stop losing anything visible at
# the size they are actually displayed.
QUALITY = 82

APPS = {
    "ucl": "/ucl.html",
    "worldcup": "/worldcup.html",
    "arcade": "/arcade.html",
    "cron": "/cron.html",
    "crypto": "/crypto.html",
    "json": "/json.html",
    "diff": "/diff.html",
}

# Pages that paint something worth showing only once a control has been used.
# The value is appended to the URL, so it goes through the app's own routing
# rather than through anything this script knows about its internals.
FRAGMENTS = {
    "cron": "",
    "crypto": "",
    "json": "",
    "diff": "",
}

CHROME_CANDIDATES = [
    "/opt/pw-browsers/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]

# Long enough for the module graph to load, the fonts to swap in and each app's
# first render to settle. These are local files, so this is generous.
SETTLE_MS = 2500


def find_chrome(explicit: str | None) -> str:
    for candidate in [explicit, os.environ.get("CHROME_BIN")]:
        if candidate:
            if Path(candidate).exists():
                return candidate
            sys.exit(f"[ERROR] No browser at {candidate}")
    for candidate in CHROME_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    for name in ("chromium", "chromium-browser", "google-chrome", "chrome"):
        found = shutil.which(name)
        if found:
            return found
    sys.exit("[ERROR] No Chromium or Chrome found. Set CHROME_BIN or pass --chrome.")


class QuietServer(socketserver.TCPServer):
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        # A screenshot run closes sockets early all the time; the default
        # handler prints a traceback for each one.
        pass


# /ucl and /worldcup load Google Fonts and cdnjs directly. That is a standing
# decision (ADR-016, AGENTS.md) and those pages are not changed here - but a
# build machine or a CI runner has no route to either, and a tile rendered
# without them would bake a fallback typeface and empty icon boxes into a
# checked-in image. So the two <link>s are swapped for the self-hosted
# equivalents *in the response only*, for the duration of the screenshot. The
# files on disk are untouched.
CDN_SUBSTITUTIONS = [
    (
        '<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans'
        ':wght@400;500;600;700;800&display=swap"\n    rel="stylesheet">',
        '<link rel="stylesheet" href="fonts.css">',
    ),
    (
        '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/'
        'font-awesome/6.4.0/css/all.min.css">',
        # fonts.css carries the vendored Font Awesome subset as well, so one
        # substitution would have been enough - but naming both makes it
        # obvious which of the page's two CDN origins each one replaces, and
        # the warning above fires if either link is reworded.
        "",
    ),
]

LOCAL_FONT_PAGES = {"/ucl.html", "/worldcup.html"}


class ShelfHandler(http.server.SimpleHTTPRequestHandler):
    """Serves frontend/, with the two predictors' CDN links localised."""

    def log_message(self, *args):
        pass

    def send_head(self):
        if self.path not in LOCAL_FONT_PAGES:
            return super().send_head()

        source = Path(self.directory) / self.path.lstrip("/")
        if not source.is_file():
            return super().send_head()

        body = source.read_text(encoding="utf-8")
        for needle, replacement in CDN_SUBSTITUTIONS:
            if needle not in body:
                print(f"[warn] {self.path}: CDN link not found to localise; "
                      "rendering as-is")
                continue
            body = body.replace(needle, replacement)

        encoded = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        return io.BytesIO(encoded)


def serve(directory: Path):
    """Start a throwaway HTTP server on a free port. Returns (server, port)."""
    handler = functools.partial(ShelfHandler, directory=str(directory))
    server = QuietServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, server.server_address[1]


def screenshot(chrome: str, url: str, dest: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        result = subprocess.run(
            [
                chrome,
                "--headless=new",
                "--no-sandbox",
                "--disable-gpu",
                "--hide-scrollbars",
                "--force-device-scale-factor=1",
                f"--window-size={RENDER_WIDTH},{RENDER_HEIGHT}",
                f"--virtual-time-budget={SETTLE_MS}",
                f"--user-data-dir={tmp}/profile",
                f"--screenshot={dest}",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if not dest.exists():
            sys.exit(f"[ERROR] {url} did not render\n{result.stderr.strip()}")


def emit(shot: Path, name: str) -> list[Path]:
    written = []
    with Image.open(shot) as raw:
        if raw.width < RENDER_WIDTH:
            sys.exit(f"[ERROR] {name} rendered {raw.size}, need >= {RENDER_WIDTH} wide")
        # Flattened onto white for the same reason the OG cards are: a page
        # that never paints its own background would otherwise carry alpha.
        card = raw.convert("RGBA").crop((0, 0, RENDER_WIDTH, RENDER_HEIGHT))
        flat = Image.new("RGB", card.size, "white")
        flat.paste(card, mask=card.split()[3])

        for width in WIDTHS:
            height = int(round(width / ASPECT))
            out = WEB_ROOT / f"{name}-tile-{width}.webp"
            flat.resize((width, height), Image.LANCZOS).save(
                out, "WEBP", quality=QUALITY, method=6
            )
            written.append(out)
            print(f"  {name:<10} {width:>5}w -> {out.name} ({out.stat().st_size / 1024:.1f} KB)")
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apps", nargs="*", metavar="APP",
                        help=f"which tiles to render, from {', '.join(APPS)} (default: all)")
    parser.add_argument("--chrome", help="path to a Chromium or Chrome binary")
    args = parser.parse_args()

    unknown = [a for a in args.apps if a not in APPS]
    if unknown:
        parser.error(f"unknown app(s): {', '.join(unknown)}. Choose from {', '.join(APPS)}.")

    chrome = find_chrome(args.chrome)
    targets = args.apps or list(APPS)

    server, port = serve(WEB_ROOT)
    print(f"Serving {WEB_ROOT.relative_to(ROOT)} on 127.0.0.1:{port}")
    total = 0
    try:
        with tempfile.TemporaryDirectory() as tmp:
            for name in targets:
                url = f"http://127.0.0.1:{port}{APPS[name]}{FRAGMENTS.get(name, '')}"
                shot = Path(tmp) / f"{name}.png"
                screenshot(chrome, url, shot)
                for out in emit(shot, name):
                    total += out.stat().st_size
    finally:
        server.shutdown()
        server.server_close()

    print(f"\nShelf payload: {total / 1024:.0f} KB across {len(targets) * len(WIDTHS)} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
