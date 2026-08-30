/**
 * Experience section.
 *
 * Two small jobs, both of them things the markup cannot do on its own.
 *
 * 1. Role durations are computed from the dates rather than typed into the
 *    page. A hand-written "8+ years" is wrong the month after it ships;
 *    `data-start` / `data-end` never go stale. The HTML still carries a
 *    correct-at-authoring fallback so a no-JS visitor sees a real number.
 *
 * 2. The density switch. This page has two readers - someone scanning for
 *    thirty seconds and someone reading properly - so "Highlights" and
 *    "Full detail" open or close every method disclosure at once. The prose
 *    lives in the DOM either way, so find-in-page, print and crawlers see
 *    it regardless of which way the switch is set.
 */

const DENSITY_KEY = "rj_experience_density";
const DENSITIES = ["highlights", "full"];

/** "2018-02" -> Date, "present" -> today. Anything else -> null. */
function parseMonth(value) {
  const raw = (value || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "present" || raw === "now") return new Date();
  const match = /^(\d{4})-(\d{1,2})$/.exec(raw);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return new Date(Number(match[1]), month - 1, 1);
}

/**
 * Months between two dates, counted the way a resume counts them: Feb 2018
 * to Feb 2019 is "1 yr 1 mo", not "1 yr". Both endpoints are inclusive.
 */
export function monthsBetween(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth()) +
    1;
  return months > 0 ? months : 0;
}

/** 103 -> "8 yr 7 mo"; 12 -> "1 yr"; 7 -> "7 mo". */
export function formatSpan(months) {
  if (!Number.isFinite(months) || months <= 0) return "";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years > 0) parts.push(`${years} yr`);
  if (rest > 0) parts.push(`${rest} mo`);
  return parts.join(" ");
}

function renderSpans(root) {
  root.querySelectorAll("[data-xp-span]").forEach((element) => {
    const start = parseMonth(element.dataset.start);
    const end = parseMonth(element.dataset.end);
    if (!start || !end) return;
    const label = formatSpan(monthsBetween(start, end));
    // Leave the authored fallback in place rather than blanking the element
    // if the dates ever fail to parse into something sensible.
    if (label) element.textContent = label;
  });
}

function readStoredDensity() {
  try {
    const stored = localStorage.getItem(DENSITY_KEY);
    return DENSITIES.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

function storeDensity(density) {
  try {
    localStorage.setItem(DENSITY_KEY, density);
  } catch {
    /* Private mode or a blocked origin - the switch still works, it just
       will not be remembered. Not worth surfacing to the user. */
  }
}

function initDensity(section) {
  const group = section.querySelector("#xp-density");
  const disclosures = Array.from(section.querySelectorAll(".xp-how"));
  if (!group || disclosures.length === 0) return;

  const buttons = Array.from(group.querySelectorAll("[data-density]"));

  /* `null` means "mixed" - the reader has opened some cards by hand, so
     neither button is the truth and neither should claim to be. */
  const paint = (density) => {
    buttons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.density === density),
      );
    });
    /* Namespaced so it cannot be confused with the buttons' own
       `data-density`; a bare `[data-density]` query would otherwise pick up
       the section itself. */
    if (density) section.dataset.xpDensity = density;
    else delete section.dataset.xpDensity;
  };

  const apply = (density) => {
    const open = density === "full";
    disclosures.forEach((item) => { item.open = open; });
    paint(density);
    storeDensity(density);
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => apply(button.dataset.density));
  });

  // Toggling one card by hand must not leave the switch asserting something
  // untrue, so the group re-derives its state from the cards themselves.
  disclosures.forEach((item) => {
    item.addEventListener("toggle", () => {
      const openCount = disclosures.filter((entry) => entry.open).length;
      if (openCount === 0) paint("highlights");
      else if (openCount === disclosures.length) paint("full");
      else paint(null);
    });
  });

  apply(readStoredDensity() || "highlights");

  /* A printed page has no density switch, so it should never withhold the
     method prose. CSS cannot force this open on its own - Chrome renders
     the closed content through `::details-content` with `content-visibility:
     hidden`, which no author `display` rule can override - so the disclosure
     state is flipped for the duration of the print and restored after. */
  const printState = new WeakMap();

  window.addEventListener("beforeprint", () => {
    disclosures.forEach((item) => {
      printState.set(item, item.open);
      item.open = true;
    });
  });

  window.addEventListener("afterprint", () => {
    disclosures.forEach((item) => {
      if (printState.has(item)) item.open = printState.get(item);
    });
  });
}

export function initExperience() {
  const section = document.getElementById("resume");
  if (!section) return;
  renderSpans(section);
  initDensity(section);
}
