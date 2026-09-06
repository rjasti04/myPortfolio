function hexToHsl(hex) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
  let r = parseInt(hex.substring(0, 2), 16) / 255;
  let g = parseInt(hex.substring(2, 4), 16) / 255;
  let b = parseInt(hex.substring(4, 6), 16) / 255;

  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    let d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function getLuminance(r, g, b) {
  let [rL, gL, bL] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
}

function hexToRgb(hex) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
  return [
    parseInt(hex.substring(0, 2), 16),
    parseInt(hex.substring(2, 4), 16),
    parseInt(hex.substring(4, 6), 16)
  ];
}

function getContrast(hex1, hex2) {
  let rgb1 = hexToRgb(hex1);
  let rgb2 = hexToRgb(hex2);
  let l1 = getLuminance(rgb1[0], rgb1[1], rgb1[2]);
  let l2 = getLuminance(rgb2[0], rgb2[1], rgb2[2]);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function hslToHex(h, s, l) {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const value = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * value).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase();
}

// ── Randomiser ──
// Three hues this far apart on the wheel read as having been chosen together.
// Three INDEPENDENTLY random hues do not - that is the whole difference
// between a shuffle worth pressing twice and one that mostly produces noise.
// Each entry is a set of offsets in degrees from one random base hue.
const SHUFFLE_HARMONIES = [
  [0, 28, -28],    // analogous - three neighbours, the calmest result
  [0, 120, 240],   // triad - evenly spaced, the most energetic
  [0, 150, 210],   // split complementary - a base against two near-opposites
  [0, 35, 180]     // accented analogous - a close pair plus one opposite
];

// Saturation and lightness are deliberately NOT random across their full
// range, because the picked colour is not what ships: `generateVariants`
// derives a text, hover, soft and mild variant from it for BOTH themes, and
// the source has to survive all of that. Above ~60% lightness the light
// theme's text variant (l - 15) stops clearing its background; below ~40% the
// dark theme's fills go to mud. The site's own defaults sit at l 30-50, so
// this band is a slightly conservative version of the same territory.
// Saturation starts high enough to read as a deliberate accent rather than a
// grey that went slightly wrong.
const SHUFFLE_SATURATION = [58, 88];
const SHUFFLE_LIGHTNESS = [42, 58];

// Minimum and maximum hue rotation from the palette already on screen. The
// floor is the point: a shuffle that lands 10 degrees from where it started
// looks like a button that does nothing, and the fix is to make "somewhere
// else on the wheel" a guarantee rather than a probability.
const SHUFFLE_MIN_ROTATION = 40;
const SHUFFLE_MAX_ROTATION = 320;

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * A fresh primary/secondary/highlight triple, related by one of the harmonies
 * above and constrained to the bands the variant generator can work with.
 *
 * @param {string} [currentPrimaryHex] the primary currently in the picker, so
 *   the new base hue can be guaranteed to land somewhere visibly different.
 * @returns {{primary: string, secondary: string, accent: string}} uppercase
 *   six-digit hex, one per control.
 */
export function randomPalette(currentPrimaryHex) {
  const currentHue = currentPrimaryHex ? hexToHsl(currentPrimaryHex)[0] : null;
  const rotation = randomInt(SHUFFLE_MIN_ROTATION, SHUFFLE_MAX_ROTATION);
  const base = currentHue === null ? randomInt(0, 359) : (currentHue + rotation) % 360;

  const harmony = SHUFFLE_HARMONIES[randomInt(0, SHUFFLE_HARMONIES.length - 1)];
  const [primary, secondary, accent] = harmony.map((offset) =>
    hslToHex(
      (base + offset + 360) % 360,
      randomInt(SHUFFLE_SATURATION[0], SHUFFLE_SATURATION[1]),
      randomInt(SHUFFLE_LIGHTNESS[0], SHUFFLE_LIGHTNESS[1])
    )
  );

  return { primary, secondary, accent };
}

function generateVariants(primaryHex, isDark) {
  const [h, s, l] = hexToHsl(primaryHex);
  
  // Decide best text color against this fill
  const contrastWithWhite = getContrast(primaryHex, '#ffffff');
  const contrastWithBlack = getContrast(primaryHex, '#000000');
  const onColor = contrastWithWhite > contrastWithBlack ? '#ffffff' : '#000000';
  
  let fillL = l;
  // Use a gentler lightness boost in dark mode to retain color vibrancy and avoid making text/button backgrounds pale.
  let textL = isDark ? Math.min(l + 5, 80) : Math.max(l - 15, 10);
  let hoverL = isDark ? Math.max(l - 10, 10) : Math.max(l - 10, 10);
  
  return {
    fill: `hsl(${h}, ${s}%, ${fillL}%)`,
    text: `hsl(${h}, ${s}%, ${textL}%)`,
    hover: `hsl(${h}, ${s}%, ${hoverL}%)`,
    soft: `hsla(${h}, ${s}%, ${fillL}%, 0.15)`,
    mild: `hsla(${h}, ${s}%, ${fillL}%, 0.58)`,
    on: onColor
  };
}

function applyPaletteVariables(palette, isDark) {
  if (!palette) return;
  const modeColors = isDark ? palette.dark : palette.light;
  if (!modeColors) return;
  
  document.body.style.removeProperty('--text');
  for (const [key, value] of Object.entries(modeColors)) {
    if (key === '--text') continue;
    document.body.style.setProperty(key, value);
  }
}

function clearCustomPalette() {
  const vars = [
    '--accent-fill', '--accent-text', '--accent-hover', '--accent-soft', '--accent-mild', '--on-accent',
    '--secondary-fill', '--secondary-text',
    '--data-fill', '--data-text', '--text',
    '--bg', '--surface', '--card-bg', '--skill-bg', '--border', '--bg-gradient'
  ];
  vars.forEach(v => document.body.style.removeProperty(v));
}

// Function to trigger on theme switch (dark/light)
export function reapplyCustomTheme(isDark) {
  const saved = localStorage.getItem('rj_theme_palette');
  if (saved) {
    try {
      const palette = JSON.parse(saved);
      applyPaletteVariables(palette, isDark);
    } catch(e) {}
  }
}

export function initThemeCustomizer() {
  const paletteBtn = document.getElementById('palette-toggle');
  const customizerDropdown = document.getElementById('theme-customizer-dropdown');
  const applyBtn = document.getElementById('theme-customizer-apply');
  const resetBtn = document.getElementById('theme-customizer-reset');
  const shuffleBtn = document.getElementById('theme-customizer-shuffle');
  const shuffleStatus = document.getElementById('theme-customizer-status');

  if (!paletteBtn || !customizerDropdown) return;

  const defaultColors = {
    primary: '#F59E0B',
    secondary: '#10B981',
    accent: '#0284C7'
  };

  const colorLabels = {
    primary: 'Primary',
    secondary: 'Secondary',
    accent: 'Highlight'
  };

  const palettePresets = [
    '#C02645', '#D4A017', '#2ECDA7', '#0EA5E9', '#A855F7', '#6366F1',
    '#14B8A6', '#EC4899', '#F59E0B', '#84CC16', '#64748B', '#0F172A'
  ];

  const colorControls = {
    primary: document.getElementById('color-primary'),
    secondary: document.getElementById('color-secondary'),
    accent: document.getElementById('color-accent')
  };

  const hexDisplays = {
    primary: document.getElementById('hex-primary'),
    secondary: document.getElementById('hex-secondary'),
    accent: document.getElementById('hex-accent')
  };

  const customizerContent = customizerDropdown.querySelector('.customizer-content');
  const colorPopover = document.getElementById('theme-color-popover');
  const colorPopoverTitle = document.getElementById('color-popover-title');
  const colorPopoverPreview = document.getElementById('color-popover-preview');
  const colorPopoverHex = document.getElementById('color-popover-hex');
  const colorPopoverClose = document.getElementById('color-popover-close');
  const colorPopoverSwatches = document.getElementById('color-popover-swatches');
  let activeColorKey = null;

  function normalizeHex(value) {
    const raw = String(value || '').trim().replace(/^#/, '');
    if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) return null;
    const hex = raw.length === 3 ? raw.split('').map(char => char + char).join('') : raw;
    return `#${hex.toUpperCase()}`;
  }

  function getColorValue(key) {
    const stored = colorControls[key]?.dataset.colorValue;
    return normalizeHex(stored) || defaultColors[key];
  }

  function updateSelectedSwatches(value) {
    const normalized = normalizeHex(value);
    colorPopoverSwatches?.querySelectorAll('.color-swatch-option').forEach(button => {
      button.classList.toggle('is-selected', normalizeHex(button.dataset.color) === normalized);
    });
  }

  function setColorValue(key, value, { preview = false, syncPopover = true } = {}) {
    const normalized = normalizeHex(value);
    const control = colorControls[key];
    if (!normalized || !control) return false;

    control.dataset.colorValue = normalized;
    control.style.setProperty('--selected-color', normalized);
    if (hexDisplays[key]) hexDisplays[key].textContent = normalized;

    if (syncPopover && activeColorKey === key) {
      if (colorPopoverHex) colorPopoverHex.value = normalized;
      colorPopoverPreview?.style.setProperty('--selected-color', normalized);
      updateSelectedSwatches(normalized);
    }

    if (preview) previewPalette();
    return true;
  }

  function updateHexDisplays() {
    Object.keys(colorControls).forEach(key => {
      setColorValue(key, getColorValue(key), { syncPopover: false });
    });
  }

  function positionColorPopover(control) {
    if (!colorPopover || !customizerContent || !control) return;

    const contentRect = customizerContent.getBoundingClientRect();
    const controlRect = control.getBoundingClientRect();
    const popoverHeight = colorPopover.offsetHeight;
    const contentHeight = customizerContent.offsetHeight;
    const belowTop = controlRect.bottom - contentRect.top + 8;
    const aboveTop = controlRect.top - contentRect.top - popoverHeight - 8;
    const maxTop = Math.max(12, contentHeight - popoverHeight - 12);
    const canFitBelow = belowTop + popoverHeight <= contentHeight - 12;
    const nextTop = canFitBelow ? belowTop : Math.max(12, Math.min(aboveTop, maxTop));

    customizerContent.style.setProperty('--color-popover-top', `${nextTop}px`);
    colorPopover.style.visibility = '';
  }

  function closeColorPopover({ restoreFocus = false } = {}) {
    const activeControl = activeColorKey ? colorControls[activeColorKey] : null;
    activeColorKey = null;

    Object.values(colorControls).forEach(control => {
      control?.classList.remove('is-active');
      control?.setAttribute('aria-expanded', 'false');
    });

    if (colorPopover) {
      colorPopover.hidden = true;
      colorPopover.style.visibility = '';
    }

    if (restoreFocus) activeControl?.focus();
  }

  function openColorPopover(key) {
    const control = colorControls[key];
    if (!control || !colorPopover) return;

    Object.values(colorControls).forEach(item => {
      item?.classList.remove('is-active');
      item?.setAttribute('aria-expanded', 'false');
    });

    activeColorKey = key;
    const value = getColorValue(key);
    control.classList.add('is-active');
    control.setAttribute('aria-expanded', 'true');

    if (colorPopoverTitle) colorPopoverTitle.textContent = colorLabels[key];
    if (colorPopoverHex) {
      colorPopoverHex.value = value;
      colorPopoverHex.setAttribute('aria-invalid', 'false');
    }
    colorPopoverPreview?.style.setProperty('--selected-color', value);
    updateSelectedSwatches(value);

    colorPopover.hidden = false;
    colorPopover.style.visibility = 'hidden';
    positionColorPopover(control);

    // BUG FIX ROOT CAUSE: For keyboard accessibility, programmatically move focus to the text input
    // when popover opens, selecting its content for easy typing.
    if (colorPopoverHex) {
      colorPopoverHex.focus();
      colorPopoverHex.select();
    }
  }

  function loadDefaults() {
    const saved = localStorage.getItem('rj_theme_palette');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.raw) {
          setColorValue('primary', data.raw.primary || defaultColors.primary);
          setColorValue('secondary', data.raw.secondary || defaultColors.secondary);
          setColorValue('accent', data.raw.accent || defaultColors.accent);
        }
      } catch (e) {
        console.error("Invalid theme data");
      }
    } else {
      setColorValue('primary', defaultColors.primary);
      setColorValue('secondary', defaultColors.secondary);
      setColorValue('accent', defaultColors.accent);
    }
    updateHexDisplays();
  }

  paletteBtn.addEventListener('click', () => {
    loadDefaults();
    closeColorPopover();
    // Drop last session's shuffle announcement so re-opening the panel cannot
    // read out hex codes that are no longer in the controls.
    if (shuffleStatus) shuffleStatus.textContent = '';
  });

  const closeModal = () => {
    if (customizerDropdown) {
      customizerDropdown.classList.remove('is-open');
      paletteBtn.setAttribute('aria-expanded', 'false');
      customizerDropdown.querySelector('.header-dropdown-menu')?.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('dropdown-open');
    }
  };

  let wasOpen = false;
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'class') {
        const isOpen = customizerDropdown.classList.contains('is-open');
        if (wasOpen && !isOpen) {
          // Dropdown just closed (via click-outside, Escape, or Apply/Reset).
          // Re-apply saved palette to discard any unsaved previews.
          closeColorPopover();
          clearCustomPalette();
          const saved = localStorage.getItem('rj_theme_palette');
          if (saved) {
            try {
              applyPaletteVariables(JSON.parse(saved), document.body.classList.contains('dark-theme'));
            } catch (e) {
              localStorage.removeItem('rj_theme_palette');
            }
          }
        }
        wasOpen = isOpen;
      }
    });
  });
  observer.observe(customizerDropdown, { attributes: true });

  const getDerivedPalette = (rawPrimary, rawSecondary, rawAccent) => {
    const buildMode = (isDark) => {
      const primary = generateVariants(rawPrimary, isDark);
      const secondary = generateVariants(rawSecondary, isDark);
      const accent = generateVariants(rawAccent, isDark);
      
      const [ph, ps] = hexToHsl(rawPrimary);
      const [sh, ss] = hexToHsl(rawSecondary);
      
      const bgGradient = isDark
        ? `radial-gradient(ellipse at 20% 40%, hsl(${ph}, 25%, 7%) 0%, #0a0e14 50%, hsl(${sh}, 25%, 8%) 100%)`
        : `radial-gradient(ellipse at top left, #ffffff, hsl(${ph}, ${Math.min(ps, 55)}%, 95%) 35%, hsl(${sh}, ${Math.min(ss, 50)}%, 96%) 70%, #fdfdfd)`;
      
      const skillBg = isDark
        ? `hsl(${ph}, 20%, 14%, 0.72)`
        : `hsl(${ph}, 40%, 97%, 0.85)`;

      return {
        '--accent-fill': primary.fill,
        '--accent-text': primary.text,
        '--accent-hover': primary.hover,
        '--accent-soft': primary.soft,
        '--accent-mild': primary.mild,
        '--on-accent': primary.on,
        '--secondary-fill': secondary.fill,
        '--secondary-text': secondary.text,
        '--data-fill': accent.fill,
        '--data-text': accent.text,
        '--bg-gradient': bgGradient,
        '--skill-bg': skillBg,
      };
    };

    return {
      version: 1,
      raw: { primary: rawPrimary, secondary: rawSecondary, accent: rawAccent },
      light: buildMode(false),
      dark: buildMode(true)
    };
  };

  function previewPalette() {
    updateHexDisplays();
    const rawPrimary = getColorValue('primary');
    const rawSecondary = getColorValue('secondary');
    const rawAccent = getColorValue('accent');
    
    const palette = getDerivedPalette(rawPrimary, rawSecondary, rawAccent);
    applyPaletteVariables(palette, document.body.classList.contains('dark-theme'));
  }

  function buildPresetSwatches() {
    if (!colorPopoverSwatches || colorPopoverSwatches.children.length) return;

    palettePresets.forEach(color => {
      const normalized = normalizeHex(color);
      if (!normalized) return;

      const button = document.createElement('button');
      const chip = document.createElement('span');
      button.type = 'button';
      button.className = 'color-swatch-option';
      button.dataset.color = normalized;
      button.setAttribute('aria-label', normalized);
      chip.className = 'color-swatch-chip';
      chip.style.setProperty('--selected-color', normalized);
      button.append(chip);
      colorPopoverSwatches.append(button);
    });
  }

  buildPresetSwatches();

  Object.entries(colorControls).forEach(([key, control]) => {
    control?.addEventListener('click', (event) => {
      event.stopPropagation();

      if (activeColorKey === key && !colorPopover?.hidden) {
        closeColorPopover({ restoreFocus: true });
        return;
      }

      openColorPopover(key);
    });
  });

  colorPopoverSwatches?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const swatch = target?.closest('.color-swatch-option');
    if (!swatch || !activeColorKey) return;

    setColorValue(activeColorKey, swatch.dataset.color, { preview: true });
  });

  colorPopoverHex?.addEventListener('input', () => {
    if (!activeColorKey) return;

    const normalized = normalizeHex(colorPopoverHex.value);
    if (!colorPopoverHex.value.trim()) {
      colorPopoverHex.setAttribute('aria-invalid', 'false');
      return;
    }

    if (!normalized) {
      colorPopoverHex.setAttribute('aria-invalid', 'true');
      return;
    }

    colorPopoverHex.setAttribute('aria-invalid', 'false');
    setColorValue(activeColorKey, normalized, { preview: true });
  });

  colorPopoverHex?.addEventListener('blur', () => {
    if (!activeColorKey || colorPopoverHex.getAttribute('aria-invalid') !== 'true') return;

    colorPopoverHex.value = getColorValue(activeColorKey);
    colorPopoverHex.setAttribute('aria-invalid', 'false');
  });

  colorPopoverClose?.addEventListener('click', () => {
    closeColorPopover({ restoreFocus: true });
  });

  colorPopover?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeColorPopover({ restoreFocus: true });
    }

    if (event.key === 'Enter' && event.target === colorPopoverHex) {
      const normalized = normalizeHex(colorPopoverHex.value);
      if (!normalized || !activeColorKey) return;

      event.preventDefault();
      setColorValue(activeColorKey, normalized, { preview: true });
      closeColorPopover({ restoreFocus: true });
    }
  });

  customizerDropdown.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !activeColorKey || colorPopover?.hidden) return;
    if (target.closest('.color-input-wrapper') || colorPopover?.contains(target)) return;

    closeColorPopover();
  });

  let customizerResizeTimeout;
  window.addEventListener('resize', () => {
    if (!activeColorKey || colorPopover?.hidden) return;
    
    // BUG FIX ROOT CAUSE: Calling layout calculations on every resize tick causes layout thrashing.
    // We debounce the calculation to reduce CPU load.
    clearTimeout(customizerResizeTimeout);
    customizerResizeTimeout = setTimeout(() => {
      if (activeColorKey && colorControls[activeColorKey]) {
        positionColorPopover(colorControls[activeColorKey]);
      }
    }, 100);
  });

  const themePresets = {
    matrix: { primary: '#03A062', secondary: '#10B981', accent: '#14B8A6' },
    nord: { primary: '#88C0D0', secondary: '#81A1C1', accent: '#A3BE8C' },
    dracula: { primary: '#BD93F9', secondary: '#FF79C6', accent: '#50FA7B' }
  };

  const presetButtons = customizerDropdown.querySelectorAll('.preset-btn');
  presetButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const presetKey = btn.dataset.preset;
      const colors = themePresets[presetKey];
      if (colors) {
        setColorValue('primary', colors.primary, { preview: false, syncPopover: false });
        setColorValue('secondary', colors.secondary, { preview: false, syncPopover: false });
        setColorValue('accent', colors.accent, { preview: true, syncPopover: false });
        closeColorPopover();
      }
    });
  });

  // Same shape as a preset click, and deliberately so: all three controls are
  // set with `preview: false` and only the last one previews, so the palette
  // is derived and applied ONCE rather than three times on the way to the
  // colours the user actually asked for.
  //
  // Like the presets and like a hand-typed hex, this is a preview and not a
  // commit - the MutationObserver above restores the saved palette if the
  // panel closes without Apply. Pressing the button repeatedly costs nothing.
  shuffleBtn?.addEventListener('click', (event) => {
    event.stopPropagation();

    const next = randomPalette(getColorValue('primary'));
    setColorValue('primary', next.primary, { preview: false, syncPopover: false });
    setColorValue('secondary', next.secondary, { preview: false, syncPopover: false });
    setColorValue('accent', next.accent, { preview: true, syncPopover: false });
    closeColorPopover();

    if (shuffleStatus) {
      shuffleStatus.textContent =
        `Random palette applied. Primary ${next.primary}, secondary ${next.secondary}, highlight ${next.accent}.`;
    }
  });

  applyBtn?.addEventListener('click', () => {
    const rawPrimary = getColorValue('primary');
    const rawSecondary = getColorValue('secondary');
    const rawAccent = getColorValue('accent');
    
    const palette = getDerivedPalette(rawPrimary, rawSecondary, rawAccent);
    localStorage.setItem('rj_theme_palette', JSON.stringify(palette));
    applyPaletteVariables(palette, document.body.classList.contains('dark-theme'));
    
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      const isDark = document.body.classList.contains('dark-theme');
      const accentColor = getComputedStyle(document.body).getPropertyValue('--accent-fill').trim();
      themeColorMeta.setAttribute("content", accentColor || (isDark ? "#0a0a0b" : "#F59E0B"));
    }
    
    closeModal();
  });

  resetBtn?.addEventListener('click', () => {
    localStorage.removeItem('rj_theme_palette');
    clearCustomPalette();
    
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      const isDark = document.body.classList.contains('dark-theme');
      const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-fill').trim();
      themeColorMeta.setAttribute("content", accentColor || (isDark ? "#0a0a0b" : "#F59E0B"));
    }
    
    closeModal();
  });
}
