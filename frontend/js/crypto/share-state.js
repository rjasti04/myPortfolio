/**
 * Share-link state for /crypto.
 *
 * The Share button used to copy `window.location.href`, which on this page is
 * the origin plus a tab hash - so it promised a "permalink" and delivered a
 * link to the tab. `/cron` set the bar for what that word means
 * (`cron-main.js`), and this brings the workbench up to it.
 *
 * What travels is the *shape* of the workbench: which tab, which encoder
 * format, which generator and how much of it. What deliberately does not
 * travel is anything you typed - plaintext waiting to be hashed, an HMAC key,
 * a token, a generated secret. A share link is pasted into chat windows and
 * ticket comments, and a tool whose share button can leak the thing you came
 * to it to handle is worse than one that shares nothing.
 *
 * Both functions take the document and a URL string rather than reading
 * globals, so they are exercisable without a page.
 */

/**
 * The settings that may travel, as [search param, element id].
 *
 * Every one of these is a <select> or a range - a closed set of values chosen
 * from the UI, never free text. That is what makes the allowlist safe to widen
 * later without re-deciding the privacy question each time.
 */
const SHARED_CONTROLS = [
  ["format", "encoder-format"],
  ["gen", "gen-type"],
  ["batch", "gen-batch"],
  ["len", "gen-length"],
];

const VALID_TABS = ["encoders", "hasher", "generators", "jwt", "time"];

/** Build the URL the Share button copies: current tab plus the shared settings. */
export function buildShareUrl(doc, href) {
  const url = new URL(href);
  url.search = "";

  const tab = (url.hash || "").replace(/^#/, "");
  if (!VALID_TABS.includes(tab)) url.hash = "#encoders";

  for (const [param, id] of SHARED_CONTROLS) {
    const el = doc.getElementById(id);
    if (!el || el.value === "" || el.value == null) continue;
    url.searchParams.set(param, String(el.value));
  }

  return url.toString();
}

/**
 * Apply the settings carried by a share link to the controls that own them.
 *
 * A value that is not one of the option values the page actually offers is
 * dropped rather than assigned: a <select> silently accepts an unknown value
 * by going blank, which would turn a mistyped link into an empty control.
 *
 * Returns the ids that were changed, so the caller knows whether to re-render.
 */
export function applyShareState(doc, href) {
  const params = new URL(href).searchParams;
  const applied = [];

  for (const [param, id] of SHARED_CONTROLS) {
    if (!params.has(param)) continue;
    const el = doc.getElementById(id);
    if (!el) continue;
    const value = params.get(param);

    if (el.tagName === "SELECT") {
      const known = Array.from(el.options).some((o) => o.value === value);
      if (!known) continue;
    } else if (el.type === "range") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < Number(el.min) || n > Number(el.max)) continue;
    }

    el.value = value;
    applied.push(id);
  }

  return applied;
}
