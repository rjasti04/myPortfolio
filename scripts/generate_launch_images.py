"""
Launch-screen asset generator.

Two problems, both invisible in a browser tab and only seen when the site is
opened as an installed app:

  1. Android/Chrome builds its splash from the manifest `background_color` plus
     the largest icon. With no `purpose: "maskable"` icon declared, the launcher
     has to plate the full-bleed square icon itself, so the rounded RJ badge
     picks up a second, mismatched backdrop. `android-chrome-maskable-512x512
     .png` insets the badge inside the maskable safe zone - the centred circle
     of 80% diameter no launcher mask may clip - on the same `background_color`
     the splash paints.

  2. iOS does not read `background_color` for the launch frame; a standalone web
     app boots against a blank screen unless `apple-touch-startup-image` gives
     it an exact-size bitmap per device resolution. The images generated here
     paint the same background and centred badge Chrome draws, so the two
     platforms launch identically instead of one flashing white into a dark
     page.

Portrait only, deliberately: covering landscape doubles the file count for a
launch orientation almost nobody starts an installed portfolio in, and a device
with no matching image falls back to exactly the blank frame it gets today. The
set improves the launches it matches and never regresses the ones it misses.

Only the one image whose media query matches is ever fetched, and only by iOS,
so the set costs deploy size rather than visitor bandwidth.

Run after changing `assets/master-icon.png` or the manifest background:

    python3 scripts/generate_launch_images.py

then re-run `npm run build`, which content-hashes the PNGs and rewrites the
references in `index.html` and `manifest.json`.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT_DIR = Path(__file__).parent.parent
MASTER_ICON = ROOT_DIR / "assets" / "master-icon.png"
FRONTEND_DIR = ROOT_DIR / "frontend"
LAUNCH_DIR = FRONTEND_DIR / "launch"

# Must stay equal to `background_color` in frontend/manifest.json, which is the
# dark `--bg` from styles.css. docs/FRONTEND.md records why the manifest holds
# the dark value and not the light one.
BACKGROUND = (0x0A, 0x0E, 0x14)

# master-icon.png is full-bleed: the badge sits on its own faint gradient, a
# few points lighter than BACKGROUND. Pasted flat that reads as a lighter square
# around the badge, so the alpha is ramped away over the outer band - which also
# drops the file to roughly half, gradient being the expensive part of a PNG.
FEATHER_KEEP = 0.72

# 128 entries hold the badge's glow without visible banding; 256 buys nothing
# here and costs ~20%. Dithering is off: it speckles the flat background and
# roughly triples every file.
PALETTE_COLORS = 128

MASKABLE_NAME = "android-chrome-maskable-512x512.png"
MASKABLE_SIZE = 512

# The badge spans ~66% of the source canvas, putting its corners at r=0.467 of
# the half-diagonal against a maskable safe zone of r=0.4. Scaling the source to
# 0.85 lands them at 0.397, so no mask shape can clip the badge.
MASKABLE_SCALE = 0.85

# Badge width as a share of the shorter CSS dimension, clamped so a phone does
# not get a stamp and a 13" iPad does not get a billboard. ~118 CSS px on a
# 393 px iPhone, close to the 128 dp Chrome uses on its own splash.
BADGE_SHARE = 0.30
BADGE_MIN_CSS = 96
BADGE_MAX_CSS = 200

# (css_width, css_height, device_pixel_ratio, devices). Portrait.
DEVICES = [
    (375, 667, 2, "iPhone SE (2nd/3rd), 8"),
    (414, 736, 3, "iPhone 8 Plus"),
    (375, 812, 3, "iPhone X, XS, 11 Pro, 12/13 mini"),
    (414, 896, 2, "iPhone XR, 11"),
    (414, 896, 3, "iPhone XS Max, 11 Pro Max"),
    (390, 844, 3, "iPhone 12, 12 Pro, 13, 13 Pro, 14"),
    (393, 852, 3, "iPhone 14 Pro, 15, 15 Pro, 16"),
    (402, 874, 3, "iPhone 16 Pro"),
    (428, 926, 3, "iPhone 12/13 Pro Max, 14 Plus"),
    (430, 932, 3, "iPhone 15 Plus, 15 Pro Max, 16 Plus"),
    (440, 956, 3, "iPhone 16 Pro Max"),
    (768, 1024, 2, "iPad mini, iPad 9.7"),
    (810, 1080, 2, "iPad 10.2"),
    (820, 1180, 2, "iPad Air 10.9/11"),
    (834, 1112, 2, "iPad Pro 10.5"),
    (834, 1194, 2, "iPad Pro 11"),
    (1024, 1366, 2, "iPad Pro 12.9/13"),
]


def feathered(icon):
    """Ramp the icon's alpha away over its outer band so the pasted square
    dissolves into the flat background instead of edging it."""
    size = icon.size[0]
    mask = Image.new("L", (size, size), 0)
    inset = round(size * (1 - FEATHER_KEEP) / 2)
    ImageDraw.Draw(mask).rectangle([inset, inset, size - 1 - inset, size - 1 - inset], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=size * 0.06))

    out = icon.copy()
    out.putalpha(mask)
    return out


def compose(master, width, height, badge_px):
    canvas = Image.new("RGB", (width, height), BACKGROUND)
    badge = feathered(master.resize((badge_px, badge_px), Image.LANCZOS))
    canvas.paste(badge, ((width - badge_px) // 2, (height - badge_px) // 2), badge)
    return canvas


def save(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.quantize(colors=PALETTE_COLORS, dither=Image.Dither.NONE).save(path, optimize=True)
    return path.stat().st_size


def generate_maskable(master):
    inner = round(MASKABLE_SIZE * MASKABLE_SCALE)
    path = FRONTEND_DIR / MASKABLE_NAME
    size = save(compose(master, MASKABLE_SIZE, MASKABLE_SIZE, inner), path)
    print(f"  {path.relative_to(ROOT_DIR)}  {size / 1024:.1f} KB")


def generate_launch_images(master):
    total = 0
    for css_w, css_h, dpr, devices in DEVICES:
        badge_css = min(max(min(css_w, css_h) * BADGE_SHARE, BADGE_MIN_CSS), BADGE_MAX_CSS)
        path = LAUNCH_DIR / f"launch-{css_w}x{css_h}-{dpr}x.png"
        size = save(compose(master, css_w * dpr, css_h * dpr, round(badge_css * dpr)), path)
        total += size
        print(f"  {path.relative_to(ROOT_DIR)}  {size / 1024:.1f} KB  ({devices})")
    print(f"  {len(DEVICES)} launch images, {total / 1024:.0f} KB total")


def main():
    if not MASTER_ICON.exists():
        raise SystemExit(f"[ERROR] Source icon not found: {MASTER_ICON}")
    master = Image.open(MASTER_ICON).convert("RGBA")
    print(f"Source: {MASTER_ICON.relative_to(ROOT_DIR)} {master.size[0]}x{master.size[1]}")
    generate_maskable(master)
    generate_launch_images(master)


if __name__ == "__main__":
    main()
