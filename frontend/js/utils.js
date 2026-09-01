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
  toast.setAttribute("role", "status");
  
  const icon = document.createElement("span");
  icon.className = `toast-icon`;
  icon.innerHTML = `<i class="fas ${iconMap[type] || iconMap.info}"></i>`;
  
  const textSpan = document.createElement("span");
  textSpan.textContent = message;
  
  toast.appendChild(icon);
  toast.appendChild(textSpan);
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add("toast-show");
    });
  });

  window.setTimeout(() => {
    toast.classList.remove("toast-show");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, 3200);
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
