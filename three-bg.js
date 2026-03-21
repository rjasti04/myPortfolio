import * as THREE from 'three';

export function initThreeBackground() {
  const canvas = document.getElementById('webgl-canvas');
  if (!canvas) return;

  // OS-level constraints bypassed so particles render correctly on PC default settings

  const scene = new THREE.Scene();
  
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 30;

  const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true, // Transparent so CSS theme background gradient shows through smoothly
    antialias: true
  });
  
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Space Particle Mesh
  const particlesGeometry = new THREE.BufferGeometry();
  const particlesCount = 800;
  const posArray = new Float32Array(particlesCount * 3);

  for (let i = 0; i < particlesCount * 3; i++) {
    // Spread widely for deep background tracking
    posArray[i] = (Math.random() - 0.5) * 120;
  }

  particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

  // Determine current active theme accent from CSS
  function getThemeColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f43f5e';
  }
  
  const particlesMaterial = new THREE.PointsMaterial({
    size: 0.18,
    color: new THREE.Color(getThemeColor()),
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending
  });

  const particlesMesh = new THREE.Points(particlesGeometry, particlesMaterial);
  scene.add(particlesMesh);

  // Mouse coordinate mappings
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

  // Responsive resizer
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  });

  // Dynamically update particle color if light/dark mode toggles
  const observer = new MutationObserver(() => {
    const newAccent = getThemeColor();
    if (newAccent) {
      particlesMaterial.color.set(newAccent);
    }
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // Deep 3D Scroll Integration
  window.addEventListener('scroll', () => {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const scrollPercent = Math.max(0, Math.min(1, window.scrollY / maxScroll));
    // Fly forward: camera.position.z travels from 30 down to 10 based on scroll
    camera.position.z = 30 - (scrollPercent * 20);
    // Slight downward pitch to map "moving through"
    scene.rotation.x = scrollPercent * 0.4;
  });

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const elapsedTime = clock.getElapsedTime();

    // Constant planetary rotation
    particlesMesh.rotation.y = elapsedTime * 0.05;
    particlesMesh.rotation.x = elapsedTime * 0.02;

    // Fluid easing responding to mouse trajectory
    targetX = mouseX * 0.001;
    targetY = mouseY * 0.001;
    
    // Lerp smoothing towards target
    particlesMesh.rotation.y += 0.05 * (targetX - particlesMesh.rotation.y);
    particlesMesh.rotation.x += 0.05 * (targetY - particlesMesh.rotation.x);

    renderer.render(scene, camera);
  }

  animate();
}

// Ensure the DOM naturally mounts the visual node first
document.addEventListener("DOMContentLoaded", initThreeBackground);
