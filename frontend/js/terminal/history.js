// Command history: bounded, sanitised, debounced-persisted, and versioned.
//
// v1 stored under "rj_terminal_history" and wrote synchronously on every
// Enter. v2 keeps the same shape but migrates the old key once and batches
// writes, so a fast typist no longer pays a main-thread storage write per
// keystroke-run.

export const STORAGE_KEY = "rj_terminal_history_v2";
const LEGACY_KEY = "rj_terminal_history";
const MAX_ENTRIES = 100;
const MAX_ENTRY_LENGTH = 500;
const PERSIST_DEBOUNCE_MS = 400;

function sanitise(raw) {
  if (!Array.isArray(raw)) return [];
  // Reject non-strings and truncate over-long entries individually. A single
  // oversized entry must never discard the rest of the list.
  return raw
    .filter((item) => typeof item === "string")
    .map((item) => item.slice(0, MAX_ENTRY_LENGTH))
    .filter((item) => item.length > 0)
    .slice(-MAX_ENTRIES);
}

function read(storage, key) {
  try {
    const saved = storage.getItem(key);
    return saved ? sanitise(JSON.parse(saved)) : [];
  } catch {
    return [];
  }
}

export function createHistory({ storage = globalThis.localStorage, key = STORAGE_KEY } = {}) {
  let entries = [];
  let cursor = 0;
  let timer = null;

  if (storage) {
    entries = read(storage, key);
    if (entries.length === 0) {
      const legacy = read(storage, LEGACY_KEY);
      if (legacy.length) {
        entries = legacy;
        schedulePersist();
      }
    }
  }
  cursor = entries.length;

  function persistNow() {
    timer = null;
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(entries));
    } catch {
      // Quota or private-mode failure — history stays in memory for the session.
    }
  }

  function schedulePersist() {
    if (!storage) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(persistNow, PERSIST_DEBOUNCE_MS);
  }

  return {
    /** All entries, oldest first. */
    all: () => entries.slice(),

    push(command) {
      const value = String(command).slice(0, MAX_ENTRY_LENGTH);
      if (!value) return;
      // Collapse immediate repeats, the way a real shell's HISTCONTROL does.
      if (entries[entries.length - 1] !== value) {
        entries.push(value);
        if (entries.length > MAX_ENTRIES) entries.shift();
        schedulePersist();
      }
      cursor = entries.length;
    },

    /** Older entry, or null at the top of the list. */
    prev() {
      if (entries.length === 0) return null;
      cursor = Math.max(0, cursor - 1);
      return entries[cursor] ?? null;
    },

    /** Newer entry; returns "" once the cursor walks past the newest entry. */
    next() {
      if (cursor < entries.length - 1) {
        cursor += 1;
        return entries[cursor] ?? "";
      }
      cursor = entries.length;
      return "";
    },

    resetCursor() {
      cursor = entries.length;
    },

    clear() {
      entries = [];
      cursor = 0;
      schedulePersist();
    },

    /** Test hook: force any pending write to land now. */
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        persistNow();
      }
    },
  };
}
