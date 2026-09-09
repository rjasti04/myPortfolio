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

// The palette the site ships with. Mirrors the --accent-fill / --secondary-fill
// / --data-fill tokens in styles.css, which are what the page paints when no
// custom palette is stored; the picker reports these, so the two have to agree.
const DEFAULT_COLORS = {
  primary: '#C5CF3F',
  secondary: '#3C82DD',
  accent: '#830FDB'
};

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

/**
 * The full CSS-custom-property set for one primary/secondary/highlight triple,
 * derived for both themes. Module scope rather than inside the panel's
 * initialiser because the home page's shuffle needs it too and it closes over
 * nothing but the helpers above.
 *
 * @returns {{version: number, raw: object, light: object, dark: object}}
 */
function getDerivedPalette(rawPrimary, rawSecondary, rawAccent) {
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
}

// ── The palette that is showing but is not saved ──
// A roll from the home page's shuffle, or from the panel's, is a PREVIEW: it
// paints immediately and it is gone on reload. Holding it here rather than in
// localStorage is what makes that true, and it is module state rather than
// closure state because three things have to agree about it - the home button
// that sets it, the panel that has to open showing it (otherwise Apply would
// save colours the visitor never saw), and `reapplyCustomTheme`, which would
// otherwise wipe the roll the moment someone flipped light/dark.
//
// The panel narrows what "gone" means: cancelling it rolls this back to what
// it held when the panel opened, not to the saved palette, so a roll survives
// being looked at. See `paletteOnOpen` in `initThemeCustomizer`.
let unsavedRawPalette = null;

function readSavedPalette() {
  // The read is INSIDE the try. It used to sit outside it, guarding only the
  // parse - but `getItem` itself throws where storage is blocked (Safari with
  // "Block All Cookies", strict privacy extensions), and this is reached from
  // applyTheme via reapplyCustomTheme on the very first init. That throw took
  // out the whole DOMContentLoaded sequence. readThemeLibrary below already
  // had it the right way round.
  try {
    const saved = localStorage.getItem('rj_theme_palette');
    if (!saved) return null;
    return JSON.parse(saved);
  } catch (e) {
    return null;
  }
}

/**
 * Copy the live accent into the `theme-color` meta tag - what the mobile
 * browser paints its toolbar with, and what tints the top bar of the installed
 * PWA.
 *
 * This is called from the two functions that paint the palette rather than
 * from their call sites because every one of those paths has to move the bar:
 * a roll from the home page, a preview inside the panel, the rollback when the
 * panel is cancelled, Apply, Reset, and a light/dark flip. The tag is a plain
 * DOM attribute that nothing re-derives from the custom properties, so
 * whatever was written last simply stays there - which is why a randomised
 * palette used to leave the bar on the previous colour until Apply.
 *
 * The manifest `theme_color` is not a fallback for this. It is one static
 * value read at install time, and it only reaches the surfaces JS cannot touch
 * anyway (the launch splash, the task switcher).
 */
export function syncThemeColorMeta(isDark = document.body.classList.contains('dark-theme')) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  // Read off <body>, not the root element: the dark variants are declared on
  // `body.dark-theme` and the customizer sets its inline properties there too,
  // so the root still resolves to the LIGHT accent on a dark page.
  const accentColor = getComputedStyle(document.body).getPropertyValue('--accent-fill').trim();
  meta.setAttribute('content', accentColor || (isDark ? '#0a0a0b' : '#C5CF3F'));
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

  syncThemeColorMeta(isDark);
}

function clearCustomPalette() {
  const vars = [
    '--accent-fill', '--accent-text', '--accent-hover', '--accent-soft', '--accent-mild', '--on-accent',
    '--secondary-fill', '--secondary-text',
    '--data-fill', '--data-text', '--text',
    '--bg', '--surface', '--card-bg', '--skill-bg', '--border', '--bg-gradient'
  ];
  vars.forEach(v => document.body.style.removeProperty(v));
  syncThemeColorMeta();
}

// Function to trigger on theme switch (dark/light)
export function reapplyCustomTheme(isDark) {
  // An unsaved roll outranks the saved palette here. The two variant sets are
  // derived per theme, so flipping light/dark has to re-derive SOMETHING - and
  // if that something were always the saved palette, every roll from the home
  // page would be destroyed by the theme toggle rather than by a reload.
  if (unsavedRawPalette) {
    const { primary, secondary, accent } = unsavedRawPalette;
    applyPaletteVariables(getDerivedPalette(primary, secondary, accent), isDark);
    return;
  }

  const palette = readSavedPalette();
  if (palette) applyPaletteVariables(palette, isDark);
}

/**
 * Roll a new palette and paint it, WITHOUT persisting it.
 *
 * This is what the landing view's shuffle does, and not persisting is the
 * whole design: a visitor who presses it out of curiosity gets their colours
 * back by reloading, rather than having to find Reset inside a header
 * dropdown. Keeping a roll is a deliberate second act - open the panel, where
 * the controls are already filled with what is on screen, and press Apply.
 * Opening that panel and closing it again is not an answer either way: the
 * roll is still there afterwards, exactly as it was.
 *
 * @returns {{primary: string, secondary: string, accent: string}} the roll.
 */
export function applyRandomTheme() {
  const current = unsavedRawPalette?.primary
    || readSavedPalette()?.raw?.primary
    || DEFAULT_COLORS.primary;

  const rolled = randomPalette(current);
  unsavedRawPalette = rolled;
  applyPaletteVariables(
    getDerivedPalette(rolled.primary, rolled.secondary, rolled.accent),
    document.body.classList.contains('dark-theme')
  );
  return rolled;
}

// ── Saved themes ──
// A visitor's own named palettes, in localStorage beside the active one. No
// account and no server: the site's auth exists for the owner's dashboard, so
// gating this behind a login would hide it from everyone who actually uses the
// page. The cost is honest and worth stating - these live in ONE browser, and
// clearing site data takes them with it.
const THEME_LIBRARY_KEY = 'rj_theme_library';

// Twelve is a row of chips that still wraps to something readable inside a
// 276px panel, not a storage limit; localStorage would hold thousands.
export const THEME_LIBRARY_LIMIT = 12;
export const THEME_NAME_MAX = 24;

/**
 * Every saved theme, oldest first. Never throws: a corrupt or hand-edited
 * value reads as an empty library rather than taking the panel down with it,
 * and entries that do not carry three usable hexes are dropped.
 */
export function readThemeLibrary() {
  let parsed;
  try {
    parsed = JSON.parse(localStorage.getItem(THEME_LIBRARY_KEY) || '[]');
  } catch (e) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((entry) => entry && typeof entry.name === 'string' && entry.raw
      && ['primary', 'secondary', 'accent'].every((k) => /^#[0-9a-fA-F]{6}$/.test(entry.raw[k] || '')))
    .slice(0, THEME_LIBRARY_LIMIT);
}

function writeThemeLibrary(entries) {
  try {
    localStorage.setItem(THEME_LIBRARY_KEY, JSON.stringify(entries.slice(0, THEME_LIBRARY_LIMIT)));
    return true;
  } catch (e) {
    // A full or blocked quota (private browsing, storage disabled). The panel
    // reports this rather than pretending the save worked.
    return false;
  }
}

/**
 * Save a named palette, or replace the one already under that name.
 *
 * Overwrite rather than duplicate: two chips reading "Sunset" tell the visitor
 * nothing about which is which, and re-saving under a name you already used is
 * far more likely to mean "update it" than "make a second one".
 *
 * The id comes back because the caller has to keep pointing at the theme it
 * just wrote - the panel marks it as the one being edited, and on an overwrite
 * that is the ORIGINAL id, not the one minted here.
 *
 * @returns {{ok: true, entries: object[], replaced: boolean, id: string}
 *   | {ok: false, reason: string}}
 */
export function saveTheme(name, raw) {
  const trimmed = String(name || '').trim().slice(0, THEME_NAME_MAX);
  if (!trimmed) return { ok: false, reason: 'empty' };

  const entries = readThemeLibrary();
  const at = entries.findIndex((entry) => entry.name.toLowerCase() === trimmed.toLowerCase());
  if (at === -1 && entries.length >= THEME_LIBRARY_LIMIT) return { ok: false, reason: 'full' };

  const entry = { id: `t${Date.now().toString(36)}`, name: trimmed, raw: { ...raw } };
  if (at === -1) entries.push(entry);
  else entries[at] = { ...entry, id: entries[at].id };
  const stored = at === -1 ? entry : entries[at];

  if (!writeThemeLibrary(entries)) return { ok: false, reason: 'storage' };
  return { ok: true, entries, replaced: at !== -1, id: stored.id };
}

/** Remove one saved theme by id. Returns the library that remains. */
export function deleteTheme(id) {
  const entries = readThemeLibrary().filter((entry) => entry.id !== id);
  writeThemeLibrary(entries);
  return entries;
}

/**
 * The landing view's shuffle. Separate from `initThemeCustomizer` because the
 * header panel and this button are independent DOM - the panel's initialiser
 * bails early when its dropdown is absent, and that must not take this with it.
 */
export function initHomeThemeShuffle() {
  const button = document.getElementById('home-theme-shuffle');
  const status = document.getElementById('home-theme-status');
  if (!button) return;

  button.addEventListener('click', () => {
    const rolled = applyRandomTheme();
    if (status) {
      status.textContent =
        `Theme randomized. Primary ${rolled.primary}, secondary ${rolled.secondary}, `
        + `highlight ${rolled.accent}. Open the palette panel and press Apply to keep it, `
        + 'or reload the page to restore the saved theme.';
    }
  });
}

export function initThemeCustomizer() {
  const paletteBtn = document.getElementById('palette-toggle');
  const customizerDropdown = document.getElementById('theme-customizer-dropdown');
  const applyBtn = document.getElementById('theme-customizer-apply');
  const resetBtn = document.getElementById('theme-customizer-reset');
  const shuffleBtn = document.getElementById('theme-customizer-shuffle');
  const shuffleStatus = document.getElementById('theme-customizer-status');
  const themeChips = document.getElementById('theme-chips');
  const saveBtn = document.getElementById('theme-customizer-save');
  const saveForm = document.getElementById('theme-save-form');
  const saveNameInput = document.getElementById('theme-save-name');
  const saveConfirmBtn = document.getElementById('theme-save-confirm');
  const saveCancelBtn = document.getElementById('theme-save-cancel');

  if (!paletteBtn || !customizerDropdown) return;

  const defaultColors = DEFAULT_COLORS;

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

  // Fill the controls with what the page is CURRENTLY painting, in priority
  // order: an unsaved roll from either shuffle, then the saved palette, then
  // the shipped defaults. The order matters - open the panel after rolling on
  // the landing view and the controls have to show that roll, or Apply would
  // quietly save a palette the visitor never saw.
  function loadDefaults() {
    const active = unsavedRawPalette || readSavedPalette()?.raw || defaultColors;
    setColorValue('primary', active.primary || defaultColors.primary);
    setColorValue('secondary', active.secondary || defaultColors.secondary);
    setColorValue('accent', active.accent || defaultColors.accent);
    updateHexDisplays();
  }

  paletteBtn.addEventListener('click', () => {
    loadDefaults();
    closeColorPopover();
    closeSaveForm();
    renderThemeLibrary();
    // Derived from the colours rather than remembered, so it survives a reload:
    // open the panel on a palette that IS one of the saved themes and that chip
    // is lit and Save offers to update it, exactly as if it had just been
    // clicked. An edit then keeps that theme loaded until something switches
    // away from it.
    setActiveTheme(themeIdMatchingControls());
    // Drop the last announcement so re-opening the panel cannot read out hex
    // codes, or a save confirmation, that no longer describe what is on screen.
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

  // What was on screen the moment the panel opened: a roll from the landing
  // view, an older preview, or nothing at all. Cancelling restores THIS rather
  // than the saved palette, because cancel means "undo what I did in here" -
  // and a roll made before the panel was ever opened was never the panel's to
  // throw away. Apply and Reset clear it, so neither is undone on the way out.
  let paletteOnOpen = null;

  function restorePaletteOnOpen() {
    unsavedRawPalette = paletteOnOpen;
    paletteOnOpen = null;
    clearCustomPalette();

    if (unsavedRawPalette) {
      const { primary, secondary, accent } = unsavedRawPalette;
      applyPaletteVariables(
        getDerivedPalette(primary, secondary, accent),
        document.body.classList.contains('dark-theme')
      );
      return;
    }

    const saved = readSavedPalette();
    if (saved) {
      applyPaletteVariables(saved, document.body.classList.contains('dark-theme'));
    } else {
      // Clearing a palette that failed to parse. Best-effort: the same blocked
      // storage that makes this necessary is what makes it throw.
      try {
        if (localStorage.getItem('rj_theme_palette')) localStorage.removeItem('rj_theme_palette');
      } catch (e) {
        /* storage unavailable - nothing to clean up that we can reach */
      }
    }
  }

  let wasOpen = false;
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'class') {
        const isOpen = customizerDropdown.classList.contains('is-open');
        if (!wasOpen && isOpen) {
          // Snapshot taken here rather than in the toggle's own click handler
          // so every way in is covered - the header button, and anything else
          // that adds `is-open`. Copied because it is a record of a past
          // moment, not a second name for the live palette.
          paletteOnOpen = unsavedRawPalette ? { ...unsavedRawPalette } : null;
        } else if (wasOpen && !isOpen) {
          // Dropdown just closed (via click-outside, Escape, or Apply/Reset).
          // Roll back to whatever the panel opened showing, which discards
          // every preview made inside it and leaves everything made before it
          // alone.
          closeColorPopover();
          restorePaletteOnOpen();
        }
        wasOpen = isOpen;
      }
    });
  });
  observer.observe(customizerDropdown, { attributes: true });

  function previewPalette() {
    updateHexDisplays();
    const rawPrimary = getColorValue('primary');
    const rawSecondary = getColorValue('secondary');
    const rawAccent = getColorValue('accent');

    // Recorded as the unsaved palette for the same reason a roll is: a
    // light/dark flip mid-edit must re-derive what the controls say, not throw
    // the edit away and repaint the saved palette.
    unsavedRawPalette = { primary: rawPrimary, secondary: rawSecondary, accent: rawAccent };
    const palette = getDerivedPalette(rawPrimary, rawSecondary, rawAccent);
    applyPaletteVariables(palette, document.body.classList.contains('dark-theme'));
    // Every path that changes a colour lands here, which makes it the one place
    // that can tell the loaded theme's chip it is now showing something the
    // saved theme does not hold.
    syncThemeChipState();
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

  /**
   * Load one triple into the three controls and paint it. All three writes go
   * in with `preview: false` and only the last previews, so the palette is
   * derived and applied once rather than three times on the way to the colours
   * that were asked for. Shared by the built-in presets, the saved themes and
   * the shuffle, because from here they are the same gesture.
   */
  function applyRawTriple(colors) {
    if (!colors) return;
    setColorValue('primary', colors.primary, { preview: false, syncPopover: false });
    setColorValue('secondary', colors.secondary, { preview: false, syncPopover: false });
    setColorValue('accent', colors.accent, { preview: true, syncPopover: false });
    closeColorPopover();
  }

  function announce(message) {
    if (shuffleStatus) shuffleStatus.textContent = message;
  }

  // ── Saved themes ──
  // Which saved theme the panel is working on, or null. Loading a chip sets it
  // and an edit KEEPS it: the point is that the colours in the controls still
  // belong to that theme, so Save can write them back to it.
  //
  // Without this the library was write-once from the panel. Overwriting by name
  // has always worked (see `saveTheme`), but nothing said so - the Save field
  // opened empty, no chip looked loaded, and Apply, the one button that reads
  // like a commit, writes the ACTIVE palette and leaves the named theme on the
  // colours it was first saved with. Editing a saved theme and pressing Apply
  // therefore looked like a save that did nothing.
  let activeThemeId = null;

  /** The three controls as a raw triple, in the shape the library stores. */
  function currentRawTriple() {
    return {
      primary: getColorValue('primary'),
      secondary: getColorValue('secondary'),
      accent: getColorValue('accent')
    };
  }

  /** The saved theme whose colours are exactly what the controls hold, if any. */
  function themeIdMatchingControls() {
    const current = currentRawTriple();
    const match = readThemeLibrary().find((entry) =>
      ['primary', 'secondary', 'accent'].every((key) => normalizeHex(entry.raw[key]) === current[key]));
    return match ? match.id : null;
  }

  /** The active theme's entry, re-read from storage rather than cached. */
  function activeThemeEntry() {
    if (!activeThemeId) return null;
    return readThemeLibrary().find((entry) => entry.id === activeThemeId) || null;
  }

  /**
   * Light the loaded theme's chip, and mark it when the controls have moved off
   * the colours that theme holds.
   *
   * The marker is the answer to "I changed a colour and my theme did not": an
   * edit is a preview until it is saved, and the chip is the only place that
   * can say so while it is still true. `aria-pressed` rather than a class
   * alone, because a screen reader has no other way to tell which of a row of
   * chips the panel is working on.
   */
  function syncThemeChipState() {
    const entry = activeThemeEntry();
    const edited = !!entry && ['primary', 'secondary', 'accent']
      .some((key) => normalizeHex(entry.raw[key]) !== getColorValue(key));

    themeChips?.querySelectorAll('.theme-chip-apply').forEach((chip) => {
      const isActive = chip.dataset.themeId === activeThemeId;
      chip.classList.toggle('is-active', isActive);
      chip.classList.toggle('is-edited', isActive && edited);
      chip.setAttribute('aria-pressed', String(isActive));
      chip.title = isActive && edited
        ? `Save to update ${chip.textContent}`
        : `Apply ${chip.textContent}`;
    });
  }

  /** Point the panel at one saved theme, or at none. */
  function setActiveTheme(id) {
    activeThemeId = id;
    syncThemeChipState();
  }

  // Rendered rather than authored, so the row rebuilds from storage after every
  // save and delete. The built-in chips are markup and are left alone; only the
  // saved ones are torn down and rebuilt, which is also why they carry a class
  // of their own rather than being told apart by position.
  function renderThemeLibrary() {
    if (!themeChips) return;
    themeChips.querySelectorAll('.theme-chip').forEach((chip) => chip.remove());

    readThemeLibrary().forEach((entry) => {
      const chip = document.createElement('span');
      chip.className = 'theme-chip';

      // Two buttons rather than one with a nested control: a button inside a
      // button is invalid, and "apply this" and "delete this" are genuinely
      // two actions that each need their own accessible name.
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'preset-btn theme-chip-apply';
      apply.dataset.themeId = entry.id;
      apply.title = `Apply ${entry.name}`;
      apply.setAttribute('aria-pressed', 'false');

      // The name is a span rather than a bare text node so it can truncate:
      // `text-overflow` needs a block-level box and the button itself is a
      // flex container. `textContent` still reads as the name either way,
      // which is what the title above and `syncThemeChipState` go on.
      const label = document.createElement('span');
      label.className = 'theme-chip-name';
      label.textContent = entry.name;
      apply.append(label);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'theme-chip-remove';
      remove.dataset.removeId = entry.id;
      remove.title = `Delete ${entry.name}`;
      remove.setAttribute('aria-label', `Delete saved theme ${entry.name}`);
      remove.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';

      chip.append(apply, remove);
      themeChips.append(chip);
    });

    // The row was just rebuilt, so the loaded theme has to be marked again -
    // a save re-renders, and what it wrote is what the panel is still editing.
    syncThemeChipState();
  }

  // One delegated handler instead of binding each chip: the saved ones are
  // created and destroyed as the library changes, and re-binding on every
  // render is how listeners get left behind on detached nodes.
  themeChips?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const remove = target.closest('[data-remove-id]');
    if (remove) {
      event.stopPropagation();
      const entry = readThemeLibrary().find((item) => item.id === remove.dataset.removeId);
      deleteTheme(remove.dataset.removeId);
      // The colours stay on screen, but they are nobody's theme now - Save has
      // to offer a new name rather than an update to something that is gone.
      if (activeThemeId === remove.dataset.removeId) activeThemeId = null;
      renderThemeLibrary();
      announce(entry ? `Deleted saved theme ${entry.name}.` : 'Saved theme deleted.');
      return;
    }

    const saved = target.closest('[data-theme-id]');
    if (saved) {
      event.stopPropagation();
      const entry = readThemeLibrary().find((item) => item.id === saved.dataset.themeId);
      if (entry) {
        applyRawTriple(entry.raw);
        setActiveTheme(entry.id);
        announce(`${entry.name} loaded. Press Apply to keep it, or Save to update it after an edit.`);
      }
      return;
    }

    const preset = target.closest('[data-preset]');
    if (preset) {
      event.stopPropagation();
      applyRawTriple(themePresets[preset.dataset.preset]);
      // A built-in is a different theme, not an edit of the loaded one, so the
      // panel stops pointing at it - Save must not silently overwrite a saved
      // theme with Dracula. Derived rather than nulled so a saved theme holding
      // exactly these colours still lights up.
      setActiveTheme(themeIdMatchingControls());
    }
  });

  /**
   * "Save" or "Update", live as the name is typed.
   *
   * Saving over a name you already used replaces that theme, and a button that
   * says Save while it is about to replace something is how that goes
   * unnoticed. This is the only place the rule is visible BEFORE the write.
   */
  function syncSaveConfirmLabel() {
    if (!saveConfirmBtn || !saveNameInput) return;
    const typed = saveNameInput.value.trim().toLowerCase();
    const exists = typed !== ''
      && readThemeLibrary().some((entry) => entry.name.toLowerCase() === typed);
    saveConfirmBtn.textContent = exists ? 'Update' : 'Save';
  }

  function closeSaveForm({ restoreFocus = false } = {}) {
    if (!saveForm) return;
    saveForm.hidden = true;
    if (saveNameInput) saveNameInput.value = '';
    syncSaveConfirmLabel();
    if (restoreFocus) saveBtn?.focus();
  }

  saveNameInput?.addEventListener('input', syncSaveConfirmLabel);

  saveBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!saveForm) return;

    if (!saveForm.hidden) {
      closeSaveForm({ restoreFocus: true });
      return;
    }

    closeColorPopover();
    saveForm.hidden = false;

    // Opened on a loaded theme, the field carries that theme's name, selected.
    // Enter then UPDATES it - which is what editing a saved theme and pressing
    // Save is asking for - and typing replaces the name outright for anyone who
    // meant to save a second theme instead. An empty field made the update path
    // exist only for a visitor who happened to retype the name exactly.
    const active = activeThemeEntry();
    if (saveNameInput && active) saveNameInput.value = active.name;
    syncSaveConfirmLabel();
    saveNameInput?.focus();
    if (active) saveNameInput?.select();
  });

  function commitSave() {
    if (!saveNameInput) return;

    const result = saveTheme(saveNameInput.value, currentRawTriple());

    if (!result.ok) {
      // Said out loud rather than swallowed: a save that silently does nothing
      // is indistinguishable from a broken button.
      const reason = result.reason === 'full'
        ? `You can save ${THEME_LIBRARY_LIMIT} themes. Delete one first.`
        : result.reason === 'empty'
          ? 'Give the theme a name first.'
          : 'This browser would not store the theme.';
      announce(reason);
      saveNameInput.focus();
      return;
    }

    const name = saveNameInput.value.trim().slice(0, THEME_NAME_MAX);
    closeSaveForm({ restoreFocus: true });
    renderThemeLibrary();
    // The panel now belongs to what was just written, whichever name it landed
    // under, so a second edit updates THAT theme rather than the one loaded
    // before it.
    setActiveTheme(result.id);
    announce(result.replaced ? `Updated saved theme ${name}.` : `Saved theme ${name}.`);
  }

  saveConfirmBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    commitSave();
  });

  saveCancelBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    closeSaveForm({ restoreFocus: true });
  });

  saveNameInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitSave();
    }
    if (event.key === 'Escape') {
      // Stopped here so Escape closes the name field rather than the whole
      // panel - the visitor is cancelling one step, not the whole errand.
      event.stopPropagation();
      closeSaveForm({ restoreFocus: true });
    }
  });

  renderThemeLibrary();

  // Same shape as a preset click, and deliberately so: all three controls are
  // set with `preview: false` and only the last one previews, so the palette
  // is derived and applied ONCE rather than three times on the way to the
  // colours the user actually asked for.
  //
  // Like the presets and like a hand-typed hex, this is a preview and not a
  // commit - the MutationObserver above rolls the palette back to what the
  // panel opened on if it closes without Apply. Pressing the button repeatedly
  // costs nothing.
  shuffleBtn?.addEventListener('click', (event) => {
    event.stopPropagation();

    const next = randomPalette(getColorValue('primary'));
    unsavedRawPalette = next;
    setColorValue('primary', next.primary, { preview: false, syncPopover: false });
    setColorValue('secondary', next.secondary, { preview: false, syncPopover: false });
    setColorValue('accent', next.accent, { preview: true, syncPopover: false });
    closeColorPopover();
    // A roll is a new palette, not an edit of the loaded theme - same reasoning
    // as the built-in presets above.
    setActiveTheme(themeIdMatchingControls());
    announce(`Random palette applied. Primary ${next.primary}, secondary ${next.secondary}, highlight ${next.accent}.`);
  });

  applyBtn?.addEventListener('click', () => {
    const rawPrimary = getColorValue('primary');
    const rawSecondary = getColorValue('secondary');
    const rawAccent = getColorValue('accent');
    
    const palette = getDerivedPalette(rawPrimary, rawSecondary, rawAccent);
    localStorage.setItem('rj_theme_palette', JSON.stringify(palette));
    // No longer unsaved - and clearing both of these before the close observer
    // runs is what stops that observer from reverting what was just saved, or
    // resurrecting the palette the panel happened to open on.
    unsavedRawPalette = null;
    paletteOnOpen = null;
    // Repaints the palette, and `applyPaletteVariables` carries the meta tag
    // with it - Apply is no longer the only thing that moves the browser bar.
    applyPaletteVariables(palette, document.body.classList.contains('dark-theme'));
    closeModal();
  });

  resetBtn?.addEventListener('click', () => {
    localStorage.removeItem('rj_theme_palette');
    // Reset means the shipped defaults, so the snapshot goes with it - closing
    // the panel afterwards must not paint a roll back over them. The saved
    // themes survive it (Reset is not a delete), but none of them is loaded any
    // more.
    unsavedRawPalette = null;
    paletteOnOpen = null;
    setActiveTheme(null);
    clearCustomPalette();
    closeModal();
  });
}
