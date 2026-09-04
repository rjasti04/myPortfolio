"""
Profile Picture Generator Script

Regenerates the six `frontend/profile-pic*` files from the master portrait in
`assets/`. The master lives outside `frontend/` for the same reason
`assets/master-icon.png` does: the deploy is an `rsync frontend/`, so anything
kept here is never published to the web root.

Run after replacing the master:

    python scripts/generate_profile_pics.py
"""

from pathlib import Path

from PIL import Image, ImageFilter

ROOT_DIR = Path(__file__).parent.parent
SOURCE_IMAGE_PATH = ROOT_DIR / "assets" / "profile-pic-master.jpg"
FRONTEND_DIR = ROOT_DIR / "frontend"

# The avatar is rendered as a circle (`.home-avatar-img` is `border-radius: 50%`
# with `aspect-ratio: 1`), so the square framing is baked in here rather than
# left to `object-fit: cover` in the browser. Cropping at the source means the
# 725w file carries only pixels that are actually painted - a portrait master
# would ship ~30% of its height to be discarded by the circle - and it removes
# the `object-position` guesswork that a portrait needs to clear the crown.
#
# The window is a 1040px square on the 1456x1456 master, placed so the eye line
# sits at 42% of the diameter and the face is centred on it: standard headshot
# framing, which keeps clearance above the hair and holds the collar and lapels
# at the bottom of the circle.
CROP_BOX = (265, 153, 1305, 1193)

VARIANTS = [
    {"width": 160, "jpg_name": "profile-pic-160.jpg", "webp_name": "profile-pic-160.webp"},
    {"width": 360, "jpg_name": "profile-pic-360.jpg", "webp_name": "profile-pic-360.webp"},
    {"width": 725, "jpg_name": "profile-pic.jpeg", "webp_name": "profile-pic.webp"},
]

JPEG_QUALITY = 88
WEBP_QUALITY = 86

# Lanczos downscaling softens edge detail; a light unsharp pass restores it
# without the halos a stronger radius would leave around the shoulder line.
UNSHARP = ImageFilter.UnsharpMask(radius=0.8, percent=60, threshold=3)


def generate_profile_pics():
    if not SOURCE_IMAGE_PATH.exists():
        print(f"[ERROR] Source image not found at: {SOURCE_IMAGE_PATH}")
        return False

    print(f"Opening source image: {SOURCE_IMAGE_PATH}")
    with Image.open(SOURCE_IMAGE_PATH) as img:
        print(f"Source size: {img.size}, mode: {img.mode}, format: {img.format}")

        if img.mode != "RGB":
            img = img.convert("RGB")

        left, top, right, bottom = CROP_BOX
        if right > img.width or bottom > img.height:
            print(f"[ERROR] CROP_BOX {CROP_BOX} falls outside the {img.size} master")
            return False
        if (right - left) != (bottom - top):
            print(f"[ERROR] CROP_BOX {CROP_BOX} is not square")
            return False

        square = img.crop(CROP_BOX)
        print(f"Cropped to: {square.size}")

        for variant in VARIANTS:
            target = variant["width"]
            resized_img = square.resize((target, target), Image.Resampling.LANCZOS).filter(UNSHARP)

            # 1. Save JPEG
            jpg_path = FRONTEND_DIR / variant["jpg_name"]
            resized_img.save(
                jpg_path, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True
            )
            jpg_size_kb = jpg_path.stat().st_size / 1024
            print(f"Saved {variant['jpg_name']}: {target}x{target} ({jpg_size_kb:.1f} KB)")

            # 2. Save WebP
            webp_path = FRONTEND_DIR / variant["webp_name"]
            resized_img.save(webp_path, "WEBP", quality=WEBP_QUALITY, method=6)
            webp_size_kb = webp_path.stat().st_size / 1024
            print(f"Saved {variant['webp_name']}: {target}x{target} ({webp_size_kb:.1f} KB)")

    print("\n[SUCCESS] All profile picture variants successfully generated!")
    return True


if __name__ == "__main__":
    generate_profile_pics()
