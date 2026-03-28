import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const compactViewportQuery = window.matchMedia("(max-width: 900px)");
let destroyBackground = null;
let backgroundVariant = null;

function shouldEnableBackground() {
  if (reducedMotionQuery.matches) return false;
  return Boolean(window.WebGLRenderingContext);
}

function getBackgroundVariant() {
  return compactViewportQuery.matches ? "compact" : "default";
}

function getBackgroundConfig(variant = getBackgroundVariant()) {
  const compact = variant === "compact";
  return {
    cameraY: compact ? 8 : 10,
    cameraZ: compact ? 20 : 25,
    dustCount: compact ? 150 : 300,
    pixelRatioCap: compact ? 1.1 : 1.5,
    pointSize: compact ? 0.8 : 0.65,
    waveColumns: compact ? 40 : 60,
    waveRows: compact ? 40 : 60,
    waveSpacing: compact ? 1.2 : 1.1,
    waveYOffset: compact ? -4 : -5,
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

  const getAccent = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#f43f5e";

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
  let cursor = 0;
  for (let xIndex = 0; xIndex < waveColumns; xIndex += 1) {
    for (let zIndex = 0; zIndex < waveRows; zIndex += 1) {
      wavePositions[cursor] = (xIndex - waveColumns / 2) * config.waveSpacing;
      wavePositions[cursor + 1] = 0;
      wavePositions[cursor + 2] = (zIndex - waveRows / 2) * config.waveSpacing;
      cursor += 3;
    }
  }
  waveGeometry.setAttribute("position", new THREE.BufferAttribute(wavePositions, 3));

  const waveMaterial = new THREE.PointsMaterial({
    blending: THREE.AdditiveBlending,
    color: new THREE.Color(getAccent()),
    depthWrite: false,
    map: spriteTexture,
    opacity: 0.2,
    size: config.pointSize,
    transparent: true,
  });

  const waveMesh = new THREE.Points(waveGeometry, waveMaterial);
  waveMesh.rotation.x = -Math.PI / 6;
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
    opacity: 0.12,
    size: 0.28,
    transparent: true,
  });

  const dustMesh = new THREE.Points(dustGeometry, dustMaterial);
  scene.add(dustMesh);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;
  controls.maxDistance = 50;
  controls.minDistance = 10;
  controls.maxPolarAngle = Math.PI / 2 + 0.1;

  const syncTheme = () => {
    const color = new THREE.Color(getAccent());
    const isDark = document.body.classList.contains("dark-theme");
    waveMaterial.color.copy(color);
    dustMaterial.color.copy(color);
    waveMaterial.opacity = isDark ? (variant === "compact" ? 0.40 : 0.60) : (variant === "compact" ? 0.50 : 0.80);
    dustMaterial.opacity = isDark ? (variant === "compact" ? 0.20 : 0.30) : (variant === "compact" ? 0.25 : 0.40);
  };
  syncTheme();

  const themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

  const clock = new THREE.Clock();

  const handleResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.pixelRatioCap));
  };
  window.addEventListener("resize", handleResize);

  let animationFrame = 0;
  const render = () => {
    animationFrame = window.requestAnimationFrame(render);
    const elapsed = clock.getElapsedTime();
    const positions = waveGeometry.attributes.position.array;

    let index = 0;
    for (let xIndex = 0; xIndex < waveColumns; xIndex += 1) {
      for (let zIndex = 0; zIndex < waveRows; zIndex += 1) {
        const x = positions[index];
        const z = positions[index + 2];
        const dist = Math.sqrt(x * x + z * z);
        positions[index + 1] = Math.sin(dist * 0.45 - elapsed * 2.5) * 1.5;
        index += 3;
      }
    }
    waveGeometry.attributes.position.needsUpdate = true;

    dustMesh.rotation.y = elapsed * 0.02;
    dustMesh.rotation.x = elapsed * 0.01;

    controls.update();
    renderer.render(scene, camera);
  };

  render();

  return () => {
    window.cancelAnimationFrame(animationFrame);
    window.removeEventListener("resize", handleResize);
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
    canvas.width = canvas.width;
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
}

document.addEventListener("DOMContentLoaded", initThreeBackground);
