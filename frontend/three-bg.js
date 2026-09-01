/**
 * Animated plexus background: drifting nodes joined by proximity lines.
 *
 * The filename is historical. This is a plain 2D-canvas renderer - see the
 * `getContext("2d")` calls below - and there is no Three.js anywhere in this
 * repository. A 1.3 MB unreferenced `js/vendor/three.module.js` was published
 * to the web root on every deploy until it was removed; nothing had ever
 * imported it. Renaming this module would churn the service worker precache
 * list and main.js for no functional gain, so the name stays and this note
 * explains it.
 */
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

const TWO_PI = Math.PI * 2;
const POINTER_AWAY = -10000;

const COLOR_KEYS = {
  left: "secondary",
  right: "accent",
  top: "accent",
  bottom: "secondary",
  speck: "data"
};

const COLOR_FALLBACKS = {
  accent: [14, 165, 233],
  secondary: [168, 85, 247],
  data: [16, 185, 129],
  node: [255, 255, 255]
};

const PROFILE_CONFIG = {
  desktop: {
    minParticles: 150,
    maxParticles: 180,
    density: 10500,
    sideWidth: 0.28,
    maxDistance: 195,
    maxLinks: 5,
    radius: [1.3, 3.2],
    speed: [2.4, 6.8],
    dpr: 1.75,
    lineAlpha: 0.58,
    repelRadius: 155,
    repelStrength: 220,
    homeStrength: 0.06,
    glowIntensity: 1.0,
    connectionFalloff: 1.5,
    glassFacetCount: 24,
    glassFacetAlpha: 0.16,
    glassFacetAreaFactor: 0.34,
    enableShadows: false
  },
  compact: {
    minParticles: 125,
    maxParticles: 155,
    density: 9900,
    sideWidth: 0.31,
    maxDistance: 165,
    maxLinks: 4,
    radius: [1.1, 2.5],
    speed: [2.1, 5.8],
    dpr: 1.5,
    lineAlpha: 0.50,
    repelRadius: 135,
    repelStrength: 200,
    homeStrength: 0.07,
    glowIntensity: 0.95,
    connectionFalloff: 1.45,
    glassFacetCount: 16,
    glassFacetAlpha: 0.14,
    glassFacetAreaFactor: 0.3,
    enableShadows: false
  },
  mobile: {
    minParticles: 80,
    maxParticles: 100,
    density: 9500,
    sideWidth: 0.35,
    maxDistance: 120,
    maxLinks: 3,
    radius: [1.0, 2.2],
    speed: [1.6, 4.8],
    dpr: 1.3,
    lineAlpha: 0.42,
    repelRadius: 0,
    repelStrength: 0,
    homeStrength: 0.09,
    glowIntensity: 0.9,
    connectionFalloff: 1.4,
    glassFacetCount: 8,
    glassFacetAlpha: 0.10,
    glassFacetAreaFactor: 0.26,
    enableShadows: false
  }
};

window.triggerWebGlSurge = (x, y) => {
  surgeIntensity = 1;
  if (typeof window.__triggerBgRipple === "function" && typeof x === "number" && typeof y === "number") {
    window.__triggerBgRipple(x, y);
  }
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function randomBetween(range) {
  return lerp(range[0], range[1], Math.random());
}

// `rgba()` strings were rebuilt for every connection, facet and particle on
// every frame (~1.5k string allocations/frame at desktop density). Alpha is
// quantised to 1/255 - finer steps are not observable - so the cache converges
// on a few hundred entries and every subsequent frame is a pure lookup.
const colorStringCache = new Map();

function colorString(color, alpha) {
  const a = alpha < 0 ? 0 : alpha > 1 ? 255 : (alpha * 255) | 0;
  const key = (((color[0] << 24) | (color[1] << 16) | (color[2] << 8) | a) >>> 0);
  let out = colorStringCache.get(key);
  if (out === undefined) {
    // Cap the cache so a long session on a shifting palette cannot grow it
    // without bound; 4096 entries covers every colour/alpha pair in practice.
    if (colorStringCache.size > 4096) colorStringCache.clear();
    out = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${(a / 255).toFixed(3)})`;
    colorStringCache.set(key, out);
  }
  return out;
}

function blendColors(a, b, weight = 0.5) {
  const t = clamp(weight, 0, 1);
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t))
  ];
}

function averageColors(colors) {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < colors.length; i += 1) {
    r += colors[i][0];
    g += colors[i][1];
    b += colors[i][2];
  }
  const n = colors.length;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

// There are only four palette keys, so every mid-tone a frame can ask for is
// one of ten pairs. Precomputing them at theme-sync time removes the
// per-connection `averageColors([...])` allocation from the draw loop.
const midColorCache = new Map();

function rebuildDerivedColors(themeColors) {
  midColorCache.clear();
  const keys = ["accent", "secondary", "data", "node"];
  keys.forEach((ka) => {
    keys.forEach((kb) => {
      const ca = themeColors[ka] || COLOR_FALLBACKS.accent;
      const cb = themeColors[kb] || COLOR_FALLBACKS.accent;
      midColorCache.set(`${ka}|${kb}`, averageColors([ca, cb]));
    });
  });
}

function midColor(themeColors, keyA, keyB) {
  return midColorCache.get(`${keyA}|${keyB}`) || themeColors.accent;
}

function parseHexColor(value) {
  const hex = value.replace("#", "").trim();

  if (hex.length === 3) {
    return hex.split("").map((channel) => parseInt(`${channel}${channel}`, 16));
  }

  if (hex.length >= 6) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16)
    ];
  }

  return null;
}

function parseRgbColor(value) {
  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;

  const channels = match[1]
    .split(",")
    .slice(0, 3)
    .map((channel) => Number.parseFloat(channel.trim()));

  if (channels.some((channel) => Number.isNaN(channel))) return null;
  return channels;
}

function getColorParser() {
  if (!getColorParser.context) {
    getColorParser.context = document.createElement("canvas").getContext("2d");
  }

  return getColorParser.context;
}

function parseCssColor(value, fallback) {
  const parser = getColorParser();
  if (!parser || !value) return fallback;

  parser.fillStyle = "#000000";
  parser.fillStyle = value.trim();

  const normalized = parser.fillStyle;
  if (normalized.startsWith("#")) return parseHexColor(normalized) || fallback;
  if (normalized.startsWith("rgb")) return parseRgbColor(normalized) || fallback;

  return fallback;
}

function readThemeColors() {
  const bodyStyles = getComputedStyle(document.body);
  const rootStyles = getComputedStyle(document.documentElement);
  const readVar = (name) =>
    bodyStyles.getPropertyValue(name).trim() ||
    rootStyles.getPropertyValue(name).trim();

  return {
    accent: parseCssColor(readVar("--accent-fill"), COLOR_FALLBACKS.accent),
    secondary: parseCssColor(readVar("--secondary-fill"), COLOR_FALLBACKS.secondary),
    data: parseCssColor(readVar("--data-fill"), COLOR_FALLBACKS.data),
    node: COLOR_FALLBACKS.node
  };
}

const spriteCache = new Map();
let spriteCacheSignature = "";

function paletteSignature(themeColors) {
  return ["accent", "secondary", "data", "node"]
    .map((k) => (themeColors[k] || COLOR_FALLBACKS[k]).join(","))
    .join("|");
}

function updateSpriteCache(themeColors) {
  // The theme MutationObserver fires for any class/style write on <body>, not
  // just palette changes. Rebuilding 8 offscreen canvases + radial gradients on
  // each of those was pure waste, so bail out when the colours did not move.
  const signature = paletteSignature(themeColors);
  if (signature === spriteCacheSignature && spriteCache.size) return;
  spriteCacheSignature = signature;
  rebuildDerivedColors(themeColors);
  spriteCache.clear();
  const keys = ["accent", "secondary", "data", "node"];
  const baseRadius = 32;
  const size = baseRadius * 2;

  keys.forEach((colorKey) => {
    const color = themeColors[colorKey] || COLOR_FALLBACKS[colorKey];
    
    // Create standard and speck profiles
    ["standard", "speck"].forEach((profile) => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      
      const isSpeck = profile === "speck";
      const factor = isSpeck ? 4.0 : 5.4;
      const coreRatio = 1 / factor;
      
      const grad = ctx.createRadialGradient(baseRadius, baseRadius, 0, baseRadius, baseRadius, baseRadius);
      grad.addColorStop(0, colorString(themeColors.node, 0.48));
      grad.addColorStop(coreRatio * 0.55, colorString(color, 0.41));
      grad.addColorStop(coreRatio, colorString(color, 0.28));
      grad.addColorStop(Math.min(coreRatio * 2.2, 0.48), colorString(color, 0.16));
      grad.addColorStop(Math.min(coreRatio * 4.0, 0.72), colorString(color, 0.06));
      grad.addColorStop(1, colorString(color, 0));
      
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(baseRadius, baseRadius, baseRadius, 0, TWO_PI);
      ctx.fill();
      
      spriteCache.set(`${colorKey}_${profile}`, canvas);
    });
  });
}

function getProfileName() {
  if (mobileDevice.matches || window.innerWidth <= 640) return "mobile";
  // The innerHeight test is deliberately skipped on touch devices: a URL bar
  // collapsing past 720px would otherwise flip the profile and trigger a full
  // destroy/remount of the particle field in the middle of a scroll.
  const shortViewport = !mobileDevice.matches && window.innerHeight < 720;
  if (compactViewportQuery.matches || shortViewport) return "compact";
  return "desktop";
}

function shouldEnableBackground() {
  if (reducedMotionQuery.matches) return false;
  if (window.innerWidth < 320 || window.innerHeight < 420) return false;
  return Boolean(
    window.requestAnimationFrame &&
      typeof document.createElement("canvas").getContext === "function"
  );
}

function getParticleCount(width, height, config) {
  const count = Math.round((width * height) / config.density);
  return clamp(count, config.minParticles, config.maxParticles);
}

function pickZone() {
  const roll = Math.random();
  if (roll < 0.44) return "left";
  if (roll < 0.88) return "right";
  if (roll < 0.94) return "top";
  if (roll < 0.98) return "bottom";
  return "speck";
}

function zonePosition(zone, width, height, config) {
  const sideBand = width * config.sideWidth;
  const outside = config.maxDistance * 0.35;
  const verticalPadding = height * 0.05;

  if (zone === "left") {
    return {
      x: lerp(-outside * 0.25, sideBand, Math.random() ** 0.9),
      y: lerp(-verticalPadding, height + verticalPadding, Math.random())
    };
  }

  if (zone === "right") {
    return {
      x: width - lerp(-outside * 0.25, sideBand, Math.random() ** 0.9),
      y: lerp(-verticalPadding, height + verticalPadding, Math.random())
    };
  }

  if (zone === "top") {
    const leftSide = Math.random() > 0.5;
    return {
      x: leftSide
        ? lerp(-outside * 0.25, width * 0.38, Math.random())
        : lerp(width * 0.62, width + outside * 0.25, Math.random()),
      y: lerp(-outside * 0.8, height * 0.22, Math.random() ** 1.35)
    };
  }

  if (zone === "bottom") {
    const leftSide = Math.random() > 0.5;
    return {
      x: leftSide
        ? lerp(-outside * 0.25, width * 0.32, Math.random())
        : lerp(width * 0.68, width + outside * 0.25, Math.random()),
      y: height - lerp(-outside * 0.8, height * 0.2, Math.random() ** 1.45)
    };
  }

  return {
    x: lerp(width * 0.3, width * 0.7, Math.random()),
    y: lerp(height * 0.2, height * 0.75, Math.random())
  };
}

function createParticle(width, height, config) {
  const zone = pickZone();
  const position = zonePosition(zone, width, height, config);
  const angle = zone === "left"
    ? lerp(-0.5, 0.5, Math.random())
    : zone === "right"
      ? Math.PI + lerp(-0.5, 0.5, Math.random())
      : Math.random() * TWO_PI;
  const speed = randomBetween(config.speed) * (zone === "speck" ? 0.3 : 1);
  const colorKey = COLOR_KEYS[zone];

  return {
    zone,
    colorKey,
    x: position.x,
    y: position.y,
    homeX: position.x,
    homeY: position.y,
    baseSpeed: speed,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: randomBetween(config.radius) * (zone === "speck" ? 0.65 : 1),
    alpha: zone === "speck" ? lerp(0.16, 0.38, Math.random()) : lerp(0.52, 0.92, Math.random()),
    phase: Math.random() * TWO_PI,
    turn: lerp(0.04, 0.15, Math.random()) * (Math.random() > 0.5 ? 1 : -1),
    pulseOffset: Math.random() * TWO_PI,
    isHub: zone !== "speck" && Math.random() < 0.12
  };
}

function reconcileParticles(particles, width, height, config) {
  const nextCount = getParticleCount(width, height, config);

  while (particles.length < nextCount) {
    particles.push(createParticle(width, height, config));
  }

  if (particles.length > nextCount) {
    particles.length = nextCount;
  }

  particles.forEach((particle) => {
    particle.x = clamp(particle.x, -config.maxDistance, width + config.maxDistance);
    particle.y = clamp(particle.y, -config.maxDistance, height + config.maxDistance);
  });
}

function drawBackground(ctx, width, height) {
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, width, height);
}

function updateParticle(particle, delta, elapsed, width, height, pointer, config, intensity) {
  // Anti-gravity zero-g float drift logic
  const floatUpSpeed = -(particle.baseSpeed || 2.0) * 0.38 * (1 + intensity * 0.4);
  const horizontalSway = Math.sin(elapsed * 1.6 + particle.phase) * 0.35;

  // Gently interpolate velocity towards anti-gravity floating state
  particle.vy = lerp(particle.vy, floatUpSpeed, delta * 1.8);
  particle.vx = lerp(particle.vx, horizontalSway, delta * 1.2);

  // Mouse Anti-Gravity Point Source Interaction (150px radius)
  const repelRadius = 150;
  if (pointer.active) {
    const dx = particle.x - pointer.x;
    const dy = particle.y - pointer.y;
    const distanceSquared = dx * dx + dy * dy;
    const radiusSquared = repelRadius * repelRadius;

    if (distanceSquared < radiusSquared && distanceSquared > 0) {
      const distance = Math.sqrt(distanceSquared);
      const normRatio = distance / repelRadius;
      
      // Repulsive force strongest at center, easing smoothly to boundary
      const force = Math.pow(1 - normRatio, 1.8) * (config.repelStrength || 220) * 1.4 * delta;
      
      // Anti-gravity repulsion velocity vector
      particle.vx += (dx / distance) * force;
      particle.vy += (dy / distance) * force;
    }
  }

  // Smooth inertia damping for graceful ease-back when mouse leaves or stops
  particle.vx *= 0.95;
  particle.vy *= 0.95;

  // Position displacement update
  particle.x += particle.vx * delta * 60;
  particle.y += particle.vy * delta * 60;

  // Boundary logic: Anti-gravity continuous upward wrapping
  const margin = config.maxDistance * 0.5;
  if (particle.y < -margin) {
    particle.y = height + margin;
    particle.x = Math.random() * width;
  } else if (particle.y > height + margin) {
    particle.y = -margin;
  }

  if (particle.x < -margin) {
    particle.x = width + margin;
  } else if (particle.x > width + margin) {
    particle.x = -margin;
  }
}

function connectionDistanceFor(a, b, config) {
  if (a.zone === "speck" || b.zone === "speck") return config.maxDistance * 0.5;
  if (a.zone === b.zone) return config.maxDistance * 1.05;
  if ((a.zone === "left" && b.zone === "top") || (a.zone === "top" && b.zone === "left")) {
    return config.maxDistance * 0.82;
  }
  if ((a.zone === "right" && b.zone === "top") || (a.zone === "top" && b.zone === "right")) {
    return config.maxDistance * 0.82;
  }
  if ((a.zone === "left" && b.zone === "bottom") || (a.zone === "bottom" && b.zone === "left")) {
    return config.maxDistance * 0.75;
  }
  if ((a.zone === "right" && b.zone === "bottom") || (a.zone === "bottom" && b.zone === "right")) {
    return config.maxDistance * 0.75;
  }
  return config.maxDistance * 0.38;
}

function midpointIsTooCentral(a, b, width, height) {
  if (a.zone === "speck" || b.zone === "speck") return false;

  const midX = (a.x + b.x) * 0.5;
  const midY = (a.y + b.y) * 0.5;
  return midX > width * 0.32 &&
    midX < width * 0.68 &&
    midY > height * 0.14 &&
    midY < height * 0.86;
}

// The grid, its buckets and the candidate objects below are all reused across
// frames. The previous version allocated a Map, one array per occupied cell and
// a string key per particle *and* per neighbour probe (~1.8k strings/frame at
// desktop density), which showed up as steady GC pressure in the profile.
const GRID_ORIGIN = 512;
const gridBuckets = new Map();
let gridGeneration = 0;

function gridKey(cx, cy) {
  return (cy + GRID_ORIGIN) * 4096 + (cx + GRID_ORIGIN);
}

function buildSpatialGrid(particles, cellSize) {
  gridGeneration += 1;
  const gen = gridGeneration;
  const invCell = 1 / cellSize;

  for (let i = 0; i < particles.length; i += 1) {
    const cx = Math.floor(particles[i].x * invCell);
    const cy = Math.floor(particles[i].y * invCell);
    const key = gridKey(cx, cy);
    let bucket = gridBuckets.get(key);
    if (bucket === undefined) {
      bucket = { gen, list: [] };
      gridBuckets.set(key, bucket);
    } else if (bucket.gen !== gen) {
      // Stale from an earlier frame: recycle the array instead of reallocating.
      bucket.gen = gen;
      bucket.list.length = 0;
    }
    bucket.list.push(i);
  }

  return gen;
}

const candidatePool = [];
const candidates = [];

function collectConnections(particles, config, width, height) {
  const cellSize = config.maxDistance;
  const gen = buildSpatialGrid(particles, cellSize);
  const invCell = 1 / cellSize;
  let count = 0;

  candidates.length = 0;

  for (let i = 0; i < particles.length; i += 1) {
    const a = particles[i];
    const cx = Math.floor(a.x * invCell);
    const cy = Math.floor(a.y * invCell);

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = gridBuckets.get(gridKey(cx + dx, cy + dy));
        if (bucket === undefined || bucket.gen !== gen) continue;

        const list = bucket.list;
        for (let k = 0; k < list.length; k += 1) {
          const j = list[k];
          if (j <= i) continue;
          const b = particles[j];
          const maxDist = connectionDistanceFor(a, b, config);
          const ex = a.x - b.x;
          const ey = a.y - b.y;
          const d2 = ex * ex + ey * ey;

          if (d2 > maxDist * maxDist) continue;
          if (midpointIsTooCentral(a, b, width, height)) continue;

          let candidate = candidatePool[count];
          if (candidate === undefined) {
            candidate = { from: 0, to: 0, distance: 0, maxDistance: 0, alpha: 0, proximity: 0 };
            candidatePool[count] = candidate;
          }
          candidate.from = i;
          candidate.to = j;
          candidate.distance = Math.sqrt(d2);
          candidate.maxDistance = maxDist;
          candidates.push(candidate);
          count += 1;
        }
      }
    }
  }

  return candidates.sort(byDistance);
}

function byDistance(a, b) {
  return a.distance - b.distance;
}

function connectionKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function triangleArea(a, b, c) {
  return Math.abs(
    (a.x * (b.y - c.y) +
      b.x * (c.y - a.y) +
      c.x * (a.y - b.y)) * 0.5
  );
}

function pointIsTooCentral(x, y, width, height) {
  return x > width * 0.34 &&
    x < width * 0.66 &&
    y > height * 0.16 &&
    y < height * 0.84;
}

// Reused output slot: this is called once per visible facet per frame and the
// result is consumed immediately by the caller.
const longestEdgeOut = [null, null];

function longestTriangleEdge(a, b, c) {
  const ab = distanceSquared(a, b);
  const bc = distanceSquared(b, c);
  const ca = distanceSquared(c, a);

  if (ab >= bc && ab >= ca) {
    longestEdgeOut[0] = a;
    longestEdgeOut[1] = b;
  } else if (bc >= ca) {
    longestEdgeOut[0] = b;
    longestEdgeOut[1] = c;
  } else {
    longestEdgeOut[0] = c;
    longestEdgeOut[1] = a;
  }

  return longestEdgeOut;
}

let linkCounts = new Uint8Array(0);
const selectedConnections = [];
// particle index -> index of its first selected connection, so the ripple
// collision pass can find an outgoing edge in O(1) instead of scanning the
// whole connection list per excited particle.
let firstConnectionOf = new Int32Array(0);

function selectConnections(particles, config, width, height, intensity) {
  if (linkCounts.length < particles.length) {
    linkCounts = new Uint8Array(particles.length);
    firstConnectionOf = new Int32Array(particles.length);
  } else {
    linkCounts.fill(0, 0, particles.length);
  }
  firstConnectionOf.fill(-1, 0, particles.length);

  const connections = collectConnections(particles, config, width, height);
  selectedConnections.length = 0;

  for (let i = 0; i < connections.length; i += 1) {
    const connection = connections[i];
    const a = particles[connection.from];
    const b = particles[connection.to];
    const maxLinks = a.zone === "speck" || b.zone === "speck" ? 1 : config.maxLinks;

    if (linkCounts[connection.from] >= maxLinks || linkCounts[connection.to] >= maxLinks) continue;

    const proximity = 1 - connection.distance / connection.maxDistance;
    const falloff = config.connectionFalloff || 1.4;

    // Mutate the pooled candidate rather than spreading it into a fresh object.
    connection.proximity = proximity;
    connection.alpha = clamp(proximity ** falloff * config.lineAlpha * (1 + intensity * 0.45), 0, 0.78);

    const slot = selectedConnections.length;
    if (firstConnectionOf[connection.from] < 0) firstConnectionOf[connection.from] = slot;
    if (firstConnectionOf[connection.to] < 0) firstConnectionOf[connection.to] = slot;
    selectedConnections.push(connection);

    linkCounts[connection.from] += 1;
    linkCounts[connection.to] += 1;
  }

  return selectedConnections;
}

function collectGlassFacets(particles, connections, config, width, height) {
  const maxFacets = config.glassFacetCount || 0;
  if (maxFacets <= 0 || connections.length < 3) return [];

  const adjacency = new Map();
  const edgeMap = new Map();
  const minArea = config.glassFacetMinArea || 280;
  const maxArea = config.maxDistance * config.maxDistance * (config.glassFacetAreaFactor || 0.3);
  const facets = [];

  const addNeighbor = (from, to, connection) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({
      to,
      proximity: connection.proximity
    });
  };

  connections.forEach((connection) => {
    const a = particles[connection.from];
    const b = particles[connection.to];
    if (!a || !b || a.zone === "speck" || b.zone === "speck") return;

    edgeMap.set(connectionKey(connection.from, connection.to), connection);
    addNeighbor(connection.from, connection.to, connection);
    addNeighbor(connection.to, connection.from, connection);
  });

  adjacency.forEach((neighbors, from) => {
    for (let i = 0; i < neighbors.length - 1; i += 1) {
      for (let j = i + 1; j < neighbors.length; j += 1) {
        const first = neighbors[i].to;
        const second = neighbors[j].to;

        // Ensure we only process each triangle once: only when the current node (from)
        // is the one with the smallest index.
        if (from >= first || from >= second) continue;

        const closingConnection = edgeMap.get(connectionKey(first, second));
        if (!closingConnection) continue;

        const a = particles[from];
        const b = particles[first];
        const c = particles[second];
        const area = triangleArea(a, b, c);
        if (area < minArea || area > maxArea) continue;

        const cx = (a.x + b.x + c.x) / 3;
        const cy = (a.y + b.y + c.y) / 3;
        if (pointIsTooCentral(cx, cy, width, height)) continue;

        facets.push({
          points: [from, first, second],
          // `from` is always the smallest index here, so ordering the other two
          // is enough for a stable key. Computed once instead of twice per
          // facet per frame via slice().sort().join().
          key: first < second ? `${from}:${first}:${second}` : `${from}:${second}:${first}`,
          area,
          strength: (neighbors[i].proximity + neighbors[j].proximity + closingConnection.proximity) / 3
        });
      }
    }
  });

  return facets
    .sort((a, b) => (b.strength * Math.sqrt(b.area)) - (a.strength * Math.sqrt(a.area)))
    .slice(0, maxFacets);
}

const facetByKey = new Map();
const facetColors = [null, null, null];

// Fixed-size scratch for the "cursor connection hub" pass.
const HUB_LINKS = 4;
const hubDistSq = new Float64Array(HUB_LINKS);
const hubIndex = new Int32Array(HUB_LINKS);
let hubCount = 0;

function traceTriangle(ctx, a, b, c) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.closePath();
}

function drawGlassFacets(ctx, particles, connections, config, width, height, intensity, themeColors, facetOpacity, delta) {
  const facets = collectGlassFacets(particles, connections, config, width, height);

  // Temporal smoothing: fade-in rate and fade-out rate per second
  const fadeIn = 2.2 * delta;   // ~0.037 per frame at 60fps → full in ~27 frames
  const fadeOut = 1.4 * delta;  // ~0.023 per frame → gone in ~43 frames

  // Mark all existing keys for potential fade-out
  const activeKeys = new Set();

  // Update opacity for currently visible facets
  facets.forEach((facet) => {
    activeKeys.add(facet.key);
    const prev = facetOpacity.get(facet.key) || 0;
    facetOpacity.set(facet.key, Math.min(prev + fadeIn, 1));
  });

  // Fade out facets that are no longer detected
  for (const [key, opacity] of facetOpacity) {
    if (!activeKeys.has(key)) {
      const next = opacity - fadeOut;
      if (next <= 0.01) {
        facetOpacity.delete(key);
      } else {
        facetOpacity.set(key, next);
      }
    }
  }

  // Build a lookup of current facets by key for drawing fading-out ones
  facetByKey.clear();
  facets.forEach((facet) => {
    facetByKey.set(facet.key, facet);
  });

  if (!facetOpacity.size) return;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // Palette-derived and intensity-derived values are the same for every facet
  // in a frame; they were being recomputed inside the loop.
  const cyanGlass = blendColors(themeColors.accent, themeColors.data, 0.22);
  const edgeWidth = 0.85 + intensity * 0.25;
  const seamWidth = 1.35 + intensity * 0.25;

  // Draw all facets that have any opacity (active + fading out)
  for (const [key, opacity] of facetOpacity) {
    const facet = facetByKey.get(key);
    if (!facet) continue; // fading-out facet whose particles moved — skip gracefully

    const [first, second, third] = facet.points;
    const a = particles[first];
    const b = particles[second];
    const c = particles[third];
    if (!a || !b || !c) continue;

    facetColors[0] = themeColors[a.colorKey] || themeColors.accent;
    facetColors[1] = themeColors[b.colorKey] || themeColors.accent;
    facetColors[2] = themeColors[c.colorKey] || themeColors.accent;
    const glassColor = blendColors(averageColors(facetColors), cyanGlass, 0.72);
    const highlightColor = blendColors(glassColor, themeColors.node, 0.56);
    const baseAlpha = clamp(
      (config.glassFacetAlpha || 0.14) * (0.65 + facet.strength * 0.9) * (1 + intensity * 0.35),
      0,
      0.32
    );
    const alpha = baseAlpha * opacity;

    // Single fill: 0.55*glass + 0.08*node is identical to filling twice under
    // additive compositing, and halves the fill-rate cost of the facet pass.
    ctx.fillStyle = colorString(blendColors(glassColor, themeColors.node, 0.127), alpha * 0.63);

    if (config.enableShadows) {
      ctx.shadowBlur = (16 + intensity * 8) * opacity;
      ctx.shadowColor = colorString(themeColors.accent, alpha * 1.7);
    }

    traceTriangle(ctx, a, b, c);
    ctx.fill();

    if (config.enableShadows) {
      ctx.shadowBlur = 0;
    }

    // Reuse the path already built for the fill instead of retracing it.
    ctx.lineWidth = edgeWidth;
    ctx.strokeStyle = colorString(highlightColor, alpha * 0.65);
    ctx.stroke();

    const [start, end] = longestTriangleEdge(a, b, c);
    ctx.lineWidth = seamWidth;
    ctx.strokeStyle = colorString(highlightColor, alpha * 1.1);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  ctx.restore();
}

// Every connection used to cost two beginPath/stroke pairs — ~500 stroke calls
// per frame at desktop density, and stroking under "lighter" is the single most
// expensive thing this file does (it was the top JS frame in the CPU profile).
// Lines are instead bucketed by colour pair and a quantised alpha, so all lines
// sharing a style go into one path that is stroked twice (glow + core). That
// takes the stroke count down to roughly two per populated bucket.
const CONNECTION_ALPHA_BANDS = 16;
const connectionBatches = new Map();

function drawConnections(ctx, particles, config, width, height, intensity, themeColors, connections) {
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";

  connectionBatches.forEach(resetBatch);

  for (let i = 0; i < connections.length; i += 1) {
    const connection = connections[i];
    const a = particles[connection.from];
    const b = particles[connection.to];
    let band = (connection.alpha * CONNECTION_ALPHA_BANDS) | 0;
    if (band >= CONNECTION_ALPHA_BANDS) band = CONNECTION_ALPHA_BANDS - 1;

    const key = `${a.colorKey}|${b.colorKey}|${band}`;
    let batch = connectionBatches.get(key);
    if (batch === undefined) {
      batch = { keyA: a.colorKey, keyB: b.colorKey, band, points: [], count: 0 };
      connectionBatches.set(key, batch);
    }

    const points = batch.points;
    const n = batch.count;
    points[n] = a.x;
    points[n + 1] = a.y;
    points[n + 2] = b.x;
    points[n + 3] = b.y;
    batch.count = n + 4;
  }

  const gi = config.glowIntensity || 1.0;
  const glowWidth = 4.0 + intensity * 0.8;
  const coreWidth = 1.2 + intensity * 0.25;

  connectionBatches.forEach((batch) => {
    if (batch.count === 0) return;

    const color = midColor(themeColors, batch.keyA, batch.keyB);
    const alpha = (batch.band + 0.5) / CONNECTION_ALPHA_BANDS;
    const points = batch.points;

    ctx.beginPath();
    for (let i = 0; i < batch.count; i += 4) {
      ctx.moveTo(points[i], points[i + 1]);
      ctx.lineTo(points[i + 2], points[i + 3]);
    }

    // Soft outer glow, then the core line — same path, stroked twice.
    ctx.lineWidth = glowWidth;
    ctx.strokeStyle = colorString(color, alpha * 0.22 * gi);
    ctx.stroke();

    ctx.lineWidth = coreWidth;
    ctx.strokeStyle = colorString(color, alpha * 0.95);
    ctx.stroke();
  });

  ctx.lineCap = "butt";
}

function resetBatch(batch) {
  batch.count = 0;
}

function drawParticles(ctx, particles, elapsed, intensity, themeColors) {
  ctx.globalCompositeOperation = "lighter";

  particles.forEach((particle) => {
    // Layered organic pulse: primary + subtle harmonic for living feel
    const pulse = 0.88
      + Math.sin(elapsed * 0.55 + particle.pulseOffset) * 0.10
      + Math.sin(elapsed * 1.3 + particle.pulseOffset * 1.7) * 0.04;
    const alpha = clamp(particle.alpha * pulse * (1 + intensity * 0.22), 0, 0.96);
    const r = particle.radius * (1 + intensity * 0.12);
    const isSpeck = particle.zone === "speck";
    const hr = r * (isSpeck ? 4.0 : 5.4);
    const spriteKey = `${particle.colorKey}_${isSpeck ? "speck" : "standard"}`;
    const sprite = spriteCache.get(spriteKey);

    if (sprite) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(
        sprite,
        particle.x - hr,
        particle.y - hr,
        hr * 2,
        hr * 2
      );
    }

    // Draw HUD elements for Hub Router nodes
    if (particle.isHub && !isSpeck && alpha > 0.35) {
      ctx.save();
      ctx.globalAlpha = alpha * 0.45;
      const color = themeColors[particle.colorKey] || themeColors.accent;
      
      // Subtle rotating dashed ring. The transform has to be applied *before*
      // the arc is traced — path points are baked with the CTM in force when
      // each command runs, so the previous ordering rotated only the pen and
      // the ring never actually turned.
      ctx.translate(particle.x, particle.y);
      ctx.rotate(elapsed * particle.turn * 0.22);
      ctx.strokeStyle = colorString(color, 0.7);
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, r * 3.6, 0, TWO_PI);
      ctx.stroke();

      // The tiny "0x4F" coordinate labels that used to render here were removed:
      // legible text in a background reads as UI, pulls focus from the content
      // in front of it, and cost a font rasterisation per hub per frame.

      ctx.restore();
    }
  });

  ctx.globalAlpha = 1.0;
}

function mountPlexusBackground(canvas, profileName = getProfileName()) {
  if (!canvas || !shouldEnableBackground()) return null;

  const config = PROFILE_CONFIG[profileName] || PROFILE_CONFIG.desktop;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return null;

  const particles = [];
  const ripples = [];
  const pointer = {
    active: false,
    x: POINTER_AWAY,
    y: POINTER_AWAY
  };
  const smoothPointer = {
    active: false,
    x: POINTER_AWAY,
    y: POINTER_AWAY
  };

  let width = 0;
  let height = 0;
  let resizeFrame = 0;
  let animationFrame = 0;
  let lastFrameTime = performance.now();
  let lastScrollY = window.scrollY || 0;
  // Sampled in a passive scroll listener rather than read inside the animation
  // frame: a scrollY read in rAF can force a synchronous layout when another
  // module has dirtied styles earlier in the same frame.
  let currentScrollY = lastScrollY;
  let themeColors = readThemeColors();
  updateSpriteCache(themeColors);
  const facetOpacity = new Map();
  const packets = [];

  const triggerRipple = (rx, ry) => {
    if (profileName === "mobile") return;
    ripples.push({
      x: rx,
      y: ry,
      radius: 4,
      maxRadius: Math.min(width, height) * 0.45,
      speed: 620,
      initialSpeed: 620,
      alpha: 0.85
    });
  };

  window.__triggerBgRipple = triggerRipple;

  let lastCssWidth = 0;
  let lastCssHeight = 0;

  const setSize = () => {
    const nextWidth = window.innerWidth;
    const nextHeight = Math.max(window.innerHeight, 1);

    // Mobile browsers fire `resize` continuously as the URL bar collapses and
    // expands during a scroll. Reassigning canvas.width/height reallocates and
    // clears the backing store, and reconcileParticles reseeds the field — so
    // the old code rebuilt the whole background mid-scroll. Width is what
    // actually changes on rotation, so ignore pure height drift on touch.
    if (
      lastCssWidth === nextWidth &&
      mobileDevice.matches &&
      Math.abs(nextHeight - lastCssHeight) < 140
    ) {
      return;
    }

    lastCssWidth = nextWidth;
    lastCssHeight = nextHeight;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, config.dpr);
    const xScale = width > 0 ? nextWidth / width : 1;
    const yScale = height > 0 ? nextHeight / height : 1;

    width = nextWidth;
    height = nextHeight;

    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    particles.forEach((particle) => {
      particle.x *= xScale;
      particle.y *= yScale;
      particle.homeX *= xScale;
      particle.homeY *= yScale;
    });

    reconcileParticles(particles, width, height, config);
  };

  const handleResize = () => {
    if (resizeFrame) return;

    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      setSize();
    });
  };

  const handleScroll = () => {
    currentScrollY = window.scrollY || 0;
  };

  const handlePointerMove = (event) => {
    pointer.active = true;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  };

  const handlePointerLeave = () => {
    pointer.active = false;
    pointer.x = POINTER_AWAY;
    pointer.y = POINTER_AWAY;
  };

  // The theme MutationObserver fires on every class/style write to <body>, and
  // the customiser writes ~17 CSS variables per preview keystroke. Coalescing to
  // one frame keeps getComputedStyle (and any sprite rebuild) to once per frame.
  let themeSyncFrame = 0;
  const syncThemeColors = () => {
    if (themeSyncFrame) return;
    themeSyncFrame = window.requestAnimationFrame(() => {
      themeSyncFrame = 0;
      themeColors = readThemeColors();
      updateSpriteCache(themeColors);
    });
  };

  const render = (currentTime) => {
    animationFrame = window.requestAnimationFrame(render);

    if (document.hidden) {
      lastFrameTime = currentTime;
      return;
    }

    const delta = Math.min((currentTime - lastFrameTime) * 0.001, 0.05);
    const elapsed = currentTime * 0.001;
    lastFrameTime = currentTime;
    surgeIntensity += (0 - surgeIntensity) * 0.018;

    // Smooth pointer lerp for graceful mouse interaction
    if (pointer.active) {
      if (smoothPointer.x < -1000) {
        smoothPointer.x = pointer.x;
        smoothPointer.y = pointer.y;
      } else {
        smoothPointer.x = lerp(smoothPointer.x, pointer.x, 0.12);
        smoothPointer.y = lerp(smoothPointer.y, pointer.y, 0.12);
      }
      smoothPointer.active = true;
    } else {
      smoothPointer.active = false;
      smoothPointer.x = POINTER_AWAY;
      smoothPointer.y = POINTER_AWAY;
    }

    const scrollDelta = currentScrollY - lastScrollY;
    lastScrollY = currentScrollY;

    if (Math.abs(scrollDelta) > 0.5) {
      // Softened from 0.35/±35: the field used to lurch against the content
      // during a flick scroll, which read as jank and pulled the eye away from
      // what the visitor was actually scrolling to.
      const scrollImpulse = clamp(scrollDelta * 0.16, -14, 14);
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        if (p.zone !== "speck") {
          p.vy -= scrollImpulse * delta * 0.6;
        }
      }
    }

    drawBackground(ctx, width, height);

    particles.forEach((particle) => {
      updateParticle(particle, delta, elapsed, width, height, smoothPointer, config, surgeIntensity);
    });

    const connections = selectConnections(particles, config, width, height, surgeIntensity);
    drawGlassFacets(ctx, particles, connections, config, width, height, surgeIntensity, themeColors, facetOpacity, delta);
    drawConnections(ctx, particles, config, width, height, surgeIntensity, themeColors, connections);

    // Render expanding shockwave energy ripples with fluid deceleration
    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      const rip = ripples[i];
      const progress = clamp(rip.radius / rip.maxRadius, 0, 1);

      // Decelerating expansion: fast burst at origin, gentle glide at perimeter
      const currentSpeed = Math.max(140, rip.initialSpeed * Math.pow(1 - progress, 0.7));
      rip.radius += currentSpeed * delta;

      // Smooth power-curve alpha fade
      rip.alpha = Math.pow(1 - progress, 1.4) * 0.85;

      if (rip.radius >= rip.maxRadius || rip.alpha <= 0.01) {
        ripples.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      // Outer primary shockwave ring
      const outerWidth = Math.max(1.0, 3.4 * Math.pow(1 - progress, 0.8));
      ctx.lineWidth = outerWidth;
      ctx.strokeStyle = colorString(themeColors.accent, rip.alpha * 0.6);
      ctx.beginPath();
      ctx.arc(rip.x, rip.y, rip.radius, 0, TWO_PI);
      ctx.stroke();

      // Inner secondary harmonic ring
      if (rip.radius > 12) {
        ctx.lineWidth = Math.max(0.8, 1.8 * Math.pow(1 - progress, 0.8));
        ctx.strokeStyle = colorString(themeColors.data, rip.alpha * 0.38);
        ctx.beginPath();
        ctx.arc(rip.x, rip.y, rip.radius * 0.78, 0, TWO_PI);
        ctx.stroke();
      }
      ctx.restore();

      // Ripple wave front collision: excite particles & dispatch stream packets.
      // Compared in squared space (no Math.hypot per particle per ripple), and
      // the outgoing edge comes from the index built in selectConnections
      // instead of a linear `connections.find()` inside this loop.
      const bandInner = Math.max(0, rip.radius - 28);
      const bandOuter = rip.radius + 28;
      const bandInnerSq = bandInner * bandInner;
      const bandOuterSq = bandOuter * bandOuter;

      for (let idx = 0; idx < particles.length; idx += 1) {
        const p = particles[idx];
        const dx = p.x - rip.x;
        const dy = p.y - rip.y;
        const dSq = dx * dx + dy * dy;
        if (dSq > bandInnerSq && dSq < bandOuterSq) {
          p.pulseOffset += 0.15;
          if (Math.random() < 0.22 && connections.length > 0) {
            const slot = firstConnectionOf[idx];
            const conn = slot >= 0 ? connections[slot] : null;
            if (conn && packets.length < 30) {
              packets.push({
                from: conn.from,
                to: conn.to,
                progress: 0,
                speed: randomBetween([1.6, 3.4]),
                colorKey: p.colorKey,
                size: lerp(1.6, 2.8, Math.random())
              });
            }
          }
        }
      }
    }

    // Draw pointer-to-plexus links (Cursor Connection Hub)
    if (smoothPointer.active && profileName !== "mobile") {
      // Previously allocated an object per nearby particle and sorted the lot
      // every frame just to take the top 4. This keeps 4 slots and inserts.
      const reach = config.repelRadius * 1.4;
      const reachSq = reach * reach;
      hubCount = 0;

      for (let idx = 0; idx < particles.length; idx += 1) {
        const p = particles[idx];
        if (p.zone === "speck") continue;
        const dx = p.x - smoothPointer.x;
        const dy = p.y - smoothPointer.y;
        const dSq = dx * dx + dy * dy;
        if (dSq >= reachSq) continue;

        // Insertion sort into a fixed 4-entry buffer.
        let slot = hubCount < HUB_LINKS ? hubCount : HUB_LINKS - 1;
        if (hubCount === HUB_LINKS && dSq >= hubDistSq[HUB_LINKS - 1]) continue;
        while (slot > 0 && hubDistSq[slot - 1] > dSq) {
          hubDistSq[slot] = hubDistSq[slot - 1];
          hubIndex[slot] = hubIndex[slot - 1];
          slot -= 1;
        }
        hubDistSq[slot] = dSq;
        hubIndex[slot] = idx;
        if (hubCount < HUB_LINKS) hubCount += 1;
      }

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let h = 0; h < hubCount; h += 1) {
        const p = particles[hubIndex[h]];
        const proximity = 1 - Math.sqrt(hubDistSq[h]) / reach;
        const alpha = proximity * 0.65 * (1 + surgeIntensity * 0.3);
        const color = themeColors[p.colorKey] || themeColors.accent;

        ctx.lineWidth = 3.5;
        ctx.strokeStyle = colorString(color, alpha * 0.18);
        ctx.beginPath();
        ctx.moveTo(smoothPointer.x, smoothPointer.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();

        ctx.lineWidth = 1.0;
        ctx.strokeStyle = colorString(color, alpha * 0.85);
        ctx.beginPath();
        ctx.moveTo(smoothPointer.x, smoothPointer.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Spawn and draw packets along connection lines (Dynamic Data Packets)
    if (connections.length > 0 && Math.random() < 0.045 + surgeIntensity * 0.08) {
      const maxPackets = profileName === "mobile" ? 10 : 25;
      if (packets.length < maxPackets) {
        const conn = connections[Math.floor(Math.random() * connections.length)];
        const fromNode = particles[conn.from];
        const toNode = particles[conn.to];
        if (fromNode && toNode && fromNode.zone !== "speck" && toNode.zone !== "speck") {
          packets.push({
            from: conn.from,
            to: conn.to,
            progress: 0,
            speed: randomBetween([0.8, 1.8]) * (1 + surgeIntensity * 0.4),
            colorKey: fromNode.colorKey,
            size: lerp(1.2, 2.5, Math.random())
          });
        }
      }
    }

    for (let i = packets.length - 1; i >= 0; i -= 1) {
      const packet = packets[i];
      packet.progress += packet.speed * delta;
      
      const a = particles[packet.from];
      const b = particles[packet.to];
      
      if (packet.progress >= 1 || !a || !b) {
        packets.splice(i, 1);
        continue;
      }

      const px = lerp(a.x, b.x, packet.progress);
      const py = lerp(a.y, b.y, packet.progress);
      const color = themeColors[packet.colorKey] || themeColors.accent;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      
      const trailLen = 0.15;
      const trailProgress = Math.max(0, packet.progress - trailLen);
      const tx = lerp(a.x, b.x, trailProgress);
      const ty = lerp(a.y, b.y, trailProgress);
      
      const grad = ctx.createLinearGradient(tx, ty, px, py);
      grad.addColorStop(0, colorString(color, 0));
      grad.addColorStop(1, colorString(color, 0.85));
      
      ctx.strokeStyle = grad;
      ctx.lineWidth = packet.size * 1.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(px, py);
      ctx.stroke();

      ctx.fillStyle = colorString(themeColors.node, 0.9);
      ctx.beginPath();
      ctx.arc(px, py, packet.size, 0, TWO_PI);
      ctx.fill();
      
      ctx.restore();
    }

    drawParticles(ctx, particles, elapsed, surgeIntensity, themeColors);
  };

  setSize();
  window.addEventListener("resize", handleResize, { passive: true });
  window.addEventListener("scroll", handleScroll, { passive: true });

  const themeObserver = new MutationObserver(syncThemeColors);
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });

  const handlePointerDown = (event) => {
    surgeIntensity = Math.min(surgeIntensity + 0.45, 1.25);
    if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      triggerRipple(event.clientX, event.clientY);
    }
  };

  if (supportsHover.matches && profileName !== "mobile") {
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.body.addEventListener("pointerleave", handlePointerLeave, { passive: true });
    window.addEventListener("pointerdown", handlePointerDown, { passive: true });
  }

  animationFrame = window.requestAnimationFrame(render);

  return () => {
    window.cancelAnimationFrame(animationFrame);
    if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    if (themeSyncFrame) window.cancelAnimationFrame(themeSyncFrame);
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("scroll", handleScroll);
    window.removeEventListener("pointermove", handlePointerMove);
    document.body.removeEventListener("pointerleave", handlePointerLeave);
    window.removeEventListener("pointerdown", handlePointerDown);
    if (window.__triggerBgRipple === triggerRipple) {
      delete window.__triggerBgRipple;
    }
    themeObserver.disconnect();
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
    destroyBackground = mountPlexusBackground(canvas, nextProfile);
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
