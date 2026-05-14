import { CONTACT_EMAIL } from "./config.js";
import { copyText, showToast, isNetworkOnline } from "./utils.js";
import { trackEvent } from "./analytics.js";
import { triggerConfetti, confettiPresets } from "./confetti.js";

// Constants
const SUBMIT_TIMEOUT_MS = 10000;
const CONTACT_FIELD_SELECTOR = 'input:not([type="hidden"]), textarea';
const CONTACT_FORM_SUBMIT_LABEL = 'Send Message <i class="fas fa-paper-plane"></i>';
const CONTACT_FORM_SENDING_LABEL = '<i class="fas fa-spinner fa-spin"></i> Sending...';

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

function copyEmailToClipboard() {
  const copyEmailBtn = document.getElementById("copy-email-btn");
  const statusText = copyEmailBtn?.querySelector('.contact-method-value');
  const originalText = statusText?.textContent || 'Click to copy';
  
  copyText(CONTACT_EMAIL)
    .then(() => {
      if (statusText) {
        statusText.textContent = 'Copied!';
        statusText.style.color = 'var(--color-success)';
        setTimeout(() => {
          statusText.textContent = originalText;
          statusText.style.color = '';
        }, 2000);
      }
      showToast("Email copied to clipboard.", "success");
      trackEvent("copy_email", { success: true });
    })
    .catch(() => {
      showToast("Clipboard copy failed. Please copy the email manually.", "error");
      trackEvent("copy_email", { success: false, reason: "exception" });
    });
}

export function initContactForm() {
  const contactForm = document.getElementById("contact-form");
  const contactStatus = document.getElementById("contact-status");
  const copyEmailBtn = document.getElementById("copy-email-btn");
  let nativeFallbackInProgress = false;

  copyEmailBtn?.addEventListener("click", copyEmailToClipboard);

  if (!contactForm || !contactStatus) return;

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
      clearAllFieldErrors(contactForm);
      trackEvent("contact_submission", { success: true, native_fallback: false });
      setFormStatus(contactStatus, "Message sent successfully. Thanks for reaching out.", "success");
      showToast("Message sent successfully.", "success");
      
      // Trigger confetti celebration
      triggerConfetti(confettiPresets.success);
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
