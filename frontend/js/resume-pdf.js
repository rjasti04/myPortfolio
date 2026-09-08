import { supportsHover } from "./config.js";
import { closeModal, openModal } from "./modal.js";
import { getResumeUrl } from "./utils.js";

/**
 * In-page preview for the resume PDF, opened from the Experience section.
 *
 * The button is a plain link in the markup and stays one: without JS, on a
 * touch device, or on iOS it navigates to the file and the browser's own
 * viewer takes over. Only where an embedded viewer actually works does the
 * click get intercepted and turned into a dialog.
 *
 * Two constraints shape this:
 *
 *  1. `<embed>`/`<object>` are dead on arrival - index.html's CSP sets
 *     `object-src 'none'`. An <iframe> is what is allowed, under the
 *     `default-src 'self'` fallback.
 *  2. The viewer stays outside `#resume .item`. A dialog can size itself to
 *     the viewport, while an iframe inside a card several screens tall would
 *     be scrolled past rather than read - and mousemove does not cross an
 *     iframe boundary, so any pointer effect on the card would stick while
 *     the pointer sat inside the viewer.
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

export function initResumePdf() {
  const trigger = document.getElementById("resume-pdf-view");
  const modal = document.getElementById("resume-pdf-modal");
  const frame = document.getElementById("resume-pdf-frame");
  const closeButton = document.getElementById("resume-pdf-modal-close");
  if (!trigger || !modal || !frame) return;

  // How long a blank panel is allowed to stay unexplained. A PDF that has not
  // painted by now is either very slow or never arriving, and the visitor
  // deserves to be told which controls they have either way.
  const SLOW_LOAD_MS = 8000;

  let slowTimer = null;

  const clearSlowTimer = () => {
    if (slowTimer !== null) {
      window.clearTimeout(slowTimer);
      slowTimer = null;
    }
  };

  const teardown = () => {
    clearSlowTimer();
    // Dropping the element rather than blanking its src: a same-origin
    // about:blank navigation leaves a live frame in the DOM, and the PDF
    // plugin keeps its rendering surface alive behind the closed dialog.
    frame.replaceChildren();
  };

  /**
   * The panel's own status line.
   *
   * The dialog used to open in the same tick as the iframe was created, with
   * nothing between the visitor and a blank white sheet - no way to tell a
   * slow fetch from a 404 on a content-hashed filename behind a stale service
   * worker. This is that missing state.
   */
  function statusNode(state, message) {
    const box = document.createElement("div");
    box.className = "pdf-modal-status";
    box.dataset.state = state;
    box.setAttribute("role", "status");

    const icon = document.createElement("i");
    icon.className =
      state === "error" ? "fas fa-triangle-exclamation" : "fas fa-circle-notch fa-spin";
    icon.setAttribute("aria-hidden", "true");

    const text = document.createElement("p");
    text.className = "pdf-modal-status-text";
    text.textContent = message;

    box.append(icon, text);

    // Every non-loading state offers the escape hatch that always works: the
    // browser's own viewer, which is what non-hover and iOS visitors get
    // anyway.
    if (state !== "loading") {
      const link = document.createElement("a");
      link.className = "btn btn-outline pdf-modal-status-link";
      link.href = trigger.getAttribute("href") || getResumeUrl();
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open the PDF in a new tab";
      box.appendChild(link);
    }
    return box;
  }

  trigger.addEventListener("click", (event) => {
    if (!supportsEmbeddedPdf()) return; // let the link navigate

    event.preventDefault();
    const iframe = document.createElement("iframe");
    iframe.className = "pdf-modal-iframe";
    iframe.title = "Resume of Rajeev Jasti";
    // The href, not a hardcoded name: the build content-hashes the PDF.
    iframe.src = trigger.getAttribute("href") || getResumeUrl();

    const status = statusNode("loading", "Loading resume\u2026");
    // The iframe paints under the status, so removing the status is the whole
    // of the transition to "ready".
    frame.replaceChildren(status, iframe);

    iframe.addEventListener("load", () => {
      clearSlowTimer();
      status.remove();
    }, { once: true });

    // A cross-origin or blocked fetch. A 404 on a same-origin path usually
    // renders the server's error page and fires `load` instead, which is why
    // the timeout below exists as well rather than only this.
    iframe.addEventListener("error", () => {
      clearSlowTimer();
      status.replaceWith(
        statusNode("error", "The resume preview could not be loaded.")
      );
    }, { once: true });

    clearSlowTimer();
    slowTimer = window.setTimeout(() => {
      slowTimer = null;
      if (!status.isConnected) return;
      status.replaceWith(
        statusNode("slow", "The preview is taking longer than usual.")
      );
    }, SLOW_LOAD_MS);

    openModal(modal, { initialFocus: closeButton || modal, onClose: teardown });
  });

  closeButton?.addEventListener("click", () => closeModal(modal));
  modal.addEventListener("click", (event) => {
    // Backdrop only. A click inside the panel - including anywhere on the
    // iframe - must not dismiss it.
    if (event.target === modal) closeModal(modal);
  });
}
