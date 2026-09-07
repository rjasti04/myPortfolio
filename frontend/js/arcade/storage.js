/**
 * Per-browser persistence for the arcade.
 *
 * Every read and write is wrapped, because `localStorage` is not merely
 * "sometimes empty" - in a private window, or with site data blocked, the
 * accessor itself throws on first touch. An arcade that refuses to boot
 * because it could not read a high score would be a poor trade, so every
 * failure here degrades to "no saved score" and the games carry on.
 *
 * One namespace prefix keeps the six games from colliding with each other and
 * from colliding with the SPA, which stores its own keys on the same origin.
 */

const PREFIX = "rj-arcade:";

/** Highest score seen for a game, or 0 when nothing is stored or storage is unavailable. */
export function readBest(gameId) {
  try {
    const raw = window.localStorage.getItem(`${PREFIX}best:${gameId}`);
    const value = Number.parseInt(raw ?? "", 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * Store `score` when it beats what is already there.
 * Returns true when this run set a new record, so the caller can celebrate it.
 */
export function writeBest(gameId, score) {
  const previous = readBest(gameId);
  if (!Number.isFinite(score) || score <= previous) return false;
  try {
    window.localStorage.setItem(
      `${PREFIX}best:${gameId}`,
      String(Math.floor(score)),
    );
  } catch {
    // Storage is full or blocked. The score still stands for this session.
  }
  return true;
}

/** Sound preference. Defaults to on - this is a game the visitor opened deliberately. */
export function readMuted() {
  try {
    return window.localStorage.getItem(`${PREFIX}muted`) === "1";
  } catch {
    return false;
  }
}

export function writeMuted(muted) {
  try {
    window.localStorage.setItem(`${PREFIX}muted`, muted ? "1" : "0");
  } catch {
    // Preference is session-only. Not worth surfacing.
  }
}
