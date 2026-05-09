export function escapeHTML(value) {
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
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

export function estimateTokens(text) {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}
