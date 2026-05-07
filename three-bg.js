import * as THREE from "three";
import { prefersReducedMotion as reducedMotionQuery, compactViewport as compactViewportQuery, mobileDevice } from "./js/config.js";
let destroyBackground = null;
let backgroundVariant = null;
let destroyMobileBackground = null;

let isWebGLAvailable = null;
let syncThreeBackgroundTimeout = null;

function shouldEnableBackground() {
  if (reducedMotionQuery.matches) return false;
  if (mobileDevice.matches) return false;

  if (isWebGLAvailable === null) {
    try {
      const canvas = document.createElement("canvas");
      isWebGLAvailable = !!(
        window.WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
      );
    } catch (e) {
      isWebGLAvailable = false;
    }
  }

  return isWebGLAvailable;
}

function getBackgroundVariant() {
  return compactViewportQuery.matches ? "compact" : "default";
}

function mountThreeBackground(canvas, variant = getBackgroundVariant()) {
  const compact = variant === "compact";

  // Don't try to initialize WebGL on very small viewports
  if (window.innerWidth < 768 || window.innerHeight < 600) {
    return null;
  }

  const scene = new THREE.Scene();

  // Camera looking down at an angle over the landscape
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 15, 30);
  camera.lookAt(0, -5, 0);

  // Ensure the canvas element is actually available
  if (!canvas) {
    console.error("Renderer initialization failed: No canvas element provided.");
    return null;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas: canvas,
      powerPreference: "high-performance",
      failIfMajorPerformanceCaveat: false
    });
  } catch (error) {
    console.error("Three.js background could not be initialized.", error);
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, compact ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Ethereal Fluid Topology system (Particle Grid)
  const columns = compact ? 50 : 80;
  const rows = compact ? 50 : 80;
  const spacing = 0.8;
  const geometry = new THREE.BufferGeometry();
  
  const particleCount = columns * rows;
  const positions = new Float32Array(particleCount * 3);
  const uvs = new Float32Array(particleCount * 2);

  let i = 0;
  for (let ix = 0; ix < columns; ix++) {
    for (let iy = 0; iy < rows; iy++) {
      // Center the grid
      positions[i * 3] = (ix - columns / 2) * spacing;
      positions[i * 3 + 1] = 0; // Y is calculated in shader
      positions[i * 3 + 2] = (iy - rows / 2) * spacing;
      
      uvs[i * 2] = ix / columns;
      uvs[i * 2 + 1] = iy / rows;
      
      i++;
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  const getAccent = () => getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#f43f5e";
  
  // Custom shader for the fluid topology
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(getAccent()) },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uThemeOpacityMultiplier: { value: 1.0 },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      
      varying vec2 vUv;
      varying float vElevation;
      
      void main() {
        vUv = uv;
        vec3 pos = position;
        
        // Very slow, ambient wave generation using overlapping sines
        float time = uTime * 0.15;
        
        float elevation = sin(pos.x * 0.15 + time) * 1.5;
        elevation += cos(pos.z * 0.15 + time * 0.8) * 1.5;
        elevation += sin((pos.x + pos.z) * 0.05 - time * 0.5) * 1.0;
        
        // Dampen the edges so it fades into nothingness nicely
        float distanceToCenter = length(pos.xz);
        float dampen = smoothstep(50.0, 10.0, distanceToCenter);
        
        pos.y = elevation * dampen;
        vElevation = pos.y;
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        
        // Size attenuation based on depth and pixel ratio
        gl_PointSize = (4.0 * uPixelRatio) * (20.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uThemeOpacityMultiplier;
      
      varying vec2 vUv;
      varying float vElevation;
      
      void main() {
        // Soft circular particle shape
        vec2 xy = gl_PointCoord.xy - vec2(0.5);
        float ll = length(xy);
        float alpha = smoothstep(0.5, 0.1, ll);
        
        // Blend color based on height (elevation)
        // Higher points are brighter pink, lower points fade into darkness/purple
        float mixRatio = smoothstep(-2.0, 2.0, vElevation);
        vec3 deepColor = vec3(uColor.r * 0.2, uColor.g * 0.1, uColor.b * 0.4); // Darker, purple-ish undertone
        vec3 finalColor = mix(deepColor, uColor, mixRatio);
        
        // Add a slight core glow to the particles
        float core = smoothstep(0.2, 0.0, ll) * 0.4 * mixRatio;
        finalColor += vec3(core);
        
        // Fade out based on distance from center (handled mostly by dampen in vertex, but let's add depth fade)
        float depthAlpha = alpha * uThemeOpacityMultiplier;
        
        if (depthAlpha < 0.01) discard;
        
        gl_FragColor = vec4(finalColor, depthAlpha * (0.3 + 0.7 * mixRatio));
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const particles = new THREE.Points(geometry, material);
  // Tilt the mesh slightly
  particles.rotation.x = -Math.PI / 12;
  scene.add(particles);

  const syncTheme = () => {
    const isDark = document.body.classList.contains("dark-theme");
    material.uniforms.uColor.value.set(getAccent());
    material.uniforms.uThemeOpacityMultiplier.value = isDark ? 0.8 : 0.6;
    
    // Switch to NormalBlending in light mode so colors are visible against white
    material.blending = isDark ? THREE.AdditiveBlending : THREE.NormalBlending;
    material.needsUpdate = true;
  };
  syncTheme();

  const themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });

  let isVisible = true;
  let mouseX = 0;
  let mouseY = 0;
  let targetMouseX = 0;
  let targetMouseY = 0;

  const handleMouseMove = (e) => {
    targetMouseX = (e.clientX / window.innerWidth) * 2 - 1;
    targetMouseY = -(e.clientY / window.innerHeight) * 2 + 1;
  };
  window.addEventListener("mousemove", handleMouseMove);

  const clock = new THREE.Clock();

  let resizeWait = false;
  const handleResize = () => {
    if (resizeWait) return;
    resizeWait = true;
    window.requestAnimationFrame(() => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, compact ? 1.5 : 2));
      material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
      resizeWait = false;
    });
  };
  window.addEventListener("resize", handleResize);

  let animationFrame = 0;
  const render = () => {
    animationFrame = window.requestAnimationFrame(render);
    if (document.hidden || !isVisible) return;

    const elapsed = clock.getElapsedTime();
    material.uniforms.uTime.value = elapsed;

    // Extremely slow and smooth mouse follow
    mouseX += (targetMouseX - mouseX) * 0.02;
    mouseY += (targetMouseY - mouseY) * 0.02;

    // Subtle parallax effect, rotating the entire scene slightly
    scene.rotation.x = mouseY * 0.05;
    scene.rotation.y = mouseX * 0.05;

    // Slowly rotate the particle grid for ambient motion
    particles.rotation.z = elapsed * 0.02;

    renderer.render(scene, camera);
  };

  render();

  return () => {
    window.cancelAnimationFrame(animationFrame);
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("mousemove", handleMouseMove);
    themeObserver.disconnect();
    renderer.setAnimationLoop(null);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
  };
}

/* ─────────────────────────────────────────────────────────────
 * Mobile "Data Stream" background – 2D Canvas
 * Snake-like energy traces crawling on a grid (H/V only).
 * ───────────────────────────────────────────────────────────── */
function mountMobileBackground() {
  const canvas = document.createElement('canvas');
  canvas.id = 'mobile-stream-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed', top: '0', left: '0',
    width: '100vw', height: '100vh',
    zIndex: '-1', pointerEvents: 'none',
    backgroundColor: 'transparent',
  });
  document.body.insertBefore(canvas, document.querySelector('.layout'));

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) { canvas.remove(); return null; }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w, h;
  const setSize = () => {
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  setSize();

  let resizeWait = false;
  const onResize = () => {
    if (resizeWait) return; resizeWait = true;
    requestAnimationFrame(() => { setSize(); resizeWait = false; });
  };
  window.addEventListener('resize', onResize);

  const readAccent = () =>
    getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#e61e4d';
  let accent = readAccent();
  const themeObs = new MutationObserver(() => { accent = readAccent(); });
  themeObs.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });

  const GRID = 20, NUM = 7, SPD = 1.2;

  class Stream {
    constructor() { this.reset(true); }
    reset(init = false) {
      this.x = Math.floor(Math.random() * (w / GRID)) * GRID;
      this.y = Math.floor(Math.random() * (h / GRID)) * GRID;
      this.trail = [];
      this.dir = Math.floor(Math.random() * 4);
      this.seg = this._rndSeg();
      this.maxLen = 45 + Math.floor(Math.random() * 90);
      this.warmup = init ? Math.floor(Math.random() * this.maxLen) : 0;
    }
    _rndSeg() { return (3 + Math.floor(Math.random() * 8)) * GRID; }
    step() {
      if (this.warmup > 0) { this.warmup--; }
      const dx = [0, SPD, 0, -SPD][this.dir];
      const dy = [-SPD, 0, SPD, 0][this.dir];
      this.x += dx; this.y += dy; this.seg -= SPD;
      if (this.seg <= 0) {
        this.x = Math.round(this.x / GRID) * GRID;
        this.y = Math.round(this.y / GRID) * GRID;
        this.dir = (this.dir + (Math.random() < 0.5 ? 1 : 3)) % 4;
        this.seg = this._rndSeg();
      }
      this.trail.unshift({ x: this.x, y: this.y });
      if (this.trail.length > this.maxLen) this.trail.pop();
      if (this.x < -120 || this.x > w + 120 || this.y < -120 || this.y > h + 120) this.reset();
    }
    draw(c, col) {
      const n = this.trail.length; if (n < 2) return;
      c.lineCap = 'round'; c.lineJoin = 'round';
      for (let i = 0; i < n - 1; i++) {
        const a = this.trail[i], b = this.trail[i + 1];
        const alpha = Math.pow(1 - i / n, 1.5);
        c.globalAlpha = alpha;

        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);

        if (i === 0) {
          c.lineWidth = 3;
          c.strokeStyle = col;
          c.shadowColor = col;
          c.shadowBlur = 24;
          c.shadowOffsetX = 0;
          c.shadowOffsetY = 0;
        } else if (i < 4) {
          c.lineWidth = 2.5;
          c.strokeStyle = col;
          c.shadowColor = col;
          c.shadowBlur = 18;
        } else {
          c.lineWidth = 1.8;
          c.strokeStyle = col;
          c.shadowColor = col;
          c.shadowBlur = 8;
        }
        c.stroke();
      }
      c.shadowBlur = 0;
      c.shadowOffsetX = 0;
      c.shadowOffsetY = 0;
      c.globalAlpha = 1;
    }
  }

  const streams = Array.from({ length: NUM }, () => new Stream());
  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (document.hidden) return;
    ctx.clearRect(0, 0, w, h);
    for (const s of streams) { s.step(); s.draw(ctx, accent); }
  };
  tick();



  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    themeObs.disconnect();
    canvas.remove();
  };
}

function syncThreeBackground() {
  // Debounce rapid calls to prevent WebGL context issues during resize
  if (syncThreeBackgroundTimeout) {
    clearTimeout(syncThreeBackgroundTimeout);
  }

  syncThreeBackgroundTimeout = setTimeout(() => {
    syncThreeBackgroundTimeout = null;
    _syncThreeBackgroundImpl();
  }, 300);
}

function _syncThreeBackgroundImpl() {
  const canvas = document.getElementById("webgl-canvas");
  if (!canvas) return;

  // Reduced motion: kill everything
  if (reducedMotionQuery.matches) {
    canvas.hidden = true;
    if (destroyBackground) { destroyBackground(); destroyBackground = null; }
    if (destroyMobileBackground) { destroyMobileBackground(); destroyMobileBackground = null; }
    backgroundVariant = null;
    return;
  }

  // Mobile: 2D Data Stream canvas (always mount on mobile, even if small viewport)
  if (mobileDevice.matches) {
    canvas.hidden = true;
    if (destroyBackground) { destroyBackground(); destroyBackground = null; backgroundVariant = null; }
    if (!destroyMobileBackground) {
      destroyMobileBackground = mountMobileBackground();
    }
    return;
  }

  // Hide WebGL canvas on very small non-mobile viewports
  if (window.innerWidth < 768 || window.innerHeight < 600) {
    canvas.hidden = true;
    if (destroyBackground) { destroyBackground(); destroyBackground = null; }
    backgroundVariant = null;
    return;
  }

  // Desktop: Three.js WebGL
  if (destroyMobileBackground) { destroyMobileBackground(); destroyMobileBackground = null; }
  const variant = getBackgroundVariant();
  if (shouldEnableBackground()) {
    canvas.hidden = false;
    if (!destroyBackground || backgroundVariant !== variant) {
      destroyBackground?.();
      destroyBackground = mountThreeBackground(canvas, variant);
      if (!destroyBackground) {
        canvas.hidden = true;
        backgroundVariant = null;
      } else {
        backgroundVariant = variant;
      }
    }
    return;
  }

  canvas.hidden = true;
  if (destroyBackground) {
    destroyBackground();
    destroyBackground = null;
  }
  backgroundVariant = null;
}

function bindMediaQueryListener(query, handler) {
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", handler);
    return;
  }

  if (typeof query.addListener === "function") {
    query.addListener(handler);
  }
}

export function initThreeBackground() {
  syncThreeBackground();

  bindMediaQueryListener(reducedMotionQuery, syncThreeBackground);
  bindMediaQueryListener(compactViewportQuery, syncThreeBackground);
  bindMediaQueryListener(mobileDevice, syncThreeBackground);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initThreeBackground);
} else {
  initThreeBackground();
}