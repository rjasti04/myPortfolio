/**
 * Category filter for the Apps shelf.
 *
 * The seven tiles each carried a visible category eyebrow - Football, Games,
 * Dev Tools, Security - that was decoration only: the grid was flat and there
 * was no way to act on it. This makes the labels the control.
 *
 * Reads `data-app-category` on the tile rather than the eyebrow's text, so the
 * visible label and the filter key can differ and neither depends on the
 * other's wording.
 *
 * The chip row ships `js-only`, so with scripting off the grid just shows
 * everything - which is the right no-JS state for a launcher.
 */

const ALL = "all";

/** The section this filter lives in, and the first segment of its fragment. */
const SECTION = "apps";

/**
 * The filter carried by the fragment, if any.
 *
 * "#apps/dev-tools" is the apps section with the Dev Tools chip pressed. Both
 * routers resolve a section from the first segment only, so the rest is ours
 * to read and nothing else looks at it.
 */
function filterFromHash(hash) {
  const [section, ...rest] = (hash || "").replace(/^#/, "").split("/");
  if (section !== SECTION || rest.length === 0) return null;
  return rest.join("/").trim() || null;
}

/**
 * Rewrite the fragment to match the chosen filter.
 *
 * `replaceState`, not `pushState`: pressing four chips in a row should leave
 * one Back press to wherever the visitor came from, not four. The chips only
 * exist inside the shelf, so a press already means the shelf is what is on
 * screen - there is nothing to guard against here beyond writing the fragment
 * that is already there.
 */
function writeHash(next) {
  const target = next === ALL ? `#${SECTION}` : `#${SECTION}/${next}`;
  if (window.location.hash === target) return;
  window.history.replaceState(null, "", target);
}

/**
 * Hide a tile from BOTH the pointer and the accessibility tree.
 *
 * `hidden` alone is not enough: `.app-tile` is `display: flex` from the grid
 * rules, and a display declaration beats the `hidden` attribute's UA style, so
 * a hidden tile would keep its box and stay tabbable. The class is what takes
 * it out of the layout; the attribute is what takes it out of the tree.
 */
function setTileVisible(tile, visible) {
  tile.classList.toggle("is-filtered-out", !visible);
  tile.toggleAttribute("hidden", !visible);
}

export function initAppsFilter() {
  const filter = document.getElementById("app-filter");
  const grid = document.querySelector(".app-grid");
  if (!filter || !grid) return;

  const chips = Array.from(filter.querySelectorAll("[data-app-filter]"));
  const tiles = Array.from(grid.querySelectorAll("[data-app-category]"));
  const status = document.getElementById("app-filter-status");
  if (chips.length === 0 || tiles.length === 0) return;

  // The counts are rendered in the markup so they are right before this module
  // loads; correcting them here keeps them honest if a tile is added and the
  // chip is not updated with it.
  const counts = new Map([[ALL, tiles.length]]);
  for (const tile of tiles) {
    const category = tile.dataset.appCategory;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  for (const chip of chips) {
    const slot = chip.querySelector(".app-filter-count");
    const count = counts.get(chip.dataset.appFilter) ?? 0;
    if (slot) slot.textContent = String(count);
    // A category with nothing in it is not a choice worth offering.
    if (count === 0 && chip.dataset.appFilter !== ALL) chip.hidden = true;
  }

  function apply(next) {
    let shown = 0;
    for (const tile of tiles) {
      const visible = next === ALL || tile.dataset.appCategory === next;
      setTileVisible(tile, visible);
      if (visible) shown += 1;
    }

    for (const chip of chips) {
      chip.setAttribute("aria-pressed", String(chip.dataset.appFilter === next));
    }

    if (status) {
      const label = chips
        .find((chip) => chip.dataset.appFilter === next)
        ?.textContent.replace(/\d+$/, "")
        .trim();
      // Announced because the only other feedback is tiles vanishing, which a
      // screen reader has no way to notice.
      status.textContent =
        next === ALL
          ? `Showing all ${shown} apps.`
          : `Showing ${shown} ${shown === 1 ? "app" : "apps"} in ${label}.`;
    }
  }

  filter.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-app-filter]");
    if (!chip || !filter.contains(chip)) return;
    // Pressing the active chip again clears the filter rather than doing
    // nothing - the row has no separate "clear", and a dead control is worse
    // than a redundant one.
    const current = chip.getAttribute("aria-pressed") === "true";
    const next = current ? ALL : chip.dataset.appFilter;
    apply(next);
    writeHash(next);
  });

  // A filter is a thing worth linking to: "look at the dev tools" should be a
  // URL, not an instruction. An unknown slug falls back to All rather than
  // painting an empty grid, which is what a renamed category would otherwise
  // leave behind in someone's bookmark.
  const known = new Set(chips.map((chip) => chip.dataset.appFilter));
  const fromHash = filterFromHash(window.location.hash);
  apply(fromHash && known.has(fromHash) ? fromHash : ALL);

  // The fragment can change without this module: a nav link, the Ctrl+K
  // palette, or the back button.
  window.addEventListener("hashchange", () => {
    const next = filterFromHash(window.location.hash);
    apply(next && known.has(next) ? next : ALL);
  });
}
