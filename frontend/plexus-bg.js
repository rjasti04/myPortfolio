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
const INTERACTIVE_SELECTOR =
  'a, button, input, textarea, select, label, summary, ' +
  '[role="button"], [role="link"], [role="tab"], [contenteditable="true"]';

// Fraction of the width over which the two hero colours hand over. Outside
// this band the halves stay pure; inside, membership is dithered per particle
// so the two fields interleave instead of meeting at a seam.
const COLOR_BLEND_START = 0.25;
const COLOR_BLEND_END = 0.75;
const SPECK_CHANCE = 0.06;
const SPECK_COLOR_KEY = "data";

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
    maxDistance: 195,
    maxLinks: 5,
    radius: [1.3, 3.2],
    speed: [2.4, 6.8],
    dpr: 1.75,
    lineAlpha: 0.58,
    pointerRadius: 155,
    pointerStrength: 220,
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
    maxDistance: 165,
    maxLinks: 4,
    radius: [1.1, 2.5],
    speed: [2.1, 5.8],
    dpr: 1.5,
    lineAlpha: 0.50,
    pointerRadius: 135,
    pointerStrength: 200,
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
    maxDistance: 120,
    maxLinks: 3,
    radius: [1.0, 2.2],
    speed: [1.6, 4.8],
    dpr: 1.3,
    lineAlpha: 0.42,
    pointerRadius: 0,
    pointerStrength: 0,
    glowIntensity: 0.9,
    connectionFalloff: 1.4,
    glassFacetCount: 8,
    glassFacetAlpha: 0.10,
    glassFacetAreaFactor: 0.26,
    enableShadows: false
  }
};

window.triggerBgSurge = (x, y) => {
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

// The smoothing constants below were authored against a 60fps frame. Applied
// per frame they make the whole simulation behave differently on a 144Hz panel
// than on a 60Hz one. These two helpers re-express them per second, so motion
// is identical on every refresh rate.
function frameDamp(retainPerFrame, delta) {
  return Math.pow(retainPerFrame, delta * 60);
}

function frameLerp(current, target, ratePerFrame, delta) {
  return lerp(current, target, 1 - Math.pow(1 - ratePerFrame, delta * 60));
}

function colorString(color, alpha) {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
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
  const total = colors.reduce(
    (sum, color) => [
      sum[0] + color[0],
      sum[1] + color[1],
      sum[2] + color[2]
    ],
    [0, 0, 0]
  );

  return total.map((channel) => Math.round(channel / colors.length));
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

  // Classify by the background's own luminance rather than the theme class:
  // the customiser can write an arbitrary palette, and what matters here is
  // whether additive light will read against it.
  const background = parseCssColor(readVar("--bg"), [10, 14, 20]);
  const isDark =
    background[0] * 0.299 + background[1] * 0.587 + background[2] * 0.114 < 140;

  // Light mode needs contrast against white without losing the hue separation
  // that makes the left-to-right gradient legible. The -text variants are dark
  // enough but sit at 22-30% lightness, where amber and olive turn into nearly
  // the same brown, so meet the -fill hue halfway instead of replacing it.
  const pick = (fillVar, textVar, fallback) => {
    const fill = parseCssColor(readVar(fillVar), fallback);
    if (isDark) return fill;
    return blendColors(fill, parseCssColor(readVar(textVar), fill), 0.5);
  };

  return {
    isDark,
    // Additive blending only ever brightens. That reads as glow on a dark
    // page and as nothing on a light one, so light mode paints normally.
    blend: isDark ? "lighter" : "source-over",
    // Source-over at the additive alphas would be heavier than the glow it
    // replaces, so light mode is scaled back to roughly match its weight.
    alphaScale: isDark ? 1 : 0.85,
    accent: pick("--accent-fill", "--accent-text", COLOR_FALLBACKS.accent),
    secondary: pick("--secondary-fill", "--secondary-text", COLOR_FALLBACKS.secondary),
    data: pick("--data-fill", "--data-text", COLOR_FALLBACKS.data),
    // The bright core of a node sprite has to become dark ink on a light page,
    // or it multiplies away to nothing.
    node: isDark
      ? COLOR_FALLBACKS.node
      : parseCssColor(readVar("--text"), [15, 23, 42])
  };
}

// Indexed by colorRank * 2 + speck, so the draw loop does an array read
// instead of building a `${key}_${profile}` string per particle per frame.
const spriteSlots = [];

function spriteSlot(colorKey, isSpeck) {
  return colorRank(colorKey) * 2 + (isSpeck ? 1 : 0);
}

function updateSpriteCache(themeColors) {
  spriteSlots.length = 0;
  const keys = ["accent", "secondary", "data"];
  const baseRadius = 32;
  const size = baseRadius * 2;
  const scale = themeColors.alphaScale || 1;

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
      grad.addColorStop(0, colorString(themeColors.node, 0.48 * scale));
      grad.addColorStop(coreRatio * 0.55, colorString(color, 0.41 * scale));
      grad.addColorStop(coreRatio, colorString(color, 0.28 * scale));
      grad.addColorStop(Math.min(coreRatio * 2.2, 0.48), colorString(color, 0.16 * scale));
      grad.addColorStop(Math.min(coreRatio * 4.0, 0.72), colorString(color, 0.06 * scale));
      grad.addColorStop(1, colorString(color, 0));
      
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(baseRadius, baseRadius, baseRadius, 0, TWO_PI);
      ctx.fill();
      
      spriteSlots[spriteSlot(colorKey, isSpeck)] = canvas;
    });
  });
}

function getProfileName() {
  if (mobileDevice.matches || window.innerWidth <= 640) return "mobile";
  if (compactViewportQuery.matches || window.innerHeight < 720) return "compact";
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

function colorKeyForX(x, width) {
  const t = clamp(
    (x / width - COLOR_BLEND_START) / (COLOR_BLEND_END - COLOR_BLEND_START),
    0,
    1
  );
  return Math.random() < t ? "accent" : "secondary";
}

function createParticle(width, height, config) {
  const isSpeck = Math.random() < SPECK_CHANCE;
  const verticalPadding = height * 0.05;
  const x = Math.random() * width;
  const y = lerp(-verticalPadding, height + verticalPadding, Math.random());
  const angle = Math.random() * TWO_PI;
  const speed = randomBetween(config.speed) * (isSpeck ? 0.3 : 1);

  return {
    zone: isSpeck ? "speck" : "node",
    colorKey: isSpeck ? SPECK_COLOR_KEY : colorKeyForX(x, width),
    x,
    y,
    baseSpeed: speed,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: randomBetween(config.radius) * (isSpeck ? 0.65 : 1),
    alpha: isSpeck ? lerp(0.16, 0.38, Math.random()) : lerp(0.52, 0.92, Math.random()),
    phase: Math.random() * TWO_PI,
    pulseOffset: Math.random() * TWO_PI
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
  particle.vy = frameLerp(particle.vy, floatUpSpeed, 0.03, delta);
  particle.vx = frameLerp(particle.vx, horizontalSway, 0.02, delta);

  // Pointer field. The cursor draws links to nearby nodes, so shoving those
  // same nodes away fought its own metaphor. Instead the field orbits the
  // cursor with a slight inward pull, and the mesh visibly gathers.
  const pointerRadius = config.pointerRadius || 0;
  if (pointer.active && pointerRadius > 0) {
    const dx = particle.x - pointer.x;
    const dy = particle.y - pointer.y;
    const distanceSquared = dx * dx + dy * dy;

    if (distanceSquared < pointerRadius * pointerRadius && distanceSquared > 1) {
      const distance = Math.sqrt(distanceSquared);
      const falloff = Math.pow(1 - distance / pointerRadius, 1.8);
      const strength = (config.pointerStrength || 0) * falloff * delta;
      const nx = dx / distance;
      const ny = dy / distance;

      // Tangential swirl around the cursor.
      particle.vx += -ny * strength;
      particle.vy += nx * strength;

      // Gentle inward drift so the field collects rather than scatters.
      particle.vx -= nx * strength * 0.25;
      particle.vy -= ny * strength * 0.25;
    }
  }

  // Smooth inertia damping for graceful ease-back when mouse leaves or stops
  const damping = frameDamp(0.95, delta);
  particle.vx *= damping;
  particle.vy *= damping;

  // Position displacement update
  particle.x += particle.vx * delta * 60;
  particle.y += particle.vy * delta * 60;

  // Boundary logic: Anti-gravity continuous upward wrapping
  const margin = config.maxDistance * 0.5;
  if (particle.y < -margin) {
    particle.y = height + margin;
    particle.x = Math.random() * width;
    if (particle.zone !== "speck") {
      particle.colorKey = colorKeyForX(particle.x, width);
    }
  } else if (particle.y > height + margin) {
    particle.y = -margin;
  }

  if (particle.x < -margin) {
    particle.x = width + margin;
  } else if (particle.x > width + margin) {
    particle.x = -margin;
  }
}

// ---------------------------------------------------------------------------
// Link graph
//
// Everything from here to drawConnections runs on every frame, so once it is
// warm none of it allocates. The previous version built a Map-of-Arrays grid
// keyed by "cx,cy" template strings, pushed an object per candidate pair,
// sorted that array of objects, then cloned every survivor with a spread. At
// ~180 particles that was several thousand short-lived objects and strings per
// frame, and the resulting GC sawtooth was the main source of dropped frames.
// The structures below are preallocated, grow at most a couple of times, and
// are then reused for the life of the mount.
// ---------------------------------------------------------------------------

// Half of the 3x3 neighbourhood. Combined with "j > i" inside the home cell
// this visits every pair exactly once, rather than visiting all nine cells and
// discarding half the results.
const NEIGHBOR_OFFSETS = [0, 0, 1, 0, -1, 1, 0, 1, 1, 1];

const FACET_CAPACITY = 512;

function connectionDistanceFor(a, b, config) {
  // Specks are decorative dust and link only to what is very close; every
  // other node links on the same footing, so no seam forms mid-screen.
  if (a.zone === "speck" || b.zone === "speck") return config.maxDistance * 0.5;
  return config.maxDistance;
}

function createGraph() {
  return {
    cols: 0,
    rows: 0,
    cellSize: 1,
    originX: 0,
    originY: 0,
    cellStart: new Int32Array(0),
    cellCursor: new Int32Array(0),
    cellItems: new Int32Array(0),

    candidateCapacity: 0,
    candidateCount: 0,
    candFrom: new Int32Array(0),
    candTo: new Int32Array(0),
    candDistance: new Float32Array(0),
    candMaxDistance: new Float32Array(0),
    order: [],

    linkCapacity: 0,
    linkCount: 0,
    linkFrom: new Int32Array(0),
    linkTo: new Int32Array(0),
    linkAlpha: new Float32Array(0),
    linkProximity: new Float32Array(0),
    linkCounts: new Uint8Array(0),

    adjStart: new Int32Array(0),
    adjCursor: new Int32Array(0),
    adjNode: new Int32Array(0),
    adjProximity: new Float32Array(0)
  };
}

function growCandidates(graph, needed) {
  let capacity = Math.max(graph.candidateCapacity, 256);
  while (capacity < needed) capacity *= 2;

  const from = new Int32Array(capacity);
  const to = new Int32Array(capacity);
  const distance = new Float32Array(capacity);
  const maxDistance = new Float32Array(capacity);

  if (graph.candidateCount > 0) {
    from.set(graph.candFrom.subarray(0, graph.candidateCount));
    to.set(graph.candTo.subarray(0, graph.candidateCount));
    distance.set(graph.candDistance.subarray(0, graph.candidateCount));
    maxDistance.set(graph.candMaxDistance.subarray(0, graph.candidateCount));
  }

  graph.candidateCapacity = capacity;
  graph.candFrom = from;
  graph.candTo = to;
  graph.candDistance = distance;
  graph.candMaxDistance = maxDistance;
}

function ensureGraphCapacity(graph, particleCount, config) {
  if (graph.candidateCapacity === 0) {
    growCandidates(graph, Math.max(particleCount * 16, 256));
  }

  // A node keeps at most maxLinks edges, so the surviving set is bounded well
  // below the candidate set and never needs to grow with it.
  const linkCapacity = Math.max(particleCount * (config.maxLinks + 1), 64);
  if (graph.linkCapacity < linkCapacity) {
    graph.linkCapacity = linkCapacity;
    graph.linkFrom = new Int32Array(linkCapacity);
    graph.linkTo = new Int32Array(linkCapacity);
    graph.linkAlpha = new Float32Array(linkCapacity);
    graph.linkProximity = new Float32Array(linkCapacity);
    graph.adjNode = new Int32Array(linkCapacity * 2);
    graph.adjProximity = new Float32Array(linkCapacity * 2);
  }

  if (graph.linkCounts.length < particleCount) {
    graph.linkCounts = new Uint8Array(particleCount);
  }
  if (graph.adjStart.length < particleCount + 1) {
    graph.adjStart = new Int32Array(particleCount + 1);
    graph.adjCursor = new Int32Array(particleCount + 1);
  }
}

function cellIndexFor(graph, particle) {
  const cx = clamp(
    Math.floor((particle.x - graph.originX) / graph.cellSize),
    0,
    graph.cols - 1
  );
  const cy = clamp(
    Math.floor((particle.y - graph.originY) / graph.cellSize),
    0,
    graph.rows - 1
  );
  return cy * graph.cols + cx;
}

function buildGrid(graph, particles, config, width, height) {
  const cellSize = Math.max(config.maxDistance, 1);
  const margin = config.maxDistance;
  const cols = Math.max(1, Math.ceil((width + margin * 2) / cellSize));
  const rows = Math.max(1, Math.ceil((height + margin * 2) / cellSize));
  const cellTotal = cols * rows;
  const count = particles.length;

  graph.cols = cols;
  graph.rows = rows;
  graph.cellSize = cellSize;
  graph.originX = -margin;
  graph.originY = -margin;

  if (graph.cellStart.length < cellTotal + 1) {
    graph.cellStart = new Int32Array(cellTotal + 1);
    graph.cellCursor = new Int32Array(cellTotal + 1);
  } else {
    graph.cellStart.fill(0, 0, cellTotal + 1);
  }
  if (graph.cellItems.length < count) {
    graph.cellItems = new Int32Array(count);
  }

  const cellStart = graph.cellStart;
  const cellCursor = graph.cellCursor;
  const cellItems = graph.cellItems;

  // Counting sort: tally, prefix-sum, then scatter into one flat index array.
  for (let i = 0; i < count; i += 1) {
    cellStart[cellIndexFor(graph, particles[i]) + 1] += 1;
  }
  for (let c = 0; c < cellTotal; c += 1) {
    cellStart[c + 1] += cellStart[c];
    cellCursor[c] = cellStart[c];
  }
  for (let i = 0; i < count; i += 1) {
    const c = cellIndexFor(graph, particles[i]);
    cellItems[cellCursor[c]] = i;
    cellCursor[c] += 1;
  }
}

function collectCandidates(graph, particles, config) {
  graph.candidateCount = 0;

  const cols = graph.cols;
  const rows = graph.rows;
  const cellStart = graph.cellStart;
  const cellItems = graph.cellItems;

  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      const home = cy * cols + cx;
      const homeStart = cellStart[home];
      const homeEnd = cellStart[home + 1];
      if (homeStart === homeEnd) continue;

      for (let n = 0; n < NEIGHBOR_OFFSETS.length; n += 2) {
        const nx = cx + NEIGHBOR_OFFSETS[n];
        const ny = cy + NEIGHBOR_OFFSETS[n + 1];
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;

        const other = ny * cols + nx;
        const sameCell = other === home;
        const otherStart = cellStart[other];
        const otherEnd = cellStart[other + 1];

        for (let ii = homeStart; ii < homeEnd; ii += 1) {
          const i = cellItems[ii];
          const a = particles[i];

          for (let jj = sameCell ? ii + 1 : otherStart; jj < otherEnd; jj += 1) {
            const j = cellItems[jj];
            const b = particles[j];
            const maxDist = connectionDistanceFor(a, b, config);
            const ex = a.x - b.x;
            const ey = a.y - b.y;
            const d2 = ex * ex + ey * ey;
            if (d2 > maxDist * maxDist) continue;

            const index = graph.candidateCount;
            if (index >= graph.candidateCapacity) {
              growCandidates(graph, index + 1);
            }
            graph.candFrom[index] = i;
            graph.candTo[index] = j;
            graph.candDistance[index] = Math.sqrt(d2);
            graph.candMaxDistance[index] = maxDist;
            graph.candidateCount = index + 1;
          }
        }
      }
    }
  }
}

// Module-scoped so the comparator is not a fresh closure on every frame.
let sortDistances = null;

function byCandidateDistance(x, y) {
  return sortDistances[x] - sortDistances[y];
}

function selectLinks(graph, particles, config, intensity) {
  const count = graph.candidateCount;
  const order = graph.order;
  order.length = count;
  for (let i = 0; i < count; i += 1) order[i] = i;

  // Closest pairs claim their link budget first, so each node keeps its
  // nearest neighbours rather than whichever pair happened to be found first.
  sortDistances = graph.candDistance;
  order.sort(byCandidateDistance);

  const linkCounts = graph.linkCounts;
  linkCounts.fill(0, 0, particles.length);

  const falloff = config.connectionFalloff || 1.4;
  const budget = config.maxLinks;
  const capacity = graph.linkCapacity;
  let linkCount = 0;

  for (let k = 0; k < count; k += 1) {
    if (linkCount >= capacity) break;

    const c = order[k];
    const from = graph.candFrom[c];
    const to = graph.candTo[c];
    const a = particles[from];
    const b = particles[to];
    const maxLinks = a.zone === "speck" || b.zone === "speck" ? 1 : budget;

    if (linkCounts[from] >= maxLinks || linkCounts[to] >= maxLinks) continue;

    const proximity = 1 - graph.candDistance[c] / graph.candMaxDistance[c];
    graph.linkFrom[linkCount] = from;
    graph.linkTo[linkCount] = to;
    graph.linkProximity[linkCount] = proximity;
    graph.linkAlpha[linkCount] = clamp(
      Math.pow(proximity, falloff) * config.lineAlpha * (1 + intensity * 0.45),
      0,
      0.78
    );

    linkCount += 1;
    linkCounts[from] += 1;
    linkCounts[to] += 1;
  }

  graph.linkCount = linkCount;
}

// Compressed adjacency over the surviving links. Facet detection and the
// ripple packet dispatch both need "who is this node linked to", which
// previously meant a Map of arrays plus a linear scan of every connection.
function buildAdjacency(graph, particles) {
  const count = particles.length;
  const linkCount = graph.linkCount;
  const adjStart = graph.adjStart;
  const adjCursor = graph.adjCursor;

  adjStart.fill(0, 0, count + 1);
  for (let k = 0; k < linkCount; k += 1) {
    adjStart[graph.linkFrom[k] + 1] += 1;
    adjStart[graph.linkTo[k] + 1] += 1;
  }
  for (let i = 0; i < count; i += 1) {
    adjStart[i + 1] += adjStart[i];
    adjCursor[i] = adjStart[i];
  }

  const adjNode = graph.adjNode;
  const adjProximity = graph.adjProximity;
  for (let k = 0; k < linkCount; k += 1) {
    const from = graph.linkFrom[k];
    const to = graph.linkTo[k];
    const proximity = graph.linkProximity[k];

    adjNode[adjCursor[from]] = to;
    adjProximity[adjCursor[from]] = proximity;
    adjCursor[from] += 1;

    adjNode[adjCursor[to]] = from;
    adjProximity[adjCursor[to]] = proximity;
    adjCursor[to] += 1;
  }
}

// Degree is capped at maxLinks (<= 5), so a linear scan beats any index.
function edgeProximity(graph, u, v) {
  for (let k = graph.adjStart[u]; k < graph.adjStart[u + 1]; k += 1) {
    if (graph.adjNode[k] === v) return graph.adjProximity[k];
  }
  return -1;
}

function buildLinkGraph(graph, particles, config, intensity, width, height) {
  ensureGraphCapacity(graph, particles.length, config);
  buildGrid(graph, particles, config, width, height);
  collectCandidates(graph, particles, config);
  selectLinks(graph, particles, config, intensity);
  buildAdjacency(graph, particles);
}

// ---------------------------------------------------------------------------
// Palette
//
// Colours depend only on the theme and on which of the three hero keys a node
// carries, so every colour a frame can need is a member of a small fixed set.
// Build that set once per theme change and memoise the rgba strings, instead
// of blending and re-serialising per connection and per facet per frame.
// ---------------------------------------------------------------------------

const MID_SLOT_BASE = 4;
const GLASS_SLOT_BASE = 13;
const HIGHLIGHT_SLOT_BASE = 40;
const ALPHA_STEPS = 128;

const COLOR_SLOT = { accent: 0, secondary: 1, data: 2, node: 3 };

const paletteColors = [];
let paletteStrings = [];
// Set from the theme so every draw site picks up the mode without threading
// themeColors through each one.
let paletteBlend = "lighter";
let paletteAlphaScale = 1;

function colorRank(key) {
  if (key === "accent") return 0;
  if (key === "secondary") return 1;
  return 2;
}

function midSlot(keyA, keyB) {
  const i = colorRank(keyA);
  const j = colorRank(keyB);
  return MID_SLOT_BASE + (i <= j ? i * 3 + j : j * 3 + i);
}

function tripleOffset(i, j, k) {
  let a = i;
  let b = j;
  let c = k;
  let t;
  if (a > b) { t = a; a = b; b = t; }
  if (b > c) { t = b; b = c; c = t; }
  if (a > b) { t = a; a = b; b = t; }
  return (a * 3 + b) * 3 + c;
}

function buildPalette(themeColors) {
  const base = [
    themeColors.accent,
    themeColors.secondary,
    themeColors.data,
    themeColors.node
  ];

  for (let i = 0; i < 4; i += 1) paletteColors[i] = base[i];

  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      paletteColors[MID_SLOT_BASE + i * 3 + j] = averageColors([base[i], base[j]]);
    }
  }

  const cyanGlass = blendColors(themeColors.accent, themeColors.data, 0.22);
  for (let i = 0; i < 3; i += 1) {
    for (let j = i; j < 3; j += 1) {
      for (let k = j; k < 3; k += 1) {
        const glass = blendColors(
          averageColors([base[i], base[j], base[k]]),
          cyanGlass,
          0.72
        );
        const offset = (i * 3 + j) * 3 + k;
        paletteColors[GLASS_SLOT_BASE + offset] = glass;
        paletteColors[HIGHLIGHT_SLOT_BASE + offset] = blendColors(
          glass,
          themeColors.node,
          0.56
        );
      }
    }
  }

  paletteBlend = themeColors.blend || "lighter";
  paletteAlphaScale = themeColors.alphaScale || 1;
  paletteStrings = [];
}

// Alpha is quantised to 1/128, which is well below what is visible on these
// translucent strokes and makes the memo key an integer.
function paletteString(slot, alpha) {
  const scaled = alpha * paletteAlphaScale;
  const step = scaled <= 0
    ? 0
    : scaled >= 1
      ? ALPHA_STEPS
      : Math.round(scaled * ALPHA_STEPS);
  const key = slot * (ALPHA_STEPS + 1) + step;
  let value = paletteStrings[key];

  if (value === undefined) {
    const color = paletteColors[slot] || COLOR_FALLBACKS.accent;
    value = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${step / ALPHA_STEPS})`;
    paletteStrings[key] = value;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Glass facets
// ---------------------------------------------------------------------------

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

// Written into a reusable record rather than returned as a fresh array pair.
const longestEdge = { ax: 0, ay: 0, bx: 0, by: 0 };

function findLongestEdge(a, b, c) {
  const ab = distanceSquared(a, b);
  const bc = distanceSquared(b, c);
  const ca = distanceSquared(c, a);

  let p = a;
  let q = b;
  let best = ab;
  if (bc > best) { p = b; q = c; best = bc; }
  if (ca > best) { p = c; q = a; }

  longestEdge.ax = p.x;
  longestEdge.ay = p.y;
  longestEdge.bx = q.x;
  longestEdge.by = q.y;
}

function createFacetStore(capacity) {
  return {
    capacity,
    count: 0,
    p0: new Int32Array(capacity),
    p1: new Int32Array(capacity),
    p2: new Int32Array(capacity),
    strength: new Float32Array(capacity),
    score: new Float32Array(capacity),
    order: []
  };
}

let sortScores = null;

function byFacetScore(x, y) {
  return sortScores[y] - sortScores[x];
}

// Vertex indices are packed into one number so the fade map can be keyed by an
// integer instead of a "a:b:c" string rebuilt for every facet every frame.
function facetKey(p0, p1, p2) {
  return p0 * 1048576 + p1 * 1024 + p2;
}

function collectFacets(graph, facets, particles, config) {
  facets.count = 0;

  const maxFacets = config.glassFacetCount || 0;
  if (maxFacets <= 0 || graph.linkCount < 3) {
    // The draw pass walks `order`, so it has to be emptied here too. Adaptive
    // quality sets glassFacetCount to 0, which takes this path every frame.
    facets.order.length = 0;
    return;
  }

  const minArea = config.glassFacetMinArea || 280;
  const maxArea =
    config.maxDistance * config.maxDistance * (config.glassFacetAreaFactor || 0.3);
  const count = particles.length;

  for (let u = 0; u < count; u += 1) {
    const a = particles[u];
    if (a.zone === "speck") continue;

    const start = graph.adjStart[u];
    const end = graph.adjStart[u + 1];

    for (let p = start; p < end - 1; p += 1) {
      const v = graph.adjNode[p];
      // Each triangle is emitted once, by its lowest-indexed vertex.
      if (v <= u) continue;
      const b = particles[v];
      if (b.zone === "speck") continue;

      for (let q = p + 1; q < end; q += 1) {
        const w = graph.adjNode[q];
        if (w <= u) continue;
        const c = particles[w];
        if (c.zone === "speck") continue;

        const closing = edgeProximity(graph, v, w);
        if (closing < 0) continue;

        const area = triangleArea(a, b, c);
        if (area < minArea || area > maxArea) continue;
        if (facets.count >= facets.capacity) continue;

        const index = facets.count;
        const strength = (graph.adjProximity[p] + graph.adjProximity[q] + closing) / 3;
        facets.p0[index] = u;
        facets.p1[index] = v < w ? v : w;
        facets.p2[index] = v < w ? w : v;
        facets.strength[index] = strength;
        facets.score[index] = strength * Math.sqrt(area);
        facets.count = index + 1;
      }
    }
  }

  const order = facets.order;
  order.length = facets.count;
  for (let i = 0; i < facets.count; i += 1) order[i] = i;
  sortScores = facets.score;
  order.sort(byFacetScore);
  if (facets.count > maxFacets) order.length = maxFacets;
}

function traceTriangle(ctx, a, b, c) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.closePath();
}

function drawGlassFacets(
  ctx,
  particles,
  facets,
  config,
  intensity,
  facetOpacity,
  facetStrength,
  delta
) {
  const fadeIn = 2.2 * delta;
  const fadeOut = 1.4 * delta;
  const order = facets.order;

  for (let i = 0; i < order.length; i += 1) {
    const index = order[i];
    const key = facetKey(facets.p0[index], facets.p1[index], facets.p2[index]);
    const previous = facetOpacity.get(key) || 0;
    facetOpacity.set(key, Math.min(previous + fadeIn, 1));
    facetStrength.set(key, facets.strength[index]);
  }

  if (facetOpacity.size === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = paletteBlend;

  const baseFacetAlpha = config.glassFacetAlpha || 0.14;
  const outlineWidth = 0.85 + intensity * 0.25;
  const edgeWidth = 1.35 + intensity * 0.25;

  for (const [key, opacity] of facetOpacity) {
    // A facet that is no longer detected keeps its last known geometry and
    // fades out. Previously it was dropped on the frame it disappeared, so the
    // fade-out never actually rendered and facets popped off.
    const p2 = key % 1024;
    const p1 = Math.floor(key / 1024) % 1024;
    const p0 = Math.floor(key / 1048576);

    const a = particles[p0];
    const b = particles[p1];
    const c = particles[p2];

    let next = opacity;
    if (!facetStrength.has(key) || !a || !b || !c) {
      next = opacity - fadeOut;
    }
    if (next <= 0.01) {
      facetOpacity.delete(key);
      facetStrength.delete(key);
      continue;
    }
    facetOpacity.set(key, next);

    if (!a || !b || !c) continue;

    const strength = facetStrength.get(key) || 0;
    const alpha = clamp(
      baseFacetAlpha * (0.65 + strength * 0.9) * (1 + intensity * 0.35),
      0,
      0.32
    ) * next;

    const offset = tripleOffset(
      colorRank(a.colorKey),
      colorRank(b.colorKey),
      colorRank(c.colorKey)
    );

    ctx.fillStyle = paletteString(GLASS_SLOT_BASE + offset, alpha * 0.55);

    if (config.enableShadows) {
      ctx.shadowBlur = (16 + intensity * 8) * next;
      ctx.shadowColor = paletteString(COLOR_SLOT.accent, alpha * 1.7);
    }

    traceTriangle(ctx, a, b, c);
    ctx.fill();

    if (config.enableShadows) {
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = paletteString(COLOR_SLOT.node, alpha * 0.08);
    traceTriangle(ctx, a, b, c);
    ctx.fill();

    ctx.lineWidth = outlineWidth;
    ctx.strokeStyle = paletteString(HIGHLIGHT_SLOT_BASE + offset, alpha * 0.65);
    traceTriangle(ctx, a, b, c);
    ctx.stroke();

    findLongestEdge(a, b, c);
    ctx.lineWidth = edgeWidth;
    ctx.strokeStyle = paletteString(HIGHLIGHT_SLOT_BASE + offset, alpha * 1.1);
    ctx.beginPath();
    ctx.moveTo(longestEdge.ax, longestEdge.ay);
    ctx.lineTo(longestEdge.bx, longestEdge.by);
    ctx.stroke();
  }

  ctx.restore();
}

function drawConnections(ctx, particles, config, intensity, graph) {
  ctx.globalCompositeOperation = paletteBlend;
  ctx.lineCap = "round";

  const gi = config.glowIntensity || 1.0;
  const linkCount = graph.linkCount;

  // Two passes over the links so lineWidth changes twice per frame rather than
  // twice per link, which keeps the canvas state machine out of the inner loop.
  for (let pass = 0; pass < 2; pass += 1) {
    ctx.lineWidth = pass === 0 ? 4.0 + intensity * 0.8 : 1.2 + intensity * 0.25;

    for (let k = 0; k < linkCount; k += 1) {
      const a = particles[graph.linkFrom[k]];
      const b = particles[graph.linkTo[k]];
      if (!a || !b) continue;

      const alpha = graph.linkAlpha[k];
      ctx.strokeStyle = paletteString(
        midSlot(a.colorKey, b.colorKey),
        pass === 0 ? alpha * 0.22 * gi : alpha * 0.95
      );
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  ctx.lineCap = "butt";
}

// ---------------------------------------------------------------------------
// Adaptive quality
//
// The profile used to be chosen once from viewport size and never revisited,
// so a struggling device had no way down and a 4K display rendered a
// 3360x1890 additively-overdrawn surface with no fallback. Measure the time
// this module actually spends per frame -- not the frame interval, which also
// reflects the display's refresh rate -- and step detail down or back up.
// ---------------------------------------------------------------------------

const WORK_BUDGET_MS = 9;
const WORK_RECOVER_MS = 5;
const STEP_DOWN_AFTER_SECONDS = 2;
const STEP_UP_AFTER_SECONDS = 6;
const MAX_QUALITY_LEVEL = 3;

function createQualityMonitor(config) {
  return {
    base: {
      glassFacetCount: config.glassFacetCount,
      maxLinks: config.maxLinks,
      maxDistance: config.maxDistance,
      dpr: config.dpr
    },
    level: 0,
    workMs: 4,
    overBudget: 0,
    underBudget: 0
  };
}

function applyQuality(monitor, config) {
  const base = monitor.base;
  const level = monitor.level;

  config.glassFacetCount = level >= 1 ? 0 : base.glassFacetCount;
  config.maxLinks = level >= 2 ? Math.max(2, base.maxLinks - 1) : base.maxLinks;
  config.maxDistance = level >= 2 ? base.maxDistance * 0.85 : base.maxDistance;
  config.dpr = level >= 3 ? 1 : base.dpr;
}

// Returns true when the device pixel ratio changed and the canvas must resize.
function updateQuality(monitor, config, workMs, delta) {
  // Long-tailed average so one hitch cannot trigger a downgrade, but a
  // sustained overrun reaches the threshold within about two seconds.
  monitor.workMs += (workMs - monitor.workMs) * 0.05;

  if (monitor.workMs > WORK_BUDGET_MS) {
    monitor.overBudget += delta;
    monitor.underBudget = 0;
  } else if (monitor.workMs < WORK_RECOVER_MS) {
    monitor.underBudget += delta;
    monitor.overBudget = 0;
  } else {
    monitor.overBudget = 0;
    monitor.underBudget = 0;
  }

  let level = monitor.level;
  if (monitor.overBudget >= STEP_DOWN_AFTER_SECONDS && level < MAX_QUALITY_LEVEL) {
    level += 1;
  } else if (monitor.underBudget >= STEP_UP_AFTER_SECONDS && level > 0) {
    level -= 1;
  }
  if (level === monitor.level) return false;

  const previousDpr = config.dpr;
  monitor.level = level;
  monitor.overBudget = 0;
  monitor.underBudget = 0;
  applyQuality(monitor, config);

  return config.dpr !== previousDpr;
}

function drawParticles(ctx, particles, elapsed, intensity) {
  ctx.globalCompositeOperation = paletteBlend;

  for (let i = 0; i < particles.length; i += 1) {
    const particle = particles[i];

    // Layered organic pulse: primary + subtle harmonic for living feel
    const pulse = 0.88
      + Math.sin(elapsed * 0.55 + particle.pulseOffset) * 0.10
      + Math.sin(elapsed * 1.3 + particle.pulseOffset * 1.7) * 0.04;
    const alpha = clamp(particle.alpha * pulse * (1 + intensity * 0.22), 0, 0.96);
    const r = particle.radius * (1 + intensity * 0.12);
    const isSpeck = particle.zone === "speck";
    const hr = r * (isSpeck ? 4.0 : 5.4);
    const sprite = spriteSlots[spriteSlot(particle.colorKey, isSpeck)];
    if (!sprite) continue;

    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, particle.x - hr, particle.y - hr, hr * 2, hr * 2);
  }

  ctx.globalAlpha = 1.0;
}

function mountPlexusBackground(canvas, profileName = getProfileName()) {
  if (!canvas || !shouldEnableBackground()) return null;

  // Copied, not referenced: adaptive quality writes to this and must not
  // mutate the shared profile table.
  const config = { ...(PROFILE_CONFIG[profileName] || PROFILE_CONFIG.desktop) };
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
  let themeColors = readThemeColors();
  updateSpriteCache(themeColors);
  buildPalette(themeColors);

  const graph = createGraph();
  const facets = createFacetStore(FACET_CAPACITY);
  const quality = createQualityMonitor(config);
  const facetOpacity = new Map();
  const facetStrength = new Map();
  const packets = [];

  // Fixed-size top-N buffers for the cursor links, refilled in place each frame.
  const POINTER_LINK_COUNT = 4;
  const pointerLinkIndex = new Int32Array(POINTER_LINK_COUNT);
  const pointerLinkDistance = new Float32Array(POINTER_LINK_COUNT);

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

  const setSize = () => {
    const nextWidth = window.innerWidth;
    const nextHeight = Math.max(window.innerHeight, 1);
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
    });

    reconcileParticles(particles, width, height, config);

    // Facet keys are particle indices, which reconciliation reshuffles.
    facetOpacity.clear();
    facetStrength.clear();
  };

  const handleResize = () => {
    if (resizeFrame) return;

    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      setSize();
    });
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

  const syncThemeColors = () => {
    themeColors = readThemeColors();
    updateSpriteCache(themeColors);
    buildPalette(themeColors);
  };

  const render = (currentTime) => {
    animationFrame = window.requestAnimationFrame(render);

    if (document.hidden) {
      lastFrameTime = currentTime;
      return;
    }

    const delta = Math.min((currentTime - lastFrameTime) * 0.001, 0.05);
    const elapsed = currentTime * 0.001;
    const workStart = performance.now();
    lastFrameTime = currentTime;
    surgeIntensity *= frameDamp(0.982, delta);

    // Smooth pointer lerp for graceful mouse interaction
    if (pointer.active) {
      if (smoothPointer.x < -1000) {
        smoothPointer.x = pointer.x;
        smoothPointer.y = pointer.y;
      } else {
        smoothPointer.x = frameLerp(smoothPointer.x, pointer.x, 0.12, delta);
        smoothPointer.y = frameLerp(smoothPointer.y, pointer.y, 0.12, delta);
      }
      smoothPointer.active = true;
    } else {
      smoothPointer.active = false;
      smoothPointer.x = POINTER_AWAY;
      smoothPointer.y = POINTER_AWAY;
    }

    const currentScrollY = window.scrollY || 0;
    const scrollDelta = currentScrollY - lastScrollY;
    lastScrollY = currentScrollY;

    if (Math.abs(scrollDelta) > 0.5) {
      const scrollImpulse = clamp(scrollDelta * 0.35, -35, 35);
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        if (p.zone !== "speck") {
          p.vy -= scrollImpulse * delta * 0.85;
        }
      }
    }

    drawBackground(ctx, width, height);

    for (let i = 0; i < particles.length; i += 1) {
      updateParticle(
        particles[i], delta, elapsed, width, height, smoothPointer, config, surgeIntensity
      );
    }

    buildLinkGraph(graph, particles, config, surgeIntensity, width, height);
    collectFacets(graph, facets, particles, config);
    drawGlassFacets(
      ctx, particles, facets, config, surgeIntensity, facetOpacity, facetStrength, delta
    );
    drawConnections(ctx, particles, config, surgeIntensity, graph);

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
      ctx.globalCompositeOperation = paletteBlend;

      // Outer primary shockwave ring
      const outerWidth = Math.max(1.0, 3.4 * Math.pow(1 - progress, 0.8));
      ctx.lineWidth = outerWidth;
      ctx.strokeStyle = paletteString(COLOR_SLOT.accent, rip.alpha * 0.6);
      ctx.beginPath();
      ctx.arc(rip.x, rip.y, rip.radius, 0, TWO_PI);
      ctx.stroke();

      // Inner secondary harmonic ring
      if (rip.radius > 12) {
        ctx.lineWidth = Math.max(0.8, 1.8 * Math.pow(1 - progress, 0.8));
        ctx.strokeStyle = paletteString(COLOR_SLOT.data, rip.alpha * 0.38);
        ctx.beginPath();
        ctx.arc(rip.x, rip.y, rip.radius * 0.78, 0, TWO_PI);
        ctx.stroke();
      }
      ctx.restore();

      // Ripple wave front collision: excite particles & dispatch stream packets.
      // Compared as squared distances against the band edges -- Math.hypot is
      // overflow-safe and correspondingly slow, and this ran per particle per
      // ripple per frame. The link partner comes from the adjacency index
      // instead of a linear scan of every connection.
      const innerEdge = rip.radius - 28;
      const innerSq = innerEdge > 0 ? innerEdge * innerEdge : 0;
      const outerSq = (rip.radius + 28) * (rip.radius + 28);

      for (let idx = 0; idx < particles.length; idx += 1) {
        const p = particles[idx];
        const rdx = p.x - rip.x;
        const rdy = p.y - rip.y;
        const rd2 = rdx * rdx + rdy * rdy;
        if (rd2 < innerSq || rd2 > outerSq) continue;

        p.pulseOffset += 0.15;
        if (Math.random() >= 0.22 || packets.length >= 30) continue;

        const adjacentStart = graph.adjStart[idx];
        if (adjacentStart >= graph.adjStart[idx + 1]) continue;

        packets.push({
          from: idx,
          to: graph.adjNode[adjacentStart],
          progress: 0,
          speed: randomBetween([1.6, 3.4]),
          colorKey: p.colorKey,
          size: lerp(1.6, 2.8, Math.random())
        });
      }
    }

    // Draw pointer-to-plexus links (Cursor Connection Hub)
    if (smoothPointer.active && profileName !== "mobile") {
      // Match the physics radius exactly: linking to nodes the field never
      // reaches is what made the cursor feel detached from the mesh.
      const pointerLinkRadius = config.pointerRadius || 0;
      const pointerRadiusSq = pointerLinkRadius * pointerLinkRadius;

      // Insertion into a fixed four-slot buffer, rather than collecting every
      // candidate into an array and sorting it to take the first four.
      let pointerLinks = 0;
      for (let idx = 0; idx < particles.length; idx += 1) {
        const p = particles[idx];
        if (p.zone === "speck") continue;

        const pdx = p.x - smoothPointer.x;
        const pdy = p.y - smoothPointer.y;
        const pd2 = pdx * pdx + pdy * pdy;
        if (pd2 >= pointerRadiusSq) continue;

        let slot = pointerLinks < POINTER_LINK_COUNT ? pointerLinks : POINTER_LINK_COUNT;
        while (slot > 0 && pointerLinkDistance[slot - 1] > pd2) {
          if (slot < POINTER_LINK_COUNT) {
            pointerLinkDistance[slot] = pointerLinkDistance[slot - 1];
            pointerLinkIndex[slot] = pointerLinkIndex[slot - 1];
          }
          slot -= 1;
        }
        if (slot < POINTER_LINK_COUNT) {
          pointerLinkDistance[slot] = pd2;
          pointerLinkIndex[slot] = idx;
          if (pointerLinks < POINTER_LINK_COUNT) pointerLinks += 1;
        }
      }

      ctx.save();
      ctx.globalCompositeOperation = paletteBlend;
      for (let n = 0; n < pointerLinks; n += 1) {
        const p = particles[pointerLinkIndex[n]];
        if (!p) continue;

        const proximity = 1 - Math.sqrt(pointerLinkDistance[n]) / pointerLinkRadius;
        const alpha = proximity * 0.65 * (1 + surgeIntensity * 0.3);
        const slot = COLOR_SLOT[p.colorKey] !== undefined
          ? COLOR_SLOT[p.colorKey]
          : COLOR_SLOT.accent;

        ctx.lineWidth = 3.5;
        ctx.strokeStyle = paletteString(slot, alpha * 0.18);
        ctx.beginPath();
        ctx.moveTo(smoothPointer.x, smoothPointer.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();

        ctx.lineWidth = 1.0;
        ctx.strokeStyle = paletteString(slot, alpha * 0.85);
        ctx.beginPath();
        ctx.moveTo(smoothPointer.x, smoothPointer.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Spawn and draw packets along connection lines (Dynamic Data Packets)
    if (graph.linkCount > 0 && Math.random() < 0.045 + surgeIntensity * 0.08) {
      const maxPackets = profileName === "mobile" ? 10 : 25;
      if (packets.length < maxPackets) {
        const k = Math.floor(Math.random() * graph.linkCount);
        const fromIndex = graph.linkFrom[k];
        const toIndex = graph.linkTo[k];
        const fromNode = particles[fromIndex];
        const toNode = particles[toIndex];
        if (fromNode && toNode && fromNode.zone !== "speck" && toNode.zone !== "speck") {
          packets.push({
            from: fromIndex,
            to: toIndex,
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
      const packetSlot = COLOR_SLOT[packet.colorKey] !== undefined
        ? COLOR_SLOT[packet.colorKey]
        : COLOR_SLOT.accent;

      ctx.save();
      ctx.globalCompositeOperation = paletteBlend;
      
      const trailLen = 0.15;
      const trailProgress = Math.max(0, packet.progress - trailLen);
      const tx = lerp(a.x, b.x, trailProgress);
      const ty = lerp(a.y, b.y, trailProgress);
      
      const grad = ctx.createLinearGradient(tx, ty, px, py);
      grad.addColorStop(0, paletteString(packetSlot, 0));
      grad.addColorStop(1, paletteString(packetSlot, 0.85));
      
      ctx.strokeStyle = grad;
      ctx.lineWidth = packet.size * 1.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(px, py);
      ctx.stroke();

      ctx.fillStyle = paletteString(COLOR_SLOT.node, 0.9);
      ctx.beginPath();
      ctx.arc(px, py, packet.size, 0, TWO_PI);
      ctx.fill();
      
      ctx.restore();
    }

    drawParticles(ctx, particles, elapsed, surgeIntensity);

    if (updateQuality(quality, config, performance.now() - workStart, delta)) {
      // Only a device-pixel-ratio change needs the canvas rebuilt.
      setSize();
    }
  };

  setSize();
  window.addEventListener("resize", handleResize, { passive: true });

  // The customiser writes theme variables one at a time onto body.style, so a
  // single slider drag fires this observer dozens of times. Each sync rebuilds
  // eight sprite canvases and the palette, so coalesce into one frame.
  let themeSyncFrame = 0;
  const queueThemeSync = () => {
    if (themeSyncFrame) return;
    themeSyncFrame = window.requestAnimationFrame(() => {
      themeSyncFrame = 0;
      syncThemeColors();
    });
  };

  const themeObserver = new MutationObserver(queueThemeSync);
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });

  const handlePointerDown = (event) => {
    // A click on nav, a button or a field is not an invitation to fire a
    // full-screen shockwave. Only background hits ripple.
    if (
      event.target instanceof Element &&
      event.target.closest(INTERACTIVE_SELECTOR)
    ) {
      return;
    }

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
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("pointermove", handlePointerMove);
    document.body.removeEventListener("pointerleave", handlePointerLeave);
    window.removeEventListener("pointerdown", handlePointerDown);
    if (window.__triggerBgRipple === triggerRipple) {
      delete window.__triggerBgRipple;
    }
    themeObserver.disconnect();
    if (themeSyncFrame) window.cancelAnimationFrame(themeSyncFrame);
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
  const canvas = document.getElementById("plexus-canvas");
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
