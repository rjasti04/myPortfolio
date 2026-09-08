import { closeModal, openModal } from "./modal.js";

/**
 * The site's one confirmation dialog.
 *
 * Destructive actions used to disagree about what confirmation means. Clearing
 * every conversation called the browser's `confirm()` - the only blocking,
 * unthemed, unstyleable dialog in a codebase that owns js/modal.js - while
 * deleting a single conversation, the far more frequently used control, asked
 * nothing at all. Revoking a session logged a device out on one click.
 *
 * One implementation, built on modal.js so it inherits the focus trap, the
 * reference-counted scroll lock, Escape and focus restore that every other
 * dialog on the site already has.
 */

let dialog = null;
let titleEl = null;
let bodyEl = null;
let confirmBtn = null;
let cancelBtn = null;
let settle = null;

function build() {
  dialog = document.createElement("div");
  dialog.className = "confirm-modal";
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "confirm-modal-title");
  dialog.setAttribute("aria-describedby", "confirm-modal-body");
  dialog.setAttribute("aria-hidden", "true");

  const panel = document.createElement("div");
  panel.className = "confirm-modal-panel";

  titleEl = document.createElement("h2");
  titleEl.className = "confirm-modal-title";
  titleEl.id = "confirm-modal-title";

  bodyEl = document.createElement("p");
  bodyEl.className = "confirm-modal-body";
  bodyEl.id = "confirm-modal-body";

  const actions = document.createElement("div");
  actions.className = "confirm-modal-actions";

  cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-outline confirm-modal-cancel";

  confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "btn confirm-modal-confirm";

  actions.append(cancelBtn, confirmBtn);
  panel.append(titleEl, bodyEl, actions);
  dialog.append(panel);
  document.body.appendChild(dialog);

  confirmBtn.addEventListener("click", () => finish(true));
  cancelBtn.addEventListener("click", () => finish(false));
  // The backdrop is a dismissal, same as Escape.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) finish(false);
  });
}

function finish(confirmed) {
  const resolve = settle;
  settle = null;
  // closeModal fires onClose, which settles anything still pending - Escape
  // and the swipe-dismiss both arrive that way rather than through a button.
  closeModal(dialog);
  if (resolve) resolve(confirmed);
}

/**
 * @param {object} options
 * @param {string} options.title       Short question, e.g. "Delete this chat?"
 * @param {string} options.body        What the visitor is agreeing to.
 * @param {string} [options.confirmLabel]
 * @param {string} [options.cancelLabel]
 * @param {boolean} [options.destructive] Paints the confirm button as danger.
 * @returns {Promise<boolean>} true when confirmed.
 */
export function confirmAction({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
} = {}) {
  if (!dialog) build();

  titleEl.textContent = title;
  bodyEl.textContent = body;
  confirmBtn.textContent = confirmLabel;
  cancelBtn.textContent = cancelLabel;
  confirmBtn.classList.toggle("is-destructive", Boolean(destructive));

  return new Promise((resolve) => {
    settle = resolve;
    openModal(dialog, {
      // Cancel takes focus, not Confirm: the safe option should be the one a
      // stray Enter or Space lands on.
      initialFocus: cancelBtn,
      onClose: () => {
        const pending = settle;
        settle = null;
        if (pending) pending(false);
      },
    });
  });
}
