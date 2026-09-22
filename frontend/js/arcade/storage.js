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

/**
 * Every game that has a stored best, as `{ [gameId]: score }`.
 *
 * Reads the namespace rather than a list of known ids, so a game that is
 * renamed or removed leaves its key here to be cleared rather than stranded.
 */
export function readAllBests() {
  const out = {};
  try {
    const prefix = `${PREFIX}best:`;
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const value = Number.parseInt(window.localStorage.getItem(key) ?? "", 10);
      if (Number.isFinite(value) && value > 0) out[key.slice(prefix.length)] = value;
    }
  } catch {
    // Storage blocked: no saved scores, which is the same answer as none set.
  }
  return out;
}

/**
 * Forget every stored best.
 *
 * A prefix sweep, not a list of ids, for the same reason as above. The sound
 * preference lives under the same namespace and is deliberately left alone:
 * "clear my scores" is not "reset the arcade".
 *
 * Returns the number of scores removed, so the caller can say what it did.
 */
export function clearAllBests() {
  let removed = 0;
  try {
    const prefix = `${PREFIX}best:`;
    const doomed = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) {
      window.localStorage.removeItem(key);
      removed += 1;
    }
  } catch {
    // Nothing was readable, so nothing was stored to remove.
  }
  return removed;
}
