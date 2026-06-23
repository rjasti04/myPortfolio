const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const modalFocusReturn = new WeakMap();
const modalKeydown = new WeakMap();

export function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (element) => {
      const isVisible =
        element.offsetParent !== null || element.getClientRects().length > 0;
      return isVisible && element.getAttribute("aria-hidden") !== "true";
    },
  );
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

export function openModal(modal, { initialFocus = null } = {}) {
  if (!modal) return;
  modalFocusReturn.set(
    modal,
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");

  const existingHandler = modalKeydown.get(modal);
  if (existingHandler) {
    document.removeEventListener("keydown", existingHandler);
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

  const handler = modalKeydown.get(modal);
  if (handler) {
    document.removeEventListener("keydown", handler);
    modalKeydown.delete(modal);
  }

  if (restoreFocus) {
    const focusReturn = modalFocusReturn.get(modal);
    if (focusReturn && typeof focusReturn.focus === "function") {
      focusReturn.focus();
    }
  }
}
