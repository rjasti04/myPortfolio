/**
 * Particle system for hero section
 * Lightweight canvas-based floating tech icons/particles
 */

export function initParticles(containerId = "particles-canvas") {
  const container = document.getElementById(containerId);
  if (!container) return;

  const canvas = document.createElement("canvas");
  canvas.id = "particles-canvas-element";
  canvas.style.position = "absolute";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";
  canvas.style.opacity = "0.3";
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  let animationId;
  let particles = [];
  let accentColor = "rgba(14, 165, 233, 1)";
  let frameCount = 0;

  function updateAccentColor() {
    const style = getComputedStyle(document.body);
    const accentFill = style.getPropertyValue("--accent-fill").trim();
    if (accentFill) {
      accentColor = accentFill;
    }
  }

  function resize() {
    canvas.width = container.offsetWidth;
    canvas.height = container.offsetHeight;
    updateAccentColor();
    initParticleArray();
  }

  class Particle {
    constructor() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height;
      this.size = Math.random() * 3 + 1;
      this.speedX = (Math.random() - 0.5) * 0.5;
      this.speedY = (Math.random() - 0.5) * 0.5;
      this.opacity = Math.random() * 0.5 + 0.2;
    }

    update() {
      this.x += this.speedX;
      this.y += this.speedY;

      // Wrap around edges
      if (this.x > canvas.width) this.x = 0;
      if (this.x < 0) this.x = canvas.width;
      if (this.y > canvas.height) this.y = 0;
      if (this.y < 0) this.y = canvas.height;
    }

    draw() {
      ctx.globalAlpha = this.opacity;
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function initParticleArray() {
    particles = [];
    const numberOfParticles = Math.floor(
      (canvas.width * canvas.height) / 15000,
    );

    for (let i = 0; i < numberOfParticles; i++) {
      particles.push(new Particle());
    }
  }

  function connectParticles() {
    const maxDistance = 120;
    const maxDistanceSq = maxDistance * maxDistance;

    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1;

    // ⚡ Bolt Performance Optimization: Sort particles by X coordinate
    // This allows us to break out of the O(N²) inner loop early when the
    // horizontal distance exceeds maxDistance, massively reducing iterations.
    particles.sort((a, b) => a.x - b.x);

    const len = particles.length;
    for (let i = 0; i < len; i++) {
      const p1 = particles[i];
      const p1x = p1.x;
      const p1y = p1.y;

      for (let j = i + 1; j < len; j++) {
        const p2 = particles[j];
        const dx = p2.x - p1x;

        // Array is sorted by x, so if dx > maxDistance, all subsequent particles will also be out of range
        if (dx > maxDistance) break;

        const dy = p1y - p2.y;

        // Quick 1D bounding box check on Y
        if (dy > maxDistance || dy < -maxDistance) continue;

        const distSq = dx * dx + dy * dy;

        if (distSq < maxDistanceSq) {
          const distance = Math.sqrt(distSq);
          const opacity = (1 - distance / maxDistance) * 0.2;
          ctx.globalAlpha = opacity;
          ctx.beginPath();
          ctx.moveTo(p1x, p1y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1.0;
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    frameCount++;
    if (frameCount % 60 === 0) {
      updateAccentColor();
    }

    particles.forEach((particle) => {
      particle.update();
      particle.draw();
    });

    connectParticles();

    animationId = requestAnimationFrame(animate);
  }

  // Mouse interaction
  let mouse = { x: null, y: null, radius: 100 };

  container.addEventListener("mousemove", (e) => {
    const rect = container.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  });

  container.addEventListener("mouseleave", () => {
    mouse.x = null;
    mouse.y = null;
  });

  // Initialize
  resize();
  animate();

  // Handle resize
  let resizeTimeout;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(resize, 200);
  });

  // Cleanup function
  return () => {
    cancelAnimationFrame(animationId);
    canvas.remove();
  };
}
