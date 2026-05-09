# Critical CSS Extraction Guide

## Overview
Extract above-the-fold CSS to inline in `<head>` for faster First Contentful Paint.

## Tools

### Option 1: Critical (Automated)
```bash
npm install -g critical

critical index.html --base . --inline --minify > critical.css
```

### Option 2: Manual Extraction
1. Open Chrome DevTools
2. Go to Coverage tab (Cmd+Shift+P → "Show Coverage")
3. Reload page
4. Identify CSS used for above-the-fold content
5. Extract rules for:
   - Header/navigation
   - Hero section
   - Stats grid
   - Base typography
   - Layout containers

## Critical Selectors (Priority)
```css
/* Base */
:root { /* CSS variables */ }
*, *::before, *::after { box-sizing: border-box; }
body { /* base styles */ }

/* Layout */
.layout { /* main layout */ }
header { /* sticky header */ }
main { /* main content */ }

/* Hero Section */
.hero { /* hero grid */ }
.hero-title { /* main heading */ }
.hero-description { /* intro text */ }
.hero-buttons { /* CTA buttons */ }

/* Stats */
.stats-grid { /* stats layout */ }
.stat-card { /* stat cards */ }

/* Navigation */
nav { /* nav styles */ }
nav a { /* nav links */ }
```

## Implementation Steps

1. **Extract Critical CSS**
   ```bash
   # Using Critical tool
   critical index.html --inline --minify
   ```

2. **Inline in HTML**
   ```html
   <head>
     <style>
       /* Critical CSS here */
     </style>
     <link rel="preload" href="styles.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
     <noscript><link rel="stylesheet" href="styles.css"></noscript>
   </head>
   ```

3. **Async Load Full CSS**
   - Use `media="print"` trick or `rel="preload"`
   - Swap to `rel="stylesheet"` after load

## Expected Impact
- **FCP**: -200ms to -400ms
- **LCP**: -150ms to -300ms
- **Lighthouse**: +5 to +10 points

## Testing
```bash
# Before
lighthouse https://rajeevjasti.com --view

# After
lighthouse https://rajeevjasti.com --view
```

## Notes
- Keep critical CSS < 14KB (TCP slow-start)
- Update when layout changes
- Test on mobile viewport
