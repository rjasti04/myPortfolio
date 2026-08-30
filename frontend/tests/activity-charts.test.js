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

  describe('bucketEvents', () => {
    it('places samples in one-second buckets, newest last', async () => {
      const { bucketEvents, BURST_BUCKETS } = await import('../js/activity-charts.js');
      const now = 1_000_000_000_000;
      const buckets = bucketEvents(
        [{ t: now }, { t: now }, { t: now - 1500 }, { t: now - 59_000 }],
        now
      );

      assert.strictEqual(buckets.length, BURST_BUCKETS);
      assert.strictEqual(buckets[BURST_BUCKETS - 1], 2, 'current second holds both "now" samples');
      assert.strictEqual(buckets[BURST_BUCKETS - 2], 1, '1.5s ago lands one bucket back');
      assert.strictEqual(buckets[0], 1, 'the oldest in-window sample lands in bucket 0');
    });

    it('drops samples outside the rolling window', async () => {
      const { bucketEvents } = await import('../js/activity-charts.js');
      const now = 1_000_000_000_000;
      const buckets = bucketEvents([{ t: now - 61_000 }, { t: now + 5000 }], now);

      assert.strictEqual(
        buckets.reduce((sum, n) => sum + n, 0),
        0,
        'stale and future-dated samples are both excluded'
      );
    });

    it('returns an all-zero window for no samples', async () => {
      const { bucketEvents, BURST_BUCKETS } = await import('../js/activity-charts.js');
      const buckets = bucketEvents([], 1_000_000_000_000);
      assert.strictEqual(buckets.length, BURST_BUCKETS);
      assert.ok(buckets.every((n) => n === 0));
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

  describe('renderLatencyMeter', () => {
    it('writes percentile positions and band onto the element', async () => {
      const { renderLatencyMeter } = await import('../js/activity-charts.js');
      const root = document.createElement('div');
      root.innerHTML =
        '<b data-lat-p50></b><b data-lat-p95></b><b data-lat-p99></b><span data-lat-scale></span>';

      // p95 of 250ms is half of the 500ms scale and inside the warn band.
      const result = renderLatencyMeter(root, [100, 100, 250]);

      assert.strictEqual(root.dataset.band, 'warn');
      assert.strictEqual(root.dataset.empty, 'false');
      assert.strictEqual(root.style.getPropertyValue('--lat-p95'), '50%');
      assert.strictEqual(root.querySelector('[data-lat-p95]').textContent, '250ms');
      assert.strictEqual(result.samples, 3);
    });

    it('marks an empty reservoir instead of drawing zeros as data', async () => {
      const { renderLatencyMeter } = await import('../js/activity-charts.js');
      const root = document.createElement('div');
      root.innerHTML = '<b data-lat-p50></b><b data-lat-p95></b><b data-lat-p99></b>';

      renderLatencyMeter(root, []);

      assert.strictEqual(root.dataset.empty, 'true');
      assert.strictEqual(root.dataset.band, 'idle');
      assert.strictEqual(root.querySelector('[data-lat-p50]').textContent, '-');
    });
  });

  describe('renderFunnel', () => {
    const escapeHTML = (value) =>
      String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    it('renders one row per path, scaled to the busiest', async () => {
      const { renderFunnel } = await import('../js/activity-charts.js');
      const root = document.createElement('div');

      renderFunnel(
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

      const rows = root.querySelectorAll('.activity-funnel-row');
      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].querySelector('.activity-funnel-bar').style.width, '100%');
      assert.strictEqual(rows[1].querySelector('.activity-funnel-bar').style.width, '25%');
      assert.match(rows[1].querySelector('.activity-funnel-next').textContent, /\/#activity/);
    });

    it('escapes path text rather than injecting it as markup', async () => {
      const { renderFunnel } = await import('../js/activity-charts.js');
      const root = document.createElement('div');

      renderFunnel(
        root,
        { steps: [{ path: '/<img src=x onerror=alert(1)>', hits: 1, share: 1 }], transitions: [] },
        { escapeHTML }
      );

      assert.strictEqual(root.querySelector('img'), null);
      assert.match(root.querySelector('.activity-funnel-path').textContent, /onerror=alert\(1\)/);
    });

    it('shows an empty state rather than a bare grid', async () => {
      const { renderFunnel } = await import('../js/activity-charts.js');
      const root = document.createElement('div');
      renderFunnel(root, { steps: [], transitions: [] }, { escapeHTML });
      assert.ok(root.querySelector('.activity-funnel-empty'));
    });
  });
});
