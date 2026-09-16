#!/usr/bin/env python3
"""Verify that SVG backdrop flow routes lie strictly on copper circuit traces.

Parses the `.site-backdrop-flow` SVG in `frontend/index.html` and samples
luminance along each vector path against `frontend/site-backdrop.webp`.
Exits non-zero if any route falls below the 95% on-trace threshold or strays
into empty background space.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
IMAGE_PATH = ROOT / "frontend" / "site-backdrop.webp"
INDEX_HTML = ROOT / "frontend" / "index.html"

PATH_REGEX = re.compile(r'<path[^>]*class="[^"]*backdrop-flow[^"]*"[^>]*d="([^"]+)"', re.IGNORECASE)
TOKEN_REGEX = re.compile(r'([MLHVZ])|(-?\d+(?:\.\d+)?)')

# Thresholds
TRACE_BRIGHTNESS_MIN = 100  # Trace copper lines have luminance > 100 (mean ~220-250)
MIN_ROUTE_ON_TRACE_PCT = 95.0


def parse_path_segments(d: str) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Parse SVG path d-string into contiguous line segments."""
    tokens = [m.group(0) for m in re.finditer(r'[A-Za-z]|-?\d+(?:\.\d+)?', d)]
    segments = []
    i = 0
    curr_x, curr_y = 0.0, 0.0

    while i < len(tokens):
        cmd = tokens[i]
        if cmd == 'M':
            curr_x, curr_y = float(tokens[i + 1]), float(tokens[i + 2])
            i += 3
        elif cmd == 'H':
            next_x = float(tokens[i + 1])
            segments.append(((curr_x, curr_y), (next_x, curr_y)))
            curr_x = next_x
            i += 2
        elif cmd == 'V':
            next_y = float(tokens[i + 1])
            segments.append(((curr_x, curr_y), (curr_x, next_y)))
            curr_y = next_y
            i += 2
        elif cmd == 'L':
            next_x, next_y = float(tokens[i + 1]), float(tokens[i + 2])
            segments.append(((curr_x, curr_y), (next_x, next_y)))
            curr_x, curr_y = next_x, next_y
            i += 3
        else:
            i += 1
    return segments


def check_traces() -> int:
    if not IMAGE_PATH.exists():
        print(f"Error: missing backdrop image: {IMAGE_PATH}")
        return 1

    if not INDEX_HTML.exists():
        print(f"Error: missing index.html: {INDEX_HTML}")
        return 1

    img = Image.open(IMAGE_PATH).convert("L")
    arr = np.array(img)
    h, w = arr.shape

    html = INDEX_HTML.read_text(encoding="utf-8")
    paths = PATH_REGEX.findall(html)

    if not paths:
        print("Error: no <path class=\"backdrop-flow\"> found in index.html")
        return 1

    print(f"Checking {len(paths)} backdrop flow paths against {w}x{h} derivative...")

    failures = 0
    total_px_all = 0
    on_trace_all = 0

    for idx, d in enumerate(paths, start=1):
        segments = parse_path_segments(d)
        if not segments:
            print(f"  Path {idx}: failed to parse segments from d='{d}'")
            failures += 1
            continue

        route_pts = 0
        route_bright = 0
        vals = []

        for (x1, y1), (x2, y2) in segments:
            dist = int(np.hypot(x2 - x1, y2 - y1))
            for step in range(dist + 1):
                t = step / max(dist, 1)
                x = int(round(x1 + t * (x2 - x1)))
                y = int(round(y1 + t * (y2 - y1)))
                
                # Check within a 1px radius tolerance to accommodate hairline antialiasing
                v = max(
                    arr[min(max(0, y), h - 1), min(max(0, x), w - 1)],
                    arr[min(max(0, y - 1), h - 1), min(max(0, x), w - 1)],
                    arr[min(max(0, y + 1), h - 1), min(max(0, x), w - 1)],
                    arr[min(max(0, y), h - 1), min(max(0, x - 1), w - 1)],
                    arr[min(max(0, y), h - 1), min(max(0, x + 1), w - 1)]
                )
                vals.append(v)
                if v >= TRACE_BRIGHTNESS_MIN:
                    route_bright += 1
                route_pts += 1

        pct = (route_bright / route_pts) * 100 if route_pts else 0.0
        avg_val = np.mean(vals) if vals else 0.0
        status = "OK" if pct >= MIN_ROUTE_ON_TRACE_PCT else "FAIL"

        print(f"  [{status}] Path {idx}: len={route_pts}px, on-trace={pct:.1f}%, mean_brightness={avg_val:.1f}")
        print(f"         d=\"{d}\"")

        total_px_all += route_pts
        on_trace_all += route_bright

        if pct < MIN_ROUTE_ON_TRACE_PCT:
            failures += 1

    overall_pct = (on_trace_all / total_px_all) * 100 if total_px_all else 0.0
    print(f"\nOverall transit alignment: {on_trace_all}/{total_px_all}px ({overall_pct:.2f}%)")

    if failures > 0:
        print(f"FAILED: {failures} path(s) fell below {MIN_ROUTE_ON_TRACE_PCT}% on-trace requirement.")
        return 1

    print("All backdrop flow paths are verified on circuit traces.")
    return 0


if __name__ == "__main__":
    sys.exit(check_traces())
