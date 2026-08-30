// Ripple effect for buttons and interactive elements
// BUG FIX ROOT CAUSE: Loop-binding click listeners to every matching element creates substantial memory overhead
// and fails to apply to dynamically generated nodes. We refactor to use a single document delegated listener.
export function initRipple() {
  document.addEventListener('pointerdown', function(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const element = e.target.closest('.btn, .project-filter, .project-details-btn, .contact-copy-btn, .contact-prompt');
    if (!element) return;

    const ripple = document.createElement('span');
    ripple.classList.add('ripple-effect');
    
    const rect = element.getBoundingClientRect();
    const radius = Math.hypot(rect.width, rect.height);
    const size = radius * 2;
    const x = e.clientX - rect.left - radius;
    const y = e.clientY - rect.top - radius;
    
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    
    element.appendChild(ripple);
    
    setTimeout(() => {
      ripple.remove();
    }, 650);
  }, { passive: true });
}
