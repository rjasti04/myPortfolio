"""
Image Optimization Script for Phase 2
Optimizes PNG and JPEG images to reduce file sizes while maintaining quality.
"""

import os
from pathlib import Path
from PIL import Image
import shutil
from datetime import datetime
import io

# Project root directory
ROOT_DIR = Path(__file__).parent.parent

# Images to optimize with target sizes (in KB)
IMAGES_TO_OPTIMIZE = {
    'icon-192.png': {'target_kb': 50, 'quality': 85},
    'icon-512.png': {'target_kb': 100, 'quality': 85},
    'master-icon.png': {'target_kb': 100, 'quality': 85},
    'profile-pic.jpeg': {'target_kb': 150, 'quality': 80},
}

def create_backup():
    """Create backup directory and copy original images."""
    backup_dir = ROOT_DIR / 'backups' / f'images_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
    backup_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"Creating backup in: {backup_dir}")
    
    for image_name in IMAGES_TO_OPTIMIZE.keys():
        src = ROOT_DIR / image_name
        if src.exists():
            dst = backup_dir / image_name
            shutil.copy2(src, dst)
            print(f"  [OK] Backed up: {image_name}")
    
    return backup_dir

def get_file_size_kb(filepath):
    """Get file size in KB."""
    return os.path.getsize(filepath) / 1024

def optimize_png(img, image_path):
    """Optimize PNG with quantization."""
    # Convert to RGB if needed, then quantize
    if img.mode in ('RGBA', 'LA'):
        # Quantize with alpha channel
        img = img.quantize(colors=256, method=2)
    elif img.mode != 'P':
        img = img.convert('RGB').quantize(colors=256, method=2)
    
    # Save with optimization
    img.save(image_path, 'PNG', optimize=True)
    return get_file_size_kb(image_path)

def optimize_jpeg(img, image_path, quality):
    """Optimize JPEG with quality setting."""
    # Convert RGBA to RGB
    if img.mode in ('RGBA', 'LA', 'P'):
        rgb_img = Image.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        if 'A' in img.mode:
            rgb_img.paste(img, mask=img.split()[-1])
        else:
            rgb_img.paste(img)
        img = rgb_img
    elif img.mode != 'RGB':
        img = img.convert('RGB')
    
    # Save with optimization
    img.save(image_path, 'JPEG', optimize=True, quality=quality, progressive=True)
    return get_file_size_kb(image_path)

def optimize_image(image_path, target_kb, quality):
    """Optimize image to target size."""
    img = Image.open(image_path)
    
    if image_path.suffix.lower() == '.png':
        return optimize_png(img, image_path)
    elif image_path.suffix.lower() in ['.jpg', '.jpeg']:
        return optimize_jpeg(img, image_path, quality)
    
    return get_file_size_kb(image_path)

def main():
    """Main optimization process."""
    print("Starting Image Optimization - Phase 2\n")
    
    # Create backup
    backup_dir = create_backup()
    print(f"\n[SUCCESS] Backup complete: {backup_dir}\n")
    
    # Optimize images
    print("Optimizing images...\n")
    results = []
    
    for image_name, config in IMAGES_TO_OPTIMIZE.items():
        image_path = ROOT_DIR / image_name
        
        if not image_path.exists():
            print(f"  [WARNING] Skipped: {image_name} (not found)")
            continue
        
        original_size = get_file_size_kb(image_path)
        
        # Optimize
        new_size = optimize_image(image_path, config['target_kb'], config['quality'])
        
        reduction = original_size - new_size
        reduction_pct = (reduction / original_size) * 100
        
        results.append({
            'name': image_name,
            'original': original_size,
            'new': new_size,
            'reduction': reduction,
            'reduction_pct': reduction_pct
        })
        
        print(f"  [OK] {image_name}")
        print(f"    {original_size:.1f}KB -> {new_size:.1f}KB (-{reduction:.1f}KB, -{reduction_pct:.1f}%)")
    
    # Summary
    print("\n" + "="*60)
    print("OPTIMIZATION SUMMARY")
    print("="*60)
    
    total_original = sum(r['original'] for r in results)
    total_new = sum(r['new'] for r in results)
    total_reduction = total_original - total_new
    total_reduction_pct = (total_reduction / total_original) * 100
    
    print(f"\nTotal size reduction: {total_reduction:.1f}KB ({total_reduction_pct:.1f}%)")
    print(f"Original total: {total_original:.1f}KB")
    print(f"New total: {total_new:.1f}KB")
    
    print("\n[SUCCESS] Phase 2 optimization complete!")
    print(f"\nNext steps:")
    print("  1. Test PWA installation with new icons")
    print("  2. Verify visual quality in browser")
    print("  3. Run Lighthouse to measure improvement")
    print(f"\nBackup location: {backup_dir}")

if __name__ == '__main__':
    main()
