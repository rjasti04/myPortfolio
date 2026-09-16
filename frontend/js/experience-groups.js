/**
 * The Experience section's collapsible groups.
 *
 * The collapsing itself is `<details>` and needs no script - this module only
 * adds what `<details>` cannot do on its own:
 *
 *  1. One control to open or close all seven at once, for a visitor who wants
 *     to read rather than scan. It is injected here rather than shipped in the
 *     markup because it does nothing without JS.
 *  2. Opening a group that something has just navigated to. The Ctrl+K palette
 *     resolves a content hit to `#exp-...` and focuses it; with the group
 *     closed that landed on a collapsed row and appeared to do nothing.
 */

/** Open every <details> on the path to `target`, including it. */
function revealDetails(target) {
  if (!target) return;
  let node = target.closest("details");
  while (node) {
    node.open = true;
    node = node.parentElement?.closest("details") ?? null;
  }
}

/**
 * Open the group a fragment names, wherever the navigation came from.
 *
 * Bound to the element rather than to the palette so a pasted URL, a
 * back/forward step and the palette all behave the same way.
 */
function syncFromHash() {
  const id = window.location.hash.slice(1);
  if (!id.startsWith("exp-")) return;
  revealDetails(document.getElementById(id));
}

export function initExperienceGroups() {
  const container = document.querySelector("#resume .item");
  if (!container) return;

  const groups = Array.from(container.querySelectorAll("details.exp-group"));
  if (groups.length === 0) return;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "exp-toggle-all";

  // The button reports what it will DO, and its aria-expanded reports the
  // state of the set it controls - those are two different things and
  // conflating them is why this kind of control usually announces backwards.
  const sync = () => {
    const allOpen = groups.every((group) => group.open);
    toggle.textContent = allOpen ? "Collapse all" : "Expand all";
    toggle.setAttribute("aria-expanded", String(allOpen));
  };

  toggle.addEventListener("click", () => {
    const allOpen = groups.every((group) => group.open);
    groups.forEach((group) => {
      group.open = !allOpen;
    });
    sync();
  });

  // `toggle` fires per <details>, including when one is opened by the palette
  // or by revealDetails, so the label never drifts from the real state.
  groups.forEach((group) => group.addEventListener("toggle", sync));

  container.parentElement.insertBefore(toggle, container);
  sync();

  window.addEventListener("hashchange", syncFromHash);
  // The palette focuses its target without changing the hash, so cover that
  // path too: anything focused inside a closed group opens it.
  document.addEventListener(
    "focusin",
    (event) => {
      if (event.target.closest?.("#resume")) revealDetails(event.target);
    },
    true
  );

  syncFromHash();
}
