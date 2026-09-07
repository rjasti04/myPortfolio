/**
 * The two runtime pieces every canvas game here needs: a fixed-timestep loop
 * and a display-density-aware drawing surface.
 *
 * Neither is a framework. They exist because getting both subtly wrong is the
 * default outcome of writing four independent requestAnimationFrame loops.
 */

/**
 * Fixed-timestep loop.
 *
 * `update` is called a whole number of times per frame at a constant `step`,
 * and `render` once. Variable-timestep physics would make Flapper's jump
 * height and Tetris's gravity depend on the visitor's refresh rate - the same
 * run plays differently at 60Hz and 144Hz, and collision can tunnel straight
 * through a pipe on a long frame.
 *
 * The accumulator is clamped to MAX_FRAME. Without it, returning to a
 * backgrounded tab hands the loop one enormous delta, which it then tries to
 * simulate in a single frame - the run appears to fast-forward through its own
 * game over. Clamping drops that time instead, which is the correct trade for
 * a game: the simulation slows rather than skipping ahead.
 */
const MAX_FRAME = 0.25;

export function createLoop({ update, render, step = 1 / 60 }) {
  let raf = 0;
  let last = 0;
  let accumulator = 0;
  let running = false;

  function frame(now) {
    if (!running) return;
    raf = window.requestAnimationFrame(frame);

    const elapsed = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    accumulator += elapsed;

    while (accumulator >= step) {
      update(step);
      accumulator -= step;
    }
    render();
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = window.performance.now();
      accumulator = 0;
      raf = window.requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      window.cancelAnimationFrame(raf);
    },
    get running() {
      return running;
    },
  };
}

/**
 * Size a canvas for the display it is on.
 *
 * The CSS box is laid out by the stylesheet; this sets the backing store to
 * that box times the device pixel ratio and scales the context to match, so
 * one context unit stays one CSS pixel. Skipping this is what makes canvas
 * games look soft on phones - a 2x or 3x screen stretches a 1x bitmap.
 *
 * DPR is capped at 2: a 3x phone triples the fill rate for a difference
 * nobody sees on a 40px block, and the frame budget is better spent elsewhere.
 *
 * Returns the CSS-pixel dimensions, which is what game logic should reason in.
 */
export function fitCanvas(canvas, context) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  return { width, height };
}

/** True when the visitor has asked the OS to reduce motion. */
export function prefersReducedMotion() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}
