// Escapes the five characters that can change the meaning of markup, including
// both quote forms.
//
// The previous implementation round-tripped through `textContent` ->
// `innerHTML`, which escapes `&`, `<` and `>` but leaves `"` untouched. Six
// call sites interpolate the result *inside* a double-quoted HTML attribute
// (chat.js retry buttons, activity.js event rows, activity-charts.js path
// bars), so a value containing a quote closed the attribute early and anything
// after it was parsed as further attributes - `onmouseover` included. The
// activity-charts path bars are fed by `page_path`, which is visitor-controlled
// and persisted, so that one was an injection stored in the database.
//
// Regex rather than the DOM so this is also usable without a document.
const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  return copied ? Promise.resolve() : Promise.reject(new Error("Copy command failed"));
}

const TOAST_DISMISS_MS = 3200;

export function showToast(message, type = "info") {
  const toastContainer = document.getElementById("toast-container");
  if (!toastContainer) return;

  const iconMap = {
    success: 'fa-check',
    error: 'fa-exclamation-circle',
    info: 'fa-info-circle'
  };

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  // An error is the one message the visitor has to act on, and polite
  // announcements queue behind whatever is already being read - a failed
  // contact submission could be spoken after the toast had gone. Errors
  // interrupt; everything else waits its turn.
  toast.setAttribute("role", type === "error" ? "alert" : "status");

  const icon = document.createElement("span");
  icon.className = `toast-icon`;
  icon.innerHTML = `<i class="fas ${iconMap[type] || iconMap.info}"></i>`;

  const textSpan = document.createElement("span");
  textSpan.className = "toast-text";
  textSpan.textContent = message;

  // 3.2s is not long enough to read a two-line error, and there was no way to
  // keep one on screen or to get rid of one early. Hover, focus and the close
  // button are all answers to that (WCAG 2.2.1).
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "toast-close";
  closeBtn.setAttribute("aria-label", "Dismiss notification");
  closeBtn.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';

  toast.appendChild(icon);
  toast.appendChild(textSpan);
  toast.appendChild(closeBtn);
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add("toast-show");
    });
  });

  let dismissTimer = null;

  const dismiss = () => {
    if (dismissTimer !== null) {
      window.clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    toast.classList.remove("toast-show");
    // The toast is removed on the transition it just started, but a toast that
    // never transitions - reduced motion, a backgrounded tab - would otherwise
    // stay in the DOM forever, so the timeout is the floor.
    let removed = false;
    const drop = () => {
      if (removed) return;
      removed = true;
      toast.remove();
    };
    toast.addEventListener("transitionend", drop, { once: true });
    window.setTimeout(drop, 400);
  };

  const arm = () => {
    if (dismissTimer !== null) window.clearTimeout(dismissTimer);
    dismissTimer = window.setTimeout(dismiss, TOAST_DISMISS_MS);
  };

  const hold = () => {
    if (dismissTimer === null) return;
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  };

  closeBtn.addEventListener("click", dismiss);
  toast.addEventListener("mouseenter", hold);
  toast.addEventListener("mouseleave", arm);
  toast.addEventListener("focusin", hold);
  toast.addEventListener("focusout", arm);

  arm();
}

export function debounce(fn, delay = 0) {
  let timeoutId = null;

  return function debounced(...args) {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn.apply(this, args);
    }, delay);
  };
}

export function throttle(fn, interval = 0) {
  let lastCall = 0;

  return function throttled(...args) {
    const now = Date.now();
    if (now - lastCall < interval) return;

    lastCall = now;
    return fn.apply(this, args);
  };
}

export function estimateTokens(text) {
  if (!text || text.length === 0) return 0;
  
  // More accurate estimation based on GPT tokenization patterns
  const words = text.trim().split(/\s+/).length;
  const specialChars = (text.match(/[^\w\s]/g) || []).length;
  const codeBlocks = (text.match(/```[\s\S]*?```/g) || []).length;
  const urls = (text.match(/https?:\/\/[^\s]+/g) || []).length;
  
  // Rough formula (calibrated against actual tokenizers)
  const baseTokens = Math.ceil(text.length / 4);
  const wordBonus = Math.ceil(words * 0.3);
  const specialBonus = Math.ceil(specialChars * 0.5);
  const codeBonus = codeBlocks * 50;
  const urlBonus = urls * 10;
  
  return baseTokens + wordBonus + specialBonus + codeBonus + urlBonus;
}

/**
 * The resume PDF's URL, taken from a link the build rewrote.
 *
 * scripts/build.mjs content-hashes the PDF into dist/ as
 * `rjasti_resume-<hash>.pdf` and rewrites references in the HTML pages and
 * manifest.json - never in the bundled JS. A literal "rjasti_resume.pdf" in a
 * module therefore 404s in production while working perfectly against
 * `frontend/`, so every caller has to read the href off the markup instead.
 *
 * Falls back to the source filename when no such link is in the DOM, which is
 * the un-built case and the only one where that name is correct.
 */
export function getResumeUrl() {
  if (typeof document === "undefined") return "rjasti_resume.pdf";
  // The download links keep their `download` attribute verbatim through the
  // build - only the href is rewritten - so they are a stable handle on it.
  const link = document.getElementById("resume-pdf-view")
    || document.querySelector('a[download$="Resume.pdf"]');
  return link?.getAttribute("href") || "rjasti_resume.pdf";
}

// Offline detection
let isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
const onlineCallbacks = [];
const offlineCallbacks = [];

export function onOnline(callback) {
  onlineCallbacks.push(callback);
}

export function onOffline(callback) {
  offlineCallbacks.push(callback);
}

export function isNetworkOnline() {
  return isOnline;
}

if (typeof window !== "undefined") {
  window.addEventListener('online', () => {
    isOnline = true;
    onlineCallbacks.forEach(cb => cb());
  });

  window.addEventListener('offline', () => {
    isOnline = false;
    offlineCallbacks.forEach(cb => cb());
  });
}
