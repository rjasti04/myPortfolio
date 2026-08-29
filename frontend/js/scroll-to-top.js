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
  const SHOW_THRESHOLD = 500;
  const HIDE_THRESHOLD = 300;
  
  const toggleVisibility = () => {
    const currentY = window.scrollY || window.pageYOffset || 0;
    if (!isVisible && currentY > SHOW_THRESHOLD) {
      isVisible = true;
      scrollBtn.classList.add('visible');
    } else if (isVisible && currentY < HIDE_THRESHOLD) {
      isVisible = false;
      scrollBtn.classList.remove('visible');
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
