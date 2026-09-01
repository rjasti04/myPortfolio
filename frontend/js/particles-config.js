/**
 * Hero particle layer — the low-cost fallback background.
 *
 * This renders the same idea as the full-viewport plexus in `three-bg.js`
 * (drifting nodes plus proximity links), so the two are mutually exclusive:
 * `main.js` mounts the plexus on capable devices and this layer everywhere
 * else. Running both stacked two animated canvases over the hero for no
 * visual gain.
 *
 * Design constraints, in priority order:
 *  - never animate while off-screen or on a hidden tab;
 *  - motion is time-based, so it looks identical at 60Hz and 120Hz;
 *  - a resize rescales the field in place instead of reseeding it;
 *  - everything it attaches is removable via the returned teardown.
 */

const MAX_PARTICLES = 90;
const AREA_PER_PARTICLE = 18000;
const LINK_DISTANCE = 120;
const LINK_ALPHA_BANDS = 6;
const MAX_DPR = 2;
const ACCENT_SYNC_MS = 1000;

export function initParticles(containerId = 'particles-canvas') {
  const container = document.getElementById(containerId);
  if (!container) return null;

  const canvas = document.createElement('canvas');
  canvas.id = 'particles-canvas-element';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.opacity = '0.3';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    canvas.remove();
    return null;
  }

  let particles = [];
  let accentColor = 'rgba(14, 165, 233, 1)';
  let cssWidth = 0;
  let cssHeight = 0;
  let pixelRatio = 0;
  let animationId = 0;
  let running = false;
  let onScreen = false;
  let lastTime = 0;
  let lastAccentSync = 0;

  // One reusable coordinate buffer per alpha band. Links are bucketed into
  // these and each band is stroked as a single path, rather than issuing a
  // beginPath/stroke pair per pair of particles.
  const linkBands = [];
  for (let i = 0; i < LINK_ALPHA_BANDS; i += 1) linkBands.push({ points: [], count: 0 });

  function updateAccentColor() {
    const accentFill = getComputedStyle(document.body).getPropertyValue('--accent-fill').trim();
    if (accentFill) accentColor = accentFill;
  }

  function createParticle() {
    return {
      x: Math.random() * cssWidth,
      y: Math.random() * cssHeight,
      size: Math.random() * 3 + 1,
      // px per second, not px per frame — the original added a fixed step each
      // frame, so the field drifted twice as fast on a 120Hz display.
      speedX: (Math.random() - 0.5) * 30,
      speedY: (Math.random() - 0.5) * 30,
      opacity: Math.random() * 0.5 + 0.2
    };
  }

  function reconcile() {
    const target = Math.min(
      MAX_PARTICLES,
      Math.floor((cssWidth * cssHeight) / AREA_PER_PARTICLE)
    );
    while (particles.length < target) particles.push(createParticle());
    if (particles.length > target) particles.length = target;
  }

  function resize(nextWidth, nextHeight) {
    const width = Math.max(Math.round(nextWidth), 1);
    const height = Math.max(Math.round(nextHeight), 1);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (width === cssWidth && height === cssHeight && dpr === pixelRatio) return;

    // Rescale in place. The old resize() rebuilt the whole array, so every
    // resize tick visibly teleported the field.
    const xScale = cssWidth > 0 ? width / cssWidth : 1;
    const yScale = cssHeight > 0 ? height / cssHeight : 1;
    for (let i = 0; i < particles.length; i += 1) {
      particles[i].x *= xScale;
      particles[i].y *= yScale;
    }

    cssWidth = width;
    cssHeight = height;
    pixelRatio = dpr;

    // Backing store follows devicePixelRatio; the original sized it in CSS
    // pixels, so the layer was soft on every HiDPI screen.
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    reconcile();
    updateAccentColor();

    // A container that starts at zero size (hidden ancestor, late layout) would
    // otherwise never start the loop, since start() bails while cssWidth is 0.
    syncRunState();
  }

  function drawLinks() {
    for (let i = 0; i < LINK_ALPHA_BANDS; i += 1) linkBands[i].count = 0;

    const maxDistanceSq = LINK_DISTANCE * LINK_DISTANCE;
    const total = particles.length;

    for (let i = 0; i < total; i += 1) {
      const a = particles[i];
      for (let j = i + 1; j < total; j += 1) {
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = dx * dx + dy * dy;
        if (distSq >= maxDistanceSq) continue;

        const closeness = 1 - Math.sqrt(distSq) / LINK_DISTANCE;
        let band = (closeness * LINK_ALPHA_BANDS) | 0;
        if (band >= LINK_ALPHA_BANDS) band = LINK_ALPHA_BANDS - 1;

        const bucket = linkBands[band];
        const n = bucket.count;
        bucket.points[n] = a.x;
        bucket.points[n + 1] = a.y;
        bucket.points[n + 2] = b.x;
        bucket.points[n + 3] = b.y;
        bucket.count = n + 4;
      }
    }

    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1;

    for (let band = 0; band < LINK_ALPHA_BANDS; band += 1) {
      const bucket = linkBands[band];
      if (bucket.count === 0) continue;

      ctx.globalAlpha = ((band + 0.5) / LINK_ALPHA_BANDS) * 0.2;
      ctx.beginPath();
      for (let i = 0; i < bucket.count; i += 4) {
        ctx.moveTo(bucket.points[i], bucket.points[i + 1]);
        ctx.lineTo(bucket.points[i + 2], bucket.points[i + 3]);
      }
      ctx.stroke();
    }
  }

  function frame(now) {
    animationId = requestAnimationFrame(frame);

    // Clamp so a long pause (tab restore, blocked main thread) resumes calmly
    // instead of teleporting every particle across the hero.
    const delta = Math.min((now - lastTime) * 0.001, 0.05);
    lastTime = now;

    if (now - lastAccentSync > ACCENT_SYNC_MS) {
      lastAccentSync = now;
      updateAccentColor();
    }

    ctx.clearRect(0, 0, cssWidth, cssHeight);

    ctx.fillStyle = accentColor;
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      p.x += p.speedX * delta;
      p.y += p.speedY * delta;

      if (p.x > cssWidth) p.x = 0;
      else if (p.x < 0) p.x = cssWidth;
      if (p.y > cssHeight) p.y = 0;
      else if (p.y < 0) p.y = cssHeight;

      ctx.globalAlpha = p.opacity;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    drawLinks();
    ctx.globalAlpha = 1;
  }

  function start() {
    if (running || cssWidth === 0) return;
    running = true;
    lastTime = performance.now();
    lastAccentSync = lastTime;
    animationId = requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(animationId);
    animationId = 0;
  }

  function syncRunState() {
    if (onScreen && !document.hidden) start();
    else stop();
  }

  // Pause once the hero leaves the viewport. Without this the layer kept
  // animating and repainting for the entire rest of the page.
  const visibility = new IntersectionObserver(
    (entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
      syncRunState();
    },
    { rootMargin: '200px' }
  );
  visibility.observe(container);

  const sizeObserver = new ResizeObserver((entries) => {
    const box = entries[entries.length - 1].contentRect;
    resize(box.width, box.height);
  });
  sizeObserver.observe(container);

  document.addEventListener('visibilitychange', syncRunState);

  resize(container.offsetWidth, container.offsetHeight);
  syncRunState();

  return () => {
    stop();
    visibility.disconnect();
    sizeObserver.disconnect();
    document.removeEventListener('visibilitychange', syncRunState);
    canvas.remove();
    particles = [];
  };
}
