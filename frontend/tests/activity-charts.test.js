import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

describe('Activity chart widgets', () => {
  let dom;

  before(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    global.document = dom.window.document;
    global.window = dom.window;
    global.getComputedStyle = dom.window.getComputedStyle;
  });

  after(() => {
    delete global.document;
    delete global.window;
    delete global.getComputedStyle;
  });

  describe('bucketSession', () => {
    it('spreads samples across the session span, oldest first', async () => {
      const { bucketSession } = await import('../js/activity-charts.js');
      const from = 1_000_000_000_000;
      const to = from + 48_000; // 1s per bucket at the default resolution

      const buckets = bucketSession(
        [
          { t: from, fam: 'nav' },
          { t: from + 500, fam: 'tap' },
          { t: from + 24_000, fam: 'pref' },
          { t: to, fam: 'reach' },
        ],
        from,
        to
      );

      assert.strictEqual(buckets.length, 48);
      assert.strictEqual(buckets[0].total, 2, 'both opening samples land in bucket 0');
      assert.strictEqual(buckets[0].nav, 1);
      assert.strictEqual(buckets[0].tap, 1);
      assert.strictEqual(buckets[24].pref, 1);
      assert.strictEqual(buckets[47].reach, 1, 'the final instant belongs to the last bucket');
    });

    it('drops samples outside the session span', async () => {
      const { bucketSession } = await import('../js/activity-charts.js');
      const from = 1_000_000_000_000;
      const to = from + 60_000;

      const buckets = bucketSession(
        [{ t: from - 1 }, { t: to + 1 }],
        from,
        to
      );

      assert.strictEqual(
        buckets.reduce((sum, b) => sum + b.total, 0),
        0,
        'samples before the session and after now are both excluded'
      );
    });

    it('returns a full-width empty series when the span is degenerate', async () => {
      const { bucketSession, TIMELINE_BUCKETS } = await import('../js/activity-charts.js');
      const buckets = bucketSession([{ t: 5 }], 10, 10);

      assert.strictEqual(buckets.length, TIMELINE_BUCKETS);
      assert.ok(buckets.every((b) => b.total === 0));
    });

    it('files an unrecognised family under navigation rather than dropping the event', async () => {
      const { bucketSession } = await import('../js/activity-charts.js');
      const from = 0;
      const buckets = bucketSession([{ t: 0, fam: 'not_a_family' }], from, 48_000);

      assert.strictEqual(buckets[0].total, 1);
      assert.strictEqual(buckets[0].nav, 1);
    });
  });

  describe('renderTimeline', () => {
    it('renders one button per bucket, scaled to the busiest', async () => {
      const { renderTimeline } = await import('../js/activity-charts.js');
      const root = document.createElement('div');

      const result = renderTimeline(root, [
        { nav: 4, tap: 0, pref: 0, reach: 0, total: 4 },
        { nav: 1, tap: 1, pref: 0, reach: 0, total: 2 },
        { nav: 0, tap: 0, pref: 0, reach: 0, total: 0 },
      ]);

      const bars = root.querySelectorAll('.act-tl-bar');
      assert.strictEqual(bars.length, 3);
      assert.strictEqual(result.peak, 4);
      assert.strictEqual(result.total, 6);
      assert.strictEqual(bars[0].querySelector('.act-tl-seg').style.height, '100%');
      assert.strictEqual(bars[1].querySelectorAll('.act-tl-seg').length, 2, 'one segment per family present');
      assert.strictEqual(bars[2].dataset.empty, 'true', 'an empty bucket is marked, not hidden');
    });

    it('scales a sparse session against a floor rather than its own peak', async () => {
      const { renderTimeline, TIMELINE_PEAK_FLOOR } = await import('../js/activity-charts.js');
      const root = document.createElement('div');

      // A single event must not fill the plot the way a busy bucket would.
      const result = renderTimeline(root, [{ nav: 1, tap: 0, pref: 0, reach: 0, total: 1 }]);

      assert.strictEqual(result.peak, 1, 'the reported peak is still the real one');
      assert.strictEqual(
        root.querySelector('.act-tl-seg').style.height,
        `${((1 / TIMELINE_PEAK_FLOOR) * 100).toFixed(2)}%`
      );
    });

    it('keeps the strip to one tab stop', async () => {
      const { renderTimeline } = await import('../js/activity-charts.js');
      const root = document.createElement('div');

      renderTimeline(root, [
        { nav: 0, tap: 0, pref: 0, reach: 0, total: 0 },
        { nav: 2, tap: 0, pref: 0, reach: 0, total: 2 },
        { nav: 1, tap: 0, pref: 0, reach: 0, total: 1 },
      ]);

      const tabbable = [...root.querySelectorAll('.act-tl-bar')].filter(
        (b) => b.getAttribute('tabindex') === '0'
      );
      assert.strictEqual(tabbable.length, 1, 'exactly one bar is in the tab order');
      assert.strictEqual(tabbable[0].dataset.bucket, '1', 'the first non-empty bucket holds it');
    });

    it('hands the tab stop to the selected bucket', async () => {
      const { renderTimeline } = await import('../js/activity-charts.js');
      const root = document.createElement('div');

      renderTimeline(
        root,
        [
          { nav: 1, tap: 0, pref: 0, reach: 0, total: 1 },
          { nav: 3, tap: 0, pref: 0, reach: 0, total: 3 },
        ],
        { selected: 1 }
      );

      assert.strictEqual(root.querySelector('[data-bucket="1"]').getAttribute('tabindex'), '0');
      assert.strictEqual(root.querySelector('[data-bucket="0"]').getAttribute('tabindex'), '-1');
    });

    it('marks the selected bucket as pressed', async () => {
      const { renderTimeline } = await import('../js/activity-charts.js');
      const root = document.createElement('div');

      renderTimeline(root, [{ nav: 1, tap: 0, pref: 0, reach: 0, total: 1 }, { nav: 0, tap: 0, pref: 0, reach: 0, total: 0 }], {
        selected: 0,
      });

      const bars = root.querySelectorAll('.act-tl-bar');
      assert.strictEqual(bars[0].getAttribute('aria-pressed'), 'true');
      assert.strictEqual(bars[1].getAttribute('aria-pressed'), 'false');
    });

    it('labels every bar so the strip is usable without sight of it', async () => {
      const { renderTimeline } = await import('../js/activity-charts.js');
      const root = document.createElement('div');

      renderTimeline(root, [{ nav: 2, tap: 0, pref: 0, reach: 0, total: 2 }], {
        label: (index, bucket) => `${bucket.total} events at slot ${index}`,
      });

      assert.strictEqual(root.querySelector('.act-tl-bar').getAttribute('aria-label'), '2 events at slot 0');
    });
  });

  describe('moveTimelineFocus', () => {
    it('walks the arrow keys across the filled buckets only', async () => {
      const { renderTimeline, moveTimelineFocus } = await import('../js/activity-charts.js');
      const root = document.createElement('div');
      document.body.appendChild(root);

      renderTimeline(root, [
        { nav: 1, tap: 0, pref: 0, reach: 0, total: 1 },
        { nav: 0, tap: 0, pref: 0, reach: 0, total: 0 },
        { nav: 2, tap: 0, pref: 0, reach: 0, total: 2 },
      ]);

      root.querySelector('[data-bucket="0"]').focus();
      const next = moveTimelineFocus(root, 'ArrowRight');
      assert.strictEqual(next.dataset.bucket, '2', 'the empty bucket is skipped');
      assert.strictEqual(next.getAttribute('tabindex'), '0');
      assert.strictEqual(root.querySelector('[data-bucket="0"]').getAttribute('tabindex'), '-1');

      assert.strictEqual(moveTimelineFocus(root, 'Home').dataset.bucket, '0');
      assert.strictEqual(moveTimelineFocus(root, 'End').dataset.bucket, '2');
      root.remove();
    });

    it('ignores keys it does not own', async () => {
      const { renderTimeline, moveTimelineFocus } = await import('../js/activity-charts.js');
      const root = document.createElement('div');
      renderTimeline(root, [{ nav: 1, tap: 0, pref: 0, reach: 0, total: 1 }]);
      assert.strictEqual(moveTimelineFocus(root, 'Enter'), null);
    });
  });

  describe('percentile', () => {
    it('computes nearest-rank percentiles', async () => {
      const { percentile } = await import('../js/activity-charts.js');
      const values = Array.from({ length: 100 }, (_, i) => i + 1);

      assert.strictEqual(percentile(values, 0.5), 50);
      assert.strictEqual(percentile(values, 0.95), 95);
      assert.strictEqual(percentile(values, 0.99), 99);
    });

    it('does not mutate the caller\'s array', async () => {
      const { percentile } = await import('../js/activity-charts.js');
      const values = [30, 10, 20];
      percentile(values, 0.5);
      assert.deepStrictEqual(values, [30, 10, 20]);
    });

    it('returns null for an empty sample', async () => {
      const { percentile } = await import('../js/activity-charts.js');
      assert.strictEqual(percentile([], 0.95), null);
    });
  });

  describe('latencyBand', () => {
    it('maps latency onto health bands', async () => {
      const { latencyBand } = await import('../js/activity-charts.js');
      assert.strictEqual(latencyBand(null), 'idle');
      assert.strictEqual(latencyBand(20), 'ok');
      assert.strictEqual(latencyBand(200), 'warn');
      assert.strictEqual(latencyBand(900), 'error');
    });
  });

  describe('renderPaths', () => {
    const escapeHTML = (value) =>
      String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    it('renders one row per path, scaled to the busiest', async () => {
      const { renderPaths } = await import('../js/activity-charts.js');
      const root = document.createElement('div');

      renderPaths(
        root,
        {
          steps: [
            { path: '/#activity', hits: 8, share: 0.8 },
            { path: '/#about', hits: 2, share: 0.2 },
          ],
          transitions: [{ from: '/#about', to: '/#activity', weight: 2 }],
        },
        { escapeHTML }
      );

      const rows = root.querySelectorAll('.act-path');
      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].querySelector('.act-path-fill').style.width, '100%');
      assert.strictEqual(rows[1].querySelector('.act-path-fill').style.width, '25%');
      assert.strictEqual(rows[1].querySelector('.act-path-share').textContent, '20%');
      assert.match(rows[1].getAttribute('title'), /followed by \/#activity/);
    });

    it('derives a share when the server does not send one', async () => {
      const { renderPaths } = await import('../js/activity-charts.js');
      const root = document.createElement('div');

      renderPaths(
        root,
        { steps: [{ path: '/a', hits: 3 }, { path: '/b', hits: 1 }], transitions: [] },
        { escapeHTML }
      );

      const shares = [...root.querySelectorAll('.act-path-share')].map((n) => n.textContent);
      assert.deepStrictEqual(shares, ['75%', '25%']);
    });

    it('escapes path text rather than injecting it as markup', async () => {
      const { renderPaths } = await import('../js/activity-charts.js');
      const root = document.createElement('div');

      renderPaths(
        root,
        { steps: [{ path: '/<img src=x onerror=alert(1)>', hits: 1, share: 1 }], transitions: [] },
        { escapeHTML }
      );

      assert.strictEqual(root.querySelector('img'), null);
      assert.match(root.querySelector('.act-path-name').textContent, /onerror=alert\(1\)/);
    });

    it('marks the selected path as pressed', async () => {
      const { renderPaths } = await import('../js/activity-charts.js');
      const root = document.createElement('div');

      renderPaths(root, { steps: [{ path: '/a', hits: 1 }], transitions: [] }, { escapeHTML, selected: '/a' });
      assert.strictEqual(root.querySelector('.act-path').getAttribute('aria-pressed'), 'true');
    });

    it('shows an empty state rather than a bare grid', async () => {
      const { renderPaths } = await import('../js/activity-charts.js');
      const root = document.createElement('div');
      renderPaths(root, { steps: [], transitions: [] }, { escapeHTML });
      assert.ok(root.querySelector('.act-paths-empty'));
    });
  });
});
