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
