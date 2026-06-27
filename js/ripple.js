// Ripple effect for buttons and interactive elements
// BUG FIX ROOT CAUSE: Loop-binding click listeners to every matching element creates substantial memory overhead
// and fails to apply to dynamically generated nodes. We refactor to use a single document delegated listener.
export function initRipple() {
  document.addEventListener('click', function(e) {
    const element = e.target.closest('.btn, .project-filter, .project-details-btn, .contact-method-card');
    if (!element) return;

    const ripple = document.createElement('span');
    ripple.classList.add('ripple-effect');
    
    const rect = element.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;
    
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    
    element.appendChild(ripple);
    
    setTimeout(() => ripple.remove(), 600);
  });
}
