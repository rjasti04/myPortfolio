import { supportsHover } from "./config.js";
import { closeModal, openModal } from "./modal.js";
import { getResumeUrl } from "./utils.js";

/**
 * In-page preview for the resume PDF, plus the hero's split button.
 *
 * Every trigger is a plain `[data-pdf-view]` link in the markup and stays one:
 * without JS, on a touch device, or on iOS it navigates to the file and the
 * browser's own viewer takes over. Only where an embedded viewer actually
 * works does the click get intercepted and turned into a dialog.
 *
 * Two constraints shape the viewer:
 *
 *  1. `<embed>`/`<object>` are dead on arrival - index.html's CSP sets
 *     `object-src 'none'`. An <iframe> is what is allowed, under the
 *     `default-src 'self'` fallback.
 *  2. The viewer cannot live inside `#resume .item`. That card is a
 *     `.tilt-card`, and mousemove does not cross an iframe boundary, so
 *     tilt.js would freeze it mid-rotation with the pointer stuck inside a
 *     document that never reports moving. The dialog sits outside the card
 *     and leaves the tilt alone.
 */

/**
 * True where an iframe renders the whole PDF, not just its first page.
 *
 * iOS - including iPadOS, which reports itself as "MacIntel" with touch
 * points and can pair with a trackpad, so `hover: hover` is not enough to
 * exclude it - renders page one in a fixed, unscrollable box. Showing a
 * 3-page resume that way is worse than the native viewer, so those devices
 * keep the plain link.
 */
function supportsEmbeddedPdf() {
  if (!supportsHover.matches) return false;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return !isIOS;
}

/**
 * The hero's split button: one silhouette, two controls. The caret opens the
 * secondary action rather than spending a second full-width button on it.
 *
 * Deliberately not built on `.header-dropdown`: that machinery belongs to the
 * header bar and carries its panel chrome, its body `.dropdown-open` dimming,
 * and a Tab trap sized for the theme customiser's whole form. This is one menu
 * item, so it borrows the aria contract and nothing else.
 */
function initSplitButton() {
  const split = document.getElementById("hero-resume-split");
  const toggle = document.getElementById("hero-pdf-more");
  const menu = document.getElementById("hero-pdf-menu");
  if (!split || !toggle || !menu) return () => {};

  const setOpen = (open) => {
    split.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    menu.setAttribute("aria-hidden", String(!open));
  };

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = !split.classList.contains("is-open");
    setOpen(willOpen);
    // rAF because the menu transitions out of visibility:hidden and cannot
    // take focus until that has applied - the same reason the header panels do.
    if (willOpen) requestAnimationFrame(() => menu.querySelector("a")?.focus());
  });

  // Any choice made, or any click landing elsewhere, closes it.
  menu.addEventListener("click", () => setOpen(false));
  document.addEventListener("click", (event) => {
    if (!split.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !split.classList.contains("is-open")) return;
    setOpen(false);
    toggle.focus();
  });

  return () => setOpen(false);
}

export function initResumePdf() {
  // The main segment sits inside the split button, so its click never counts as
  // "outside" - the menu would be left hanging open behind the dialog.
  const closeSplitMenu = initSplitButton();

  const triggers = Array.from(document.querySelectorAll("[data-pdf-view]"));
  const modal = document.getElementById("resume-pdf-modal");
  const frame = document.getElementById("resume-pdf-frame");
  const closeButton = document.getElementById("resume-pdf-modal-close");
  if (triggers.length === 0 || !modal || !frame) return;

  const teardown = () => {
    // Dropping the element rather than blanking its src: a same-origin
    // about:blank navigation leaves a live frame in the DOM, and the PDF
    // plugin keeps its rendering surface alive behind the closed dialog.
    frame.replaceChildren();
  };

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      if (!supportsEmbeddedPdf()) return; // let the link navigate

      event.preventDefault();
      closeSplitMenu();
      const iframe = document.createElement("iframe");
      iframe.className = "pdf-modal-iframe";
      iframe.title = "Resume of Rajeev Jasti";
      // The href, not a hardcoded name: the build content-hashes the PDF.
      iframe.src = trigger.getAttribute("href") || getResumeUrl();
      frame.replaceChildren(iframe);

      openModal(modal, { initialFocus: closeButton || modal, onClose: teardown });
    });
  });

  closeButton?.addEventListener("click", () => closeModal(modal));
  modal.addEventListener("click", (event) => {
    // Backdrop only. A click inside the panel - including anywhere on the
    // iframe - must not dismiss it.
    if (event.target === modal) closeModal(modal);
  });
}
