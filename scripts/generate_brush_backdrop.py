"""
Brush Backdrop Generator Script

Builds `frontend/brush-backdrop.webp` - the painted panel the landing portrait
stands in front of. It is a *luminance mask*, not a picture: white is opaque
paint, black is bare page, and `.home-portrait::before` fills the shape it
describes with `var(--accent-fill)`. That indirection is the point - the theme
customiser can set any accent and the paint follows it, because the file
carries the SHAPE and nothing else.

Why generate it rather than commit a painted panel: the only honest source of
bristle texture is a photograph of real paint, and one photograph is one
stroke. `assets/brush-stroke-master.jpg` is that photograph - a single
landscape swipe on black, which is exactly what the landing view used to show
and exactly why it read as a stray smear rather than a backdrop. This script
turns it into a panel by re-using it as a *brush*: the same swipe, rotated
upright, rescaled, flipped and laid down a dozen times at varying weights,
composited by lightest-wins so overlaps thicken instead of banding. Every edge
in the output is therefore a real dry-brush edge, and the interior tonal
variation is real loaded-bristle variation, without a second photograph.

The stroke table below is the whole design. Coordinates are fractions of the
output canvas so the panel can be re-rendered at any resolution, and each
entry's `weight` is how much of the source's brightness survives - that is
what keeps the interior from flattening into one solid slab.

    python scripts/generate_brush_backdrop.py

Pillow is the only dependency. Nothing here needs the network.
"""

import argparse
from pathlib import Path
from typing import NamedTuple

from PIL import Image, ImageChops, ImageFilter

ROOT_DIR = Path(__file__).parent.parent
SOURCE_IMAGE_PATH = ROOT_DIR / "assets" / "brush-stroke-master.jpg"
OUTPUT_PATH = ROOT_DIR / "frontend" / "brush-backdrop.webp"

# Output geometry. Portrait, because the panel frames a standing figure from
# the head to below the chest; the ratio is the one the CSS assumes when it
# sizes `.home-portrait::before` off the portrait's own width.
#
# 1000px wide is deliberately modest: the panel renders at ~800 CSS px at the
# widest cap, and a mask has no detail a viewer can resolve - its edges are
# feathered bristle, not type. Doubling the resolution quadruples the bytes to
# describe the same soft edge.
CANVAS_W = 1060
CANVAS_H = 1120

# Pixels above this in the source count as paint. The master is a studio shot
# on black, so the histogram is bimodal and the exact cut is not delicate -
# this only decides where the bounding-box crop lands.
PAINT_THRESHOLD = 28

# The brightness that `load_brush` maps to fully opaque, as a percentile of the
# cropped master's pixels. It has to sit inside the loaded core and above every
# feathered edge: too low and the dry-brush texture clips to a flat silhouette,
# too high and the panel stays a wash. The master is roughly 60% black field,
# so this lands well inside the paint.
CORE_PERCENTILE = 0.985

# How much of a cropped stroke's length is spent ramping its cut end back to
# nothing. See `taper_cut`.
CUT_TAPER = 0.22

# Encoder quality for the output. See the note in `main`.
WEBP_QUALITY = 80

# ── Where the panel has to stop, and why it is computed rather than chosen ──
#
# The portrait in front of the panel does not end, it DISSOLVES:
# `.home-portrait-img` carries `mask-image: linear-gradient(to bottom, #000
# 68%, transparent 97%)`, so from 68% of its height down the figure is
# progressively transparent. Anything painted behind it in that band shows
# THROUGH the jacket - and what shows through is not a wash, it is the panel's
# own bristle texture printed across the lapels as an olive smudge.
#
# So the panel's own fade is not a free aesthetic choice. It has to be finished
# before the figure starts letting light through, and the four mirrors below
# are what let that be computed instead of guessed. They restate values that
# live in styles.css: if any of them changes there, change it here too - the
# script prints the resulting band on every run so a mismatch is visible.
PANEL_WIDTH_OF_BOX = 0.88  # .home-portrait::before  width
PANEL_TOP_OF_BOX = -0.06  # .home-portrait::before  top
PORTRAIT_BOX_ASPECT = 786 / 760  # .home-portrait     box height / width
PORTRAIT_FADE_START = 0.68  # .home-portrait-img mask-image

# Margin between the last of the paint and the first of the figure's
# transparency, as a fraction of the portrait box. Small but not zero: landing
# the two lines on the same pixel row makes them one visible edge again.
FADE_CLEARANCE = 0.02

# How much of the panel's height the dissolve is spread over. Long, because the
# paint now has to be gone well above the bottom of the panel and a short ramp
# there reads as the paint having been cut off rather than having run out.
FADE_SPAN = 0.30


def _fade_bounds() -> tuple[float, float]:
    """`(start, end)` of the bottom fade, as fractions of the canvas height."""
    panel_height_of_box = PANEL_WIDTH_OF_BOX * (CANVAS_H / CANVAS_W) / PORTRAIT_BOX_ASPECT
    gone_at_box = PORTRAIT_FADE_START - FADE_CLEARANCE
    end = (gone_at_box - PANEL_TOP_OF_BOX) / panel_height_of_box
    return end - FADE_SPAN, end


FADE_START, FADE_END = _fade_bounds()


class Stroke(NamedTuple):
    """One laid-down stroke. Every fraction is of the output canvas.

    cx, cy    centre of the stroke
    length    long axis, as a fraction of canvas HEIGHT for uprights and of
              canvas WIDTH for the flat accents - `vertical` picks which
    width     short axis, same convention inverted
    angle     degrees counter-clockwise; 0 is the source's own landscape
              swipe, so ~90 stands it upright
    flip      mirror the source end-for-end, so the loaded end and the dry
              feathered end do not all land on the same side
    weight    0-1 multiplier on the source's brightness, i.e. how opaque this
              stroke's paint is before overlaps
    vertical  upright, or one of the flat accents
    crop      slice of the source's long axis to use, cut ends tapered
    """

    cx: float
    cy: float
    length: float
    width: float
    angle: float
    flip: bool
    weight: float
    vertical: bool = True
    crop: tuple[float, float] = (0.0, 1.0)


# The uprights are the panel. Their staggered `cy` values are what ragged the
# top edge and cut the notch above the head; their staggered lengths do the
# same at the bottom before the fade takes over. The flat accents are the
# spatter that breaks the panel's silhouette so it does not read as a
# rectangle - they are short and light on purpose.
STROKES = [
    # --- uprights, left to right ------------------------------------------
    Stroke(cx=0.115, cy=0.505, length=0.780, width=0.330, angle=93.5, flip=False, weight=0.68, vertical=True),
    Stroke(cx=0.230, cy=0.455, length=0.880, width=0.380, angle=89.0, flip=True, weight=0.86, vertical=True),
    Stroke(cx=0.360, cy=0.520, length=0.930, width=0.400, angle=91.5, flip=False, weight=1.00, vertical=True),
    Stroke(cx=0.500, cy=0.470, length=0.900, width=0.395, angle=88.5, flip=True, weight=0.95, vertical=True),
    Stroke(cx=0.635, cy=0.525, length=0.925, width=0.400, angle=92.0, flip=False, weight=1.00, vertical=True),
    Stroke(cx=0.765, cy=0.465, length=0.870, width=0.375, angle=89.5, flip=True, weight=0.88, vertical=True),
    Stroke(cx=0.880, cy=0.530, length=0.775, width=0.325, angle=87.5, flip=False, weight=0.70, vertical=True),
    # --- flat accents, breaking the silhouette ----------------------------
    # All four take the swipe's dry tail (see `crop` in `lay_stroke`), which is
    # the half that ends in bristle marks instead of a blunt edge.
    Stroke(cx=0.520, cy=0.100, length=0.640, width=0.150, angle=-5.0, flip=False, weight=0.60, vertical=False, crop=(0.30, 1.0)),
    Stroke(cx=0.430, cy=0.855, length=0.740, width=0.170, angle=4.0, flip=True, weight=0.55, vertical=False, crop=(0.25, 1.0)),
    Stroke(cx=0.930, cy=0.300, length=0.300, width=0.105, angle=-14.0, flip=False, weight=0.34, vertical=False, crop=(0.62, 1.0)),
    Stroke(cx=0.080, cy=0.690, length=0.280, width=0.100, angle=11.0, flip=True, weight=0.32, vertical=False, crop=(0.62, 1.0)),
]


def load_brush() -> Image.Image:
    """The master swipe as greyscale, cropped to the paint itself and levelled.

    Two things happen here. The crop: the master is a swipe floating in a wide
    black field, and pasting that field around would waste most of every
    transform and make `length`/`width` mean something other than the stroke's
    own dimensions.

    The level stretch: the paint in the photograph is a mid amber lit by a
    studio softbox, so its brightest pixels sit around 200 of 255. Read as a
    mask that is not paint, it is paint at 78% opacity - the panel came out a
    wash the page showed through rather than a surface the subject stands on.
    Mapping the loaded core to white restores the density without touching the
    feathering, which is what carries the texture and is all well below the
    percentile.
    """
    src = Image.open(SOURCE_IMAGE_PATH).convert("L")
    box = src.point(lambda v: 255 if v >= PAINT_THRESHOLD else 0).getbbox()
    if box is None:
        raise SystemExit(f"{SOURCE_IMAGE_PATH.name}: no paint above the threshold")
    src = src.crop(box)

    histogram = src.histogram()
    ceiling = len(histogram) - 1
    target = CORE_PERCENTILE * sum(histogram)
    running = 0
    for value, count in enumerate(histogram):
        running += count
        if running >= target:
            ceiling = max(value, 1)
            break
    return src.point(lambda v, c=ceiling: min(255, round(v * 255 / c)))


def taper_cut(width: int, height: int, at_start: bool, at_end: bool) -> Image.Image:
    """A horizontal ramp that fades whichever ends of a crop were cut open."""
    ramp = Image.new("L", (width, 1), 255)
    span = max(1, round(width * CUT_TAPER))
    for x in range(span):
        t = x / span
        eased = round(255 * t * t * (3 - 2 * t))
        if at_start:
            ramp.putpixel((x, 0), eased)
        if at_end:
            ramp.putpixel((width - 1 - x, 0), eased)
    return ramp.resize((width, height))


def lay_stroke(canvas: Image.Image, brush: Image.Image, spec: Stroke) -> None:
    """Composite one stroke onto the canvas, lightest pixel wins.

    Lighten rather than alpha-over because these are meant to be one substance:
    two strokes of the same paint crossing give the darker-through-thicker of
    the two, never a seam and never a rectangle where a translucent layer's
    bounding box lands.
    """
    # `crop` takes a slice along the source's long axis before anything else,
    # so an entry can ask for a specific part of the swipe rather than the
    # whole of it. The accents want the dry, feathered tail: scaled down whole,
    # the swipe keeps its blunt loaded end, and a short blunt stroke reads as a
    # rectangular tab stuck to the panel's edge, which is the one shape none of
    # this is meant to produce. `taper_cut` is what makes the cut itself
    # survivable - a crop through the middle of a loaded swipe is a guillotine
    # edge, straighter than anything a brush leaves, so the new end is ramped
    # off over a fraction of its own length and lands as a lift-off instead.
    lo, hi = spec.crop
    if (lo, hi) != (0.0, 1.0):
        brush = brush.crop((round(lo * brush.width), 0, round(hi * brush.width), brush.height))
        brush = ImageChops.multiply(brush, taper_cut(brush.width, brush.height, lo > 0.0, hi < 1.0))

    if spec.vertical:
        long_px, short_px = spec.length * CANVAS_H, spec.width * CANVAS_W
    else:
        long_px, short_px = spec.length * CANVAS_W, spec.width * CANVAS_H

    stroke = brush.resize((max(1, round(long_px)), max(1, round(short_px))), Image.LANCZOS)
    if spec.flip:
        stroke = stroke.transpose(Image.FLIP_LEFT_RIGHT)
    if spec.weight != 1.0:
        stroke = stroke.point(lambda v, w=spec.weight: round(v * w))

    # `expand` keeps the corners that rotation pushes outside the old box, so a
    # tilted stroke is not clipped square at its own ends.
    stroke = stroke.rotate(spec.angle, resample=Image.BICUBIC, expand=True)

    left = round(spec.cx * CANVAS_W - stroke.width / 2)
    top = round(spec.cy * CANVAS_H - stroke.height / 2)

    layer = Image.new("L", canvas.size, 0)
    layer.paste(stroke, (left, top))
    canvas.paste(ImageChops.lighter(canvas, layer), (0, 0))


def apply_bottom_fade(panel: Image.Image) -> Image.Image:
    """Ramp the panel to nothing over its last stretch."""
    ramp = Image.new("L", (1, CANVAS_H), 255)
    start, end = round(FADE_START * CANVAS_H), round(FADE_END * CANVAS_H)
    span = max(1, end - start)
    for y in range(start, CANVAS_H):
        # Smoothstep, so the fade has no visible start line - a linear ramp
        # kinks exactly where it leaves full opacity, which is the one place
        # the eye is already looking for an edge.
        t = min(1.0, (y - start) / span)
        ramp.putpixel((0, y), round(255 * (1 - t * t * (3 - 2 * t))))
    return ImageChops.multiply(panel, ramp.resize(panel.size))


def build() -> Image.Image:
    brush = load_brush()
    canvas = Image.new("L", (CANVAS_W, CANVAS_H), 0)
    for spec in STROKES:
        lay_stroke(canvas, brush, spec)

    # A half-pixel blur at this scale: LANCZOS on a photograph leaves faint
    # ringing at the bristle edges, which a luminance mask turns into a
    # speckled fringe of half-opaque accent.
    canvas = canvas.filter(ImageFilter.GaussianBlur(0.6))
    return apply_bottom_fade(canvas)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument(
        "--out", type=Path, default=OUTPUT_PATH, help="where to write the panel (default: frontend/brush-backdrop.webp)"
    )
    args = parser.parse_args()

    panel = build()
    # Lossy WebP, greyscale, and the quality is the whole of the decision. The
    # honest alternative was a greyscale PNG, and it came out at 485 KB against
    # 73 KB here - bristle texture is high-frequency noise, which is the one
    # thing PNG cannot pack, and this is a decorative layer on the LCP view.
    #
    # The usual objection to a lossy mask is that ringing lifts the black field
    # off zero, and a mask that is 2/255 everywhere is a wash of accent across
    # the whole rectangle. Measured on this panel at q=80, the far corners come
    # back at a mean of 0.01-0.12 of 255 - the lift is confined to the pixels
    # touching a bristle edge, where a couple of percent of alpha is texture
    # rather than error. Drop the quality much below this and that stops being
    # true.
    panel.save(args.out, format="WEBP", quality=WEBP_QUALITY, method=6)

    kb = args.out.stat().st_size / 1024
    print(f"{args.out.relative_to(ROOT_DIR)}  {panel.width}x{panel.height}  {kb:.1f} KB")
    # The band, restated where it can be checked against the CSS: the fade has
    # to finish above `PORTRAIT_FADE_START` or the paint prints on the jacket.
    panel_height_of_box = PANEL_WIDTH_OF_BOX * (CANVAS_H / CANVAS_W) / PORTRAIT_BOX_ASPECT

    def to_box(local: float) -> float:
        return PANEL_TOP_OF_BOX + local * panel_height_of_box

    print(f"  {len(STROKES)} strokes from {SOURCE_IMAGE_PATH.name}")
    print(
        f"  paint fades {to_box(FADE_START):.0%} -> {to_box(FADE_END):.0%} of the portrait box; "
        f"the figure starts dissolving at {PORTRAIT_FADE_START:.0%}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
