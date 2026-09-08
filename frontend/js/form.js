import { CONTACT_EMAIL } from "./config.js";
import { copyText, showToast, isNetworkOnline } from "./utils.js";
import { API_BASE, isApiConfigured, trackEvent } from "./analytics.js";
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

/* aria-describedby is a space-separated token list, and #contact-message
   already ships one pointing at its character counter. Assigning the error id
   over the top of it - and removing the attribute wholesale to clear - meant
   the first validation error permanently detached "0 / 1200" from the only
   field with a length limit. These two edit the list in place instead. */
function describedBy(field) {
  return new Set((field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
}

function writeDescribedBy(field, ids) {
  if (ids.size) field.setAttribute("aria-describedby", [...ids].join(" "));
  else field.removeAttribute("aria-describedby");
}

function clearFieldError(field, errorEl = getFieldErrorElement(field)) {
  field.removeAttribute("aria-invalid");
  const ids = describedBy(field);
  ids.delete(errorEl.id);
  writeDescribedBy(field, ids);
  errorEl.textContent = "";
  delete errorEl.dataset.active;
}

function showFieldError(field, errorEl = getFieldErrorElement(field)) {
  field.setAttribute("aria-invalid", "true");
  const ids = describedBy(field);
  ids.add(errorEl.id);
  writeDescribedBy(field, ids);
  errorEl.textContent = field.validationMessage;
  errorEl.dataset.active = "true";
}

/**
 * Renders inline errors for every invalid field and focuses the first.
 *
 * Submit used to hand off to reportValidity(), whose native bubble is mirrored
 * by no live region and vanishes on the next keystroke - while the
 * .form-error-message machinery above sat unused for exactly this case.
 *
 * @returns {boolean} true when the form is submittable.
 */
function validateAllFields(form) {
  let firstInvalid = null;
  form.querySelectorAll(CONTACT_FIELD_SELECTOR).forEach((field) => {
    if (field.checkValidity()) {
      clearFieldError(field);
      return;
    }
    showFieldError(field);
    if (!firstInvalid) firstInvalid = field;
  });

  if (firstInvalid) firstInvalid.focus();
  return firstInvalid === null;
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

  copyEmailBtn?.addEventListener("click", copyEmailToClipboard);

  if (!contactForm || !contactStatus) return;

  initContactPrompts();
  initMessageCounter();

  // Real-time validation feedback with ARIA announcements
  contactForm.querySelectorAll(CONTACT_FIELD_SELECTOR).forEach(field => {
    const errorEl = getFieldErrorElement(field);

    field.addEventListener('blur', () => {
      // The guard here used to be `field.value &&`, so tabbing through the
      // form blank produced no inline error at all - the emptiest, most
      // common way to get it wrong was the one case with no feedback.
      // `touched` keeps a field the visitor has never entered quiet until
      // submit.
      field.dataset.touched = "true";
      if (field.checkValidity()) clearFieldError(field, errorEl);
      else showFieldError(field, errorEl);
    });

    field.addEventListener('input', () => {
      if (field.hasAttribute('aria-invalid') && field.checkValidity()) {
        clearFieldError(field, errorEl);
      }
    });
  });

  // The form carries a real `action`, so a browser without fetch submits it
  // natively without help. `_next` is set up front so that path returns here
  // instead of stranding the visitor on FormSubmit's own thank-you page.
  //
  // There used to be a submitNatively() that ran on *any* AJAX failure. That is
  // what made a timeout deliver the message twice, and it navigated the visitor
  // off the site to do it.
  const nextField = document.createElement("input");
  nextField.type = "hidden";
  nextField.name = "_next";
  nextField.value = `${window.location.href.split("#")[0]}#contact`;
  contactForm.append(nextField);

  contactForm.addEventListener("input", () => clearFormStatus(contactStatus));
  contactForm.addEventListener("submit", async (event) => {
    // No fetch: let the browser submit the form natively.
    if (typeof window.fetch !== "function") return;
    event.preventDefault();
    if (!validateAllFields(contactForm)) {
      setFormStatus(contactStatus, "Please check the highlighted fields.", "error");
      return;
    }

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
    // The honeypot is in the markup and rides along on a native form POST, but
    // this payload is hand-built, so the AJAX path - the one virtually every
    // submission takes - dropped it and FormSubmit never got to apply it.
    const honeypot = contactForm.querySelector('input[name="_honey"]')?.value || "";
    if (submitBtn && !submitBtn.dataset.defaultLabel) {
      submitBtn.dataset.defaultLabel = submitBtn.innerHTML;
    }
    setSubmitState(contactForm, submitBtn, true);

    try {
      // Each attempt gets its own controller and its own timeout. Sharing one
      // meant a first-party call that ran out the clock left the signal already
      // aborted, so the fallback could never even be sent.
      const postJson = (url, body) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
        return fetch(url, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId));
      };

      let response = null;
      let viaFirstParty = false;

      // First party first. POST /contact reuses the same hardened SMTP sender
      // the account-recovery mail goes through, so delivery, spam handling and
      // failure visibility all sit on this side of the wire.
      //
      // The fallback is deliberately narrow. Aborting cancels the browser's
      // wait, not the POST already in flight, so retrying a *timed-out*
      // request against FormSubmit is how the visitor's message gets delivered
      // twice - the same defect that stopped this handler falling through to a
      // native submit. Only two outcomes prove nothing was sent: the API was
      // unreachable, or it answered 502, which is the status the route returns
      // when SMTP itself failed. A 422 means the payload is bad and a 429 means
      // the hourly budget is spent; retrying either elsewhere would route
      // around a check rather than recover from a failure.
      if (isApiConfigured()) {
        try {
          response = await postJson(`${API_BASE}/contact`, {
            name,
            email,
            message,
            _honey: honeypot,
          });
          viaFirstParty = response.ok;
          if (!response.ok && response.status !== 502) throw new Error("Request failed");
        } catch (firstPartyError) {
          if (firstPartyError?.name === "AbortError") throw firstPartyError;
          if (response && !response.ok && response.status !== 502) throw firstPartyError;
          // Unreachable API. The portfolio never depends on the backend being
          // up, so this falls through - which is also why formsubmit.co stays
          // in the CSP rather than being removed with the dead origins.
          response = null;
        }
      }

      if (!viaFirstParty) {
        response = await postJson(`https://formsubmit.co/ajax/${CONTACT_EMAIL}`, {
          _subject: "New portfolio message from rjasti.com",
          _honey: honeypot,
          email,
          message,
          name,
        });
      }
      if (!response || !response.ok) throw new Error("Request failed");
      contactForm.reset();
      // reset() mutates values without firing input, so the counter and the
      // prompt-seed flag would both survive a successful send.
      const messageField = contactForm.querySelector("#contact-message");
      if (messageField) fireInput(messageField);
      clearAllFieldErrors(contactForm);
      // Which path carried it, so the dashboard can show whether the
      // first-party endpoint is actually taking the traffic.
      trackEvent("contact_submission", {
        success: true,
        native_fallback: false,
        transport: viaFirstParty ? "first_party" : "formsubmit",
      });
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

      // Aborting cancels the browser's wait, not the POST already in flight at
      // FormSubmit. Falling through to a native submit here delivered slow-but-
      // successful messages twice, and the visitor saw a full-page navigation
      // away from the site for their trouble. Ask instead.
      const timedOut = error?.name === "AbortError";
      trackEvent("contact_submission", {
        success: false,
        native_fallback: false,
        reason: timedOut ? "timeout" : "network",
      });
      setFormStatus(
        contactStatus,
        timedOut
          ? "That took longer than expected. Your message may still have arrived - "
            + "check before resending, or email me directly."
          : "Could not reach the mail service. Please try again, or email me directly.",
        "error"
      );
      showToast(
        timedOut ? "Send timed out - check before resending." : "Could not send. Please try again.",
        "error"
      );
    } finally {
      setSubmitState(contactForm, submitBtn, false);
    }
  });
}
