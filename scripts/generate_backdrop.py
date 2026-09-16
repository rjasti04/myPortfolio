"""
Site Backdrop Generator Script

Builds `frontend/site-backdrop.webp` and `frontend/site-backdrop.jpg` - the
static ground the whole SPA stands on, from the master in `assets/`. Two files
rather than one because the CSS reaches them through `image-set()`: WebP for
every engine that takes it, JPEG as the fallback, and the browser picks.

`assets/` is outside the deploy's `rsync frontend/`, so the full-resolution
master never reaches the web root. That is the point of keeping it there - the
original can be as large as it likes.

── Why the output tops out at 1920px and will not upscale ──

This is a `background-size: cover` layer on a fixed element, so the browser
scales whatever it is given to the viewport. Handing it more pixels than the
master actually contains does not add detail; it adds bytes and a resample
that softens the hairlines this particular drawing is made of. `TARGET_WIDTH`
is therefore a CEILING, not a target: a master narrower than it is emitted at
its own width and the script says so.

The honest consequence, stated here because it is the thing a future reader
will want: a ~2000px master under `cover` on a 2560px display IS upscaled, by
the browser, at paint time. Nothing in this script can fix that - the fix is a
larger master. What the script can do is refuse to bake the upscale into the
file, where it would cost bytes as well as sharpness.

── Quality ──

A technical drawing is the adversarial case for a lossy codec: large flat
fields, then 1px lines at high contrast, which is exactly what DCT ringing
shows up around. The two quality numbers below are set higher than a
photograph would need for that reason. `method=6` is libwebp's slowest,
best-packing setting; it costs a second here and nothing at runtime.

    python scripts/generate_backdrop.py

Pillow is the only dependency. Nothing here needs the network.
"""

import argparse
from pathlib import Path

from PIL import Image

ROOT_DIR = Path(__file__).parent.parent
SOURCE_IMAGE_PATH = ROOT_DIR / "assets" / "site-backdrop-master.jpg"
OUTPUT_DIR = ROOT_DIR / "frontend"
OUTPUT_STEM = "site-backdrop"

# Ceiling, not a target - see the note at the top. 1920 covers every common
# desktop width; beyond it `cover` is resampling a drawing that has no more
# detail to give.
TARGET_WIDTH = 1920

# Higher than photographic defaults, because the subject is hairlines on a flat
# field. Measured on the reference master: at WebP q=72 the 1px traces pick up
# a visible halo against the dark ground; at 82 they do not.
WEBP_QUALITY = 82
JPEG_QUALITY = 86

# Anything past this is worth a second look rather than an automatic pass. It
# is advisory only: `scripts/build.mjs` deliberately keeps images out of
# BUDGETS_KIB, on the argument that a budget which fires whenever a photo is
# added is a budget people learn to raise reflexively.
SIZE_ADVISORY_KB = 400


def display(path: Path) -> str:
    """Repo-relative where possible, absolute otherwise.

    `--out-dir` exists so the outputs can be written somewhere other than
    `frontend/` - a scratch directory, a diff against the committed pair - and
    `Path.relative_to` raises rather than falling back when the target is
    outside ROOT_DIR. Reporting a path is not worth a traceback.
    """
    try:
        return str(path.relative_to(ROOT_DIR))
    except ValueError:
        return str(path)


def load_master(path: Path) -> Image.Image:
    """The master as RGB, with any EXIF rotation already applied.

    `exif_transpose` matters more than it looks: a master exported from a phone
    or some editors carries its orientation as a tag rather than in the pixel
    order, and Pillow does not apply it on open. Skipping this ships a backdrop
    that is correct in the editor's preview and rotated on the site.
    """
    if not path.exists():
        raise SystemExit(
            f"missing master: {display(path)}\n"
            f"  Put the source image there, then re-run. It is not shipped -\n"
            f"  assets/ sits outside the deploy's rsync of frontend/."
        )

    from PIL import ImageOps

    master = Image.open(path)
    master = ImageOps.exif_transpose(master)
    # A JPEG is already RGB; a PNG master with alpha is not, and JPEG cannot
    # carry the alpha. Flatten onto black rather than white - this drawing is
    # dark-ground, so black is the colour its own edges fade into.
    if master.mode in ("RGBA", "LA", "P"):
        flat = Image.new("RGB", master.size, (0, 0, 0))
        master = master.convert("RGBA")
        flat.paste(master, mask=master.split()[-1])
        return flat
    return master.convert("RGB")


def resize_to_ceiling(master: Image.Image) -> tuple[Image.Image, bool]:
    """Scale down to TARGET_WIDTH. Returns the image and whether it was scaled."""
    if master.width <= TARGET_WIDTH:
        return master, False
    height = round(master.height * TARGET_WIDTH / master.width)
    return master.resize((TARGET_WIDTH, height), Image.LANCZOS), True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument(
        "--source", type=Path, default=SOURCE_IMAGE_PATH, help="master image (default: assets/site-backdrop-master.jpg)"
    )
    parser.add_argument("--out-dir", type=Path, default=OUTPUT_DIR, help="where to write (default: frontend/)")
    parser.add_argument("--stem", default=OUTPUT_STEM, help="output basename (default: site-backdrop)")
    args = parser.parse_args()

    master = load_master(args.source)
    original = f"{master.width}x{master.height}"
    image, scaled = resize_to_ceiling(master)

    webp_path = args.out_dir / f"{args.stem}.webp"
    jpeg_path = args.out_dir / f"{args.stem}.jpg"

    image.save(webp_path, format="WEBP", quality=WEBP_QUALITY, method=6)
    # `optimize` runs the Huffman tables twice for a few percent; `progressive`
    # is free here and lets the fallback paint in passes on a slow connection,
    # which for a full-viewport backdrop is the difference between a blank
    # ground and a rough one while the rest of the page is already up.
    image.save(jpeg_path, format="JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)

    print(f"{args.source.name}  {original}" + (f" -> {image.width}x{image.height}" if scaled else "  (not scaled)"))
    oversized = []
    for path in (webp_path, jpeg_path):
        kb = path.stat().st_size / 1024
        print(f"  {display(path)}  {kb:.1f} KB")
        if kb > SIZE_ADVISORY_KB:
            oversized.append(f"{path.name} ({kb:.0f} KB)")

    if not scaled:
        print(
            f"  note: master is {master.width}px wide, at or under the {TARGET_WIDTH}px ceiling.\n"
            f"        It was NOT upscaled. Under `cover` the browser will scale it up on\n"
            f"        a wider display; a larger master is the only real fix."
        )
    if oversized:
        print(f"  note: over the {SIZE_ADVISORY_KB} KB advisory - {', '.join(oversized)}. Nothing fails on this.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
