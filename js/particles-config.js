/**
 * Particle system for hero section
 * Lightweight canvas-based floating tech icons/particles
 */

export function initParticles(containerId = 'particles-canvas') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const canvas = document.createElement('canvas');
  canvas.id = 'particles-canvas-element';
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.opacity = '0.3';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let animationId;
  let particles = [];

  function resize() {
    canvas.width = container.offsetWidth;
    canvas.height = container.offsetHeight;
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
      ctx.fillStyle = `rgba(14, 165, 233, ${this.opacity})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function initParticleArray() {
    particles = [];
    const numberOfParticles = Math.floor((canvas.width * canvas.height) / 15000);
    
    for (let i = 0; i < numberOfParticles; i++) {
      particles.push(new Particle());
    }
  }

  function connectParticles() {
    const maxDistance = 120;
    
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < maxDistance) {
          const opacity = (1 - distance / maxDistance) * 0.2;
          ctx.strokeStyle = `rgba(14, 165, 233, ${opacity})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach(particle => {
      particle.update();
      particle.draw();
    });

    connectParticles();

    animationId = requestAnimationFrame(animate);
  }

  // Mouse interaction
  let mouse = { x: null, y: null, radius: 100 };

  container.addEventListener('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  });

  container.addEventListener('mouseleave', () => {
    mouse.x = null;
    mouse.y = null;
  });

  // Initialize
  resize();
  animate();

  // Handle resize
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(resize, 200);
  });

  // Cleanup function
  return () => {
    cancelAnimationFrame(animationId);
    canvas.remove();
  };
}

// Spotlight effect that follows mouse
export function initSpotlight(containerId = 'hero') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const spotlight = document.createElement('div');
  spotlight.className = 'spotlight-effect';
  spotlight.style.cssText = `
    position: absolute;
    width: 600px;
    height: 600px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(14, 165, 233, 0.15) 0%, transparent 70%);
    pointer-events: none;
    transform: translate(-50%, -50%);
    transition: opacity 0.3s ease;
    opacity: 0;
    z-index: 0;
  `;
  
  container.style.position = 'relative';
  container.appendChild(spotlight);

  let mouseX = 0;
  let mouseY = 0;
  let spotlightX = 0;
  let spotlightY = 0;

  container.addEventListener('mouseenter', () => {
    spotlight.style.opacity = '1';
  });

  container.addEventListener('mouseleave', () => {
    spotlight.style.opacity = '0';
  });

  container.addEventListener('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
  });

  function animateSpotlight() {
    // Smooth follow with easing
    spotlightX += (mouseX - spotlightX) * 0.1;
    spotlightY += (mouseY - spotlightY) * 0.1;

    spotlight.style.left = `${spotlightX}px`;
    spotlight.style.top = `${spotlightY}px`;

    requestAnimationFrame(animateSpotlight);
  }

  animateSpotlight();

  return () => {
    spotlight.remove();
  };
}
