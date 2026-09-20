"""
Brush Backdrop Generator Script

Builds `frontend/brush-backdrop.webp` - the painted swash the landing portrait
stands in front of. It is an *alpha mask*, not a picture: a flat white
rectangle whose ALPHA channel carries the shape - opaque is paint, transparent
is bare page - which `.home-portrait::before` fills with `var(--accent-fill)`.
That indirection is the point - the theme customiser can set any accent and
the paint follows it, because the file carries the SHAPE and nothing else.

── It is a diagonal gesture now, and it is mobile-only ──

This used to build an upright PANEL: a slab of paint a standing figure was
posed against, sized to sit beside a text column. Two things retired it.
`.home-portrait::before` is now scoped to `@media (width <= 900px)`, which is
the STACKED layout - portrait above the text, centred - and an upright slab
behind a centred head is a rectangle with a man in the middle of it, which is
the one shape the panel was built to avoid in the first place. Above 900px the
paint is gone entirely; the hero wears a glass frame there instead, and the
pseudo-element is never generated, so nothing fetches this file on a desktop.

So the output is a swash: one diagonal sweep rising left to right, feathering
out at both ends, with spatter flecks off its axis. The canvas turned
landscape to hold it (see CANVAS_W/CANVAS_H), and every stroke in the table
below is measured along the canvas WIDTH because every stroke is now a
diagonal - the `vertical` switch the panel needed is gone with it.

── Alpha and not luminance, which is the obvious way to ship a greyscale mask
and is what this wrote until iOS was looked at ──

A CSS mask can read its source two ways, and the engines do not agree on
which. `mask-mode: luminance` takes the brightness; `mask-mode: alpha` takes
the alpha; the initial value, `match-source`, resolves to ALPHA for a raster
image. Chrome has honoured an explicit `luminance` since 120. WebKit's
support for it is flagged partial by browser-compat-data - "does not always
have the expected effect", webkit.org/b/282530 - and there is no
`-webkit-mask-mode` to fall back on, because WebKit never shipped one.

So a greyscale sheet with no alpha channel is a mask that is opaque
everywhere the moment an engine reads it as alpha. Android drew the brush;
iOS drew a hard-edged block of accent the full size of the mask box, tilted
two degrees, with the portrait standing in front of it. Measured on the file
this replaces: a luminance read paints 51.9% of the box, an alpha read paints
100.0%.

Keeping the RGB plane pure white is the other half of the fix and is not
decorative: a luminance mask is defined as luminance x alpha, so white x
alpha is the same shape the alpha read gets. The file renders identically
whichever mode an engine picks, which is what stops this regressing the next
time someone touches the CSS.

Why generate it rather than commit a painted swash: the only honest source of
bristle texture is a photograph of real paint, and one photograph is one
stroke. `assets/brush-stroke-master.jpg` is that photograph - a single
landscape swipe on black. Shipped as-is it was a swipe: at 125% of the
portrait's width it ran out past one shoulder and stopped in mid-air on the
other, with a blunt loaded end at one side, so it read as a smear the portrait
happened to overlap. This script re-uses it as a *brush* instead: the same
swipe, rescaled, tipped, flipped and laid down sixteen times at varying
weights, composited by lightest-wins so overlaps thicken instead of banding.
Every edge in the output is therefore a real dry-brush edge, the interior
tonal variation is real loaded-bristle variation, and both ends feather -
without a second photograph.

The stroke table below is the whole design. Coordinates are fractions of the
output canvas so the swash can be re-rendered at any resolution, and each
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

# Output geometry. Landscape, because the swash sweeps ACROSS the portrait
# rather than standing behind it; the ratio is the one the CSS assumes when it
# sizes `.home-portrait::before` off the portrait's own width.
#
# Wide and short is also what buys the diagonal its length back. The bottom
# fade below is computed, not chosen, and it has to finish before the figure
# starts dissolving at 68% of its own height - on the old portrait canvas that
# line landed at 67% of the mask and amputated the swash's whole lower-left
# half. At 1300x900 the same constraint lands at ~92%, so the fade trims the
# tail instead of cutting the stroke.
#
# 1300px wide is deliberately modest: the swash renders at ~560 CSS px at the
# widest phone cap, and a mask has no detail a viewer can resolve - its edges
# are feathered bristle, not type. Doubling the resolution quadruples the bytes
# to describe the same soft edge.
CANVAS_W = 1300
CANVAS_H = 900

# Pixels above this in the source count as paint. The master is a studio shot
# on black, so the histogram is bimodal and the exact cut is not delicate -
# this only decides where the bounding-box crop lands.
PAINT_THRESHOLD = 28

# The brightness that `load_brush` maps to fully opaque, as a percentile of the
# cropped master's pixels. It has to sit inside the loaded core and above every
# feathered edge: too low and the dry-brush texture clips to a flat silhouette,
# too high and the swash stays a wash. The master is roughly 60% black field,
# so this lands well inside the paint.
CORE_PERCENTILE = 0.985

# How much of a cropped stroke's length is spent ramping its cut end back to
# nothing. See `taper_cut`.
CUT_TAPER = 0.22

# Encoder quality for the output. See the note in `main`. It applies to the RGB
# plane, which is now one flat white and costs almost nothing either way.
WEBP_QUALITY = 80

# Quality of the ALPHA channel, which is where the whole swash lives. This is
# the one number that decides the file size, and it is a cliff rather than a
# slope: libwebp compresses alpha losslessly above ~75 and lossily below it.
# Measured on this swash's predecessor, the same source at a similar area:
#
#     alpha_quality    100     90     80     70     60     50     40
#     file size      320 KB 334 KB 266 KB  94 KB  83 KB  71 KB  58 KB
#     mean error      0.00   0.22   0.46   2.91   3.32   3.71   4.53   (of 255)
#
# 60 is the first setting past the cliff, and its error is comfortably inside
# the noise: 3.3/255 is 1.3% of opacity on a layer already drawn at 0.92, and
# the thing being quantised is feathered bristle, not an edge anyone can lay a
# ruler against. The far corners - the bare-page field, where error shows as a
# wash of accent across the whole rectangle - come back at a mean of 0.03/255,
# which is better than the lossy greyscale this replaced managed.
ALPHA_QUALITY = 60

# ── Where the paint has to stop, and why it is computed rather than chosen ──
#
# The portrait in front of the swash does not end, it DISSOLVES:
# `.home-portrait-img` carries `mask-image: linear-gradient(to bottom, #000
# 68%, transparent 97%)`, so from 68% of its height down the figure is
# progressively transparent. Anything painted behind it in that band shows
# THROUGH the jacket - and what shows through is not a wash, it is the swash's
# own bristle texture printed across the lapels as an olive smudge.
#
# So the swash's own fade is not a free aesthetic choice. It has to be finished
# before the figure starts letting light through, and the four mirrors below
# are what let that be computed instead of guessed. They restate values that
# live in styles.css: if any of them changes there, change it here too - the
# script prints the resulting band on every run so a mismatch is visible.
SWASH_WIDTH_OF_BOX = 1.24  # .home-portrait::before  width
SWASH_TOP_OF_BOX = -0.10  # .home-portrait::before  top
PORTRAIT_BOX_ASPECT = 786 / 760  # .home-portrait     box height / width
PORTRAIT_FADE_START = 0.68  # .home-portrait-img mask-image

# Margin between the last of the paint and the first of the figure's
# transparency, as a fraction of the portrait box. Small but not zero: landing
# the two lines on the same pixel row makes them one visible edge again.
FADE_CLEARANCE = 0.02

# How much of the swash's height the dissolve is spread over. Long, because a
# short ramp across a DIAGONAL is the worst case for this: the ramp is
# horizontal and the stroke is not, so a tight one reads as a ruled line drawn
# across the paint. Over 270px it lands as the tail running dry instead.
FADE_SPAN = 0.30


def _fade_bounds() -> tuple[float, float]:
    """`(start, end)` of the bottom fade, as fractions of the canvas height."""
    swash_height_of_box = SWASH_WIDTH_OF_BOX * (CANVAS_H / CANVAS_W) / PORTRAIT_BOX_ASPECT
    gone_at_box = PORTRAIT_FADE_START - FADE_CLEARANCE
    end = (gone_at_box - SWASH_TOP_OF_BOX) / swash_height_of_box
    return end - FADE_SPAN, end


FADE_START, FADE_END = _fade_bounds()


class Stroke(NamedTuple):
    """One laid-down stroke. Every fraction is of the output canvas.

    cx, cy    centre of the stroke
    length    long axis, as a fraction of canvas WIDTH. Values above 1.0 are
              normal and not a mistake: the canvas diagonal is 1.22 of its
              width, so a sweep that crosses the whole box is longer than the
              box is wide
    width     short axis, as a fraction of canvas HEIGHT
    angle     degrees counter-clockwise; 0 is the source's own landscape
              swipe, so a positive angle tips its far end UP - which is the
              direction the swash rises, left to right
    flip      mirror the source end-for-end, so the loaded end and the dry
              feathered end do not all land on the same side
    weight    0-1 multiplier on the source's brightness, i.e. how opaque this
              stroke's paint is before overlaps
    crop      slice of the source's long axis to use, cut ends tapered
    """

    cx: float
    cy: float
    length: float
    width: float
    angle: float
    flip: bool
    weight: float
    crop: tuple[float, float] = (0.0, 1.0)


# ── The table is the design ──
#
# Five long sweeps at 33-37 degrees make the body. They are offset
# PERPENDICULAR to their own axis rather than stacked vertically, which is
# what keeps the result one gesture instead of a fan: the unit normal to a
# 35-degree rise is (0.57, 0.82) in canvas fractions scaled by (1/W, 1/H), so
# a step of 65px along it moves a stroke by (+0.029, +0.059) here. The middle
# sweep carries full weight and the outer two are thin and light, so the band
# has a loaded core and dry shoulders the way one pass of a wide brush does.
#
# Their `cx` values also drift ALONG the axis, which is what ragged the two
# ends - five strokes ending on one line is a cut, not a lift-off.
#
# Two light shoulder passes then shed off the band's own edges, and ten
# flecks of spatter finish it. The flecks are not a new primitive: they are ordinary
# strokes a few dozen pixels long, cropped from the extreme dry tail of the
# source, so even a 40px speck is real bristle rather than a drawn dot.
STROKES = [
    # --- the body: five sweeps, perpendicular offsets about the centre -----
    Stroke(cx=0.425, cy=0.453, length=0.86, width=0.115, angle=36.5, flip=False, weight=0.52),
    Stroke(cx=0.502, cy=0.437, length=1.00, width=0.155, angle=34.0, flip=True, weight=0.84),
    Stroke(cx=0.500, cy=0.500, length=1.05, width=0.195, angle=35.0, flip=False, weight=1.00),
    Stroke(cx=0.489, cy=0.573, length=0.97, width=0.150, angle=33.5, flip=True, weight=0.82),
    Stroke(cx=0.559, cy=0.563, length=0.82, width=0.110, angle=36.0, flip=False, weight=0.50),
    # --- shoulder: one light pass shed off the band's upper edge -----------
    # There is exactly one, and it is dry, faint and cropped at BOTH ends -
    # three constraints, each of which fixes a way the earlier cuts of this
    # table failed. Three of them, parallel, read as a set of bars laid beside
    # the stroke. Keeping the source's blunt loaded end made each bar a tab
    # rather than bristle that ran out. And at full weight, one 135px off the
    # axis is a second stroke rather than the same one splitting.
    Stroke(cx=0.535, cy=0.281, length=0.52, width=0.048, angle=33.0, flip=False, weight=0.26, crop=(0.62, 0.96)),
    # --- spatter, all of it clear of the band ------------------------------
    Stroke(cx=0.231, cy=0.392, length=0.072, width=0.044, angle=39.0, flip=False, weight=0.58, crop=(0.88, 1.0)),
    Stroke(cx=0.330, cy=0.265, length=0.050, width=0.032, angle=12.0, flip=True, weight=0.48, crop=(0.90, 1.0)),
    Stroke(cx=0.454, cy=0.153, length=0.062, width=0.038, angle=52.0, flip=False, weight=0.54, crop=(0.89, 1.0)),
    Stroke(cx=0.598, cy=0.062, length=0.040, width=0.026, angle=-24.0, flip=True, weight=0.44, crop=(0.91, 1.0)),
    Stroke(cx=0.734, cy=0.073, length=0.054, width=0.034, angle=63.0, flip=False, weight=0.50, crop=(0.89, 1.0)),
    Stroke(cx=0.853, cy=0.454, length=0.066, width=0.041, angle=27.0, flip=True, weight=0.56, crop=(0.88, 1.0)),
    Stroke(cx=0.786, cy=0.604, length=0.046, width=0.030, angle=-16.0, flip=False, weight=0.46, crop=(0.90, 1.0)),
    Stroke(cx=0.694, cy=0.725, length=0.038, width=0.025, angle=44.0, flip=True, weight=0.44, crop=(0.91, 1.0)),
    Stroke(cx=0.172, cy=0.560, length=0.044, width=0.028, angle=-8.0, flip=False, weight=0.42, crop=(0.90, 1.0)),
    Stroke(cx=0.867, cy=0.210, length=0.032, width=0.021, angle=71.0, flip=True, weight=0.40, crop=(0.92, 1.0)),
]


def load_brush() -> Image.Image:
    """The master swipe as greyscale, cropped to the paint itself and levelled.

    Two things happen here. The crop: the master is a swipe floating in a wide
    black field, and pasting that field around would waste most of every
    transform and make `length`/`width` mean something other than the stroke's
    own dimensions.

    The level stretch: the paint in the photograph is a mid amber lit by a
    studio softbox, so its brightest pixels sit around 200 of 255. Read as a
    mask that is not paint, it is paint at 78% opacity - the paint came out a
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
    # rectangular tab stuck to the swash's edge, which is the one shape none of
    # this is meant to produce. `taper_cut` is what makes the cut itself
    # survivable - a crop through the middle of a loaded swipe is a guillotine
    # edge, straighter than anything a brush leaves, so the new end is ramped
    # off over a fraction of its own length and lands as a lift-off instead.
    lo, hi = spec.crop
    if (lo, hi) != (0.0, 1.0):
        brush = brush.crop((round(lo * brush.width), 0, round(hi * brush.width), brush.height))
        brush = ImageChops.multiply(brush, taper_cut(brush.width, brush.height, lo > 0.0, hi < 1.0))

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


def apply_bottom_fade(swash: Image.Image) -> Image.Image:
    """Ramp the swash to nothing over its last stretch."""
    ramp = Image.new("L", (1, CANVAS_H), 255)
    start, end = round(FADE_START * CANVAS_H), round(FADE_END * CANVAS_H)
    span = max(1, end - start)
    for y in range(start, CANVAS_H):
        # Smoothstep, so the fade has no visible start line - a linear ramp
        # kinks exactly where it leaves full opacity, which is the one place
        # the eye is already looking for an edge.
        t = min(1.0, (y - start) / span)
        ramp.putpixel((0, y), round(255 * (1 - t * t * (3 - 2 * t))))
    return ImageChops.multiply(swash, ramp.resize(swash.size))


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
        "--out", type=Path, default=OUTPUT_PATH, help="where to write the swash (default: frontend/brush-backdrop.webp)"
    )
    args = parser.parse_args()

    swash = build()

    # The swash is built as a greyscale coverage map because that is the
    # natural thing to composite strokes into; it ships as the ALPHA of a white
    # sheet, for the reason argued at the top of this file.
    sheet = Image.new("RGBA", swash.size, (255, 255, 255, 255))
    sheet.putalpha(swash)

    # Lossy WebP, and the two quality numbers are the whole of the decision.
    # The honest alternative was a PNG, and the same sheet comes out at 510 KB
    # against 83 KB here - bristle texture is high-frequency noise, which is
    # the one thing PNG cannot pack, and this is a decorative layer on the LCP
    # view.
    #
    # The usual objection to a lossy mask is that ringing lifts the empty field
    # off zero, and a mask that is 2/255 everywhere is a wash of accent across
    # the whole rectangle. It is a smaller worry here than it was for the
    # greyscale file: alpha is compressed on its own terms rather than as
    # colour, and at these settings the far corners come back at a mean of
    # 0.03 of 255. The lift is confined to pixels touching a bristle edge,
    # where a couple of percent of alpha is texture rather than error.
    sheet.save(args.out, format="WEBP", quality=WEBP_QUALITY, alpha_quality=ALPHA_QUALITY, method=6)

    kb = args.out.stat().st_size / 1024
    print(f"{args.out.relative_to(ROOT_DIR)}  {sheet.width}x{sheet.height}  {kb:.1f} KB")
    print(f"  alpha mask, q={WEBP_QUALITY} alpha_q={ALPHA_QUALITY}")
    # The band, restated where it can be checked against the CSS: the fade has
    # to finish above `PORTRAIT_FADE_START` or the paint prints on the jacket.
    swash_height_of_box = SWASH_WIDTH_OF_BOX * (CANVAS_H / CANVAS_W) / PORTRAIT_BOX_ASPECT

    def to_box(local: float) -> float:
        return SWASH_TOP_OF_BOX + local * swash_height_of_box

    print(f"  {len(STROKES)} strokes from {SOURCE_IMAGE_PATH.name}")
    print(
        f"  paint fades {to_box(FADE_START):.0%} -> {to_box(FADE_END):.0%} of the portrait box; "
        f"the figure starts dissolving at {PORTRAIT_FADE_START:.0%}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
