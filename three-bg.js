import * as THREE from 'three';

export function initThreeBackground() {
  const canvas = document.getElementById('webgl-canvas');
  if (!canvas) return;

  // OS-level constraints bypassed so particles render correctly on PC default settings

  const scene = new THREE.Scene();

  // Antigravity Camera Perspective
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 10, 30);

  const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true, // Transparent for CSS background to shine through
    antialias: true
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Helper to read CSS theme color dynamically
  function getThemeColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f43f5e';
  }

  // Generate Soft Glow Texture dynamically using native Canvas API
  function createParticleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    return new THREE.CanvasTexture(canvas);
  }

  const particleTexture = createParticleTexture();

  // --- SYSTEM 1: The Antigravity Undulating Wave Mesh ---
  const waveGeometry = new THREE.BufferGeometry();
  const countX = 80;
  const countZ = 80;
  const waveCount = countX * countZ;
  const waveArray = new Float32Array(waveCount * 3);

  let idx = 0;
  for (let ix = 0; ix < countX; ix++) {
    for (let iz = 0; iz < countZ; iz++) {
      waveArray[idx] = (ix - countX / 2) * 1.5;     // X spreading
      waveArray[idx + 1] = 0;                       // Y (animated per frame via sine waves)
      waveArray[idx + 2] = (iz - countZ / 2) * 1.5; // Z spreading
      idx += 3;
    }
  }

  waveGeometry.setAttribute('position', new THREE.BufferAttribute(waveArray, 3));

  const waveMaterial = new THREE.PointsMaterial({
    size: 0.8,
    color: new THREE.Color(getThemeColor()),
    transparent: true,
    opacity: 0.6,
    map: particleTexture,
    depthWrite: false, // Prevents strange rendering artifacts on overlapping glowing points
    blending: THREE.AdditiveBlending
  });

  const waveMesh = new THREE.Points(waveGeometry, waveMaterial);
  waveMesh.rotation.x = -Math.PI / 8; // Tilt slightly toward viewer
  waveMesh.position.y = -5; // Sink it below the main text plane
  scene.add(waveMesh);

  // --- SYSTEM 2: Deep Ambient Floating Dust ---
  const dustGeometry = new THREE.BufferGeometry();
  const dustCount = 500;
  const dustArray = new Float32Array(dustCount * 3);
  for (let d = 0; d < dustCount * 3; d++) {
    dustArray[d] = (Math.random() - 0.5) * 150;
  }
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustArray, 3));

  const dustMaterial = new THREE.PointsMaterial({
    size: 0.4,
    color: new THREE.Color(getThemeColor()),
    transparent: true,
    opacity: 0.25,
    map: particleTexture,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const dustMesh = new THREE.Points(dustGeometry, dustMaterial);
  scene.add(dustMesh);

  // Mouse trajectory handling for subtle parallax shifts
  let mouseX = 0;
  let mouseY = 0;
  let targetX = 0;
  let targetY = 0;
  const windowHalfX = window.innerWidth / 2;
  const windowHalfY = window.innerHeight / 2;

  document.addEventListener('mousemove', (event) => {
    mouseX = (event.clientX - windowHalfX);
    mouseY = (event.clientY - windowHalfY);
  });

  // Responsive boundary resizer
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  });

  // Dynamically update theme material and opacity based on active theme
  function updateThemeSettings() {
    const isDark = document.body.classList.contains('dark-theme');
    const newAccent = getThemeColor();
    if (newAccent) {
      const col = new THREE.Color(newAccent);
      waveMaterial.color.copy(col);
      dustMaterial.color.copy(col);
    }
    // Subdue the WebGL intensity to preserve content legibility
    waveMaterial.opacity = isDark ? 0.25 : 0.60;
    dustMaterial.opacity = isDark ? 0.15 : 0.30;
  }

  updateThemeSettings(); // Apply initial settings based on current theme

  const observer = new MutationObserver(() => {
    updateThemeSettings();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // 3D Scroll Integration parameters
  let scrollOffset = 0;
  window.addEventListener('scroll', () => {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    scrollOffset = Math.max(0, Math.min(1, window.scrollY / maxScroll));
  }, { passive: true });

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const elapsedTime = clock.getElapsedTime();

    // Smoothly Lerp Camera Matrix (Parallax + Scroll)
    targetX = mouseX * 0.002;
    targetY = mouseY * 0.002;

    // Map screen mouse coordinates to 3D world space roughly
    const worldMouseX = (mouseX / windowHalfX) * 45;
    const worldMouseZ = (mouseY / windowHalfY) * 30 - 5;

    // Mathematically undulate the Antigravity Wave layer using interference sine/cosine grids
    const positions = waveGeometry.attributes.position.array;
    let waveIdx = 0;
    for (let ix = 0; ix < countX; ix++) {
      for (let iz = 0; iz < countZ; iz++) {
        const cx = positions[waveIdx];
        const cz = positions[waveIdx + 2];

        // Fluid Radial Repulsion Math (squared-distance guard avoids sqrt for most particles)
        const dx = cx - worldMouseX;
        const dz = cz - worldMouseZ;
        const distSq = dx * dx + dz * dz;
        let repulsion = 0;
        if (distSq < 256) { // 16² = 256
          const dist = Math.sqrt(distSq);
          // Cursor ripples pushing into the wave
          repulsion = Math.cos(dist * 0.6 - elapsedTime * 4) * (16 - dist) * 0.25;
        }

        // Complex continuous wave formula
        const dropY = Math.sin((cx + elapsedTime * 0.8) * 0.2) * 1.5;
        const swellY = Math.cos((cz + elapsedTime * 0.6) * 0.2) * 1.5;
        const complexInterference = Math.sin((cx + cz + elapsedTime) * 0.1) * 2;

        positions[waveIdx + 1] = dropY + swellY + complexInterference + repulsion;
        waveIdx += 3;
      }
    }
    waveGeometry.attributes.position.needsUpdate = true; // Tell GPU that vertex array mutated

    // Gently drift the ambient dust matrix
    dustMesh.rotation.y = elapsedTime * 0.015;
    dustMesh.rotation.x = elapsedTime * 0.005;


    camera.position.x += (targetX - camera.position.x) * 0.05;
    camera.position.y += (10 + (scrollOffset * -5) - targetY - camera.position.y) * 0.05;
    camera.position.z += (30 + (scrollOffset * -20) - camera.position.z) * 0.05;

    // Always track scene center organically
    camera.lookAt(scene.position);

    renderer.render(scene, camera);
  }

  animate();
}

// Ensure the DOM natively mounts the visual node post HTML-parse
document.addEventListener("DOMContentLoaded", initThreeBackground);
