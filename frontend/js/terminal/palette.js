// Ctrl+K command palette.
//
// This is the payoff for modelling commands as data: the palette is a second
// renderer over the same registry, so every command written for the terminal
// is reachable site-wide with no duplicated list to maintain.

const OPEN_KEY = "k";

export function initPalette({ registry, run, panel }) {
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
    if (!word) return registry.visible();
    return registry
      .visible()
      .filter((command) => command.name.includes(word) || command.summary.toLowerCase().includes(word))
      .sort((a, b) => a.name.indexOf(word) - b.name.indexOf(word));
  }

  function render() {
    items = matches();
    if (activeIndex >= items.length) activeIndex = 0;
    listEl.replaceChildren();

    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "cmd-palette-empty";
      empty.textContent = "No matching command";
      listEl.appendChild(empty);
      return;
    }

    items.forEach((command, index) => {
      const li = document.createElement("li");
      li.className = "cmd-palette-item";
      li.id = `cmd-palette-item-${index}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(index === activeIndex));
      if (index === activeIndex) li.classList.add("is-active");

      const name = document.createElement("span");
      name.className = "cmd-palette-name";
      name.textContent = command.usage ?? command.name;

      const summary = document.createElement("span");
      summary.className = "cmd-palette-summary";
      summary.textContent = command.summary;

      li.append(name, summary);
      li.addEventListener("click", () => submit(command));
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

  async function submit(command) {
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
