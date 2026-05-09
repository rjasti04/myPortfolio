# Design Token Reference Guide

## Overview
This guide documents the standardized design tokens implemented for consistent styling across the application.

---

## 🎨 Color Tokens

### **Accent Colors**
```css
--accent-fill: hsl(348, 79%, 50%)      /* Primary accent for buttons, highlights */
--accent-text: hsl(348, 79%, 40%)      /* Accent for text and icons */
--accent-hover: hsl(348, 79%, 35%)     /* Hover state for accent elements */
--accent-soft: hsl(348, 79%, 50%, 0.12) /* Subtle backgrounds */
--accent-mild: hsl(348, 79%, 50%, 0.58) /* Medium opacity accents */
```

### **Text Colors**
```css
--text: #0f172a           /* Primary text color */
--muted: #3f4b5a          /* Secondary text (WCAG AA compliant) */
--on-accent: #fff         /* Text on accent backgrounds */
```

### **Status Colors**
```css
--color-success: #047857  /* Success states */
--color-warning: #b45309  /* Warning states */
--color-error: #be123c    /* Error states */
```

---

## 📏 Typography Scale

### **Font Sizes**
```css
--text-hero: clamp(32px, 8vw, 64px)  /* Hero headings */
--text-h2: 36px                       /* Section headings */
--text-h3: 24px                       /* Subsection headings */
--text-body-lg: 16px                  /* Large body text */
--text-body: 15px                     /* Standard body text */
--text-body-sm: 14px                  /* Small body text */
--text-body-xs: 13px                  /* Extra small text (min readable) */
```

### **Line Heights**
```css
--line-height-body: 1.65   /* Standard body text */
--line-height-large: 1.5   /* Large text and headings */
```

**Usage Example:**
```css
.description {
  font-size: var(--text-body);
  line-height: var(--line-height-body);
}
```

---

## 🌑 Shadows

### **Elevation Scale**
```css
--shadow-xs: 0 2px 8px hsl(0, 0%, 0%, 0.02)    /* Subtle lift */
--shadow-sm: 0 4px 15px hsl(0, 0%, 0%, 0.03)   /* Small cards */
--shadow-md: 0 8px 32px hsl(0, 0%, 0%, 0.04)   /* Medium cards */
--shadow-lg: 0 16px 48px hsl(0, 0%, 0%, 0.06)  /* Large modals */
--shadow-xl: 0 24px 64px hsl(0, 0%, 0%, 0.08)  /* Floating elements */
```

**Usage Guidelines:**
- Use `--shadow-xs` for subtle hover states
- Use `--shadow-sm` for small cards and buttons
- Use `--shadow-md` for main content cards
- Use `--shadow-lg` for modals and overlays
- Use `--shadow-xl` for floating action buttons

---

## 📐 Border Radius

### **Radius Scale**
```css
--radius-sm: 8px      /* Small elements (tags, badges) */
--radius-md: 12px     /* Medium elements (buttons, inputs) */
--radius-lg: 16px     /* Large elements (cards) */
--radius-xl: 20px     /* Extra large (sections, modals) */
--radius-full: 999px  /* Fully rounded (pills, avatars) */
```

**Usage Example:**
```css
.btn {
  border-radius: var(--radius-md);
}

.card {
  border-radius: var(--radius-lg);
}

.pill {
  border-radius: var(--radius-full);
}
```

---

## ⏱️ Motion & Timing

### **Duration**
```css
--motion-fast: 120ms      /* Quick interactions (hover) */
--motion-base: 180ms      /* Standard transitions */
--motion-medium: 240ms    /* Medium animations */
--motion-slow: 320ms      /* Slow, deliberate animations */
--motion-page: 200ms      /* Page transitions */
--motion-reveal: 520ms    /* Reveal animations */
```

### **Easing Functions**
```css
--ease-standard: cubic-bezier(0.2, 0, 0, 1)      /* Standard easing */
--ease-enter: cubic-bezier(0.22, 1, 0.36, 1)     /* Enter animations */
--ease-press: cubic-bezier(0.34, 1.2, 0.64, 1)   /* Button press */
```

**Usage Example:**
```css
.button {
  transition: 
    background-color var(--motion-base) var(--ease-standard),
    transform var(--motion-fast) var(--ease-press);
}
```

---

## 📱 Responsive

### **Touch Targets**
```css
--min-touch-target: 44px  /* Minimum size for interactive elements */
```

**Usage:**
```css
.interactive-element {
  min-width: var(--min-touch-target);
  min-height: var(--min-touch-target);
}
```

### **Header**
```css
--header-height: 72px     /* Desktop */
--header-height: 56px     /* Mobile (≤900px) */
```

---

## 🎭 Dark Theme Overrides

When `body.dark-theme` is active, these tokens are automatically overridden:

```css
--bg: #0a0a0b
--text: #fafaf9
--muted: #d4cfc8
--accent-fill: hsl(348, 100%, 68%)
--accent-text: hsl(348, 100%, 75%)
--accent-hover: hsl(348, 100%, 62%)
```

---

## 📋 Best Practices

### **DO:**
✅ Always use design tokens instead of hardcoded values
✅ Use semantic token names (e.g., `--text` not `--color-dark`)
✅ Maintain consistent spacing using the scale
✅ Test in both light and dark themes
✅ Verify WCAG contrast ratios

### **DON'T:**
❌ Create one-off custom values
❌ Use inline styles for colors or spacing
❌ Override tokens without good reason
❌ Mix token scales (e.g., using `--shadow-xl` on small elements)

---

## 🔄 Migration Guide

### **Replacing Old Values**

**Before:**
```css
.card {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  border-radius: 16px;
  transition: all 0.3s ease;
}
```

**After:**
```css
.card {
  box-shadow: var(--shadow-md);
  border-radius: var(--radius-lg);
  transition: 
    box-shadow var(--motion-base) var(--ease-standard),
    transform var(--motion-base) var(--ease-standard);
}
```

---

## 🎨 Color Contrast Reference

### **Light Theme**
| Combination | Ratio | WCAG Level |
|-------------|-------|------------|
| `--text` on `--bg` | 16.2:1 | AAA |
| `--muted` on `--bg` | 4.5:1 | AA |
| `--accent-text` on `--bg` | 7.8:1 | AAA |

### **Dark Theme**
| Combination | Ratio | WCAG Level |
|-------------|-------|------------|
| `--text` on `--bg` | 18.5:1 | AAA |
| `--muted` on `--bg` | 12.1:1 | AAA |
| `--accent-text` on `--bg` | 9.2:1 | AAA |

---

## 🛠️ Tools & Resources

### **Testing Contrast**
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [Coolors Contrast Checker](https://coolors.co/contrast-checker)

### **Visualizing Tokens**
- Browser DevTools CSS Variables inspector
- [CSS Variables Viewer Extension](https://chrome.google.com/webstore)

### **Animation Testing**
- Enable "Prefers Reduced Motion" in browser settings
- Use DevTools animation timeline

---

## 📝 Adding New Tokens

When adding new design tokens:

1. **Define in `:root`** - Add to the main token list
2. **Document here** - Update this guide
3. **Add dark theme override** - If color-related
4. **Test thoroughly** - Verify in all contexts
5. **Update components** - Replace hardcoded values

**Example:**
```css
:root {
  /* New token */
  --spacing-section: clamp(64px, 10vh, 96px);
}

/* Usage */
section + section {
  margin-top: var(--spacing-section);
}
```

---

## 🎯 Quick Reference

### **Most Common Tokens**

```css
/* Colors */
color: var(--text);
color: var(--muted);
background: var(--accent-fill);

/* Typography */
font-size: var(--text-body);
line-height: var(--line-height-body);

/* Spacing */
padding: 16px 24px;
gap: 16px;

/* Shadows */
box-shadow: var(--shadow-md);

/* Radius */
border-radius: var(--radius-lg);

/* Motion */
transition: all var(--motion-base) var(--ease-standard);
```

---

## 🔗 Related Documentation

- [UI/UX Improvements](./UI_UX_IMPROVEMENTS.md)
- [Accessibility Guidelines](./README.md#accessibility)
- [Component Library](./COMPONENTS.md) *(if exists)*

---

**Last Updated**: 2024
**Maintained By**: Development Team
