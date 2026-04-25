import re

# -------------
# 1. REFACOR CSS
# -------------
with open('styles.css', 'r', encoding='utf-8') as f:
    css = f.read()

# Add new variables to :root
root_addition = """
  /* Status Colors */
  --color-success: #34d399;
  --color-warning: #f59e0b;
  --color-error: #fb7185;
  --color-matrix: #39ff14;
  
  /* Typography Scale */
  --text-hero: clamp(32px, 8vw, 64px);
  --text-h2: 36px;
  --text-h3: 24px;
  --text-body-lg: 16px;
  --text-body: 15px;
  --text-body-sm: 14px;
  --text-body-xs: 12px;
  
  /* Elevation Shadows */
  --shadow-sm: 0 4px 15px rgba(0, 0, 0, 0.03);
  --shadow-md: 0 8px 32px rgba(0, 0, 0, 0.04);
"""
if '--color-success:' not in css:
    css = css.replace('--terminal-green: #fbbf24;\n}', '--terminal-green: #fbbf24;\n' + root_addition + '}')

# Replace hardcoded hex colors
hex_map = {
    r'#fb7185': 'var(--color-error)',
    r'#f59e0b': 'var(--color-warning)',
    r'#34d399': 'var(--color-success)',
    r'#35d07f': 'var(--color-success)',
    r'#ff4d4d': 'var(--color-error)',
    r'#f43f5e': 'var(--color-error)',
    r'#39ff14': 'var(--color-matrix)',
    r'#fbbf24': 'var(--terminal-green)',
}

for hex_code, var_name in hex_map.items():
    css = re.sub(hex_code, var_name, css, flags=re.IGNORECASE)

# Typography replacements
css = re.sub(r'font-size:\s*clamp\(32px,\s*8vw,\s*64px\);', 'font-size: var(--text-hero);', css)
css = re.sub(r'font-size:\s*36px;', 'font-size: var(--text-h2);', css)
css = re.sub(r'font-size:\s*24px;', 'font-size: var(--text-h3);', css)
css = re.sub(r'font-size:\s*16px;', 'font-size: var(--text-body-lg);', css)
css = re.sub(r'font-size:\s*15px;', 'font-size: var(--text-body);', css)
css = re.sub(r'font-size:\s*14px;', 'font-size: var(--text-body-sm);', css)
css = re.sub(r'font-size:\s*12px;', 'font-size: var(--text-body-xs);', css)

# Glassmorphism DRY - Instead of removing, just group them
css = re.sub(r'\s*backdrop-filter:\s*blur\(24px\);\s*-webkit-backdrop-filter:\s*blur\(24px\);', '', css)

utility = """
/* Utility Classes */
nav, .item, .skill-group, .ai-layout, .activity-table-container {
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
}
"""
if 'nav, .item, .skill-group' not in css:
    css = css.replace('/* Main Content */', utility + '\n/* Main Content */')

# Add activity pagination classes
activity_classes = """
.activity-pagination-wrapper {
  display: flex;
  justify-content: space-between;
  margin-top: 20px;
  align-items: center;
}
.activity-pagination-btn {
  padding: 6px 14px;
  font-size: var(--text-body-sm);
}
.activity-page-info {
  font-size: var(--text-body-sm);
  color: var(--muted);
}
"""
if '.activity-pagination-wrapper' not in css:
    css += activity_classes

with open('styles.css', 'w', encoding='utf-8') as f:
    f.write(css)

# -------------
# 2. REFACOR HTML
# -------------
with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Replace inline styles in activity pagination
html = html.replace(
    'style="display: none; justify-content: space-between; margin-top: 20px; align-items: center;"',
    'class="activity-pagination-wrapper" style="display: none;"'
)
html = html.replace(
    'class="btn btn-outline" style="padding: 6px 14px; font-size: 13px;"',
    'class="btn btn-outline activity-pagination-btn"'
)
html = html.replace(
    'style="font-size: 13px; color: var(--muted);"',
    'class="activity-page-info"'
)

# Replace <div class="activity-pagination" id="activity-pagination" class="activity-pagination-wrapper" style="display: none;">
# wait, the previous replace will produce:
# <div class="activity-pagination" id="activity-pagination" class="activity-pagination-wrapper" style="display: none;">
# HTML handles multiple class attributes poorly, so let's do a better replace:

html = re.sub(
    r'<div class="activity-pagination" id="activity-pagination"\s*style="display: none; justify-content: space-between; margin-top: 20px; align-items: center;">',
    '<div class="activity-pagination activity-pagination-wrapper" id="activity-pagination" style="display: none;">',
    html
)
# (Re-read to start clean HTML transform to avoid double class)
with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

html = html.replace(
    '<div class="activity-pagination" id="activity-pagination"\n            style="display: none; justify-content: space-between; margin-top: 20px; align-items: center;">',
    '<div class="activity-pagination activity-pagination-wrapper" id="activity-pagination" style="display: none;">'
)
html = html.replace(
    'class="btn btn-outline" style="padding: 6px 14px; font-size: 13px;"',
    'class="btn btn-outline activity-pagination-btn"'
)
html = html.replace(
    'style="font-size: 13px; color: var(--muted);"',
    'class="activity-page-info"'
)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print("Refactoring complete!")
