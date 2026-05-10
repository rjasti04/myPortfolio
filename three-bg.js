import * as THREE from "./js/vendor/three.module.js";
import {
  prefersReducedMotion as reducedMotionQuery,
  compactViewport as compactViewportQuery,
  mobileDevice
} from "./js/config.js";

let destroyBackground = null;
let backgroundProfile = null;
let isWebGLAvailable = null;
let syncThreeBackgroundTimeout = null;

const PROFILE_CONFIG = {
  desktop: {
    nodes: 80,
    links: 120,
    packets: 60,
    nodeSize: [4.5, 9.5],
    packetSize: [6.5, 10.5],
    dpr: 1.65,
    fps: 30,
    edgeBias: 0.5,
    opacity: { dark: 2.5, light: 3.5 }
  },
  compact: {
  nodes: 80,
  links: 120,
  packets: 60,
  nodeSize: [4.0, 8.5],
  packetSize: [6.0, 9.5],
  dpr: 1.45,
  fps: 30,
  edgeBias: 0.50,
    opacity: { dark: 2.5, light: 3.5 }
  },
  mobile: {
  nodes: 40,
  links: 80,
  packets: 30,
  nodeSize: [3.5, 7.5],
  packetSize: [5.5, 8.5],
  dpr: 1.25,
  fps: 24,
  edgeBias: 0.90,
    opacity: { dark: 2.5, light: 3.5 }
  }
};

function createPrng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function readCssColor(name, fallback) {
  const styles = getComputedStyle(document.body);
  const rootStyles = getComputedStyle(document.documentElement);
  const value = styles.getPropertyValue(name).trim() || rootStyles.getPropertyValue(name).trim() || fallback;
  const color = new THREE.Color();

  try {
    color.setStyle(value);
  } catch (error) {
    color.set(fallback);
  }

  return color;
}

function getProfileName() {
  if (mobileDevice.matches || window.innerWidth <= 640) return "mobile";
  if (compactViewportQuery.matches || window.innerHeight < 720) return "compact";
  return "desktop";
}

function canUseWebGL() {
  if (isWebGLAvailable !== null) return isWebGLAvailable;

  try {
    const canvas = document.createElement("canvas");
    isWebGLAvailable = Boolean(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch (error) {
    isWebGLAvailable = false;
  }

  return isWebGLAvailable;
}

function shouldEnableBackground() {
  if (reducedMotionQuery.matches) return false;
  if (window.innerWidth < 320 || window.innerHeight < 420) return false;
  return canUseWebGL();
}

function quietZoneAmount(x, y, aspect, profileName) {
  const quietX = aspect * (profileName === "mobile" ? 0.44 : 0.52);
  const quietY = profileName === "mobile" ? 0.34 : 0.42;
  const xAmount = 1 - clamp(Math.abs(x) / quietX, 0, 1);
  const yAmount = 1 - clamp(Math.abs(y) / quietY, 0, 1);
  return clamp(Math.min(xAmount, yAmount), 0, 1);
}

function moveOutOfQuietZone(point, aspect, profileName, rand) {
  const quietX = aspect * (profileName === "mobile" ? 0.34 : 0.44);
  const quietY = profileName === "mobile" ? 0.24 : 0.32;

  if (Math.abs(point.x) >= quietX || Math.abs(point.y) >= quietY) {
    return point;
  }

  const pushHorizontal = rand() > 0.45;
  if (pushHorizontal) {
    const sign = point.x >= 0 ? 1 : -1;
    point.x = sign * lerp(quietX, aspect * 1.08, rand());
  } else {
    const sign = point.y >= 0 ? 1 : -1;
    point.y = sign * lerp(quietY, 1.05, rand());
  }

  return point;
}

function createNodes(count, aspect, profileName, config, rand) {
  const nodes = [];
  const xMax = aspect * 1.12;
  const yMax = 1.08;

  for (let i = 0; i < count; i += 1) {
    const lane = rand();
    const edgeBias = config.edgeBias;
    const point = { x: 0, y: 0, z: 0 };

    if (lane < edgeBias * 0.28) {
      point.x = lerp(-xMax, -aspect * 0.58, rand());
      point.y = lerp(-yMax, yMax, rand());
    } else if (lane < edgeBias * 0.56) {
      point.x = lerp(aspect * 0.58, xMax, rand());
      point.y = lerp(-yMax, yMax, rand());
    } else if (lane < edgeBias * 0.78) {
      point.x = lerp(-xMax, xMax, rand());
      point.y = lerp(0.54, yMax, rand());
    } else if (lane < edgeBias) {
      point.x = lerp(-xMax, xMax, rand());
      point.y = lerp(-yMax, -0.54, rand());
    } else {
      point.x = lerp(-xMax, xMax, rand());
      point.y = lerp(-yMax, yMax, rand());
    }

    moveOutOfQuietZone(point, aspect, profileName, rand);

    nodes.push({
      x: point.x,
      y: point.y,
      z: lerp(-0.04, 0.04, rand()),
      size: lerp(config.nodeSize[0], config.nodeSize[1], rand()),
      seed: rand(),
      colorMix: rand()
    });
  }

  return nodes;
}

function createLinks(nodes, desiredCount, aspect, profileName, rand) {
  const links = [];
  const seen = new Set();
  const maxDistance = profileName === "mobile" ? Math.max(0.82, aspect * 1.1) : Math.max(0.9, aspect * 0.78);

  nodes.forEach((node, index) => {
    const nearest = nodes
      .map((candidate, candidateIndex) => {
        if (candidateIndex === index) return null;
        const dx = node.x - candidate.x;
        const dy = node.y - candidate.y;
        const distance = Math.hypot(dx, dy);
        return { index: candidateIndex, distance };
      })
      .filter(Boolean)
      .filter((candidate) => candidate.distance < maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);

    nearest.forEach((candidate) => {
      if (links.length >= desiredCount) return;
      if (rand() < 0.34 && nearest.length > 1) return;

      const a = Math.min(index, candidate.index);
      const b = Math.max(index, candidate.index);
      const key = `${a}:${b}`;
      if (seen.has(key)) return;

      seen.add(key);

      const from = nodes[a];
      const to = nodes[b];
      const midX = (from.x + to.x) * 0.5;
      const midY = (from.y + to.y) * 0.5;
      const quiet = quietZoneAmount(midX, midY, aspect, profileName);

      links.push({
        from: a,
        to: b,
        distance: candidate.distance,
        seed: rand(),
        colorMix: rand(),
        alpha: lerp(0.22, 0.52, rand()) * (1 - quiet * 0.56)
      });
    });
  });

  let attempts = 0;
  const maxAttempts = desiredCount * nodes.length * 8;

  while (links.length < desiredCount && attempts < maxAttempts) {
    attempts += 1;
    const fromIndex = Math.floor(rand() * nodes.length);
    const toIndex = Math.floor(rand() * nodes.length);
    if (fromIndex === toIndex) continue;

    const a = Math.min(fromIndex, toIndex);
    const b = Math.max(fromIndex, toIndex);
    const key = `${a}:${b}`;
    if (seen.has(key)) continue;

    const from = nodes[a];
    const to = nodes[b];
    const distance = Math.hypot(from.x - to.x, from.y - to.y);
    if (distance > maxDistance * 1.18) continue;

    seen.add(key);
    links.push({
      from: a,
      to: b,
      distance,
      seed: rand(),
      colorMix: rand(),
      alpha: lerp(0.16, 0.38, rand())
    });
  }

  if (links.length === 0 && nodes.length > 1) {
    links.push({
      from: 0,
      to: 1,
      distance: Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y),
      seed: rand(),
      colorMix: rand(),
      alpha: 0.24
    });
  }

  return links.slice(0, desiredCount);
}

function createLineMesh(nodes, links, uniforms) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(links.length * 2 * 3);
  const alphas = new Float32Array(links.length * 2);
  const colorMixes = new Float32Array(links.length * 2);

  links.forEach((link, index) => {
    const from = nodes[link.from];
    const to = nodes[link.to];
    const offset = index * 6;
    const attributeOffset = index * 2;

    positions[offset] = from.x;
    positions[offset + 1] = from.y;
    positions[offset + 2] = from.z;
    positions[offset + 3] = to.x;
    positions[offset + 4] = to.y;
    positions[offset + 5] = to.z;

    alphas[attributeOffset] = link.alpha;
    alphas[attributeOffset + 1] = link.alpha;
    colorMixes[attributeOffset] = link.colorMix;
    colorMixes[attributeOffset + 1] = link.colorMix;
  });

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aLineAlpha", new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute("aColorMix", new THREE.BufferAttribute(colorMixes, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uOpacity: { value: 1 }
    },
    vertexShader: `
      attribute float aLineAlpha;
      attribute float aColorMix;

      varying float vLineAlpha;
      varying float vColorMix;

      void main() {
        vLineAlpha = aLineAlpha;
        vColorMix = aColorMix;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision mediump float;

      uniform vec3 uPrimaryColor;
      uniform vec3 uSecondaryColor;
      uniform vec3 uDataColor;
      uniform float uOpacity;

      varying float vLineAlpha;
      varying float vColorMix;

      void main() {
        vec3 base = mix(uPrimaryColor, uSecondaryColor, smoothstep(0.15, 0.85, vColorMix));
        vec3 color = mix(base, uDataColor, smoothstep(0.55, 1.0, vColorMix) * 0.55);
        gl_FragColor = vec4(color, vLineAlpha * uOpacity);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  return new THREE.LineSegments(geometry, material);
}

function createNodeMesh(nodes, uniforms) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(nodes.length * 3);
  const sizes = new Float32Array(nodes.length);
  const seeds = new Float32Array(nodes.length);
  const colorMixes = new Float32Array(nodes.length);

  nodes.forEach((node, index) => {
    const offset = index * 3;
    positions[offset] = node.x;
    positions[offset + 1] = node.y;
    positions[offset + 2] = node.z + 0.02;
    sizes[index] = node.size;
    seeds[index] = node.seed;
    colorMixes[index] = node.colorMix;
  });

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute("aColorMix", new THREE.BufferAttribute(colorMixes, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uOpacity: { value: 1 }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;

      attribute float aSize;
      attribute float aSeed;
      attribute float aColorMix;

      varying float vPulse;
      varying float vColorMix;

      void main() {
        vColorMix = aColorMix;
        vPulse = 0.74 + 0.26 * sin(uTime * 0.72 + aSeed * 6.283185);
        gl_PointSize = aSize * uPixelRatio * vPulse;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision mediump float;

      uniform vec3 uPrimaryColor;
      uniform vec3 uSecondaryColor;
      uniform vec3 uDataColor;
      uniform float uOpacity;

      varying float vPulse;
      varying float vColorMix;

      void main() {
        vec2 point = gl_PointCoord.xy - vec2(0.5);
        float dist = length(point);
        float halo = smoothstep(0.5, 0.12, dist) * 0.58;
        float core = smoothstep(0.24, 0.0, dist);
        vec3 base = mix(uPrimaryColor, uSecondaryColor, smoothstep(0.1, 0.9, vColorMix));
        vec3 color = mix(base, uDataColor, smoothstep(0.62, 1.0, vColorMix) * 0.48);
        float alpha = (halo + core) * uOpacity * (0.76 + 0.24 * vPulse);

        if (alpha < 0.01) discard;

        gl_FragColor = vec4(color + core * 0.14, alpha);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  return new THREE.Points(geometry, material);
}

function createPackets(nodes, links, count, config, aspect, profileName, uniforms, rand) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const colorMixes = new Float32Array(count);
  const packets = [];

  for (let i = 0; i < count; i += 1) {
    const link = links[Math.floor(rand() * links.length)];
    const speedBase = profileName === "mobile" ? 0.035 : 0.045;
    const distanceFactor = clamp(link.distance, 0.45, 2.8);

    packets.push({
      link,
      phase: rand(),
      speed: lerp(speedBase, speedBase * 2.1, rand()) / distanceFactor,
      alpha: lerp(0.52, 0.92, rand())
    });

    sizes[i] = lerp(config.packetSize[0], config.packetSize[1], rand());
    colorMixes[i] = rand();
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPacketAlpha", new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute("aColorMix", new THREE.BufferAttribute(colorMixes, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uOpacity: { value: 1 }
    },
    vertexShader: `
      uniform float uPixelRatio;

      attribute float aSize;
      attribute float aPacketAlpha;
      attribute float aColorMix;

      varying float vPacketAlpha;
      varying float vColorMix;

      void main() {
        vPacketAlpha = aPacketAlpha;
        vColorMix = aColorMix;
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision mediump float;

      uniform vec3 uPrimaryColor;
      uniform vec3 uSecondaryColor;
      uniform vec3 uDataColor;
      uniform float uOpacity;

      varying float vPacketAlpha;
      varying float vColorMix;

      void main() {
        vec2 point = gl_PointCoord.xy - vec2(0.5);
        float dist = length(point);
        float body = smoothstep(0.5, 0.08, dist);
        float core = smoothstep(0.18, 0.0, dist);
        vec3 base = mix(uPrimaryColor, uSecondaryColor, smoothstep(0.12, 0.9, vColorMix));
        vec3 color = mix(base, uDataColor, smoothstep(0.42, 1.0, vColorMix) * 0.72);
        float alpha = body * vPacketAlpha * uOpacity;

        if (alpha < 0.01) discard;

        gl_FragColor = vec4(color + core * 0.26, alpha);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const mesh = new THREE.Points(geometry, material);

  const update = (elapsed) => {
    const positionAttribute = geometry.getAttribute("position");
    const alphaAttribute = geometry.getAttribute("aPacketAlpha");

    packets.forEach((packet, index) => {
      const from = nodes[packet.link.from];
      const to = nodes[packet.link.to];
      const progress = (packet.phase + elapsed * packet.speed) % 1;
      const ease = progress;
      const x = lerp(from.x, to.x, ease);
      const y = lerp(from.y, to.y, ease);
      const z = lerp(from.z, to.z, ease) + 0.04;
      const fade = Math.sin(progress * Math.PI);
      const quiet = quietZoneAmount(x, y, aspect, profileName);
      const offset = index * 3;

      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = z;
      alphas[index] = packet.alpha * (0.32 + fade * 0.68) * (1 - quiet * 0.52);
    });

    positionAttribute.needsUpdate = true;
    alphaAttribute.needsUpdate = true;
  };

  update(0);

  return { mesh, update };
}

function mountSignalMeshBackground(canvas, profileName = getProfileName()) {
  if (!canvas || !shouldEnableBackground()) return null;

  const config = PROFILE_CONFIG[profileName] || PROFILE_CONFIG.desktop;
  const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  const rand = createPrng(profileName === "mobile" ? 4871 : profileName === "compact" ? 8923 : 12037);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 10);
  camera.position.z = 3;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      canvas,
      depth: false,
      stencil: false,
      powerPreference: profileName === "mobile" ? "low-power" : "high-performance",
      failIfMajorPerformanceCaveat: false,
      preserveDrawingBuffer: false
    });
  } catch (error) {
    console.warn("Signal mesh background could not be initialized.", error);
    return null;
  }

  renderer.setClearColor(0x000000, 0);

  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, config.dpr) },
    uPrimaryColor: { value: new THREE.Color("#0ea5e9") },
    uSecondaryColor: { value: new THREE.Color("#a855f7") },
    uDataColor: { value: new THREE.Color("#10b981") }
  };

  const nodes = createNodes(config.nodes, aspect, profileName, config, rand);
  const links = createLinks(nodes, config.links, aspect, profileName, rand);
  const lineMesh = createLineMesh(nodes, links, uniforms);
  const nodeMesh = createNodeMesh(nodes, uniforms);
  const packets = createPackets(nodes, links, config.packets, config, aspect, profileName, uniforms, rand);

  lineMesh.renderOrder = 1;
  packets.mesh.renderOrder = 2;
  nodeMesh.renderOrder = 3;
  scene.add(lineMesh, packets.mesh, nodeMesh);

  const allMaterials = [lineMesh.material, nodeMesh.material, packets.mesh.material];

  const syncTheme = () => {
    const isDark = document.body.classList.contains("dark-theme");
    const opacity = isDark ? config.opacity.dark : config.opacity.light;
    const blending = THREE.AdditiveBlending;

    uniforms.uPrimaryColor.value.copy(readCssColor("--accent-fill", "#0ea5e9"));
    uniforms.uSecondaryColor.value.copy(readCssColor("--secondary-fill", "#a855f7"));
    uniforms.uDataColor.value.copy(readCssColor("--data-fill", "#10b981"));

    lineMesh.material.uniforms.uOpacity.value = opacity * 0.5;
    nodeMesh.material.uniforms.uOpacity.value = opacity * 0.66;
    packets.mesh.material.uniforms.uOpacity.value = opacity * 0.92;

    allMaterials.forEach((material) => {
      if (material.blending !== blending) {
        material.blending = blending;
        material.needsUpdate = true;
      }
    });
  };

  syncTheme();

  const themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });

  const setSize = () => {
    const width = window.innerWidth;
    const height = Math.max(window.innerHeight, 1);
    const nextAspect = width / height;

    camera.left = -nextAspect;
    camera.right = nextAspect;
    camera.top = 1;
    camera.bottom = -1;
    camera.updateProjectionMatrix();

    const pixelRatio = Math.min(window.devicePixelRatio || 1, config.dpr);
    uniforms.uPixelRatio.value = pixelRatio;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
  };

  setSize();

  let resizeWait = false;
  const handleResize = () => {
    if (resizeWait) return;

    resizeWait = true;
    window.requestAnimationFrame(() => {
      setSize();
      resizeWait = false;
    });
  };

  window.addEventListener("resize", handleResize);

  const supportsPointerParallax = profileName !== "mobile" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  let pointerX = 0;
  let pointerY = 0;
  let targetPointerX = 0;
  let targetPointerY = 0;

  const handlePointerMove = (event) => {
    targetPointerX = (event.clientX / window.innerWidth) * 2 - 1;
    targetPointerY = -((event.clientY / window.innerHeight) * 2 - 1);
  };

  if (supportsPointerParallax) {
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
  }

  const clock = new THREE.Clock();
  const frameInterval = 1000 / config.fps;
  let animationFrame = 0;
  let lastFrameTime = 0;

  const render = (currentTime) => {
    animationFrame = window.requestAnimationFrame(render);

    if (document.hidden) return;

    const deltaTime = currentTime - lastFrameTime;
    if (deltaTime < frameInterval) return;
    lastFrameTime = currentTime - (deltaTime % frameInterval);

    const elapsed = clock.getElapsedTime();
    uniforms.uTime.value = elapsed;
    packets.update(elapsed);

    if (supportsPointerParallax) {
      pointerX += (targetPointerX - pointerX) * 0.035;
      pointerY += (targetPointerY - pointerY) * 0.035;
      scene.position.x = pointerX * aspect * 0.018;
      scene.position.y = pointerY * 0.018;
      scene.rotation.z = pointerX * 0.006;
    }

    renderer.render(scene, camera);
  };

  animationFrame = window.requestAnimationFrame(render);

  const handleContextLost = (event) => {
    event.preventDefault();
    window.cancelAnimationFrame(animationFrame);
  };

  const handleContextRestored = () => {
    syncThreeBackground();
  };

  canvas.addEventListener("webglcontextlost", handleContextLost, false);
  canvas.addEventListener("webglcontextrestored", handleContextRestored, false);

  return () => {
    window.cancelAnimationFrame(animationFrame);
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("webglcontextlost", handleContextLost);
    canvas.removeEventListener("webglcontextrestored", handleContextRestored);
    themeObserver.disconnect();

    lineMesh.geometry.dispose();
    nodeMesh.geometry.dispose();
    packets.mesh.geometry.dispose();
    allMaterials.forEach((material) => material.dispose());
    renderer.dispose();
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
    destroyBackground = mountSignalMeshBackground(canvas, nextProfile);
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
