import * as THREE from "./js/vendor/three.module.js";
import {
  prefersReducedMotion as reducedMotionQuery,
  compactViewport as compactViewportQuery,
  mobileDevice,
  supportsHover
} from "./js/config.js";

let destroyBackground = null;
let backgroundProfile = null;
let syncThreeBackgroundTimeout = null;
let surgeIntensity = 0;

const COLOR_FALLBACKS = {
  accent: 0x0ea5e9,     // Sky Blue
  secondary: 0xa855f7,  // Vibrant Purple
  data: 0x10b981,       // Emerald
  node: 0xffffff        // Crisp White
};

const PROFILE_CONFIG = {
  desktop: {
    particleCount: 280,
    gridCols: 54,
    gridRows: 42,
    maxDistance: 32,
    dpr: 1.5,
    waveSpeed: 0.85,
    maxLinks: 4
  },
  compact: {
    particleCount: 180,
    gridCols: 42,
    gridRows: 32,
    maxDistance: 28,
    dpr: 1.25,
    waveSpeed: 0.7,
    maxLinks: 3
  },
  mobile: {
    particleCount: 100,
    gridCols: 28,
    gridRows: 22,
    maxDistance: 22,
    dpr: 1.0,
    waveSpeed: 0.5,
    maxLinks: 2
  }
};

/** Global API for click surge trigger */
window.triggerWebGlSurge = (x, y) => {
  surgeIntensity = 1.0;
  if (typeof window.__trigger3DSurge === "function") {
    window.__trigger3DSurge(x, y);
  }
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function parseCssColorToHex(value, fallback) {
  if (!value) return fallback;
  const tempCanvas = document.createElement("canvas");
  const ctx = tempCanvas.getContext("2d");
  if (!ctx) return fallback;

  ctx.fillStyle = "#000000";
  ctx.fillStyle = value.trim();
  const normalized = ctx.fillStyle;

  if (normalized.startsWith("#")) {
    return parseInt(normalized.replace("#", ""), 16);
  }
  if (normalized.startsWith("rgb")) {
    const match = normalized.match(/\d+/g);
    if (match && match.length >= 3) {
      return (parseInt(match[0], 10) << 16) + (parseInt(match[1], 10) << 8) + parseInt(match[2], 10);
    }
  }
  return fallback;
}

function readThemeColors() {
  const bodyStyles = getComputedStyle(document.body);
  const rootStyles = getComputedStyle(document.documentElement);
  const readVar = (name) =>
    bodyStyles.getPropertyValue(name).trim() ||
    rootStyles.getPropertyValue(name).trim();

  return {
    accent: parseCssColorToHex(readVar("--accent-fill"), COLOR_FALLBACKS.accent),
    secondary: parseCssColorToHex(readVar("--secondary-fill"), COLOR_FALLBACKS.secondary),
    data: parseCssColorToHex(readVar("--data-fill"), COLOR_FALLBACKS.data),
    node: COLOR_FALLBACKS.node
  };
}

function getProfileName() {
  if (mobileDevice.matches || window.innerWidth <= 640) return "mobile";
  if (compactViewportQuery.matches || window.innerHeight < 720) return "compact";
  return "desktop";
}

function shouldEnableBackground() {
  if (reducedMotionQuery.matches) return false;
  if (window.innerWidth < 320 || window.innerHeight < 420) return false;
  return true;
}

/** Create circular soft glowing particle sprite texture */
function createParticleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");

  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255, 255, 255, 1.0)");
  grad.addColorStop(0.2, "rgba(255, 255, 255, 0.85)");
  grad.addColorStop(0.45, "rgba(255, 255, 255, 0.35)");
  grad.addColorStop(0.8, "rgba(255, 255, 255, 0.08)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** 3D WebGL Three.js Background Implementation */
function mountThreeWebGLBackground(canvas, profileName = getProfileName()) {
  const config = PROFILE_CONFIG[profileName] || PROFILE_CONFIG.desktop;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance"
    });
  } catch (e) {
    console.warn("WebGL initialization failed, falling back to 2D canvas mode:", e);
    return mount2DFallbackBackground(canvas, profileName);
  }

  const dpr = Math.min(window.devicePixelRatio || 1, config.dpr);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0c16, 0.0022);

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 32, 110);
  camera.lookAt(0, -10, 0);

  let themeHex = readThemeColors();
  const accentColor = new THREE.Color(themeHex.accent);
  const secondaryColor = new THREE.Color(themeHex.secondary);
  const dataColor = new THREE.Color(themeHex.data);

  // -------------------------------------------------------------
  // 1. DYNAMIC 3D NEURAL WAVE MESH
  // -------------------------------------------------------------
  const gridWidth = 260;
  const gridDepth = 180;
  const gridGeo = new THREE.PlaneGeometry(gridWidth, gridDepth, config.gridCols, config.gridRows);
  gridGeo.rotateX(-Math.PI * 0.42);
  gridGeo.translate(0, -32, -10);

  const posAttr = gridGeo.attributes.position;
  const initialPositions = posAttr.array.slice();

  const waveMaterial = new THREE.MeshBasicMaterial({
    color: accentColor,
    wireframe: true,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending
  });

  const waveMesh = new THREE.Mesh(gridGeo, waveMaterial);
  scene.add(waveMesh);

  // -------------------------------------------------------------
  // 2. 3D FLOATING QUANTUM DATA PARTICLES
  // -------------------------------------------------------------
  const particleCount = config.particleCount;
  const particleGeo = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particleCount * 3);
  const particleVelocities = new Float32Array(particleCount * 3);
  const particleColors = new Float32Array(particleCount * 3);
  const particlePhases = new Float32Array(particleCount);

  const particleTexture = createParticleTexture();

  for (let i = 0; i < particleCount; i++) {
    const i3 = i * 3;
    particlePositions[i3] = (Math.random() - 0.5) * 280;
    particlePositions[i3 + 1] = (Math.random() - 0.5) * 140;
    particlePositions[i3 + 2] = (Math.random() - 0.5) * 180;

    particleVelocities[i3] = (Math.random() - 0.5) * 0.15;
    particleVelocities[i3 + 1] = Math.random() * 0.12 + 0.05; // Float upwards
    particleVelocities[i3 + 2] = (Math.random() - 0.5) * 0.15;

    particlePhases[i] = Math.random() * Math.PI * 2;

    const randColor = Math.random();
    const c = randColor < 0.45 ? accentColor : randColor < 0.85 ? secondaryColor : dataColor;
    particleColors[i3] = c.r;
    particleColors[i3 + 1] = c.g;
    particleColors[i3 + 2] = c.b;
  }

  particleGeo.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  particleGeo.setAttribute("color", new THREE.BufferAttribute(particleColors, 3));

  const particleMaterial = new THREE.PointsMaterial({
    size: 4.8,
    map: particleTexture,
    vertexColors: true,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const particleSystem = new THREE.Points(particleGeo, particleMaterial);
  scene.add(particleSystem);

  // -------------------------------------------------------------
  // 3. DYNAMIC VECTOR LINKS BETWEEN PARTICLES
  // -------------------------------------------------------------
  const maxLines = particleCount * config.maxLinks;
  const linePositions = new Float32Array(maxLines * 6);
  const lineColors = new Float32Array(maxLines * 6);

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
  lineGeo.setAttribute("color", new THREE.BufferAttribute(lineColors, 3));

  const lineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const lineSegments = new THREE.LineSegments(lineGeo, lineMaterial);
  scene.add(lineSegments);

  // -------------------------------------------------------------
  // 4. SHOCKWAVE BURST SYSTEM
  // -------------------------------------------------------------
  const shockwaves = [];
  window.__trigger3DSurge = (x, y) => {
    if (profileName === "mobile") return;
    const ringGeo = new THREE.RingGeometry(1, 2, 48);
    ringGeo.rotateX(-Math.PI * 0.5);

    const ringMat = new THREE.MeshBasicMaterial({
      color: accentColor,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });

    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    
    // Map screen x/y to 3D world coordinates on wave plane
    const vec = new THREE.Vector3(
      (x / window.innerWidth) * 2 - 1,
      -(y / window.innerHeight) * 2 + 1,
      0.5
    );
    vec.unproject(camera);
    const dir = vec.sub(camera.position).normalize();
    const distance = -camera.position.y / dir.y;
    const pos = camera.position.clone().add(dir.multiplyScalar(distance));

    ringMesh.position.set(pos.x, -25, pos.z);
    scene.add(ringMesh);

    shockwaves.push({
      mesh: ringMesh,
      radius: 2,
      maxRadius: 140,
      speed: 160,
      opacity: 0.85
    });
  };

  // -------------------------------------------------------------
  // INTERACTIVITY & EVENT LISTENERS
  // -------------------------------------------------------------
  const mouse = { x: 0, y: 0, targetX: 0, targetY: 0, active: false };
  let lastScrollY = window.scrollY || 0;
  let targetCameraY = 32;
  let targetCameraRotX = -0.22;

  const handleMouseMove = (event) => {
    mouse.active = true;
    mouse.targetX = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.targetY = -(event.clientY / window.innerHeight) * 2 + 1;
  };

  const handleMouseLeave = () => {
    mouse.active = false;
    mouse.targetX = 0;
    mouse.targetY = 0;
  };

  const handlePointerDown = (event) => {
    surgeIntensity = Math.min(surgeIntensity + 0.5, 1.2);
    if (event.clientX && event.clientY) {
      window.triggerWebGlSurge(event.clientX, event.clientY);
    }
  };

  const handleResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };

  window.addEventListener("resize", handleResize, { passive: true });
  if (supportsHover.matches && profileName !== "mobile") {
    window.addEventListener("pointermove", handleMouseMove, { passive: true });
    document.body.addEventListener("pointerleave", handleMouseLeave, { passive: true });
    window.addEventListener("pointerdown", handlePointerDown, { passive: true });
  }

  // Sync theme changes
  const themeObserver = new MutationObserver(() => {
    themeHex = readThemeColors();
    accentColor.setHex(themeHex.accent);
    secondaryColor.setHex(themeHex.secondary);
    dataColor.setHex(themeHex.data);
  });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });

  // -------------------------------------------------------------
  // ANIMATION RENDER LOOP
  // -------------------------------------------------------------
  let animationFrameId = 0;
  let lastTime = performance.now();

  const animate = (currentTime) => {
    animationFrameId = requestAnimationFrame(animate);

    if (document.hidden) {
      lastTime = currentTime;
      return;
    }

    const delta = Math.min((currentTime - lastTime) * 0.001, 0.05);
    const elapsed = currentTime * 0.001 * config.waveSpeed;
    lastTime = currentTime;

    surgeIntensity += (0 - surgeIntensity) * 0.02;

    // Smooth Mouse NDC lerp
    mouse.x += (mouse.targetX - mouse.x) * 0.08;
    mouse.y += (mouse.targetY - mouse.y) * 0.08;

    // Scroll parallax perspective shift
    const currentScrollY = window.scrollY || 0;
    const maxScroll = Math.max(document.body.scrollHeight - window.innerHeight, 1);
    const scrollRatio = clamp(currentScrollY / maxScroll, 0, 1);
    
    targetCameraY = 32 - scrollRatio * 20;
    targetCameraRotX = -0.22 - scrollRatio * 0.15;

    camera.position.x += (mouse.x * 14 - camera.position.x) * 0.05;
    camera.position.y += (targetCameraY + mouse.y * 8 - camera.position.y) * 0.05;
    camera.rotation.x += (targetCameraRotX - mouse.y * 0.08 - camera.rotation.x) * 0.05;
    camera.rotation.y = -mouse.x * 0.1;

    // Material color updates
    waveMaterial.color.lerp(accentColor, 0.05);

    // 1. Update 3D Neural Wave Grid Vertices
    const positions = posAttr.array;
    const cols = config.gridCols + 1;
    const rows = config.gridRows + 1;

    for (let i = 0; i < posAttr.count; i++) {
      const ix = i % cols;
      const iy = Math.floor(i / cols);
      const initZ = initialPositions[i * 3 + 2];

      const wx = (ix / cols) * 8 - 4;
      const wy = (iy / rows) * 8 - 4;

      // Multi-octave wave noise displacement
      let z = Math.sin(wx * 1.8 + elapsed * 1.5) * Math.cos(wy * 1.6 + elapsed * 1.2) * 5.5;
      z += Math.sin(wx * 3.2 - elapsed * 2.1) * 2.2;

      // Cursor Gravitational Lens vertex bending
      if (mouse.active) {
        const vx = positions[i * 3];
        const vy = positions[i * 3 + 1];
        const distToMouse = Math.hypot(vx - mouse.x * 120, vy - mouse.y * 80);
        if (distToMouse < 65) {
          const force = (1 - distToMouse / 65) ** 2 * 18 * (1 + surgeIntensity);
          z += force;
        }
      }

      positions[i * 3 + 2] = initZ + z;
    }
    posAttr.needsUpdate = true;

    // 2. Update Floating Quantum Particles
    const pPos = particleGeo.attributes.position.array;
    const pCol = particleGeo.attributes.color.array;

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      
      pPos[i3] += (particleVelocities[i3] + Math.sin(elapsed + particlePhases[i]) * 0.1) * (1 + surgeIntensity * 0.5);
      pPos[i3 + 1] += particleVelocities[i3 + 1] * (1 + surgeIntensity * 0.4);
      pPos[i3 + 2] += particleVelocities[i3 + 2];

      // Zero-G upward boundary reset
      if (pPos[i3 + 1] > 80) {
        pPos[i3 + 1] = -70;
        pPos[i3] = (Math.random() - 0.5) * 280;
        pPos[i3 + 2] = (Math.random() - 0.5) * 180;
      }
    }
    particleGeo.attributes.position.needsUpdate = true;

    // 3. Connect Dynamic Vector Lines between particles
    let lineIdx = 0;
    const maxDist = config.maxDistance;
    const maxDistSq = maxDist * maxDist;

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      let links = 0;

      for (let j = i + 1; j < particleCount; j++) {
        if (links >= config.maxLinks) break;

        const j3 = j * 3;
        const dx = pPos[i3] - pPos[j3];
        const dy = pPos[i3 + 1] - pPos[j3 + 1];
        const dz = pPos[i3 + 2] - pPos[j3 + 2];
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < maxDistSq) {
          const l6 = lineIdx * 6;

          linePositions[l6] = pPos[i3];
          linePositions[l6 + 1] = pPos[i3 + 1];
          linePositions[l6 + 2] = pPos[i3 + 2];

          linePositions[l6 + 3] = pPos[j3];
          linePositions[l6 + 4] = pPos[j3 + 1];
          linePositions[l6 + 5] = pPos[j3 + 2];

          const alpha = (1 - Math.sqrt(distSq) / maxDist) * 0.4;
          lineColors[l6] = accentColor.r * alpha;
          lineColors[l6 + 1] = accentColor.g * alpha;
          lineColors[l6 + 2] = accentColor.b * alpha;

          lineColors[l6 + 3] = secondaryColor.r * alpha;
          lineColors[l6 + 4] = secondaryColor.g * alpha;
          lineColors[l6 + 5] = secondaryColor.b * alpha;

          lineIdx++;
          links++;
        }
      }
    }

    // Zero out unused line segments
    for (let k = lineIdx * 6; k < maxLines * 6; k++) {
      linePositions[k] = 0;
      lineColors[k] = 0;
    }
    lineGeo.attributes.position.needsUpdate = true;
    lineGeo.attributes.color.needsUpdate = true;

    // 4. Update Expanding 3D Shockwave Rings
    for (let i = shockwaves.length - 1; i >= 0; i--) {
      const sw = shockwaves[i];
      sw.radius += sw.speed * delta;
      sw.opacity = (1 - sw.radius / sw.maxRadius) * 0.85;

      if (sw.radius >= sw.maxRadius || sw.opacity <= 0.01) {
        scene.remove(sw.mesh);
        sw.mesh.geometry.dispose();
        sw.mesh.material.dispose();
        shockwaves.splice(i, 1);
        continue;
      }

      sw.mesh.scale.set(sw.radius, sw.radius, 1);
      sw.mesh.material.opacity = sw.opacity;
    }

    renderer.render(scene, camera);
  };

  animationFrameId = requestAnimationFrame(animate);

  // Teardown & Resource Disposal Cleanup
  return () => {
    cancelAnimationFrame(animationFrameId);
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("pointermove", handleMouseMove);
    document.body.removeEventListener("pointerleave", handleMouseLeave);
    window.removeEventListener("pointerdown", handlePointerDown);
    delete window.__trigger3DSurge;
    themeObserver.disconnect();

    // Dispose WebGL Geometries and Materials
    gridGeo.dispose();
    waveMaterial.dispose();
    particleGeo.dispose();
    particleMaterial.dispose();
    particleTexture.dispose();
    lineGeo.dispose();
    lineMaterial.dispose();
    
    shockwaves.forEach((sw) => {
      scene.remove(sw.mesh);
      sw.mesh.geometry.dispose();
      sw.mesh.material.dispose();
    });

    renderer.dispose();
  };
}

/** 2D Canvas Fallback for devices without WebGL support */
function mount2DFallbackBackground(canvas, profileName) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);
  let animId = 0;

  const handleResize = () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  };
  window.addEventListener("resize", handleResize, { passive: true });

  const render = (time) => {
    animId = requestAnimationFrame(render);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(14, 165, 233, 0.15)";

    const t = time * 0.001;
    for (let x = 0; x < width; x += 40) {
      const y = height * 0.7 + Math.sin(x * 0.01 + t) * 20;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  animId = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(animId);
    window.removeEventListener("resize", handleResize);
    ctx.clearRect(0, 0, width, height);
  };
}

function syncThreeBackground() {
  if (syncThreeBackgroundTimeout) {
    clearTimeout(syncThreeBackgroundTimeout);
  }

  syncThreeBackgroundTimeout = setTimeout(() => {
    syncThreeBackgroundTimeout = null;
    syncThreeBackgroundImpl();
  }, 250);
}

function syncThreeBackgroundImpl() {
  const canvas = document.getElementById("webgl-canvas");
  if (!canvas) return;

  if (!shouldEnableBackground()) {
    canvas.hidden = true;
    destroyBackground?.();
    destroyBackground = null;
    backgroundProfile = null;
    return;
  }

  const nextProfile = getProfileName();
  canvas.hidden = false;

  if (!destroyBackground || backgroundProfile !== nextProfile) {
    destroyBackground?.();
    destroyBackground = mountThreeWebGLBackground(canvas, nextProfile);
    backgroundProfile = destroyBackground ? nextProfile : null;
    canvas.hidden = !destroyBackground;
  }
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
  window.addEventListener("resize", syncThreeBackground, { passive: true });
  bindMediaQueryListener(reducedMotionQuery, syncThreeBackground);
  bindMediaQueryListener(compactViewportQuery, syncThreeBackground);
  bindMediaQueryListener(mobileDevice, syncThreeBackground);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initThreeBackground);
} else {
  initThreeBackground();
}
