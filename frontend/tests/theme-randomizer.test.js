import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

// `randomPalette` is the shuffle button in the theme customiser. The point of
// testing a random function is that it is NOT uniformly random: the colours it
// returns are fed to `generateVariants`, which derives a text, hover, soft and
// mild variant from each of them for both themes, and a source outside the
// saturation/lightness bands produces a palette that is technically applied and
// practically unusable. These assertions are those bands.
//
// Every case runs the generator many times rather than once - a constraint that
// holds for one roll of a random function has not been tested.
const ROLLS = 400;

const HEX = /^#[0-9A-F]{6}$/;

function hexToHsl(hex) {
  const r = parseInt(hex.substring(1, 3), 16) / 255;
  const g = parseInt(hex.substring(3, 5), 16) / 255;
  const b = parseInt(hex.substring(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l * 100];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;

  return [(h / 6) * 360, s * 100, l * 100];
}

function hueGap(a, b) {
  const raw = Math.abs(a - b) % 360;
  return Math.min(raw, 360 - raw);
}

describe('Theme randomizer', () => {
  let dom;
  let randomPalette;

  before(async () => {
    // The url matters: the module reaches for `localStorage`, and jsdom gives
    // an opaque origin - where localStorage throws - to a document with none.
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://rjasti.com/' });
    global.document = dom.window.document;
    global.window = dom.window;
    global.localStorage = dom.window.localStorage;
    ({ randomPalette } = await import('../js/theme-customizer.js'));
  });

  after(() => {
    delete global.document;
    delete global.window;
    delete global.localStorage;
  });

  it('returns a six-digit uppercase hex for all three controls', () => {
    for (let i = 0; i < ROLLS; i += 1) {
      const palette = randomPalette('#F59E0B');
      assert.deepStrictEqual(Object.keys(palette).sort(), ['accent', 'primary', 'secondary']);
      for (const [key, value] of Object.entries(palette)) {
        assert.match(value, HEX, `${key} was ${value}`);
      }
    }
  });

  it('keeps saturation and lightness inside the bands the variant generator can use', () => {
    for (let i = 0; i < ROLLS; i += 1) {
      for (const hex of Object.values(randomPalette('#F59E0B'))) {
        const [, s, l] = hexToHsl(hex);
        // One point of slack each way: the bands are chosen in HSL and the
        // returned value is hex, so quantising to 8 bits per channel moves
        // both figures by a fraction of a percent.
        assert.ok(s >= 57 && s <= 89, `${hex} saturation ${s.toFixed(1)} outside 58-88`);
        assert.ok(l >= 41 && l <= 59, `${hex} lightness ${l.toFixed(1)} outside 42-58`);
      }
    }
  });

  it('always lands a visible distance from the palette already on screen', () => {
    // Without this the button appears broken every so often: a base hue that
    // rolls close to the current one returns a palette the eye reads as the
    // one already there.
    for (let i = 0; i < ROLLS; i += 1) {
      const current = '#F59E0B';
      const [currentHue] = hexToHsl(current);
      const [primaryHue] = hexToHsl(randomPalette(current).primary);
      assert.ok(
        hueGap(currentHue, primaryHue) >= 35,
        `new primary hue ${primaryHue.toFixed(1)} too close to ${currentHue.toFixed(1)}`
      );
    }
  });

  it('relates the three colours to each other rather than rolling them independently', () => {
    // Every harmony puts secondary and highlight at fixed offsets from the
    // primary, so the gaps that actually occur are a small closed set. Three
    // independent hues would spread across every gap there is.
    //
    // The four entries in SHUFFLE_HARMONIES collapse to five gaps, because
    // hueGap is circular and caps at 180: [0,28,-28] -> 28; [0,120,240] -> 120
    // twice; [0,150,210] -> 150 twice; [0,35,180] -> 35 and 180. Update this
    // list when a harmony is added, which is the point of pinning it.
    const NOMINAL_GAPS = [28, 35, 120, 150, 180];

    // ── Why this does not count distinct rounded gaps ──
    // It used to, and asserted the count was <= 12. The offsets in
    // theme-customizer.js are exact integers, but the colours round-trip
    // through eight-bit hex on the way back out, so a recovered hue is its
    // nominal value give or take about 0.76 degrees and `Math.round` drops it
    // into gap-1 or gap+1. The closed set is therefore 14 values, not 5: each
    // nominal plus its two neighbours, except 180, which can only round down
    // because the gap is capped there.
    //
    // The off-by-one buckets each land ~0.09% of the time, so whether a given
    // 400-roll sample hit enough of them to exceed 12 was luck: over 4,000
    // simulated runs the observed count ranged 5 to 14 (median 9) and the
    // assertion failed 59 times, or 1.5%. That is the kind of rate that passes
    // review and CI and then fails on someone's laptop. Raising the bound to
    // 14 would have made it pass and stopped it testing anything, since 14 is
    // the whole set.
    //
    // Snapping each gap to its nearest nominal tests the real property -
    // offsets are fixed - deterministically and far more strictly: three
    // independent hues fail on the first roll instead of 2.7% of the time.
    const seen = new Set();
    for (let i = 0; i < ROLLS; i += 1) {
      const { primary, secondary, accent } = randomPalette('#F59E0B');
      const [ph] = hexToHsl(primary);
      for (const hex of [secondary, accent]) {
        const gap = hueGap(ph, hexToHsl(hex)[0]);
        const nearest = NOMINAL_GAPS.reduce((best, n) =>
          Math.abs(gap - n) < Math.abs(gap - best) ? n : best
        );
        assert.ok(
          Math.abs(gap - nearest) < 1,
          `hue gap ${gap.toFixed(3)} is not one of ${NOMINAL_GAPS.join(', ')} ` +
            `(nearest ${nearest}, off by ${Math.abs(gap - nearest).toFixed(3)})`
        );
        seen.add(nearest);
      }
    }

    // Every gap being near SOME nominal is not enough on its own - a generator
    // that only ever emitted 28 would pass that. The harmonies are picked
    // uniformly, so 400 rolls hit all five with overwhelming probability.
    assert.deepStrictEqual(
      [...seen].sort((a, b) => a - b),
      NOMINAL_GAPS,
      'expected every harmony in SHUFFLE_HARMONIES to be reachable'
    );
  });

  it('still works when no current colour is supplied', () => {
    for (let i = 0; i < ROLLS; i += 1) {
      for (const hex of Object.values(randomPalette())) {
        assert.match(hex, HEX);
      }
    }
  });
});
