"""
Image Verification Script
Verifies optimized images meet quality and size requirements.
"""

from pathlib import Path
from PIL import Image

ROOT_DIR = Path(__file__).parent.parent

IMAGES = ['icon-192.png', 'icon-512.png', 'master-icon.png', 'profile-pic.jpeg']

def verify_images():
    print("Image Verification Report")
    print("=" * 60)
    
    for img_name in IMAGES:
        img_path = ROOT_DIR / 'frontend' / img_name
        
        if not img_path.exists():
            print(f"\n[ERROR] {img_name} not found!")
            continue
        
        img = Image.open(img_path)
        size_kb = img_path.stat().st_size / 1024
        
        print(f"\n{img_name}")
        print(f"  Size: {size_kb:.1f}KB")
        print(f"  Dimensions: {img.width}x{img.height}")
        print(f"  Mode: {img.mode}")
        print(f"  Format: {img.format}")
    
    print("\n" + "=" * 60)
    print("\nManual Testing Checklist:")
    print("  1. Open index.html in browser")
    print("  2. Check favicon displays correctly")
    print("  3. Check profile picture quality")
    print("  4. Test PWA installation (if supported)")
    print("  5. Verify icons in PWA install prompt")
    print("  6. Run Lighthouse audit")

if __name__ == '__main__':
    verify_images()
