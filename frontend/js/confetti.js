/**
 * Confetti celebration effect
 * Lightweight canvas-based confetti animation
 */

export function triggerConfetti(options = {}) {
  const {
    duration = 3000,
    particleCount = 150,
    spread = 70,
    origin = { x: 0.5, y: 0.5 },
    colors = ['var(--accent-fill)', 'var(--secondary-fill)', 'var(--data-fill)']
  } = options;

  const canvas = document.createElement('canvas');
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '10001';
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const startTime = Date.now();

  // Create particles
  for (let i = 0; i < particleCount; i++) {
    const angle = (Math.random() * spread - spread / 2) * (Math.PI / 180);
    const velocity = 5 + Math.random() * 10;
    
    particles.push({
      x: canvas.width * origin.x,
      y: canvas.height * origin.y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity - Math.random() * 5,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 10,
      size: 8 + Math.random() * 8,
      colorIndex: Math.floor(Math.random() * colors.length),
      gravity: 0.3 + Math.random() * 0.2,
      friction: 0.98,
      opacity: 1
    });
  }

  function getResolvedColors() {
    const getStyle = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
      ? window.getComputedStyle.bind(window)
      : (typeof getComputedStyle === 'function' ? getComputedStyle : null);
    const bodyStyles = getStyle && document.body ? getStyle(document.body) : null;
    const rootStyles = getStyle && document.documentElement ? getStyle(document.documentElement) : null;
    return colors.map(color => {
      if (typeof color === 'string' && color.startsWith('var(')) {
        const match = color.match(/var\(([^)]+)\)/);
        if (match) {
          const varName = match[1].trim();
          return bodyStyles?.getPropertyValue(varName)?.trim() ||
                 rootStyles?.getPropertyValue(varName)?.trim() ||
                 '#ef4444';
        }
      }
      return color;
    });
  }

  function animate() {
    const elapsed = Date.now() - startTime;
    
    if (elapsed > duration) {
      document.body.removeChild(canvas);
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const currentColors = getResolvedColors();

    particles.forEach(p => {
      // Update physics
      p.vy += p.gravity;
      p.vx *= p.friction;
      p.vy *= p.friction;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;
      
      // Fade out in last 500ms
      if (elapsed > duration - 500) {
        p.opacity = 1 - (elapsed - (duration - 500)) / 500;
      }

      // Draw particle
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation * Math.PI / 180);
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = currentColors[p.colorIndex] || currentColors[0] || '#ef4444';
      
      // Draw rectangle confetti
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size / 2);
      
      ctx.restore();
    });

    requestAnimationFrame(animate);
  }

  animate();
}

// Preset configurations
export const confettiPresets = {
  celebration: {
    particleCount: 200,
    spread: 90,
    origin: { x: 0.5, y: 0.6 }
  },
  
  success: {
    particleCount: 100,
    spread: 60,
    origin: { x: 0.5, y: 0.5 },
    colors: ['var(--accent-fill)', 'var(--secondary-fill)', 'var(--data-fill)']
  },
  
  fireworks: {
    particleCount: 80,
    spread: 360,
    origin: { x: 0.5, y: 0.4 }
  },
  
  subtle: {
    particleCount: 50,
    spread: 45,
    duration: 2000,
    origin: { x: 0.5, y: 0.3 }
  }
};
