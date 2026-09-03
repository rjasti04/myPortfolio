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

export function initResumePdf() {
  const trigger = document.getElementById("resume-pdf-view");
  const modal = document.getElementById("resume-pdf-modal");
  const frame = document.getElementById("resume-pdf-frame");
  const closeButton = document.getElementById("resume-pdf-modal-close");
  if (!trigger || !modal || !frame) return;

  const teardown = () => {
    // Dropping the element rather than blanking its src: a same-origin
    // about:blank navigation leaves a live frame in the DOM, and the PDF
    // plugin keeps its rendering surface alive behind the closed dialog.
    frame.replaceChildren();
  };

  trigger.addEventListener("click", (event) => {
    if (!supportsEmbeddedPdf()) return; // let the link navigate

    event.preventDefault();
    const iframe = document.createElement("iframe");
    iframe.className = "pdf-modal-iframe";
    iframe.title = "Resume of Rajeev Jasti";
    // The href, not a hardcoded name: the build content-hashes the PDF.
    iframe.src = trigger.getAttribute("href") || getResumeUrl();
    frame.replaceChildren(iframe);

    openModal(modal, { initialFocus: closeButton || modal, onClose: teardown });
  });

  closeButton?.addEventListener("click", () => closeModal(modal));
  modal.addEventListener("click", (event) => {
    // Backdrop only. A click inside the panel - including anywhere on the
    // iframe - must not dismiss it.
    if (event.target === modal) closeModal(modal);
  });
}
