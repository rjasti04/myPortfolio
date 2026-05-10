import { CONTACT_EMAIL } from "./config.js";
import { copyText, showToast, isNetworkOnline } from "./utils.js";
import { trackEvent } from "./analytics.js";
import { triggerConfetti, confettiPresets } from "./confetti.js";

// Constants
const SUBMIT_TIMEOUT_MS = 10000;

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
  contactForm.querySelectorAll('input, textarea').forEach(field => {
    // Create error message element for accessibility
    const errorId = `${field.id}-error`;
    let errorEl = document.getElementById(errorId);
    if (!errorEl) {
      errorEl = document.createElement('span');
      errorEl.id = errorId;
      errorEl.className = 'form-error-message';
      errorEl.setAttribute('role', 'alert');
      errorEl.style.display = 'none';
      errorEl.style.color = 'var(--color-error)';
      errorEl.style.fontSize = '12px';
      errorEl.style.marginTop = '4px';
      field.parentElement.appendChild(errorEl);
    }
    
    field.addEventListener('blur', () => {
      if (field.value && !field.checkValidity()) {
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-describedby', errorId);
        field.style.borderColor = 'var(--color-error)';
        errorEl.textContent = field.validationMessage;
        errorEl.style.display = 'block';
      } else if (field.value) {
        field.removeAttribute('aria-invalid');
        field.removeAttribute('aria-describedby');
        field.style.borderColor = '';
        errorEl.style.display = 'none';
      }
    });
    
    field.addEventListener('input', () => {
      if (field.hasAttribute('aria-invalid') && field.checkValidity()) {
        field.removeAttribute('aria-invalid');
        field.removeAttribute('aria-describedby');
        field.style.borderColor = '';
        errorEl.style.display = 'none';
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
    const originalLabel = submitBtn?.innerHTML || "";

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    }

    try {
      const response = await fetch(`https://formsubmit.co/ajax/${CONTACT_EMAIL}`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ _subject: "New portfolio message from rajeevjasti.com", email, message, name }),
      });
      if (!response.ok) throw new Error("Request failed");
      contactForm.reset();
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
      if (submitBtn && !nativeFallbackInProgress) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalLabel;
      }
    }
  });
}
