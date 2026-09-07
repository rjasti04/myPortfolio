"""
Profile Cutout Generator Script

Builds the free-form landing portrait: a studio shot background-removed so the
page's own gradient and plexus canvas show through the silhouette instead of a
photographic square clipped to a circle.

It reads its OWN master, `assets/profile-portrait-master.jpg`, not the headshot
`generate_profile_pics.py` uses. The two want opposite framings and no single
file serves both: the avatar is a circle that has to be filled by a face, so its
master is cropped tight, while the landing portrait is a bust standing in front
of a painted panel and needs the shoulders and the jacket the circle would throw
away. Replacing either master is therefore a change to one image on the page,
not to both - which is the point of keeping them apart.

Two stages, because they have very different dependency costs:

  1. **Matting** turns `assets/profile-portrait-master.jpg` into
     `assets/profile-cutout-master.png` - straight alpha, trimmed to the
     silhouette. Needs `rembg`, which pulls onnxruntime and downloads a ~1 GB
     model on first run. Runs only when the matte is missing or
     `--rebuild-matte` is passed.
  2. **Encoding** turns that matte into the four `frontend/profile-cutout*`
     files. Needs nothing but Pillow, so a contributor who only wants to
     re-tune quality or add a width never pays for stage 1.

Both the master and the matte live outside `frontend/` for the reason the
headshot master does: the deploy is an `rsync frontend/`, so nothing kept in
`assets/` is published.

Run after replacing the master:

    pip install "rembg[cpu]"          # stage 1 only
    python scripts/generate_profile_cutout.py --rebuild-matte

Re-encoding from the committed matte needs no extra install:

    python scripts/generate_profile_cutout.py
"""

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT_DIR = Path(__file__).parent.parent
SOURCE_IMAGE_PATH = ROOT_DIR / "assets" / "profile-portrait-master.jpg"
MATTE_PATH = ROOT_DIR / "assets" / "profile-cutout-master.png"
FRONTEND_DIR = ROOT_DIR / "frontend"

# birefnet-portrait over u2net_human_seg and isnet-general-use: all three agree
# on the silhouette to within a few pixels, but birefnet resolves the hair
# boundary with the least stair-stepping, which is the edge a cutout is judged
# on. It is the largest model of the three (~1 GB) - stage 2 exists so that
# cost is paid once.
REMBG_MODEL = "birefnet-portrait"

# Alpha at or above this is "solidly the subject" - the reference colour for
# decontamination below.
INTERIOR_ALPHA = 0.98

# Below this alpha a pixel is pure background colour and takes its RGB entirely
# from the interior; between here and INTERIOR_ALPHA the two blend.
CONTAMINATED_ALPHA = 0.55

# ── The bust window on the master ──
# The master is a full-length standing shot; the landing portrait is a bust. It
# has to be, and not by preference: `.home-portrait` renders at up to 450px
# inside a hero with almost no vertical slack, so a frame carrying the figure
# down to the knees would spend that width on trouser leg and hand the head
# roughly half the size the layout is built around.
#
# Only the BOTTOM edge here is a composition decision - where to cut the torso.
# The other three are deliberately loose, because the trim at the end of
# `build_matte` finds the true silhouette edge and adds MARGIN_PX to it: these
# just have to clear the subject. Which is also why the cut is worth stating
# exactly. At this line the trimmed matte comes out 0.967 as wide as it is tall,
# and that ratio is load-bearing in two other files - the `width`/`height` pair
# on `.home-portrait-img` in `index.html`, and the brush panel's `top`, `left`
# and `aspect-ratio` in the HOME HERO region of `styles.css`, all of which are
# percentages of a box this shape. Move the cut and re-check both.
#
# Cropping BEFORE segmentation rather than after is the other half of it:
# birefnet resamples whatever it is handed to 1024x1024, so giving it the bust
# alone spends the model's entire input on the hairline instead of on the
# trousers. It also puts the torso against the frame edge the way the old
# headshot master had it, which is what MARGIN_PX below assumes.
SOURCE_CROP_BOX = (372, 164, 947, 678)

# The matte keeps this much transparent margin on the left, right and top. The
# bottom is deliberately NOT padded: the torso is cut by SOURCE_CROP_BOX above,
# so the silhouette has to run flush to the bottom edge for the CSS to bleed it
# off the container rather than float a severed torso.
MARGIN_PX = 6

# Two rungs, and the top one is an odd number because it is not a choice: 497 is
# the matte's own width, and the ladder stops there because anything past it is
# an upscale wearing a bigger filename. The bust window is a ~500px crop of a
# 1254px master, so that is genuinely all the portrait there is.
#
# It does not reach 2x. `.home-portrait` caps at 450 CSS px - lowered from 570
# for exactly this reason, so that the widest render is a downscale of this file
# rather than an upscale of it - and a retina desktop there still asks for ~900w
# against 497. The previous master, a frame-filling headshot, mattes to 1111 and
# covered it. A higher-resolution original of this shot is the only thing that
# closes the gap; nothing in this script can, and generating a 900w file from a
# 497w matte would only move the blur from the browser to here while multiplying
# the bytes. 380 stays as the lower rung: it is the LCP file `index.html`
# preloads and the build precaches, and it is still a true downscale.
VARIANTS = [
    {"width": 380, "png_name": "profile-cutout-380.png", "webp_name": "profile-cutout-380.webp"},
    {"width": 497, "png_name": "profile-cutout.png", "webp_name": "profile-cutout.webp"},
]

# Lossy WebP with alpha. 84 is where the lapel weave stops visibly blocking on
# the 760w file; the alpha channel is stored losslessly either way.
WEBP_QUALITY = 84

# The PNG fallback is only ever fetched by a browser without WebP alpha, which
# is a rounding error of a share and older than several features this page
# already hard-requires. Quantising it keeps that dead weight off the wire -
# 256 colours dither acceptably on a photographic bust at these widths.
PNG_COLORS = 256

# Lanczos downscaling softens edge detail; the same light unsharp pass the
# headshot variants use restores it without haloing the shoulder line.
UNSHARP = ImageFilter.UnsharpMask(radius=0.8, percent=60, threshold=3)


def build_matte():
    """Crop the master to the bust, segment it, and write the trimmed RGBA matte."""
    try:
        from rembg import new_session, remove
    except ImportError:
        print('[ERROR] rembg is not installed. Run: pip install "rembg[cpu]"')
        return False

    if not SOURCE_IMAGE_PATH.exists():
        print(f"[ERROR] Source image not found at: {SOURCE_IMAGE_PATH}")
        return False

    print(f"Opening source image: {SOURCE_IMAGE_PATH}")
    with Image.open(SOURCE_IMAGE_PATH) as img:
        print(f"Source size: {img.size}, mode: {img.mode}, format: {img.format}")
        source = img.convert("RGB").crop(SOURCE_CROP_BOX)
    print(f"Cropped to the bust window {SOURCE_CROP_BOX}: {source.size}")

    print(f"Segmenting with {REMBG_MODEL} (first run downloads the model)...")
    cut = remove(source, session=new_session(REMBG_MODEL), post_process_mask=True)

    arr = np.array(cut.convert("RGBA"), dtype=np.float32)
    rgb, alpha = arr[:, :, :3], arr[:, :, 3] / 255.0

    # ── Colour decontamination ──
    # The master was shot outdoors against trees, so every pixel the lens and the
    # JPEG encoder smeared across the silhouette carries some of that green.
    # Straight alpha keeps those RGB values, and they surface as a lime rim the
    # moment the cutout is composited onto any other ground. Rewriting each
    # partial pixel with the colour of the nearest solidly-interior pixel makes
    # the fringe the subject's own colour instead.
    from scipy.ndimage import distance_transform_edt

    _, nearest = distance_transform_edt(alpha < INTERIOR_ALPHA, return_indices=True)
    interior_rgb = rgb[nearest[0], nearest[1]]
    keep = np.clip(
        (alpha - CONTAMINATED_ALPHA) / (INTERIOR_ALPHA - CONTAMINATED_ALPHA), 0, 1
    )[:, :, None]
    rgb = interior_rgb * (1 - keep) + rgb * keep

    # ── Edge pull ──
    # Decontamination fixes the colour of the fringe but not its width. A 1px
    # erosion drops the outermost ring - the one the model is least sure about -
    # and a sub-pixel blur puts a soft edge back so the silhouette does not
    # read as cut with scissors. The gain compensates for the mass the min
    # filter takes off the interior side of the ramp.
    alpha_img = Image.fromarray((alpha * 255).astype(np.uint8), "L")
    alpha_img = alpha_img.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    alpha = np.clip(np.asarray(alpha_img, dtype=np.float32) / 255.0 * 1.06, 0, 1)

    matte = Image.fromarray(
        np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8), "RGBA"
    )

    # ── Trim ──
    # `getbbox()` on the alpha would keep a hairline of near-zero pixels; the
    # explicit threshold drops them, then MARGIN_PX is added back on three sides
    # so the drop-shadow in styles.css has something to fall on.
    rows, cols = np.nonzero(alpha > 0.03)
    left = max(int(cols.min()) - MARGIN_PX, 0)
    right = min(int(cols.max()) + 1 + MARGIN_PX, matte.width)
    top = max(int(rows.min()) - MARGIN_PX, 0)
    bottom = matte.height
    matte = matte.crop((left, top, right, bottom))

    MATTE_PATH.parent.mkdir(parents=True, exist_ok=True)
    matte.save(MATTE_PATH, "PNG", optimize=True)
    matte_size_kb = MATTE_PATH.stat().st_size / 1024
    print(f"Saved {MATTE_PATH.name}: {matte.width}x{matte.height} ({matte_size_kb:.1f} KB)")
    return True


def encode_variants():
    """Write the frontend WebP/PNG pairs from the committed matte."""
    if not MATTE_PATH.exists():
        print(f"[ERROR] Matte not found at: {MATTE_PATH}")
        print("        Run with --rebuild-matte to generate it.")
        return False

    with Image.open(MATTE_PATH) as matte:
        matte = matte.convert("RGBA")
        print(f"Matte size: {matte.size}")

        for variant in VARIANTS:
            target = variant["width"]
            height = round(target * matte.height / matte.width)
            resized = matte.resize((target, height), Image.Resampling.LANCZOS)

            # UnsharpMask is a channel-wise convolution, so running it on RGBA
            # sharpens the alpha ramp too and hands back the hard edge the
            # feather above deliberately removed. Sharpen the colour, keep the
            # alpha as resampled.
            alpha = resized.getchannel("A")
            sharpened = resized.convert("RGB").filter(UNSHARP)
            sharpened.putalpha(alpha)

            webp_path = FRONTEND_DIR / variant["webp_name"]
            sharpened.save(webp_path, "WEBP", quality=WEBP_QUALITY, method=6)
            webp_size_kb = webp_path.stat().st_size / 1024
            print(f"Saved {variant['webp_name']}: {target}x{height} ({webp_size_kb:.1f} KB)")

            # Quantising RGBA keeps alpha in the palette, so the fallback stays
            # a cutout rather than gaining a black box.
            png_path = FRONTEND_DIR / variant["png_name"]
            sharpened.quantize(colors=PNG_COLORS, method=Image.Quantize.FASTOCTREE).save(
                png_path, "PNG", optimize=True
            )
            png_size_kb = png_path.stat().st_size / 1024
            print(f"Saved {variant['png_name']}: {target}x{height} ({png_size_kb:.1f} KB)")

    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--rebuild-matte",
        action="store_true",
        help="re-run background removal even if assets/profile-cutout-master.png exists",
    )
    args = parser.parse_args()

    if args.rebuild_matte or not MATTE_PATH.exists():
        if not build_matte():
            return False
    else:
        print(f"Reusing existing matte: {MATTE_PATH.name} (--rebuild-matte to regenerate)")

    if not encode_variants():
        return False

    print("\n[SUCCESS] Profile cutout variants successfully generated!")
    return True


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
