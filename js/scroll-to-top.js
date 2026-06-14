import { prefersReducedMotion } from "./config.js";

// Scroll to top button
export function initScrollToTop() {
  const scrollBtn = document.createElement('button');
  scrollBtn.id = 'scroll-to-top';
  scrollBtn.className = 'scroll-to-top js-only';
  scrollBtn.setAttribute('aria-label', 'Scroll to top');
  scrollBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
  document.body.appendChild(scrollBtn);
  
  let isVisible = false;
  
  const toggleVisibility = () => {
    const shouldShow = window.scrollY > 400;
    if (shouldShow !== isVisible) {
      isVisible = shouldShow;
      scrollBtn.classList.toggle('visible', shouldShow);
    }
  };
  
  window.addEventListener('scroll', toggleVisibility, { passive: true });
  toggleVisibility();
  
  scrollBtn.addEventListener('click', () => {
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion.matches ? 'auto' : 'smooth'
    });
  });
}
