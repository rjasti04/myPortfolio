"""
Profile Cutout Generator Script

Builds the two free-form landing portraits: studio shots background-removed so
the page's own gradient and plexus canvas show through the silhouette instead of
a photographic square clipped to a circle.

There are TWO of them because the landing portrait flips. `.home-portrait` is a
button; clicking it rotates a card whose front is the hat shot and whose back is
the suit shot that used to be the only portrait. Both faces render into the same
box, so both mattes have to come out the same shape - see SHARED_ASPECT below,
which is the one number in this file that is not free.

Each face reads its OWN master, and neither is the headshot
`generate_profile_pics.py` uses. Those want opposite framings and no single file
serves both: the avatar is a circle that has to be filled by a face, so its
master is cropped tight, while a landing portrait is a bust standing in front of
a painted panel and needs the shoulders the circle would throw away. Replacing
any master is therefore a change to one image on the page, not to all of them -
which is the point of keeping them apart.

Two stages, because they have very different dependency costs:

  1. **Matting** turns each master into its `assets/profile-cutout*-master.png` -
     straight alpha, trimmed to the silhouette. Needs `rembg`, which pulls
     onnxruntime and downloads a ~1 GB model on first run. Runs only when a
     matte is missing or `--rebuild-matte` is passed.
  2. **Encoding** turns those mattes into the `frontend/profile-cutout*` files.
     Needs nothing but Pillow, so a contributor who only wants to re-tune
     quality or add a width never pays for stage 1.

Both the masters and the mattes live outside `frontend/` for the reason the
headshot master does: the deploy is an `rsync frontend/`, so nothing kept in
`assets/` is published.

Run after replacing a master:

    pip install "rembg[cpu]"                                  # stage 1 only
    python scripts/generate_profile_cutout.py --rebuild-matte --face front

Re-encoding from the committed mattes needs no extra install:

    python scripts/generate_profile_cutout.py
"""

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT_DIR = Path(__file__).parent.parent
ASSETS_DIR = ROOT_DIR / "assets"
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

# ── The one number neither face gets to choose ──
# Width over height of the trimmed matte. The two faces share a single box - the
# flip card sizes to the front and the back is absolutely positioned over it -
# so a face that mattes to a different shape either letterboxes or resizes the
# card mid-rotation. The value is the suit shot's, because it was here first and
# because it is baked into two other files: the `width`/`height` pair on
# `.home-portrait-img` in `index.html`, and the brush panel's `top`, `left` and
# `aspect-ratio` in the HOME HERO region of `styles.css`, all of which are
# percentages of a box this shape.
#
# It is reached by moving a face's `crop` BOTTOM edge, which is the only edge
# that is a composition decision anyway (see the per-face notes). Every run
# prints what each face actually came out at and fails if one drifts past
# ASPECT_TOLERANCE, so this cannot rot quietly.
SHARED_ASPECT = 0.9688
ASPECT_TOLERANCE = 0.01

# Lossy WebP with alpha. 84 is where the lapel weave stops visibly blocking on
# the widest file; the alpha channel is stored losslessly either way.
WEBP_QUALITY = 84

# The PNG fallback is only ever fetched by a browser without WebP alpha, which
# is a rounding error of a share and older than several features this page
# already hard-requires. Quantising it keeps that dead weight off the wire -
# 256 colours dither acceptably on a photographic bust at these widths.
PNG_COLORS = 256

# Lanczos downscaling softens edge detail; the same light unsharp pass the
# headshot variants use restores it without haloing the shoulder line.
UNSHARP = ImageFilter.UnsharpMask(radius=0.8, percent=60, threshold=3)


# ── The two faces ──
# `crop` is the bust window on that face's master, applied BEFORE segmentation
# rather than after: birefnet resamples whatever it is handed to 1024x1024, so
# giving it the bust alone spends the model's entire input on the hairline
# instead of on the trousers. Only the BOTTOM edge is a composition decision -
# where to cut the torso, which is also what lands the face on SHARED_ASPECT.
# The other three are deliberately loose, because `build_matte`'s trim finds the
# true silhouette edge and adds `margin_px` back to it: they only have to clear
# the subject.
#
# `margin_px` is the transparent margin kept on the left, right and top so the
# drop-shadow in styles.css has something to fall on. The bottom is deliberately
# NOT padded: the torso is cut by `crop`, so the silhouette has to run flush to
# the bottom edge for the CSS to bleed it off the container rather than float a
# severed torso. The two values differ because the two mattes are three times
# apart in resolution and this margin is what the page sees AFTER downscaling -
# 17px on a ~1430px matte and 6px on a 497px one both land near 4.5px at the
# 380w rung.
FACES = [
    {
        "key": "front",
        # The hat shot. Shot outdoors at 3024x4032 - four times the pixels of
        # the suit master, which is why this face is the one that finally
        # carries a 2x rung (see its variants).
        "source": ASSETS_DIR / "profile-portrait-master.jpg",
        "matte": ASSETS_DIR / "profile-cutout-master.png",
        # Full-length standing shot; the silhouette runs x 903..2322 from
        # y 1707 (crown of the hat) to the bottom of the frame. Three loose
        # edges, then the cut: 3200 is where the arms are crossed and the
        # trimmed matte lands on SHARED_ASPECT. It passes through the forearms,
        # which sounds worse than it looks - `.home-portrait-img`'s mask starts
        # dissolving the figure at 68% of its height, so the crossed arms are
        # already ghosting by the time the cut arrives and are gone before it.
        "crop": (850, 1650, 2380, 3200),
        "margin_px": 17,
        # Three rungs, and the top one is new. The old ladder stopped at 497
        # because that was the whole of the bust the 1254px suit master had in
        # it, so a retina desktop asking for ~900w got an upscale and the note
        # here said only a higher-resolution original could fix it. This master
        # is that original. `.home-portrait` still caps at 450 CSS px, so 900
        # is exactly its 2x and the ladder now covers every rung the `sizes`
        # attribute can ask for: 380 for a 1x phone, 570 for a 1x desktop or a
        # 2x phone, 900 for a 2x desktop. 380 keeps its name because it is the
        # LCP file - `index.html` preloads it, the build precaches it, and
        # `scripts/tests/build.test.js` asserts those two stay the same file.
        "variants": [
            {"width": 380, "png_name": "profile-cutout-380.png", "webp_name": "profile-cutout-380.webp"},
            {"width": 570, "png_name": "profile-cutout-570.png", "webp_name": "profile-cutout-570.webp"},
            {"width": 900, "png_name": "profile-cutout.png", "webp_name": "profile-cutout.webp"},
        ],
    },
    {
        "key": "back",
        # The suit shot - the portrait this page showed before the flip, kept
        # verbatim because that is the whole point of the back face. Its matte
        # is committed and predates this script's two-face shape; re-running
        # `--rebuild-matte --face back` reproduces it from these constants.
        "source": ASSETS_DIR / "profile-portrait-back-master.jpg",
        "matte": ASSETS_DIR / "profile-cutout-back-master.png",
        "crop": (372, 164, 947, 678),
        "margin_px": 6,
        # Two rungs, and the top one is an odd number because it is not a
        # choice: 497 is this matte's own width, and the ladder stops there
        # because anything past it is an upscale wearing a bigger filename. The
        # 1254px master is genuinely all the portrait there is. It does not
        # reach 2x, and on the back face that is affordable in a way it was not
        # when this shot was the landing image: nothing preloads it, it is
        # fetched at low priority behind the LCP, and it is on screen only
        # after a deliberate click.
        "variants": [
            {"width": 380, "png_name": "profile-cutout-back-380.png", "webp_name": "profile-cutout-back-380.webp"},
            {"width": 497, "png_name": "profile-cutout-back.png", "webp_name": "profile-cutout-back.webp"},
        ],
    },
]


def build_matte(face):
    """Crop a master to the bust, segment it, and write the trimmed RGBA matte."""
    try:
        from rembg import new_session, remove
    except ImportError:
        print('[ERROR] rembg is not installed. Run: pip install "rembg[cpu]"')
        return False

    source_path, matte_path = face["source"], face["matte"]
    if not source_path.exists():
        print(f"[ERROR] Source image not found at: {source_path}")
        return False

    print(f"Opening source image: {source_path}")
    with Image.open(source_path) as img:
        print(f"Source size: {img.size}, mode: {img.mode}, format: {img.format}")
        source = img.convert("RGB").crop(face["crop"])
    print(f"Cropped to the bust window {face['crop']}: {source.size}")

    print(f"Segmenting with {REMBG_MODEL} (first run downloads the model)...")
    cut = remove(source, session=new_session(REMBG_MODEL), post_process_mask=True)

    arr = np.array(cut.convert("RGBA"), dtype=np.float32)
    rgb, alpha = arr[:, :, :3], arr[:, :, 3] / 255.0

    # ── Colour decontamination ──
    # Both masters were shot outdoors against trees, so every pixel the lens and
    # the JPEG encoder smeared across the silhouette carries some of that green.
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
    # explicit threshold drops them, then `margin_px` is added back on three
    # sides so the drop-shadow in styles.css has something to fall on.
    margin = face["margin_px"]
    rows, cols = np.nonzero(alpha > 0.03)
    left = max(int(cols.min()) - margin, 0)
    right = min(int(cols.max()) + 1 + margin, matte.width)
    top = max(int(rows.min()) - margin, 0)
    bottom = matte.height
    matte = matte.crop((left, top, right, bottom))

    matte_path.parent.mkdir(parents=True, exist_ok=True)
    matte.save(matte_path, "PNG", optimize=True)
    matte_size_kb = matte_path.stat().st_size / 1024
    print(f"Saved {matte_path.name}: {matte.width}x{matte.height} ({matte_size_kb:.1f} KB)")
    return True


def encode_variants(face):
    """Write one face's frontend WebP/PNG pairs from its committed matte."""
    matte_path = face["matte"]
    if not matte_path.exists():
        print(f"[ERROR] Matte not found at: {matte_path}")
        print("        Run with --rebuild-matte to generate it.")
        return None

    with Image.open(matte_path) as matte:
        matte = matte.convert("RGBA")
        aspect = matte.width / matte.height
        print(f"Matte size: {matte.size} (w/h {aspect:.4f})")

        for variant in face["variants"]:
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

    return aspect


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--face",
        choices=[face["key"] for face in FACES] + ["all"],
        default="all",
        help="which side of the flip card to build (default: all)",
    )
    parser.add_argument(
        "--rebuild-matte",
        action="store_true",
        help="re-run background removal even if the matte already exists",
    )
    args = parser.parse_args()

    selected = [face for face in FACES if args.face in (face["key"], "all")]
    aspects = {}

    for face in selected:
        print(f"\n── {face['key']} face ──")
        if args.rebuild_matte or not face["matte"].exists():
            if not build_matte(face):
                return False
        else:
            print(f"Reusing existing matte: {face['matte'].name} (--rebuild-matte to regenerate)")

        aspect = encode_variants(face)
        if aspect is None:
            return False
        aspects[face["key"]] = aspect

    # ── The shape check ──
    # Both faces render into one box, so a drifted aspect is not a cosmetic
    # problem: it either letterboxes a face or resizes the card mid-flip, and
    # it silently invalidates the brush panel's percentage geometry. Fail here
    # rather than let it reach the page.
    print()
    drifted = False
    for key, aspect in aspects.items():
        delta = aspect - SHARED_ASPECT
        status = "ok" if abs(delta) <= ASPECT_TOLERANCE else "DRIFTED"
        print(f"{key:>5} face aspect w/h {aspect:.4f} vs shared {SHARED_ASPECT} ({delta:+.4f}) {status}")
        drifted = drifted or status == "DRIFTED"

    if drifted:
        print(
            "\n[ERROR] A face no longer matches SHARED_ASPECT. Move that face's crop\n"
            "        bottom edge until it does, or - if the new shape is intended -\n"
            "        re-tune SHARED_ASPECT, the width/height pair on\n"
            "        .home-portrait-img in index.html, and the brush panel's top,\n"
            "        left and aspect-ratio in the HOME HERO region of styles.css."
        )
        return False

    print("\n[SUCCESS] Profile cutout variants successfully generated!")
    return True


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
