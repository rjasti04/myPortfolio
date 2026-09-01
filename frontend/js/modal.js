import { ModalSwipeDismiss } from "./swipe-handler.js";

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const modalFocusReturn = new WeakMap();
const modalKeydown = new WeakMap();
const modalSwipeHandlers = new WeakMap();
// Per-modal teardown, so a dialog with bookkeeping of its own still gets it run
// when the close comes from inside this module - Escape, the swipe dismiss, or
// a caller invoking closeModal directly rather than its own wrapper.
const modalOnClose = new WeakMap();

// Nested opens must not each stash their own scroll position, so the lock is
// reference counted and only the outermost close restores the page.
let scrollLockDepth = 0;
let scrollLockOffset = 0;

function lockBodyScroll() {
  if (scrollLockDepth++ > 0) return;
  scrollLockOffset = window.scrollY || window.pageYOffset || 0;
  document.body.style.top = `-${scrollLockOffset}px`;
  document.body.classList.add("modal-scroll-locked");
}

function unlockBodyScroll() {
  if (scrollLockDepth === 0) return;
  if (--scrollLockDepth > 0) return;
  document.body.classList.remove("modal-scroll-locked");
  document.body.style.top = "";
  window.scrollTo(0, scrollLockOffset);
}

export function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
    const isVisible = element.offsetParent !== null || element.getClientRects().length > 0;
    return isVisible && element.getAttribute("aria-hidden") !== "true";
  });
}

export function handleFocusTrap(event, modal) {
  if (event.key !== "Tab") return;

  const focusable = getFocusableElements(modal);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function openModal(modal, { initialFocus = null, onClose = null } = {}) {
  if (!modal) return;
  // Idempotent: the scroll lock is reference counted, so opening the same modal
  // twice used to take two locks and one close could never release it. Two
  // listeners firing for one click is enough to trigger that, which is exactly
  // what the login button did.
  if (modal.classList.contains("active")) {
    if (initialFocus && typeof initialFocus.focus === "function") initialFocus.focus();
    return;
  }
  if (onClose) modalOnClose.set(modal, onClose);
  const activeEl = typeof document !== "undefined" ? document.activeElement : null;
  const isElement = typeof HTMLElement !== "undefined"
    ? activeEl instanceof HTMLElement
    : Boolean(activeEl && typeof activeEl.focus === "function");
  modalFocusReturn.set(modal, isElement ? activeEl : null);
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  lockBodyScroll();

  if (!modalSwipeHandlers.has(modal)) {
    const swipeDismiss = new ModalSwipeDismiss(modal, () => closeModal(modal));
    modalSwipeHandlers.set(modal, swipeDismiss);
  }

  const onKeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal(modal);
      return;
    }
    handleFocusTrap(event, modal);
  };

  modalKeydown.set(modal, onKeydown);
  document.addEventListener("keydown", onKeydown);

  const focusable = getFocusableElements(modal);
  const target = initialFocus || focusable[0] || modal;
  if (target && typeof target.focus === "function") {
    target.focus();
  }
}

export function closeModal(modal, { restoreFocus = true } = {}) {
  if (!modal || !modal.classList.contains("active")) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
  unlockBodyScroll();

  const handler = modalKeydown.get(modal);
  if (handler) {
    document.removeEventListener("keydown", handler);
    modalKeydown.delete(modal);
  }

  const onClose = modalOnClose.get(modal);
  if (typeof onClose === "function") onClose();

  if (restoreFocus) {
    const focusReturn = modalFocusReturn.get(modal);
    if (focusReturn && typeof focusReturn.focus === "function") {
      focusReturn.focus();
    }
  }
}
