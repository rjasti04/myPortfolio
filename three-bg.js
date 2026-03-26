import * as THREE from "three";

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const compactViewportQuery = window.matchMedia("(max-width: 900px)");
let destroyBackground = null;

function shouldEnableBackground() {
  if (reducedMotionQuery.matches) return false;
  if (compactViewportQuery.matches) return false;
  return Boolean(window.WebGLRenderingContext);
}

function mountThreeBackground(canvas) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 4, 22);

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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
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
  const waveColumns = 52;
  const waveRows = 52;
  const wavePositions = new Float32Array(waveColumns * waveRows * 3);
  let cursor = 0;
  for (let xIndex = 0; xIndex < waveColumns; xIndex += 1) {
    for (let zIndex = 0; zIndex < waveRows; zIndex += 1) {
      wavePositions[cursor] = (xIndex - waveColumns / 2) * 1.25;
      wavePositions[cursor + 1] = 0;
      wavePositions[cursor + 2] = (zIndex - waveRows / 2) * 1.25;
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
    size: 0.65,
    transparent: true,
  });

  const waveMesh = new THREE.Points(waveGeometry, waveMaterial);
  waveMesh.rotation.x = -Math.PI / 6;
  waveMesh.position.y = -3.5;
  scene.add(waveMesh);

  const dustGeometry = new THREE.BufferGeometry();
  const dustCount = 220;
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

  const pointer = { x: 0, y: 0 };
  const updatePointer = (event) => {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
  };
  document.addEventListener("pointermove", updatePointer, { passive: true });

  const syncTheme = () => {
    const color = new THREE.Color(getAccent());
    const isDark = document.body.classList.contains("dark-theme");
    waveMaterial.color.copy(color);
    dustMaterial.color.copy(color);
    waveMaterial.opacity = isDark ? 0.30 : 0.70;
    dustMaterial.opacity = isDark ? 0.15 : 0.35;
  };
  syncTheme();

  const themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

  const clock = new THREE.Clock();

  const handleResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
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
        positions[index + 1] =
          Math.sin((x + elapsed * 2.2) * 0.16) * 0.85
          + Math.cos((z + elapsed * 1.6) * 0.15) * 0.8;
        index += 3;
      }
    }
    waveGeometry.attributes.position.needsUpdate = true;

    dustMesh.rotation.y = elapsed * 0.01;
    dustMesh.rotation.x = elapsed * 0.004;

    camera.position.x += ((pointer.x * 1.4) - camera.position.x) * 0.02;
    camera.position.y += ((4 - pointer.y * 0.7) - camera.position.y) * 0.02;
    camera.lookAt(scene.position);
    renderer.render(scene, camera);
  };

  render();

  return () => {
    window.cancelAnimationFrame(animationFrame);
    window.removeEventListener("resize", handleResize);
    document.removeEventListener("pointermove", updatePointer);
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

  if (shouldEnableBackground()) {
    canvas.hidden = false;
    if (!destroyBackground) {
      destroyBackground = mountThreeBackground(canvas);
      if (!destroyBackground) {
        canvas.hidden = true;
      }
    }
    return;
  }

  canvas.hidden = true;
  if (destroyBackground) {
    destroyBackground();
    destroyBackground = null;
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

  bindMediaQueryListener(reducedMotionQuery, syncThreeBackground);
  bindMediaQueryListener(compactViewportQuery, syncThreeBackground);
}

document.addEventListener("DOMContentLoaded", initThreeBackground);
