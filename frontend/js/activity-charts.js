/**
 * DOM widgets for the activity dashboard.
 *
 * Deliberately dependency-free. A bucketed session strip and a ranked bar list
 * are a loop and a few positioned elements; a charting library would add
 * 45-200 KB to a PWA that precaches its whole shell, for no capability this
 * page uses. Colours are read from CSS custom properties so both themes and
 * any accent change flow through without touching this file.
 *
 * DOM rather than canvas: every bar in the session strip is a filter control,
 * so it needs to be a real focusable element with a label. A canvas would put
 * the whole chart behind one hit target and hide it from assistive tech.
 *
 * `activity.js` owns all state; every export here is a pure paint from a
 * snapshot it passes in.
 */

// Buckets across the whole session, not a fixed time window. A visit is the
// unit the reader cares about, and its length is not known in advance.
export const TIMELINE_BUCKETS = 48;

// Paint order within a stacked bar, bottom to top. Stable so a bucket does not
// reshuffle its own segments between repaints.
export const FAMILY_ORDER = ["nav", "tap", "pref", "reach"];

// Smallest value the strip will scale to, so a handful of events reads as a
// handful rather than filling the plot.
export const TIMELINE_PEAK_FLOOR = 3;

// Latency bands, in ms, for the pipeline chain's health dot.
const LATENCY_GOOD_MS = 150;
const LATENCY_WARN_MS = 300;

/**
 * Buckets `{ t, fam }` samples across `[from, to]` into per-family counts.
 *
 * Returns one entry per bucket, oldest first. An empty session still returns a
 * full-length array of zeroes so the strip keeps its width while it fills.
 */
export function bucketSession(samples, from, to, buckets = TIMELINE_BUCKETS) {
  const out = Array.from({ length: buckets }, () => ({
    nav: 0,
    tap: 0,
    pref: 0,
    reach: 0,
    total: 0,
  }));

  const span = to - from;
  if (!Number.isFinite(span) || span <= 0) return out;

  samples.forEach((sample) => {
    if (sample.t < from || sample.t > to) return;
    // The final instant belongs in the last bucket, not one past the end.
    const index = Math.min(buckets - 1, Math.floor(((sample.t - from) / span) * buckets));
    const family = FAMILY_ORDER.includes(sample.fam) ? sample.fam : "nav";
    out[index][family] += 1;
    out[index].total += 1;
  });

  return out;
}

/**
 * Paints the session strip.
 *
 * Each bucket is a button: clicking one narrows the log to that slice of the
 * visit. Bars are scaled to the busiest bucket rather than to an absolute
 * rate - the question the strip answers is "when was I busy", which is
 * relative by nature.
 */
export function renderTimeline(root, buckets, { selected = null, label } = {}) {
  if (!root) return null;

  // Roving tabindex: the strip is one stop in the tab order and the arrow keys
  // move within it. Forty-eight individually tabbable bars would put the log
  // forty-eight presses away from the filters above it.
  const firstFilled = buckets.findIndex((b) => b.total > 0);
  const active = selected !== null && buckets[selected]?.total > 0 ? selected : firstFilled;

  const peak = Math.max(0, ...buckets.map((b) => b.total));
  // Scaling purely to the peak makes every bar full height when the peak is 1,
  // so four events across a quiet visit paint the same picture as forty. The
  // floor keeps a sparse session looking sparse; a busy one is unaffected.
  const scale = Math.max(TIMELINE_PEAK_FLOOR, peak);

  root.innerHTML = buckets
    .map((bucket, index) => {
      const stack = FAMILY_ORDER.filter((family) => bucket[family] > 0)
        .map(
          (family) =>
            `<span class="act-tl-seg" data-fam="${family}" style="height: ${(
              (bucket[family] / scale) *
              100
            ).toFixed(2)}%"></span>`,
        )
        .join("");

      const text = label ? label(index, bucket) : `${bucket.total} events`;
      // A bucket with nothing in it is not a filter worth offering, so it is
      // disabled rather than merely styled down: it stays visible as part of
      // the shape but drops out of the tab order.
      return `<button type="button" class="act-tl-bar" data-bucket="${index}"
        aria-pressed="${selected === index ? "true" : "false"}"
        tabindex="${index === active ? "0" : "-1"}"
        ${bucket.total === 0 ? 'data-empty="true" disabled' : ""}
        title="${text}" aria-label="${text}">${stack}</button>`;
    })
    .join("");

  return { peak, total: buckets.reduce((sum, b) => sum + b.total, 0), active };
}

/**
 * Arrow-key movement across the strip, paired with the roving tabindex above.
 * Returns the bar that now holds focus, or null when the key is not ours.
 */
export function moveTimelineFocus(root, key) {
  if (!root) return null;
  const bars = [...root.querySelectorAll(".act-tl-bar:not([disabled])")];
  if (!bars.length) return null;

  const current = Math.max(0, bars.indexOf(document.activeElement));
  let next;
  if (key === "ArrowRight" || key === "ArrowDown") next = Math.min(bars.length - 1, current + 1);
  else if (key === "ArrowLeft" || key === "ArrowUp") next = Math.max(0, current - 1);
  else if (key === "Home") next = 0;
  else if (key === "End") next = bars.length - 1;
  else return null;

  bars.forEach((bar, index) => bar.setAttribute("tabindex", index === next ? "0" : "-1"));
  bars[next].focus();
  return bars[next];
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
 * Renders the path list as ranked rows.
 *
 * `steps` come straight from `/sessions/{id}/events/funnel`. The bar is the
 * row's own background rather than a separate column: label and magnitude then
 * occupy one strip the eye reads in a single pass, instead of a name on the
 * left and an unlabelled bar 150px to its right.
 */
export function renderPaths(
  root,
  funnel,
  { escapeHTML, selected = null, failed = false, emptyText = "No navigation recorded yet." } = {},
) {
  if (!root) return;

  const steps = funnel?.steps || [];
  if (!steps.length) {
    // A failed request used to render as "No navigation recorded yet." - a
    // failure indistinguishable from an empty session, on a panel whose whole
    // job is to report what happened.
    root.innerHTML = failed
      ? `<p class="act-paths-empty" data-state="error">Could not load where you went.
           <span>Use Refresh to try again &mdash; your events keep recording either way.</span></p>`
      : `<p class="act-paths-empty">${escapeHTML(emptyText)}</p>`;
    return;
  }

  const peak = Math.max(...steps.map((step) => step.hits || 0), 1);
  const total = steps.reduce((sum, step) => sum + (step.hits || 0), 0) || 1;
  const transitions = funnel.transitions || [];

  root.innerHTML = steps
    .map((step) => {
      const path = step.path || "-";
      const hits = step.hits || 0;
      // `share` is the server's figure when present; otherwise derive it from
      // the rows on hand rather than printing nothing.
      const share = Math.round((step.share ?? hits / total) * 100);
      const leadsTo = transitions.find((edge) => edge.from === step.path);
      const next = leadsTo ? ` Most often followed by ${leadsTo.to}.` : "";

      return `
        <button type="button" class="act-path" data-path="${escapeHTML(path)}"
          aria-pressed="${selected === step.path ? "true" : "false"}"
          title="${escapeHTML(path)} - ${hits} of ${total} events.${escapeHTML(next)}">
          <span class="act-path-fill" style="width: ${Math.round((hits / peak) * 100)}%"></span>
          <span class="act-path-name">${escapeHTML(path)}</span>
          <span class="act-path-hits">${hits}</span>
          <span class="act-path-share">${share}%</span>
        </button>
      `;
    })
    .join("");
}
