// Reusable modal utilities

let activeModal = null;
let previousFocus = null;
const modalStack = [];

/**
 * Open a modal dialog
 * @param {HTMLElement} modal - The modal element to open
 * @param {Object} options - Configuration options
 * @param {HTMLElement} options.initialFocus - Element to focus when opened
 * @param {Function} options.onClose - Callback when modal closes
 * @param {boolean} options.closeOnEscape - Allow ESC key to close (default: true)
 * @param {boolean} options.closeOnBackdrop - Allow backdrop click to close (default: true)
 */
export function openModal(modal, options = {}) {
  if (!modal) return;

  const {
    initialFocus = null,
    onClose = null,
    closeOnEscape = true,
    closeOnBackdrop = true,
  } = options;

  // Store previous focus
  previousFocus = document.activeElement;

  // Add to modal stack
  modalStack.push({ modal, onClose });
  activeModal = modal;

  // Show modal
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  modal.removeAttribute("hidden");

  // Trap focus
  trapFocus(modal);

  // Focus initial element
  if (initialFocus) {
    setTimeout(() => initialFocus.focus(), 100);
  } else {
    const firstFocusable = modal.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (firstFocusable) {
      setTimeout(() => firstFocusable.focus(), 100);
    }
  }

  // Prevent body scroll
  document.body.style.overflow = "hidden";

  // ESC key handler
  if (closeOnEscape) {
    modal.addEventListener("keydown", handleEscapeKey);
  }

  // Backdrop click handler
  if (closeOnBackdrop) {
    modal.addEventListener("click", handleBackdropClick);
  }
}

/**
 * Close the active modal
 * @param {HTMLElement} modal - Optional specific modal to close
 */
export function closeModal(modal = null) {
  const targetModal = modal || activeModal;
  if (!targetModal) return;

  // Find in stack
  const stackIndex = modalStack.findIndex((item) => item.modal === targetModal);
  if (stackIndex === -1) return;

  const { onClose } = modalStack[stackIndex];

  // Hide modal
  targetModal.classList.remove("active");
  targetModal.setAttribute("aria-hidden", "true");

  // Remove from stack
  modalStack.splice(stackIndex, 1);

  // Update active modal
  activeModal =
    modalStack.length > 0 ? modalStack[modalStack.length - 1].modal : null;

  // Restore body scroll if no modals open
  if (modalStack.length === 0) {
    document.body.style.overflow = "";
  }

  // Restore focus
  if (previousFocus && modalStack.length === 0) {
    previousFocus.focus();
    previousFocus = null;
  }

  // Remove event listeners
  targetModal.removeEventListener("keydown", handleEscapeKey);
  targetModal.removeEventListener("click", handleBackdropClick);

  // Call onClose callback
  if (onClose) {
    onClose();
  }
}

/**
 * Close all open modals
 */
export function closeAllModals() {
  while (modalStack.length > 0) {
    closeModal(modalStack[modalStack.length - 1].modal);
  }
}

/**
 * Check if any modal is currently open
 */
export function isModalOpen() {
  return modalStack.length > 0;
}

// Private helper functions

function handleEscapeKey(e) {
  if (e.key === "Escape") {
    closeModal(e.currentTarget);
  }
}

function handleBackdropClick(e) {
  if (e.target === e.currentTarget) {
    closeModal(e.currentTarget);
  }
}

function trapFocus(modal) {
  const focusableElements = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );

  if (focusableElements.length === 0) return;

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  const handleTabKey = (e) => {
    if (e.key !== "Tab") return;

    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
  };

  modal.addEventListener("keydown", handleTabKey);
}
