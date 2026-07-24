"""
Profile Picture Generator Script
Generates optimized JPEG and WebP images in multiple resolutions (160w, 360w, 725w)
from the source image located on the desktop.
"""

import os
from pathlib import Path
from PIL import Image

ROOT_DIR = Path(__file__).parent.parent
SOURCE_IMAGE_PATH = Path(r"C:\Users\inbox_inm6dkz\OneDrive\Desktop\rj_profile_pic.jpg")
FRONTEND_DIR = ROOT_DIR / "frontend"

VARIANTS = [
    {"width": 160, "jpg_name": "profile-pic-160.jpg", "webp_name": "profile-pic-160.webp"},
    {"width": 360, "jpg_name": "profile-pic-360.jpg", "webp_name": "profile-pic-360.webp"},
    {"width": 725, "jpg_name": "profile-pic.jpeg", "webp_name": "profile-pic.webp"},
]

def generate_profile_pics():
    if not SOURCE_IMAGE_PATH.exists():
        print(f"[ERROR] Source image not found at: {SOURCE_IMAGE_PATH}")
        return False

    print(f"Opening source image: {SOURCE_IMAGE_PATH}")
    with Image.open(SOURCE_IMAGE_PATH) as img:
        print(f"Source size: {img.size}, mode: {img.mode}, format: {img.format}")

        if img.mode != "RGB":
            img = img.convert("RGB")

        orig_w, orig_h = img.size
        aspect_ratio = orig_h / orig_w

        for variant in VARIANTS:
            target_w = variant["width"]
            target_h = int(round(target_w * aspect_ratio))
            
            resized_img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
            
            # 1. Save JPEG
            jpg_path = FRONTEND_DIR / variant["jpg_name"]
            resized_img.save(jpg_path, "JPEG", quality=85, optimize=True, progressive=True)
            jpg_size_kb = jpg_path.stat().st_size / 1024
            print(f"Saved {variant['jpg_name']}: {target_w}x{target_h} ({jpg_size_kb:.1f} KB)")

            # 2. Save WebP
            webp_path = FRONTEND_DIR / variant["webp_name"]
            resized_img.save(webp_path, "WEBP", quality=82, method=6)
            webp_size_kb = webp_path.stat().st_size / 1024
            print(f"Saved {variant['webp_name']}: {target_w}x{target_h} ({webp_size_kb:.1f} KB)")

    print("\n[SUCCESS] All profile picture variants successfully generated!")
    return True

if __name__ == "__main__":
    generate_profile_pics()
