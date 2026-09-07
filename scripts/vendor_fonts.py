#!/usr/bin/env python3
"""Vendors the web fonts into frontend/fonts/, subset to what the site uses.

Two third-party stylesheets sat in the critical rendering path: Google Fonts
and Font Awesome from cdnjs. Both are render-blocking `<link>` elements, so
either one being slow delayed first paint for every visitor, and each was an
independent single point of failure - a corporate proxy or a regional block was
enough. Measured with the CDNs stalling, first contentful paint was 3.2s against
~250ms for the site's own assets.

Self-hosting removes both, and subsetting makes the local copies far smaller
than the originals:

  * Plus Jakarta Sans ships as 16 faces across four subsets. The site is
    English, so only latin and latin-ext are fetched.
  * Font Awesome ships ~2000 icons in a 148 KB solid face and a 108 KB brands
    face. This scans the source for the `fa-*` classes actually used and cuts
    the fonts down to those glyphs.
  * Sniglet sets one word - the /arcade wordmark - so it is cut to the 26
    letters that word can contain: 3.7 KB against 24 KB for the latin subset.

Run after adding an icon that is not already used:

    python scripts/vendor_fonts.py

Requires fonttools[woff] and an installed @fortawesome/fontawesome-free.
"""

from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
FONT_DIR = FRONTEND / "fonts"
FA_PKG = ROOT / "node_modules" / "@fortawesome" / "fontawesome-free"

GOOGLE_CSS = (
    "https://fonts.googleapis.com/css2"
    "?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap"
)
# Latin only: the site's copy is English, and the CV's accented characters
# (é, í) live in the base latin range.
WANTED_SUBSETS = {"latin", "latin-ext"}

# Sniglet, the /arcade wordmark's face - the inflated bubble letterform the
# page's toy styling asks for and that a grotesque like Plus Jakarta Sans
# cannot fake at any weight. SIL OFL 1.1, the same licence as the body face.
#
# It sets exactly one word on one page, so it is subset by glyph rather than by
# language: A-Z is 3.7 KB against 24 KB for the full latin subset. `.wordmark`
# is `text-transform: uppercase`, so those 26 are every glyph it can ask for -
# and the narrow `unicode-range` below is what keeps that a fallback rather
# than a row of tofu if it ever asks for more.
WORDMARK_CSS = (
    "https://fonts.googleapis.com/css2?family=Sniglet:wght@800&display=swap"
)
WORDMARK_TEXT = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120 Safari/537.36"
)


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def vendor_google_fonts() -> str:
    """Downloads the wanted subsets and returns local @font-face CSS."""
    css = fetch(GOOGLE_CSS).decode("utf-8")
    blocks = re.findall(r"/\* (\S+) \*/\s*(@font-face \{.*?\})", css, re.S)
    out: list[str] = []
    # Plus Jakarta Sans is a variable font: Google serves byte-identical files
    # for every weight of a given subset and varies only the `font-weight`
    # declaration. Keying by content rather than by weight means one file per
    # subset instead of one per weight - four downloads instead of sixteen, and
    # the browser caches one file that four faces share.
    by_digest: dict[str, str] = {}
    kept = 0
    for subset, block in blocks:
        if subset not in WANTED_SUBSETS:
            continue
        url = re.search(r"url\((https://[^)]+)\)", block).group(1)
        payload = fetch(url)
        digest = hashlib.sha256(payload).hexdigest()[:8]
        name = by_digest.get(digest)
        if name is None:
            name = f"plus-jakarta-sans-{subset}-{digest}.woff2"
            (FONT_DIR / name).write_bytes(payload)
            by_digest[digest] = name
        out.append(block.replace(url, f"fonts/{name}"))
        kept += 1
    print(f"  Plus Jakarta Sans: {kept} of {len(blocks)} faces kept, "
          f"sharing {len(by_digest)} unique files")
    return "\n".join(out)


def vendor_wordmark_font() -> str:
    """Downloads the arcade wordmark face, subset to the letters it can set."""
    css = fetch(WORDMARK_CSS).decode("utf-8")
    blocks = re.findall(r"/\* (\S+) \*/\s*(@font-face \{.*?\})", css, re.S)
    block = next(body for subset, body in blocks if subset == "latin")
    url = re.search(r"url\((https://[^)]+)\)", block).group(1)

    # fontTools reads the woff2 straight off disk, so the full face lands in
    # the font directory only long enough to be cut down and removed.
    full = FONT_DIR / "sniglet-full.woff2"
    full.write_bytes(fetch(url))
    dest = FONT_DIR / "sniglet-wordmark.woff2"
    subprocess.run(
        [sys.executable, "-m", "fontTools.subset", str(full),
         f"--text={WORDMARK_TEXT}", "--flavor=woff2",
         "--layout-features=*", "--no-hinting",
         f"--output-file={dest}"],
        check=True, capture_output=True,
    )
    before = full.stat().st_size
    full.unlink()

    # Content-hashed like the body face, so a re-subset cannot be served from a
    # cache holding the previous glyph set under the same name.
    digest = hashlib.sha256(dest.read_bytes()).hexdigest()[:8]
    named = dest.with_name(f"sniglet-wordmark-{digest}.woff2")
    dest.rename(named)
    print(f"  Sniglet: {len(WORDMARK_TEXT)} glyphs, "
          f"{before // 1024} KB -> {named.stat().st_size / 1024:.1f} KB")

    return (
        "@font-face {\n"
        "  font-family: 'Sniglet';\n"
        "  font-style: normal;\n"
        "  font-weight: 800;\n"
        "  font-display: swap;\n"
        f"  src: url(fonts/{named.name}) format('woff2');\n"
        "  /* A-Z only. The file carries no other glyph, so the range has to\n"
        "     stop here for anything else to fall through to the next family\n"
        "     in the stack rather than render as tofu. */\n"
        "  unicode-range: U+0041-005A;\n"
        "}"
    )


def used_icon_classes() -> set[str]:
    """Every `fa-foo` class named anywhere in the source."""
    names: set[str] = set()
    for path in [*FRONTEND.rglob("*.html"), *FRONTEND.rglob("*.js"), *FRONTEND.rglob("*.css")]:
        if "tests" in path.parts or "vendor" in path.parts:
            continue
        names |= set(re.findall(r"\bfa-([a-z0-9-]+)\b", path.read_text(encoding="utf-8", errors="ignore")))
    # Style selectors, not glyph names.
    return names - {"solid", "brands", "regular", "spin", "fw", "lg", "2x", "3x", "pulse"}


def subset_font_awesome(icons: set[str]) -> str:
    """Subsets the FA faces to the glyphs used and returns the local CSS."""
    # Parsed from the shipped CSS rather than a metadata JSON: the file layout
    # has moved between Font Awesome releases, but these rules are the contract
    # the browser itself consumes.
    #
    # Aliases share one rule, e.g.
    #   .fa-home-alt:before,.fa-home:before,.fa-house:before{content:"\f015"}
    all_css = (FA_PKG / "css" / "all.min.css").read_text(encoding="utf-8")
    brands_css = (FA_PKG / "css" / "brands.min.css").read_text(encoding="utf-8")
    brand_names = set(re.findall(r"\.fa-([a-z0-9-]+):before", brands_css))

    codepoints: dict[str, str] = {}
    for selectors, code in re.findall(r"((?:\.fa-[a-z0-9-]+:before,?)+)\{content:\"\\([0-9a-f]+)\"\}", all_css):
        for name in re.findall(r"\.fa-([a-z0-9-]+):before", selectors):
            codepoints[name] = code

    by_style: dict[str, set[str]] = {"solid": set(), "brands": set()}
    matched = set()
    for name in icons:
        code = codepoints.get(name)
        if not code:
            continue
        by_style["brands" if name in brand_names else "solid"].add(code)
        matched.add(name)

    unmatched = sorted(icons - matched)
    if unmatched:
        print(f"  note: {len(unmatched)} fa-* names are not icons (styles/utilities): {unmatched[:6]}")

    faces = {"solid": ("fa-solid-900", 900, '"Font Awesome 6 Free"'),
             "brands": ("fa-brands-400", 400, '"Font Awesome 6 Brands"')}
    css: list[str] = []
    for style, glyphs in by_style.items():
        stem, weight, family = faces[style]
        src = FA_PKG / "webfonts" / f"{stem}.woff2"
        dest = FONT_DIR / f"{stem}-subset.woff2"
        unicodes = ",".join(f"U+{c}" for c in sorted(glyphs))
        subprocess.run(
            [sys.executable, "-m", "fontTools.subset", str(src),
             f"--unicodes={unicodes}", "--flavor=woff2",
             "--layout-features=*", "--no-hinting",
             f"--output-file={dest}"],
            check=True, capture_output=True,
        )
        print(f"  {stem}: {len(glyphs)} glyphs, "
              f"{src.stat().st_size // 1024} KB -> {dest.stat().st_size // 1024} KB")
        css.append(
            f"@font-face {{\n"
            f"  font-family: {family};\n"
            f"  font-style: normal;\n"
            f"  font-weight: {weight};\n"
            f"  font-display: block;\n"
            f"  src: url(fonts/{dest.name}) format('woff2');\n"
            f"}}"
        )
    # The class rules Font Awesome's own stylesheet would provide.
    css.append(
        # An icon font has no meaningful generic fallback - the whole point is
        # the specific glyph set - so that rule is disabled here rather than
        # satisfied with a fake one. Kept narrow: two declarations, by name.
        "/* stylelint-disable font-family-no-missing-generic-family-keyword */\n"
        # `.far`/`.fa-regular` are mapped onto the solid face on purpose. The
        # regular face is not vendored - the site uses exactly one regular
        # glyph (`far fa-circle`, in the password checklists) and a second
        # 100 KB download for it is not worth it. Dropping these selectors
        # instead leaves that markup with no font-family at all, which renders
        # as tofu.
        ".fas,\n.fa-solid,\n.far,\n.fa-regular {\n  font-family: \"Font Awesome 6 Free\";\n  font-weight: 900;\n}\n\n"
        ".fab,\n.fa-brands {\n  font-family: \"Font Awesome 6 Brands\";\n  font-weight: 400;\n}\n"
        "/* stylelint-enable font-family-no-missing-generic-family-keyword */\n\n"
        ".fa,\n.fas,\n.far,\n.fab,\n.fa-solid,\n.fa-regular,\n.fa-brands {\n"
        "  -moz-osx-font-smoothing: grayscale;\n"
        "  -webkit-font-smoothing: antialiased;\n"
        "  display: var(--fa-display, inline-block);\n"
        "  font-style: normal;\n"
        "  font-variant: normal;\n"
        "  line-height: 1;\n"
        "  text-rendering: auto;\n"
        "}"
    )
    for name in sorted(matched):
        css.append(f'.fa-{name}::before {{\n  content: "\\{codepoints[name]}";\n}}')
    return "\n".join(css)


def main() -> int:
    if not (FA_PKG / "css" / "all.min.css").exists():
        print("Font Awesome package missing. Run: npm install", file=sys.stderr)
        return 1
    shutil.rmtree(FONT_DIR, ignore_errors=True)
    FONT_DIR.mkdir(parents=True, exist_ok=True)

    print("Vendoring fonts...")
    google_css = vendor_google_fonts()
    wordmark_css = vendor_wordmark_font()
    icons = used_icon_classes()
    print(f"  found {len(icons)} distinct fa-* class names in the source")
    fa_css = subset_font_awesome(icons)

    header = (
        "/* Generated by scripts/vendor_fonts.py - do not edit by hand.\n"
        "   Self-hosted so neither fonts.googleapis.com nor cdnjs sits in the\n"
        "   critical rendering path, and subset to the glyphs this site uses.\n"
        "   Re-run the script after adding a new icon. */\n"
    )
    (FRONTEND / "fonts.css").write_text(
        f"{header}\n{google_css}\n\n{wordmark_css}\n\n{fa_css}\n", encoding="utf-8"
    )
    total = sum(f.stat().st_size for f in FONT_DIR.iterdir())
    print(f"  wrote frontend/fonts.css and {len(list(FONT_DIR.iterdir()))} font files ({total // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
