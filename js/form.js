import { CONTACT_EMAIL } from "./config.js";
import { showToast } from "./utils.js";
import { trackEvent } from "./analytics.js";

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
  if (!navigator.clipboard?.writeText) {
    showToast("Clipboard access is unavailable. Please copy the email manually.", "error");
    trackEvent("copy_email", { success: false, reason: "unavailable" });
    return;
  }
  navigator.clipboard.writeText(CONTACT_EMAIL)
    .then(() => {
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
