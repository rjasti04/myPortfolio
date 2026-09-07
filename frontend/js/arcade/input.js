/**
 * Input helpers shared by the six games.
 *
 * Every binder returns its own teardown function. That is the whole point:
 * the shell destroys and recreates a game on every restart, and a listener
 * left on `window` by the previous instance keeps driving a dead game - two
 * runs of Tetris responding to one arrow key.
 */

/** Distance in CSS pixels before a drag counts as a swipe rather than a tap. */
const SWIPE_THRESHOLD = 28;

/**
 * Whether input currently reaches the game at all.
 *
 * Module-level for the same reason the loop registry is: the page runs one game
 * at a time, and pause is a property of the page rather than of any one binder.
 * The alternative - every game checking a paused flag before acting - is a
 * check that some future game forgets, and the symptom is a piece that hard
 * drops behind a pause panel.
 */
let blocked = false;

/** Called by the shell around a pause. Nothing else should touch it. */
export function setInputBlocked(value) {
  blocked = value;
}

/**
 * Keyboard bindings from a `{ ArrowLeft: fn }` map.
 *
 * Bound on `window` rather than the canvas, because a canvas is not focusable
 * without a tabindex and the visitor should not have to click the board first.
 * Handled keys have their default suppressed - otherwise arrows and space
 * scroll the page underneath the game, which on a phone-sized viewport moves
 * the board off screen mid-run.
 */
export function bindKeys(map) {
  const onKeyDown = (event) => {
    if (blocked) return;
    const handler = map[event.key];
    if (!handler) return;
    if (event.repeat && handler.ignoreRepeat) return;
    event.preventDefault();
    (handler.run ?? handler)(event);
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}

/**
 * Continuous pointer position over a surface, as a fraction of its box.
 *
 * `bindSwipe` resolves a whole gesture into one direction once it is over,
 * which is the right shape for a board that moves in steps and the wrong one
 * for a paddle: a paddle has to follow the pointer while it is still moving,
 * and on a mouse it has to do so before any button is pressed. `pointermove`
 * covers both - a mouse reports it hovering, a finger reports it dragging.
 *
 * The position is handed over normalised to 0..1 across the element, so the
 * game never has to know what size the canvas ended up on screen.
 */
export function bindPointerTrack(element, onMove) {
  const handle = (event) => {
    if (blocked) return;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    onMove(
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    );
  };

  // `pointerdown` as well as `pointermove`: a finger that taps without dragging
  // reports no move at all, and the tap should still be where the paddle goes.
  element.addEventListener("pointermove", handle);
  element.addEventListener("pointerdown", handle);
  return () => {
    element.removeEventListener("pointermove", handle);
    element.removeEventListener("pointerdown", handle);
  };
}

/**
 * Swipe and tap on a touch surface.
 *
 * Pointer events cover mouse, touch and pen in one path. `touch-action: none`
 * on the element (set in the stylesheet) is what stops the browser claiming
 * the gesture for a scroll before the handler ever sees it.
 */
export function bindSwipe(element, { onSwipe, onTap } = {}) {
  let startX = 0;
  let startY = 0;
  let pointerId = null;

  const onPointerDown = (event) => {
    if (blocked || pointerId !== null) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    element.setPointerCapture?.(event.pointerId);
  };

  const onPointerUp = (event) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    if (blocked) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (Math.max(absX, absY) < SWIPE_THRESHOLD) {
      onTap?.(event);
      return;
    }
    // The dominant axis wins outright: a diagonal drag has to resolve to one
    // direction or a 2048 board moves twice on one gesture.
    if (absX > absY) onSwipe?.(dx > 0 ? "right" : "left");
    else onSwipe?.(dy > 0 ? "down" : "up");
  };

  const onPointerCancel = () => {
    pointerId = null;
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerCancel);

  return () => {
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("pointercancel", onPointerCancel);
  };
}
