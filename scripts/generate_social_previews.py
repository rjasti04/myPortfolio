"""Renders the Open Graph cards in scripts/social-previews/ to PNG.

One 1200x630 card per shareable page:

    social-preview.html   -> frontend/social-preview.png     (/)
    ucl-preview.html      -> frontend/ucl-preview.png        (/ucl)
    arcade-preview.html   -> frontend/arcade-preview.png     (/arcade)
    worldcup-preview.html -> frontend/worldcup-preview.png   (/worldcup)

The cards are HTML because they have to stay in step with the site, and the
only way to guarantee that is to build them from the same tokens and the same
self-hosted font files rather than from a copy in a design tool. Headless
Chromium renders them; Pillow trims and flattens the result.

    python3 scripts/generate_social_previews.py            # all four
    python3 scripts/generate_social_previews.py ucl        # just one

Needs a Chromium or Chrome binary. The script looks through CHROME_BIN, then
the usual install paths; pass --chrome to point at one directly. Its own
monospace fallback decides the terminal panel on the portfolio card, so a
machine without any of the faces in that stack will render it in whatever it
does have - the checked-in PNGs came from Liberation Mono.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CARD_DIR = ROOT / "scripts" / "social-previews"
OUT_DIR = ROOT / "frontend"

WIDTH, HEIGHT = 1200, 630

# Chromium reserves part of the window for chrome even headless, so the
# viewport comes up short of the window height. Render tall and trim.
RENDER_HEIGHT = HEIGHT + 200

CARDS = {
    "portfolio": ("social-preview.html", "social-preview.png"),
    "ucl": ("ucl-preview.html", "ucl-preview.png"),
    "arcade": ("arcade-preview.html", "arcade-preview.png"),
    "worldcup": ("worldcup-preview.html", "worldcup-preview.png"),
}

CHROME_CANDIDATES = [
    "/opt/pw-browsers/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
]


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


def render(chrome: str, source: Path, dest: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        shot = Path(tmp) / "shot.png"
        result = subprocess.run(
            [
                chrome,
                "--headless=new",
                "--no-sandbox",
                "--disable-gpu",
                "--hide-scrollbars",
                "--force-device-scale-factor=1",
                f"--window-size={WIDTH},{RENDER_HEIGHT}",
                # The cards load their fonts from frontend/fonts/ over file://.
                "--allow-file-access-from-files",
                f"--user-data-dir={tmp}/profile",
                f"--screenshot={shot}",
                source.as_uri(),
            ],
            capture_output=True,
            text=True,
        )
        if not shot.exists():
            sys.exit(f"[ERROR] {source.name} did not render\n{result.stderr.strip()}")

        with Image.open(shot) as raw:
            if raw.width < WIDTH or raw.height < HEIGHT:
                sys.exit(f"[ERROR] {source.name} rendered {raw.size}, need >= {WIDTH}x{HEIGHT}")
            # Flattened onto white: an OG card is composited on whatever the
            # feed's background is, and alpha there is a coin toss.
            card = raw.convert("RGBA").crop((0, 0, WIDTH, HEIGHT))
            flat = Image.new("RGB", (WIDTH, HEIGHT), "white")
            flat.paste(card, mask=card.split()[3])
            flat.save(dest, "PNG", optimize=True)

    print(f"  {source.name:<24} -> {dest.relative_to(ROOT)} ({dest.stat().st_size / 1024:.1f} KB)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    # Validated by hand rather than with choices=: argparse checks an empty
    # nargs="*" default against choices and rejects its own default.
    parser.add_argument("cards", nargs="*", metavar="CARD",
                        help=f"which cards to render, from {', '.join(CARDS)} (default: all)")
    parser.add_argument("--chrome", help="path to a Chromium or Chrome binary")
    args = parser.parse_args()

    unknown = [c for c in args.cards if c not in CARDS]
    if unknown:
        parser.error(f"unknown card(s): {', '.join(unknown)}. Choose from {', '.join(CARDS)}.")

    chrome = find_chrome(args.chrome)
    print(f"Rendering with {chrome}")
    for key in (args.cards or list(CARDS)):
        source, out = CARDS[key]
        render(chrome, CARD_DIR / source, OUT_DIR / out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
