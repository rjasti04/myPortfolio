// Shared animation utilities

/**
 * Animate a number counter
 * @param {HTMLElement} element - Element containing the number
 * @param {number} target - Target number
 * @param {number} duration - Animation duration in ms
 * @param {string} suffix - Optional suffix (e.g., '+', '%')
 */
export function animateCounter(element, target, duration = 1000, suffix = '') {
  const start = 0;
  const startTime = performance.now();
  
  const animate = (currentTime) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Easing function (ease-out)
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = Math.floor(start + (target - start) * easeOut);
    
    element.textContent = current + suffix;
    
    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      element.textContent = target + suffix;
    }
  };
  
  requestAnimationFrame(animate);
}

/**
 * Fade in element
 * @param {HTMLElement} element - Element to fade in
 * @param {number} duration - Duration in ms
 */
export function fadeIn(element, duration = 300) {
  element.style.opacity = '0';
  element.style.display = 'block';
  
  let start = null;
  
  const animate = (timestamp) => {
    if (!start) start = timestamp;
    const progress = (timestamp - start) / duration;
    
    element.style.opacity = Math.min(progress, 1);
    
    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  };
  
  requestAnimationFrame(animate);
}

/**
 * Fade out element
 * @param {HTMLElement} element - Element to fade out
 * @param {number} duration - Duration in ms
 */
export function fadeOut(element, duration = 300) {
  let start = null;
  const initialOpacity = parseFloat(getComputedStyle(element).opacity) || 1;
  
  const animate = (timestamp) => {
    if (!start) start = timestamp;
    const progress = (timestamp - start) / duration;
    
    element.style.opacity = initialOpacity * (1 - Math.min(progress, 1));
    
    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      element.style.display = 'none';
    }
  };
  
  requestAnimationFrame(animate);
}

/**
 * Slide down element
 * @param {HTMLElement} element - Element to slide down
 * @param {number} duration - Duration in ms
 */
export function slideDown(element, duration = 300) {
  element.style.display = 'block';
  const height = element.scrollHeight;
  element.style.height = '0';
  element.style.overflow = 'hidden';
  
  let start = null;
  
  const animate = (timestamp) => {
    if (!start) start = timestamp;
    const progress = (timestamp - start) / duration;
    
    element.style.height = (height * Math.min(progress, 1)) + 'px';
    
    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      element.style.height = '';
      element.style.overflow = '';
    }
  };
  
  requestAnimationFrame(animate);
}

/**
 * Slide up element
 * @param {HTMLElement} element - Element to slide up
 * @param {number} duration - Duration in ms
 */
export function slideUp(element, duration = 300) {
  const height = element.scrollHeight;
  element.style.height = height + 'px';
  element.style.overflow = 'hidden';
  
  let start = null;
  
  const animate = (timestamp) => {
    if (!start) start = timestamp;
    const progress = (timestamp - start) / duration;
    
    element.style.height = (height * (1 - Math.min(progress, 1))) + 'px';
    
    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      element.style.display = 'none';
      element.style.height = '';
      element.style.overflow = '';
    }
  };
  
  requestAnimationFrame(animate);
}

/**
 * Stagger animation for multiple elements
 * @param {NodeList|Array} elements - Elements to animate
 * @param {Function} animationFn - Animation function to apply
 * @param {number} delay - Delay between each element in ms
 */
export function staggerAnimation(elements, animationFn, delay = 100) {
  elements.forEach((element, index) => {
    setTimeout(() => {
      animationFn(element);
    }, index * delay);
  });
}

/**
 * Parallax scroll effect
 * @param {HTMLElement} element - Element to apply parallax
 * @param {number} speed - Parallax speed (0-1, lower is slower)
 */
export function parallaxScroll(element, speed = 0.5) {
  const updateParallax = () => {
    const scrolled = window.pageYOffset;
    const offset = element.offsetTop;
    const distance = scrolled - offset;
    
    element.style.transform = `translateY(${distance * speed}px)`;
  };
  
  window.addEventListener('scroll', updateParallax, { passive: true });
  updateParallax();
  
  return () => window.removeEventListener('scroll', updateParallax);
}

/**
 * Smooth scroll to element
 * @param {HTMLElement|string} target - Element or selector to scroll to
 * @param {number} offset - Offset from top in px
 */
export function smoothScrollTo(target, offset = 0) {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  if (!element) return;
  
  const targetPosition = element.getBoundingClientRect().top + window.pageYOffset - offset;
  
  window.scrollTo({
    top: targetPosition,
    behavior: 'smooth'
  });
}

/**
 * Reveal elements on scroll
 * @param {string} selector - Selector for elements to reveal
 * @param {Object} options - IntersectionObserver options
 */
export function revealOnScroll(selector = '.reveal', options = {}) {
  const defaultOptions = {
    threshold: 0.15,
    rootMargin: '0px 0px -50px 0px',
    ...options
  };
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
        observer.unobserve(entry.target);
      }
    });
  }, defaultOptions);
  
  document.querySelectorAll(selector).forEach(element => {
    observer.observe(element);
  });
  
  return observer;
}
