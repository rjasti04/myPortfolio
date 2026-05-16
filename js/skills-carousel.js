import { prefersReducedMotion } from "./config.js";

// Carousel configuration constants
const MOBILE_QUERY = "(max-width: 500px)";
const AUTOPLAY_MS = 4500;
const SWIPE_THRESHOLD = 40;

export function initSkillsCarousel() {
  const carousel = document.querySelector("[data-skills-carousel]");
  if (!carousel) return;

  const track = carousel.querySelector(".skills-grid");
  const slides = Array.from(track.querySelectorAll(".skill-group"));
  if (!slides.length) return;

  // Wait for next frame to ensure DOM is fully rendered and painted
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      initCarouselLogic(carousel, track, slides);
    });
  });
}

function initCarouselLogic(carousel, track, slides) {
  const prevBtn = carousel.querySelector(".skills-carousel-arrow--prev");
  const nextBtn = carousel.querySelector(".skills-carousel-arrow--next");
  const dotsContainer = carousel.querySelector(".skills-carousel-dots");
  const mq = window.matchMedia(MOBILE_QUERY);

  let activeIdx = 0;
  let autoplayTimer = null;
  let visible = false;
  let isMobile = mq.matches;
  let reduceMotion = prefersReducedMotion.matches;

  const dots = slides.map((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "skills-carousel-dot";
    dot.setAttribute("role", "tab");
    dot.setAttribute(
      "aria-label",
      `Show skill group ${i + 1} of ${slides.length}`,
    );
    dot.addEventListener("click", () => {
      goTo(i);
      restartAutoplay();
    });
    dotsContainer.appendChild(dot);
    return dot;
  });

  function render() {
    const n = slides.length;
    const prevI = (activeIdx - 1 + n) % n;
    const nextI = (activeIdx + 1) % n;
    slides.forEach((slide, i) => {
      slide.classList.remove("is-active", "is-prev", "is-next", "active");
      if (i === activeIdx) {
        slide.classList.add("is-active", "active");
      } else if (i === prevI) {
        slide.classList.add("is-prev");
      } else if (i === nextI) {
        slide.classList.add("is-next");
      }
      slide.setAttribute("aria-hidden", i === activeIdx ? "false" : "true");
    });
    dots.forEach((d, i) => {
      const active = i === activeIdx;
      d.classList.toggle("is-active", active);
      d.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function resetClasses() {
    slides.forEach((slide) => {
      slide.classList.remove("is-active", "is-prev", "is-next", "active");
      slide.removeAttribute("aria-hidden");
    });
    dots.forEach((d) => d.classList.remove("is-active"));
  }

  function goTo(idx) {
    const n = slides.length;
    activeIdx = ((idx % n) + n) % n;
    render();
  }

  function next() {
    goTo(activeIdx + 1);
    restartAutoplay();
  }

  function prev() {
    goTo(activeIdx - 1);
    restartAutoplay();
  }

  function startAutoplay() {
    stopAutoplay();
    if (
      !isMobile ||
      !visible ||
      reduceMotion ||
      carousel.matches(":focus-within")
    )
      return;
    autoplayTimer = window.setInterval(() => goTo(activeIdx + 1), AUTOPLAY_MS);
  }

  function stopAutoplay() {
    if (autoplayTimer !== null) {
      window.clearInterval(autoplayTimer);
      autoplayTimer = null;
    }
  }

  function restartAutoplay() {
    if (!isMobile) return;
    startAutoplay();
  }

  prevBtn?.addEventListener("click", prev);
  nextBtn?.addEventListener("click", next);

  let startX = null;
  let startY = null;
  let deltaX = 0;
  let horizontal = false;

  track.addEventListener(
    "touchstart",
    (e) => {
      if (!isMobile || e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      deltaX = 0;
      horizontal = false;
      stopAutoplay();
    },
    { passive: true },
  );

  track.addEventListener(
    "touchmove",
    (e) => {
      if (startX === null) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!horizontal && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
        horizontal = true;
      }
      deltaX = dx;
    },
    { passive: true },
  );

  track.addEventListener("touchend", () => {
    if (startX === null) return;
    if (horizontal && Math.abs(deltaX) > SWIPE_THRESHOLD) {
      if (deltaX < 0) goTo(activeIdx + 1);
      else goTo(activeIdx - 1);
    }
    startX = null;
    startY = null;
    deltaX = 0;
    horizontal = false;
    startAutoplay();
  });

  carousel.addEventListener("mouseenter", stopAutoplay);
  carousel.addEventListener("mouseleave", startAutoplay);
  carousel.addEventListener("focusin", stopAutoplay);
  carousel.addEventListener("focusout", startAutoplay);

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visible = entry.isIntersecting;
          if (visible && isMobile) {
            // Ensure carousel is initialized when becoming visible
            if (!carousel.classList.contains("carousel-initialized")) {
              carousel.classList.add("carousel-initialized");
              // Force reflow to ensure CSS is applied
              void carousel.offsetHeight;
              render();
            }
            startAutoplay();
          } else {
            stopAutoplay();
          }
        });
      },
      { threshold: 0.1, rootMargin: "50px" },
    );
    io.observe(carousel);
  } else {
    visible = true;
    if (isMobile) startAutoplay();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAutoplay();
    else startAutoplay();
  });

  function onMqChange(e) {
    isMobile = e.matches;
    if (isMobile) {
      goTo(activeIdx);
      startAutoplay();
    } else {
      stopAutoplay();
      resetClasses();
    }
  }

  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", onMqChange);
  } else if (typeof mq.addListener === "function") {
    mq.addListener(onMqChange);
  }

  function onMotionChange(e) {
    reduceMotion = e.matches;
    if (reduceMotion) stopAutoplay();
    else startAutoplay();
  }

  if (typeof prefersReducedMotion.addEventListener === "function") {
    prefersReducedMotion.addEventListener("change", onMotionChange);
  } else if (typeof prefersReducedMotion.addListener === "function") {
    prefersReducedMotion.addListener(onMotionChange);
  }

  if (isMobile) {
    carousel.classList.add("carousel-initialized");
    // Force reflow to ensure CSS classes are applied before render
    void carousel.offsetHeight;
    render();
    startAutoplay();
  }
}
