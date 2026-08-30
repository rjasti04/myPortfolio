import { CONTACT_EMAIL } from "./config.js";
import { copyText, showToast, isNetworkOnline } from "./utils.js";
import { trackEvent } from "./analytics.js";
import { triggerConfetti, confettiPresets } from "./confetti.js";

// Constants
const SUBMIT_TIMEOUT_MS = 10000;
const CONTACT_FIELD_SELECTOR = '.floating-label-group input[id], .floating-label-group textarea[id]';
const CONTACT_FORM_SUBMIT_LABEL = 'Send Message <i class="fas fa-paper-plane"></i>';
const CONTACT_FORM_SENDING_LABEL = '<i class="fas fa-spinner fa-spin"></i> Sending...';
const COPY_RESET_MS = 2000;
const COUNTER_WARN_RATIO = 0.9;

function setFormStatus(element, message, state = "info") {
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}

function clearFormStatus(element) {
  if (!element) return;
  element.textContent = "";
  delete element.dataset.state;
}

function getFieldErrorElement(field) {
  const errorId = `${field.id}-error`;
  let errorEl = document.getElementById(errorId);
  if (!errorEl) {
    errorEl = document.createElement("span");
    errorEl.id = errorId;
    errorEl.className = "form-error-message";
    errorEl.setAttribute("role", "alert");
    field.parentElement.appendChild(errorEl);
  }
  return errorEl;
}

function clearFieldError(field, errorEl = getFieldErrorElement(field)) {
  field.removeAttribute("aria-invalid");
  field.removeAttribute("aria-describedby");
  errorEl.textContent = "";
  delete errorEl.dataset.active;
}

function showFieldError(field, errorEl = getFieldErrorElement(field)) {
  field.setAttribute("aria-invalid", "true");
  field.setAttribute("aria-describedby", errorEl.id);
  errorEl.textContent = field.validationMessage;
  errorEl.dataset.active = "true";
}

function clearAllFieldErrors(form) {
  form.querySelectorAll(CONTACT_FIELD_SELECTOR).forEach((field) => {
    clearFieldError(field);
  });
}

function setSubmitState(form, submitBtn, isSubmitting) {
  form.toggleAttribute("aria-busy", isSubmitting);
  if (!submitBtn) return;

  submitBtn.disabled = isSubmitting;
  submitBtn.innerHTML = isSubmitting
    ? CONTACT_FORM_SENDING_LABEL
    : submitBtn.dataset.defaultLabel || CONTACT_FORM_SUBMIT_LABEL;
}

let copyResetTimer = null;

function copyEmailToClipboard() {
  const copyEmailBtn = document.getElementById("copy-email-btn");
  const statusText = copyEmailBtn?.querySelector(".contact-method-value");
  const liveRegion = document.getElementById("copy-email-live");

  // Captured once, not per click: reading the label at click time meant a
  // second click inside the 2s window latched "Copied!" as the resting label.
  if (statusText && !statusText.dataset.defaultLabel) {
    statusText.dataset.defaultLabel = statusText.textContent.trim() || "Copy";
  }

  copyText(CONTACT_EMAIL)
    .then(() => {
      if (statusText) {
        statusText.textContent = "Copied!";
        copyEmailBtn.dataset.copied = "true";
        clearTimeout(copyResetTimer);
        copyResetTimer = setTimeout(() => {
          statusText.textContent = statusText.dataset.defaultLabel;
          delete copyEmailBtn.dataset.copied;
        }, COPY_RESET_MS);
      }
      // The toast is visual-first; this is what a screen reader hears.
      if (liveRegion) liveRegion.textContent = `${CONTACT_EMAIL} copied to clipboard.`;
      showToast("Email copied to clipboard.", "success");
      trackEvent("copy_email", { success: true });
    })
    .catch(() => {
      if (liveRegion) liveRegion.textContent = "Copy failed. Please copy the address manually.";
      showToast("Clipboard copy failed. Please copy the email manually.", "error");
      trackEvent("copy_email", { success: false, reason: "exception" });
    });
}

function fireInput(field) {
  field.dispatchEvent(new window.Event("input", { bubbles: true }));
}

/* A blank textarea is where contact forms lose people: they know they want to
   write, not how to open. Each chip seeds a first line and drops the caret at
   the end of it, so the visitor continues a sentence instead of starting one.
   A seed is only ever replaced by another seed or by an empty field - words
   the visitor typed themselves are never overwritten. */
function initContactPrompts() {
  const promptGroup = document.getElementById("contact-prompts");
  const messageField = document.getElementById("contact-message");
  if (!promptGroup || !messageField) return;

  const prompts = Array.from(promptGroup.querySelectorAll(".contact-prompt"));
  if (!prompts.length) return;

  const clearPressed = () => prompts.forEach((btn) => btn.setAttribute("aria-pressed", "false"));
  clearPressed();

  prompts.forEach((btn) => {
    btn.addEventListener("click", () => {
      const seed = btn.dataset.prompt || "";
      const current = messageField.value;
      const isReplaceable = current.trim() === "" || current === messageField.dataset.promptSeed;

      // aria-pressed promises a toggle, so pressing the loaded chip again has
      // to undo it rather than silently re-seed the same line.
      if (btn.getAttribute("aria-pressed") === "true" && current === messageField.dataset.promptSeed) {
        messageField.value = "";
        delete messageField.dataset.promptSeed;
        clearPressed();
        fireInput(messageField);
        messageField.focus();
        return;
      }

      if (!isReplaceable) {
        messageField.focus();
        messageField.setSelectionRange(current.length, current.length);
        showToast("Your draft is kept - add to it below.", "info");
        return;
      }

      messageField.value = seed;
      messageField.dataset.promptSeed = seed;
      clearPressed();
      btn.setAttribute("aria-pressed", "true");
      fireInput(messageField);
      messageField.focus();
      messageField.setSelectionRange(seed.length, seed.length);
      trackEvent("contact_prompt", { topic: btn.textContent.trim() });
    });
  });

  // The moment the visitor edits a seed it stops being a seed, so the next
  // chip click can no longer discard it.
  messageField.addEventListener("input", () => {
    if (messageField.dataset.promptSeed && messageField.value !== messageField.dataset.promptSeed) {
      delete messageField.dataset.promptSeed;
      clearPressed();
    }
  });
}

function initMessageCounter() {
  const messageField = document.getElementById("contact-message");
  const counter = document.getElementById("contact-message-count");
  if (!messageField || !counter) return;

  const max = Number(counter.dataset.max) || Number(messageField.getAttribute("maxlength")) || 0;
  const update = () => {
    const used = messageField.value.length;
    counter.textContent = max ? `${used} / ${max}` : String(used);
    counter.dataset.state = max && used >= max * COUNTER_WARN_RATIO ? "limit" : "ok";
  };

  messageField.addEventListener("input", update);
  update();
}

export function initContactForm() {
  const contactForm = document.getElementById("contact-form");
  const contactStatus = document.getElementById("contact-status");
  const copyEmailBtn = document.getElementById("copy-email-btn");
  let nativeFallbackInProgress = false;

  copyEmailBtn?.addEventListener("click", copyEmailToClipboard);

  if (!contactForm || !contactStatus) return;

  initContactPrompts();
  initMessageCounter();

  // Real-time validation feedback with ARIA announcements
  contactForm.querySelectorAll(CONTACT_FIELD_SELECTOR).forEach(field => {
    const errorEl = getFieldErrorElement(field);

    field.addEventListener('blur', () => {
      if (field.value && !field.checkValidity()) {
        showFieldError(field, errorEl);
      } else if (field.value) {
        clearFieldError(field, errorEl);
      }
    });

    field.addEventListener('input', () => {
      if (field.hasAttribute('aria-invalid') && field.checkValidity()) {
        clearFieldError(field, errorEl);
      }
    });
  });

  const submitNatively = () => {
    nativeFallbackInProgress = true;
    let nextField = contactForm.querySelector('input[name="_next"]');
    if (!nextField) {
      nextField = document.createElement("input");
      nextField.type = "hidden";
      nextField.name = "_next";
      contactForm.append(nextField);
    }
    nextField.value = `${window.location.href.split("#")[0]}#contact`;
    contactForm.submit();
  };

  contactForm.addEventListener("input", () => clearFormStatus(contactStatus));
  contactForm.addEventListener("submit", async (event) => {
    if (nativeFallbackInProgress || typeof window.fetch !== "function") return;
    event.preventDefault();
    if (!contactForm.reportValidity()) return;

    // Check network status
    if (!isNetworkOnline()) {
      setFormStatus(contactStatus, "You appear to be offline. Please check your connection.", "error");
      showToast("No internet connection detected.", "error");
      return;
    }

    const submitBtn = contactForm.querySelector('button[type="submit"]');
    const name = contactForm.querySelector("#contact-name")?.value.trim() || "";
    const email = contactForm.querySelector("#contact-email")?.value.trim() || "";
    const message = contactForm.querySelector("#contact-message")?.value.trim() || "";
    if (submitBtn && !submitBtn.dataset.defaultLabel) {
      submitBtn.dataset.defaultLabel = submitBtn.innerHTML;
    }
    setSubmitState(contactForm, submitBtn, true);

    try {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), SUBMIT_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(`https://formsubmit.co/ajax/${CONTACT_EMAIL}`, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ _subject: "New portfolio message from rjasti.com", email, message, name }),
          signal: abortController.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!response.ok) throw new Error("Request failed");
      contactForm.reset();
      // reset() mutates values without firing input, so the counter and the
      // prompt-seed flag would both survive a successful send.
      const messageField = contactForm.querySelector("#contact-message");
      if (messageField) fireInput(messageField);
      clearAllFieldErrors(contactForm);
      trackEvent("contact_submission", { success: true, native_fallback: false });
      setFormStatus(contactStatus, "Message sent successfully. Thanks for reaching out.", "success");
      showToast("Message sent successfully.", "success");
      
      // Trigger confetti celebration
      try {
        triggerConfetti(confettiPresets.success);
      } catch {
        // Non-critical animation flourish; ignore if unavailable
      }
    } catch (error) {
      console.error(error);
      setFormStatus(contactStatus, "Trying the standard form submission flow...", "info");
      trackEvent("contact_submission", { success: false, native_fallback: true });
      submitNatively();
    } finally {
      if (!nativeFallbackInProgress) {
        setSubmitState(contactForm, submitBtn, false);
      }
    }
  });
}
