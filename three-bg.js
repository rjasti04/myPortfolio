import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { prefersReducedMotion as reducedMotionQuery, compactViewport as compactViewportQuery, mobileDevice } from "./js/config.js";
let destroyBackground = null;
let backgroundVariant = null;

function shouldEnableBackground() {
  if (reducedMotionQuery.matches) return false;
  if (mobileDevice.matches) return false;
  return Boolean(window.WebGLRenderingContext);
}

function getBackgroundVariant() {
  return compactViewportQuery.matches ? "compact" : "default";
}

function getBackgroundConfig(variant = getBackgroundVariant()) {
  const compact = variant === "compact";
  return {
    cameraY: compact ? 6 : 12,
    cameraZ: compact ? 12 : 25,
    dustCount: compact ? 2000 : 5000,
    pixelRatioCap: compact ? 1.5 : 2,
    pointSize: compact ? 0.35 : 0.6,
    waveColumns: compact ? 60 : 100,
    waveRows: compact ? 60 : 100,
    waveSpacing: compact ? 1.4 : 1.8,
    waveYOffset: compact ? -12 : -15,
  };
}

function mountThreeBackground(canvas, variant = getBackgroundVariant()) {
  const config = getBackgroundConfig(variant);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, config.cameraY, config.cameraZ);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas,
    });
  } catch (error) {
    console.error("Three.js background could not be initialized.", error);
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.pixelRatioCap));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const getAccent = () => getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#f43f5e";

  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 64;
  textureCanvas.height = 64;
  const textureContext = textureCanvas.getContext("2d");
  const gradient = textureContext.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.8)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.16)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  textureContext.fillStyle = gradient;
  textureContext.fillRect(0, 0, 64, 64);
  const spriteTexture = new THREE.CanvasTexture(textureCanvas);

  const waveGeometry = new THREE.BufferGeometry();
  const { waveColumns, waveRows } = config;
  const wavePositions = new Float32Array(waveColumns * waveRows * 3);
  const waveDistances = new Float32Array(waveColumns * waveRows);
  let cursor = 0;
  let distCursor = 0;
  for (let xIndex = 0; xIndex < waveColumns; xIndex += 1) {
    for (let zIndex = 0; zIndex < waveRows; zIndex += 1) {
      const x = (xIndex - waveColumns / 2) * config.waveSpacing;
      const z = (zIndex - waveRows / 2) * config.waveSpacing;
      wavePositions[cursor] = x;
      wavePositions[cursor + 1] = 0;
      wavePositions[cursor + 2] = z;
      waveDistances[distCursor] = Math.sqrt(x * x + z * z);
      cursor += 3;
      distCursor += 1;
    }
  }
  waveGeometry.setAttribute("position", new THREE.BufferAttribute(wavePositions, 3));

  const waveMaterial = new THREE.PointsMaterial({
    blending: THREE.AdditiveBlending,
    color: new THREE.Color(getAccent()),
    depthWrite: false,
    map: spriteTexture,
    size: config.pointSize,
    transparent: false,
  });

  const waveMesh = new THREE.Points(waveGeometry, waveMaterial);
  waveMesh.rotation.x = -Math.PI / 6;
  waveMesh.rotation.z = Math.PI / 6;
  waveMesh.position.y = config.waveYOffset;
  scene.add(waveMesh);

  const dustGeometry = new THREE.BufferGeometry();
  const { dustCount } = config;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let index = 0; index < dustCount * 3; index += 1) {
    dustPositions[index] = (Math.random() - 0.5) * 90;
  }
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));

  const dustMaterial = new THREE.PointsMaterial({
    blending: THREE.AdditiveBlending,
    color: new THREE.Color(getAccent()),
    depthWrite: false,
    map: spriteTexture,
    size: variant === "compact" ? 0.25 : 0.4,
    transparent: true,
  });

  const dustMesh = new THREE.Points(dustGeometry, dustMaterial);
  scene.add(dustMesh);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.autoRotate = false;
  controls.enableRotate = false;
  controls.enableZoom = false;
  controls.enablePan = false;

  const syncTheme = () => {
    const color = new THREE.Color(getAccent());
    const isDark = document.body.classList.contains("dark-theme");
    waveMaterial.color.copy(color);
    dustMaterial.color.copy(color);
    waveMaterial.opacity = isDark ? (variant === "compact" ? 0.30 : 0.60) : (variant === "compact" ? 0.52 : 1);
    dustMaterial.opacity = isDark ? (variant === "compact" ? 0.15 : 0.30) : (variant === "compact" ? 0.22 : 1);
  };
  syncTheme();

  const themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

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
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.pixelRatioCap));
      resizeWait = false;
    });
  };
  window.addEventListener("resize", handleResize);

  let animationFrame = 0;
  const render = () => {
    animationFrame = window.requestAnimationFrame(render);
    if (document.hidden || !isVisible) return;

    const elapsed = clock.getElapsedTime();
    const positions = waveGeometry.attributes.position.array;

    let index = 0;
    let distIndex = 0;
    for (let xIndex = 0; xIndex < waveColumns; xIndex += 1) {
      for (let zIndex = 0; zIndex < waveRows; zIndex += 1) {
        const x = positions[index];
        const z = positions[index + 2];
        const dist = waveDistances[distIndex];
        
        // Multi-layered sine waves for a smooth, organic, ocean-like feel
        let y = 0;
        y += Math.sin(x * 0.05 + elapsed * 0.15) * 1.5; // slow primary roll
        y += Math.cos(z * 0.05 + elapsed * 0.12) * 1.5; // slow cross roll
        y += Math.sin((x + z) * 0.03 - elapsed * 0.2) * 1.0; // gentle diagonal interference
        y += Math.sin(dist * 0.08 - elapsed * 0.25) * 0.5; // subtle outward ripple

        // Smooth edge dampening (attenuation) so it fades seamlessly into the distance
        const maxDist = (Math.max(waveColumns, waveRows) * config.waveSpacing) / 2;
        const dampening = Math.max(0, 1 - Math.pow(dist / maxDist, 2));

        positions[index + 1] = y * dampening;
        index += 3;
        distIndex += 1;
      }
    }
    waveGeometry.attributes.position.needsUpdate = true;

    mouseX += (targetMouseX - mouseX) * 0.05;
    mouseY += (targetMouseY - mouseY) * 0.05;

    // Slowly rotate dust independently for a floating ambient effect
    dustMesh.rotation.y = elapsed * 0.015;
    dustMesh.rotation.z = elapsed * 0.005;

    // Apply gentle parallax effect to the entire scene using mouse coordinates
    scene.rotation.x = mouseY * 0.15;
    scene.rotation.y = mouseX * 0.15;

    controls.update();
    renderer.render(scene, camera);
  };

  render();

  return () => {
    window.cancelAnimationFrame(animationFrame);
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("mousemove", handleMouseMove);
    controls.dispose();
    themeObserver.disconnect();
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.forceContextLoss?.();
    waveGeometry.dispose();
    dustGeometry.dispose();
    waveMaterial.dispose();
    dustMaterial.dispose();
    spriteTexture.dispose();
  };
}

function syncThreeBackground() {
  const canvas = document.getElementById("webgl-canvas");
  if (!canvas) return;

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