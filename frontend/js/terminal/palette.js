// Ctrl+K command palette.
//
// This is the payoff for modelling commands as data: the palette is a second
// renderer over the same registry, so every command written for the terminal
// is reachable site-wide with no duplicated list to maintain.
//
// It searches page content on the same seam. CONTENT_INDEX is generated from
// content/resume.json and the section headings, so a visitor typing "Redshift"
// or "Kafka" lands on the part of the page that says so. Find-in-page cannot
// do that here: the router keeps one section in the DOM at a time, so seven
// eighths of the site is never there for the browser to find.

import { CONTENT_INDEX } from "../search-index.js";

const OPEN_KEY = "k";

// Content results are capped so a broad word ("data") cannot push every
// command off the list. Commands are always rendered first for the same reason.
const MAX_CONTENT_RESULTS = 6;
const SNIPPET_RADIUS = 55;

/** An excerpt of `text` centred on `word`, with ellipses where it was cut. */
function snippet(text, word) {
  const at = text.toLowerCase().indexOf(word);
  if (at < 0) return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  const from = Math.max(0, at - SNIPPET_RADIUS);
  const to = Math.min(text.length, at + word.length + SNIPPET_RADIUS);
  return `${from > 0 ? "..." : ""}${text.slice(from, to).trim()}${to < text.length ? "..." : ""}`;
}

/** Commands whose name or summary contains `word`, best prefix match first. */
function commandMatches(registry, word) {
  const visible = registry.visible();
  const hits = word
    ? visible
        .filter((c) => c.name.includes(word) || c.summary.toLowerCase().includes(word))
        .sort((a, b) => a.name.indexOf(word) - b.name.indexOf(word))
    : visible;
  return hits.map((command) => ({
    kind: "command",
    command,
    label: command.usage ?? command.name,
    detail: command.summary,
  }));
}

/** Page content containing `word`. A title hit outranks a body hit. */
function contentMatches(word) {
  if (!word) return [];
  return CONTENT_INDEX.map((entry) => {
    const title = entry.title.toLowerCase();
    const text = (entry.text || "").toLowerCase();
    const inTitle = title.includes(word);
    if (!inTitle && !text.includes(word)) return null;
    return {
      kind: "content",
      entry,
      label: entry.title,
      detail: snippet(entry.text || "", word),
      rank: inTitle ? 0 : 1,
    };
  })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_CONTENT_RESULTS);
}

export function initPalette({ registry, run, panel, navigate }) {
  let root = null;
  let field = null;
  let listEl = null;
  let items = [];
  let activeIndex = 0;
  let lastFocused = null;

  function build() {
    root = document.createElement("div");
    root.className = "cmd-palette";
    root.hidden = true;
    root.innerHTML = `
      <div class="cmd-palette-backdrop" data-palette-close></div>
      <div class="cmd-palette-box" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="cmd-palette-field">
          <span class="cmd-palette-prompt" aria-hidden="true">$</span>
          <input type="text" class="cmd-palette-input" id="cmd-palette-input"
            role="combobox" aria-expanded="true" aria-controls="cmd-palette-list"
            aria-autocomplete="list" autocomplete="off" spellcheck="false"
            placeholder="Run a command..." aria-label="Run a command" />
        </div>
        <ul class="cmd-palette-list" id="cmd-palette-list" role="listbox" aria-label="Commands"></ul>
        <p class="cmd-palette-hint">
          <kbd>&uarr;</kbd><kbd>&darr;</kbd> navigate &middot; <kbd>Enter</kbd> run &middot; <kbd>Esc</kbd> close
        </p>
      </div>`;
    document.body.appendChild(root);

    field = root.querySelector(".cmd-palette-input");
    listEl = root.querySelector(".cmd-palette-list");

    root.addEventListener("click", (event) => {
      if (event.target.closest("[data-palette-close]")) close();
    });
    field.addEventListener("input", render);
    field.addEventListener("keydown", onFieldKeydown);
  }

  function matches() {
    const query = field.value.trim().toLowerCase();
    const word = query.split(/\s+/)[0] ?? "";
    return [...commandMatches(registry, word), ...contentMatches(word)];
  }

  function render() {
    items = matches();
    if (activeIndex >= items.length) activeIndex = 0;
    listEl.replaceChildren();

    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "cmd-palette-empty";
      empty.textContent = "No matching command or content";
      listEl.appendChild(empty);
      // The option it pointed at was just removed; an id reference to nothing
      // leaves a screen reader announcing a stale or empty option.
      field.removeAttribute("aria-activedescendant");
      return;
    }

    items.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = "cmd-palette-item";
      li.id = `cmd-palette-item-${index}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(index === activeIndex));
      if (index === activeIndex) li.classList.add("is-active");

      const name = document.createElement("span");
      name.className = "cmd-palette-name";
      name.textContent = item.label;

      const summary = document.createElement("span");
      summary.className = "cmd-palette-summary";
      summary.textContent = item.detail;

      li.append(name, summary);

      // The list stays one flat listbox - a group header <li> between options
      // is invalid inside role="listbox". The badge is part of the option, so
      // a screen reader announces the kind along with the label instead.
      if (item.kind === "content") {
        li.classList.add("cmd-palette-item--content");
        const badge = document.createElement("span");
        badge.className = "cmd-palette-kind";
        badge.textContent = `in ${item.entry.section}`;
        li.append(badge);
      }

      li.addEventListener("click", () => submit(item));
      listEl.appendChild(li);
    });

    field.setAttribute("aria-activedescendant", `cmd-palette-item-${activeIndex}`);
    const active = listEl.children[activeIndex];
    if (typeof active?.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest" });
    }
  }

  function move(delta) {
    if (!items.length) return;
    activeIndex = (activeIndex + delta + items.length) % items.length;
    render();
  }

  async function submit(item) {
    if (item?.kind === "content") {
      const { section, anchor } = item.entry;
      close();
      // The same navigation the `cd` command uses, so there is one router
      // entry point rather than a second one that drifts from it.
      if (typeof navigate === "function") await navigate(section);
      else window.location.hash = section;
      if (anchor) {
        const target = document.getElementById(anchor);
        // Landing on a heading without moving focus leaves a keyboard user at
        // the top of the page; -1 makes the heading focusable for this jump
        // without adding it to the tab order.
        if (target) {
          target.setAttribute("tabindex", "-1");
          target.focus({ preventScroll: true });
          // Guarded the same way the result list guards its own call: focus has
          // already moved, so a missing scrollIntoView costs smoothness, not
          // the navigation.
          // Read at call time rather than through config.js, whose import-time
          // matchMedia call would tie this module to a window at load.
          if (typeof target.scrollIntoView === "function") {
            const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
            target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
          }
        }
      }
      return;
    }

    const command = item?.command ?? item;
    const typed = field.value.trim();
    const hasArgs = typed.split(/\s+/).length > 1;
    const line = hasArgs ? typed : (command?.name ?? typed);
    if (!line) return;

    const target = registry.get(line.split(/\s+/)[0]);
    close();
    // Commands that don't navigate write their output into the About-page
    // terminal, so bring the reader there before running them.
    if (target && !target.navigates && panel && !panel.closest("section.active")) {
      window.location.hash = "about";
    }
    await run(line);
  }

  function onFieldKeydown(event) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Enter":
        event.preventDefault();
        submit(items[activeIndex]);
        break;
      case "Tab": {
        // Keep focus inside the dialog.
        event.preventDefault();
        break;
      }
      default:
        break;
    }
  }

  function open() {
    if (!root) build();
    lastFocused = document.activeElement;
    root.hidden = false;
    document.body.classList.add("cmd-palette-open");
    field.value = "";
    activeIndex = 0;
    render();
    field.focus();
  }

  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    document.body.classList.remove("cmd-palette-open");
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
    lastFocused = null;
  }

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === OPEN_KEY) {
      event.preventDefault();
      if (root && !root.hidden) close();
      else open();
    }
  });

  return { open, close };
}
