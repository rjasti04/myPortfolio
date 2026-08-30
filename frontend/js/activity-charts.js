/**
 * Canvas and DOM widgets for the activity dashboard.
 *
 * Deliberately dependency-free. A 60-bucket bar strip and a percentile meter
 * are a loop and a few positioned elements; a charting library would add
 * 45-200 KB to a PWA that precaches its whole shell, for no capability this
 * page uses. Colours are read from the CSS custom properties so both themes
 * and any accent change flow through without touching this file.
 *
 * `activity.js` owns all state; every export here is a pure paint from a
 * snapshot it passes in.
 */

// One bucket per second of a rolling minute.
export const BURST_BUCKETS = 60;
export const BURST_WINDOW_MS = BURST_BUCKETS * 1000;

// Latency bands, in ms, for the p50/p95/p99 meter.
const LATENCY_SCALE_MS = 500;
const LATENCY_GOOD_MS = 150;
const LATENCY_WARN_MS = 300;

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Device-pixel-ratio aware sizing. Returns false when the canvas has no box. */
function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

/**
 * Buckets `{ t }` samples into per-second counts over the trailing minute.
 * Index 0 is the oldest second, `BURST_BUCKETS - 1` the current one.
 */
export function bucketEvents(samples, now = Date.now()) {
  const buckets = new Array(BURST_BUCKETS).fill(0);
  samples.forEach((sample) => {
    const age = now - sample.t;
    if (age < 0 || age >= BURST_WINDOW_MS) return;
    const index = BURST_BUCKETS - 1 - Math.floor(age / 1000);
    if (index >= 0 && index < BURST_BUCKETS) buckets[index] += 1;
  });
  return buckets;
}

/**
 * Paints the event-rate burst strip.
 *
 * Bars, not a smoothed area: the data is a discrete count per second, and a
 * spline between integer counts invents intermediate values that never
 * occurred. An empty window still draws the baseline, so "live but quiet"
 * stays visually distinct from "not connected".
 */
export function drawBurstStrip(canvas, samples, { reducedMotion = false } = {}) {
  if (!canvas) return;
  const fitted = fitCanvas(canvas);
  if (!fitted) return;
  const { ctx, width, height } = fitted;

  const buckets = bucketEvents(samples);
  const peak = Math.max(1, ...buckets);

  ctx.clearRect(0, 0, width, height);

  const accent = cssVar("--accent-fill", "#f59e0b");
  const track = cssVar("--border", "rgba(15,23,42,0.13)");
  const baseline = height - 1;

  // Baseline keeps the widget legible when nothing is arriving.
  ctx.fillStyle = track;
  ctx.fillRect(0, baseline, width, 1);

  const gap = 1;
  const barWidth = Math.max(1, width / BURST_BUCKETS - gap);

  buckets.forEach((count, index) => {
    if (!count) return;
    const x = (width / BURST_BUCKETS) * index;
    const barHeight = Math.max(2, (count / peak) * (height - 4));
    // The newest bar reads at full strength; older ones recede so the eye
    // lands on "now" without any animation.
    const age = (BURST_BUCKETS - 1 - index) / BURST_BUCKETS;
    ctx.globalAlpha = reducedMotion ? 1 : 0.35 + 0.65 * (1 - age);
    ctx.fillStyle = accent;
    ctx.fillRect(x, baseline - barHeight, barWidth, barHeight);
  });

  ctx.globalAlpha = 1;
  return { peak, total: buckets.reduce((sum, n) => sum + n, 0) };
}

/** Nearest-rank percentile over an unsorted numeric sample. */
export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

export function latencyBand(ms) {
  if (ms === null || ms === undefined) return "idle";
  if (ms < LATENCY_GOOD_MS) return "ok";
  if (ms < LATENCY_WARN_MS) return "warn";
  return "error";
}

/**
 * Updates the p50/p95/p99 latency meter.
 *
 * Horizontal rather than a radial gauge: a dial renders one number, while the
 * interesting story here is the spread between the median and the tail.
 * Positions are written as percentages onto custom properties so the CSS owns
 * all the drawing.
 */
export function renderLatencyMeter(root, samples) {
  if (!root) return null;

  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  const p99 = percentile(samples, 0.99);

  const pct = (value) =>
    value === null ? 0 : Math.min(100, (value / LATENCY_SCALE_MS) * 100);

  root.style.setProperty("--lat-p50", `${pct(p50)}%`);
  root.style.setProperty("--lat-p95", `${pct(p95)}%`);
  root.style.setProperty("--lat-p99", `${pct(p99)}%`);
  root.dataset.band = latencyBand(p95);
  root.dataset.empty = samples.length ? "false" : "true";

  const write = (selector, value) => {
    const node = root.querySelector(selector);
    if (node) node.textContent = value === null ? "-" : `${Math.round(value)}ms`;
  };
  write("[data-lat-p50]", p50);
  write("[data-lat-p95]", p95);
  write("[data-lat-p99]", p99);

  const scaleNode = root.querySelector("[data-lat-scale]");
  if (scaleNode) scaleNode.textContent = `0-${LATENCY_SCALE_MS}ms`;

  return { p50, p95, p99, samples: samples.length };
}

/**
 * Renders the path funnel as stacked proportional bars.
 *
 * `steps` come straight from `/sessions/{id}/events/funnel`. Bars are sorted
 * by hits, so the reader sees where the session actually spent its attention.
 */
export function renderFunnel(root, funnel, { escapeHTML }) {
  if (!root) return;

  const steps = funnel?.steps || [];
  if (!steps.length) {
    root.innerHTML = `<p class="activity-funnel-empty">No navigation recorded yet.</p>`;
    return;
  }

  const peak = Math.max(...steps.map((step) => step.hits || 0), 1);
  const transitions = funnel.transitions || [];

  root.innerHTML = steps
    .map((step) => {
      const hits = step.hits || 0;
      const width = Math.round((hits / peak) * 100);
      const share = Math.round((step.share || 0) * 100);
      const leadsTo = transitions.find((edge) => edge.from === step.path);
      return `
        <div class="activity-funnel-row">
          <span class="activity-funnel-path" title="${escapeHTML(step.path || "")}">
            ${escapeHTML(step.path || "-")}
          </span>
          <span class="activity-funnel-track">
            <span class="activity-funnel-bar" style="width: ${width}%"></span>
          </span>
          <span class="activity-funnel-count">${hits}<span class="activity-funnel-share">${share}%</span></span>
          <span class="activity-funnel-next">${
            leadsTo ? `<i class="fas fa-arrow-right" aria-hidden="true"></i> ${escapeHTML(leadsTo.to)}` : ""
          }</span>
        </div>
      `;
    })
    .join("");
}
