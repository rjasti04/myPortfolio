/**
 * Keyboard shortcuts and the sheet that documents them, shared by the apps.
 *
 * /diff bound `j`/`k` to step through changes and guarded correctly against
 * text fields and modifier keys - and nothing told anyone it existed. No other
 * app had a document-level shortcut at all, and none of the seven had a `?`
 * sheet, so /diff's own bindings were undiscoverable too. For a shelf whose
 * audience is developers that was the cheapest credibility left on the table.
 *
 * The sheet is GENERATED from the table that does the binding, not written by
 * hand beside it. A hand-written sheet is a second source of truth that starts
 * drifting the first time a shortcut is renamed, and a shortcuts sheet that
 * lies is worse than none.
 *
 * Per-app extras register through the same table, so /diff's `j`/`k` appear in
 * its sheet and nowhere else.
 */

/** Shortcuts every app gets. `?` is last so it reads as the way out of itself. */
function baseShortcuts({ focusPrimary, tabs }) {
  const list = [];

  if (focusPrimary) {
    list.push({
      keys: ["/"],
      label: "Focus the main input",
      run: (event) => {
        const target = document.querySelector(focusPrimary);
        if (!target) return false;
        // preventDefault, or the "/" lands in the field it just focused -
        // which is how Firefox's quick-find used to eat this shortcut.
        event.preventDefault();
        target.focus();
        if (typeof target.select === "function") target.select();
        return true;
      },
    });
  }

  if (tabs) {
    list.push({
      keys: ["1", "…"],
      label: "Switch tab",
      match: (event) => /^[1-9]$/.test(event.key),
      run: (event) => {
        const buttons = Array.from(document.querySelectorAll(tabs));
        const target = buttons[Number(event.key) - 1];
        if (!target) return false;
        target.click();
        target.focus();
        return true;
      },
    });
  }

  return list;
}

/**
 * True when a keystroke belongs to whatever the visitor is typing in, or
 * carries a modifier. The same guard /diff already applied, in one place.
 */
function isTypingContext(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  const el = event.target;
  const tag = el?.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return true;
  return Boolean(el?.isContentEditable);
}

/**
 * Bind the shortcuts and build the sheet.
 *
 * @param {object} options
 * @param {string} [options.focusPrimary] - selector for the app's main input
 * @param {string} [options.tabs] - selector for the tab buttons, in order
 * @param {Array<{keys: string[], label: string, match?: Function, run?: Function}>}
 *   [options.extra] - per-app bindings, listed in the sheet alongside the rest.
 *   An entry with no `run` is documentation only: it appears in the sheet and
 *   binds nothing, which is how a key the app itself owns gets listed without
 *   two handlers fighting over it.
 * @param {() => boolean} [options.suppress] - true while this module should
 *   keep its hands off the keyboard entirely. /arcade passes one for the time
 *   a game is on screen: Escape belongs to the game then, and a sheet that
 *   also answered it would pause the run on the way out.
 * @param {Document} [options.doc]
 * @returns {{ open: () => void, close: () => void, shortcuts: Array }}
 */
export function initAppShortcuts({
  focusPrimary,
  tabs,
  extra = [],
  suppress,
  doc = document,
} = {}) {
  const shortcuts = [...baseShortcuts({ focusPrimary, tabs }), ...extra];

  const sheet = buildSheet(doc, shortcuts);
  doc.body.appendChild(sheet.root);

  function close() {
    if (sheet.root.hidden) return;
    sheet.root.hidden = true;
    sheet.lastFocus?.focus?.();
  }

  function open() {
    if (!sheet.root.hidden) return;
    sheet.lastFocus = doc.activeElement;
    sheet.root.hidden = false;
    sheet.closeButton.focus();
  }

  doc.addEventListener("keydown", (event) => {
    if (typeof suppress === "function" && suppress()) {
      // Suppressed mid-sheet means the app took over while it was open, so
      // put it away rather than leaving it floating over whatever took focus.
      if (!sheet.root.hidden) close();
      return;
    }

    // Escape closes the sheet from anywhere, including a text field - it is
    // the one key that has to work while you are typing.
    if (event.key === "Escape" && !sheet.root.hidden) {
      close();
      return;
    }

    if (isTypingContext(event)) return;

    if (event.key === "?") {
      event.preventDefault();
      if (sheet.root.hidden) open();
      else close();
      return;
    }

    if (!sheet.root.hidden) return;

    for (const shortcut of shortcuts) {
      if (typeof shortcut.run !== "function") continue;
      const matches = shortcut.match
        ? shortcut.match(event)
        : shortcut.keys.includes(event.key);
      if (matches && shortcut.run(event) !== false) return;
    }
  });

  return { open, close, shortcuts };
}

function buildSheet(doc, shortcuts) {
  const root = doc.createElement("div");
  root.className = "shortcuts-sheet";
  root.id = "shortcuts-sheet";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "shortcuts-sheet-title");
  root.hidden = true;

  const panel = doc.createElement("div");
  panel.className = "shortcuts-panel";

  const heading = doc.createElement("h2");
  heading.className = "shortcuts-title";
  heading.id = "shortcuts-sheet-title";
  heading.textContent = "Keyboard shortcuts";

  const list = doc.createElement("dl");
  list.className = "shortcuts-list";

  // One row per registered binding, plus `?` itself - which is bound by this
  // module rather than by the table, and so is the one entry added here.
  const rows = [
    ...shortcuts.map((s) => [s.keys, s.label]),
    [["Esc"], "Close this sheet"],
    [["?"], "Show or hide this sheet"],
  ];

  for (const [keys, label] of rows) {
    const term = doc.createElement("dt");
    for (const key of keys) {
      const kbd = doc.createElement("kbd");
      kbd.textContent = key;
      term.appendChild(kbd);
    }

    const detail = doc.createElement("dd");
    detail.textContent = label;
    list.append(term, detail);
  }

  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.className = "btn-sm shortcuts-close";
  closeButton.textContent = "Close";

  panel.append(heading, list, closeButton);
  root.appendChild(panel);

  const sheet = { root, closeButton, lastFocus: null };
  closeButton.addEventListener("click", () => {
    root.hidden = true;
    sheet.lastFocus?.focus?.();
  });
  // Clicking the backdrop dismisses, the same as Escape.
  root.addEventListener("click", (event) => {
    if (event.target !== root) return;
    root.hidden = true;
    sheet.lastFocus?.focus?.();
  });

  return sheet;
}
