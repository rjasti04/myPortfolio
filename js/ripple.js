// Ripple effect for buttons and interactive elements
export function initRipple() {
  const rippleElements = document.querySelectorAll('.btn, .project-filter, .project-details-btn, .contact-method-card');
  
  rippleElements.forEach(element => {
    element.addEventListener('click', function(e) {
      const ripple = document.createElement('span');
      ripple.classList.add('ripple-effect');
      
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;
      
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';
      
      this.appendChild(ripple);
      
      setTimeout(() => ripple.remove(), 600);
    });
  });
}
