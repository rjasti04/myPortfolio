import {
  prefersReducedMotion as reducedMotionQuery,
  compactViewport as compactViewportQuery,
  mobileDevice,
  supportsHover,
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
  speck: "data",
};

const COLOR_FALLBACKS = {
  accent: [14, 165, 233],
  secondary: [168, 85, 247],
  data: [16, 185, 129],
  node: [255, 255, 255],
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
    lineAlpha: 0.5,
    repelRadius: 135,
    repelStrength: 200,
    homeStrength: 0.07,
    glowIntensity: 0.95,
    connectionFalloff: 1.45,
    glassFacetCount: 16,
    glassFacetAlpha: 0.14,
    glassFacetAreaFactor: 0.3,
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
    glassFacetAlpha: 0.1,
    glassFacetAreaFactor: 0.26,
  },
};

window.triggerWebGlSurge = () => {
  surgeIntensity = 1;
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

function colorString(color, alpha) {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function blendColors(a, b, weight = 0.5) {
  const t = clamp(weight, 0, 1);
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

function averageColors(colors) {
  const total = colors.reduce(
    (sum, color) => [sum[0] + color[0], sum[1] + color[1], sum[2] + color[2]],
    [0, 0, 0],
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
      parseInt(hex.slice(4, 6), 16),
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
  if (normalized.startsWith("rgb"))
    return parseRgbColor(normalized) || fallback;

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
    secondary: parseCssColor(
      readVar("--secondary-fill"),
      COLOR_FALLBACKS.secondary,
    ),
    data: parseCssColor(readVar("--data-fill"), COLOR_FALLBACKS.data),
    node: COLOR_FALLBACKS.node,
  };
}

function getProfileName() {
  if (mobileDevice.matches || window.innerWidth <= 640) return "mobile";
  if (compactViewportQuery.matches || window.innerHeight < 720)
    return "compact";
  return "desktop";
}

function shouldEnableBackground() {
  if (reducedMotionQuery.matches) return false;
  if (window.innerWidth < 320 || window.innerHeight < 420) return false;
  return Boolean(
    window.requestAnimationFrame &&
    typeof document.createElement("canvas").getContext === "function",
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
      y: lerp(-verticalPadding, height + verticalPadding, Math.random()),
    };
  }

  if (zone === "right") {
    return {
      x: width - lerp(-outside * 0.25, sideBand, Math.random() ** 0.9),
      y: lerp(-verticalPadding, height + verticalPadding, Math.random()),
    };
  }

  if (zone === "top") {
    const leftSide = Math.random() > 0.5;
    return {
      x: leftSide
        ? lerp(-outside * 0.25, width * 0.38, Math.random())
        : lerp(width * 0.62, width + outside * 0.25, Math.random()),
      y: lerp(-outside * 0.8, height * 0.22, Math.random() ** 1.35),
    };
  }

  if (zone === "bottom") {
    const leftSide = Math.random() > 0.5;
    return {
      x: leftSide
        ? lerp(-outside * 0.25, width * 0.32, Math.random())
        : lerp(width * 0.68, width + outside * 0.25, Math.random()),
      y: height - lerp(-outside * 0.8, height * 0.2, Math.random() ** 1.45),
    };
  }

  return {
    x: lerp(width * 0.3, width * 0.7, Math.random()),
    y: lerp(height * 0.2, height * 0.75, Math.random()),
  };
}

function createParticle(width, height, config) {
  const zone = pickZone();
  const position = zonePosition(zone, width, height, config);
  const angle =
    zone === "left"
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
    alpha:
      zone === "speck"
        ? lerp(0.16, 0.38, Math.random())
        : lerp(0.52, 0.92, Math.random()),
    phase: Math.random() * TWO_PI,
    turn: lerp(0.04, 0.15, Math.random()) * (Math.random() > 0.5 ? 1 : -1),
    pulseOffset: Math.random() * TWO_PI,
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
    particle.x = clamp(
      particle.x,
      -config.maxDistance,
      width + config.maxDistance,
    );
    particle.y = clamp(
      particle.y,
      -config.maxDistance,
      height + config.maxDistance,
    );
  });
}

function drawBackground(ctx, width, height) {
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, width, height);
}

function applyHomeForce(particle, delta, config) {
  if (particle.zone === "speck") return;

  particle.vx += (particle.homeX - particle.x) * config.homeStrength * delta;
  particle.vy +=
    (particle.homeY - particle.y) * config.homeStrength * delta * 0.55;
}

function nudgeAwayFromCenter(particle, delta, width, height) {
  if (particle.zone === "speck") return;

  const inQuietX = particle.x > width * 0.32 && particle.x < width * 0.68;
  const inQuietY = particle.y > height * 0.16 && particle.y < height * 0.86;

  if (!inQuietX || !inQuietY) return;

  const direction = particle.zone === "right" ? 1 : -1;
  particle.vx += direction * width * 0.22 * delta;
}

function updateParticle(
  particle,
  delta,
  elapsed,
  width,
  height,
  pointer,
  config,
  intensity,
) {
  const turn =
    Math.sin(elapsed * particle.turn + particle.phase) * delta * 0.07;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const vx = particle.vx * cos - particle.vy * sin;
  const vy = particle.vx * sin + particle.vy * cos;
  const speed = Math.hypot(vx, vy) || particle.baseSpeed || 1;
  const targetSpeed = particle.baseSpeed * (1 + intensity * 0.5);

  particle.vx = (vx / speed) * targetSpeed;
  particle.vy = (vy / speed) * targetSpeed;

  applyHomeForce(particle, delta, config);
  nudgeAwayFromCenter(particle, delta, width, height);

  particle.x += particle.vx * delta;
  particle.y += particle.vy * delta;

  if (pointer.active && config.repelRadius > 0) {
    const dx = particle.x - pointer.x;
    const dy = particle.y - pointer.y;
    const distanceSquared = dx * dx + dy * dy;
    const radiusSquared = config.repelRadius * config.repelRadius;

    if (distanceSquared < radiusSquared) {
      const distance = Math.sqrt(distanceSquared) || 1;
      const force = (1 - distance / config.repelRadius) ** 1.8;
      const push = force * config.repelStrength * delta;

      particle.x += (dx / distance) * push;
      particle.y += (dy / distance) * push;

      // Dampen velocity during repulsion for smoother interaction
      particle.vx *= 0.92;
      particle.vy *= 0.92;
    }
  }

  const margin = config.maxDistance * 0.6;
  if (particle.x < -margin || particle.x > width + margin) particle.vx *= -0.98;
  if (particle.y < -margin || particle.y > height + margin)
    particle.vy *= -0.98;

  particle.x = clamp(particle.x, -margin, width + margin);
  particle.y = clamp(particle.y, -margin, height + margin);
}

function connectionDistanceFor(a, b, config) {
  if (a.zone === "speck" || b.zone === "speck") return config.maxDistance * 0.5;
  if (a.zone === b.zone) return config.maxDistance * 1.05;
  if (
    (a.zone === "left" && b.zone === "top") ||
    (a.zone === "top" && b.zone === "left")
  ) {
    return config.maxDistance * 0.82;
  }
  if (
    (a.zone === "right" && b.zone === "top") ||
    (a.zone === "top" && b.zone === "right")
  ) {
    return config.maxDistance * 0.82;
  }
  if (
    (a.zone === "left" && b.zone === "bottom") ||
    (a.zone === "bottom" && b.zone === "left")
  ) {
    return config.maxDistance * 0.75;
  }
  if (
    (a.zone === "right" && b.zone === "bottom") ||
    (a.zone === "bottom" && b.zone === "right")
  ) {
    return config.maxDistance * 0.75;
  }
  return config.maxDistance * 0.38;
}

function midpointIsTooCentral(a, b, width, height) {
  if (a.zone === "speck" || b.zone === "speck") return false;

  const midX = (a.x + b.x) * 0.5;
  const midY = (a.y + b.y) * 0.5;
  return (
    midX > width * 0.32 &&
    midX < width * 0.68 &&
    midY > height * 0.14 &&
    midY < height * 0.86
  );
}

function buildSpatialGrid(particles, cellSize) {
  const grid = new Map();
  for (let i = 0; i < particles.length; i += 1) {
    const cx = Math.floor(particles[i].x / cellSize);
    const cy = Math.floor(particles[i].y / cellSize);
    const key = cx * 10007 + cy;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  return grid;
}

function collectConnections(particles, config, width, height) {
  const cellSize = config.maxDistance;
  const grid = buildSpatialGrid(particles, cellSize);
  const candidates = [];

  for (let i = 0; i < particles.length; i += 1) {
    const a = particles[i];
    const cx = Math.floor(a.x / cellSize);
    const cy = Math.floor(a.y / cellSize);

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const nKey = (cx + dx) * 10007 + (cy + dy);
        const bucket = grid.get(nKey);
        if (!bucket) continue;

        for (const j of bucket) {
          if (j <= i) continue;
          const b = particles[j];
          const maxDist = connectionDistanceFor(a, b, config);
          const ex = a.x - b.x;
          const ey = a.y - b.y;
          const d2 = ex * ex + ey * ey;

          if (d2 > maxDist * maxDist) continue;
          if (midpointIsTooCentral(a, b, width, height)) continue;

          candidates.push({
            from: i,
            to: j,
            distance: Math.sqrt(d2),
            maxDistance: maxDist,
          });
        }
      }
    }
  }

  return candidates.sort((a, b) => a.distance - b.distance);
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
    (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)) * 0.5,
  );
}

function triangleCentroid(a, b, c) {
  return {
    x: (a.x + b.x + c.x) / 3,
    y: (a.y + b.y + c.y) / 3,
  };
}

function pointIsTooCentral(x, y, width, height) {
  return (
    x > width * 0.34 &&
    x < width * 0.66 &&
    y > height * 0.16 &&
    y < height * 0.84
  );
}

function longestTriangleEdge(a, b, c) {
  const edges = [
    [a, b, distanceSquared(a, b)],
    [b, c, distanceSquared(b, c)],
    [c, a, distanceSquared(c, a)],
  ];

  return edges.sort((first, second) => second[2] - first[2])[0];
}

function selectConnections(particles, config, width, height, intensity) {
  const linkCounts = new Uint8Array(particles.length);
  const connections = collectConnections(particles, config, width, height);
  const selectedConnections = [];

  connections.forEach((connection) => {
    const a = particles[connection.from];
    const b = particles[connection.to];
    const maxLinks =
      a.zone === "speck" || b.zone === "speck" ? 1 : config.maxLinks;

    if (
      linkCounts[connection.from] >= maxLinks ||
      linkCounts[connection.to] >= maxLinks
    )
      return;

    const proximity = 1 - connection.distance / connection.maxDistance;
    const falloff = config.connectionFalloff || 1.4;
    const alpha = clamp(
      proximity ** falloff * config.lineAlpha * (1 + intensity * 0.45),
      0,
      0.78,
    );

    selectedConnections.push({
      ...connection,
      alpha,
      proximity,
    });

    linkCounts[connection.from] += 1;
    linkCounts[connection.to] += 1;
  });

  return selectedConnections;
}

function collectGlassFacets(particles, connections, config, width, height) {
  const maxFacets = config.glassFacetCount || 0;
  if (maxFacets <= 0 || connections.length < 3) return [];

  const adjacency = new Map();
  const edgeMap = new Map();
  const minArea = config.glassFacetMinArea || 280;
  const maxArea =
    config.maxDistance *
    config.maxDistance *
    (config.glassFacetAreaFactor || 0.3);
  const facets = [];
  const seen = new Set();

  const addNeighbor = (from, to, connection) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({
      to,
      proximity: connection.proximity,
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
        const closingConnection = edgeMap.get(connectionKey(first, second));

        if (!closingConnection) continue;

        const key = [from, first, second].sort((a, b) => a - b).join(":");
        if (seen.has(key)) continue;
        seen.add(key);

        const a = particles[from];
        const b = particles[first];
        const c = particles[second];
        const area = triangleArea(a, b, c);
        if (area < minArea || area > maxArea) continue;

        const centroid = triangleCentroid(a, b, c);
        if (pointIsTooCentral(centroid.x, centroid.y, width, height)) continue;

        facets.push({
          points: [from, first, second],
          centroid,
          area,
          strength:
            (neighbors[i].proximity +
              neighbors[j].proximity +
              closingConnection.proximity) /
            3,
        });
      }
    }
  });

  return facets
    .sort(
      (a, b) => b.strength * Math.sqrt(b.area) - a.strength * Math.sqrt(a.area),
    )
    .slice(0, maxFacets);
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
  connections,
  config,
  width,
  height,
  intensity,
  themeColors,
  facetOpacity,
  delta,
) {
  const facets = collectGlassFacets(
    particles,
    connections,
    config,
    width,
    height,
  );

  // Temporal smoothing: fade-in rate and fade-out rate per second
  const fadeIn = 2.2 * delta; // ~0.037 per frame at 60fps → full in ~27 frames
  const fadeOut = 1.4 * delta; // ~0.023 per frame → gone in ~43 frames

  // Mark all existing keys for potential fade-out
  const activeKeys = new Set();

  // Update opacity for currently visible facets
  facets.forEach((facet) => {
    const key = facet.points
      .slice()
      .sort((a, b) => a - b)
      .join(":");
    activeKeys.add(key);
    const prev = facetOpacity.get(key) || 0;
    facetOpacity.set(key, Math.min(prev + fadeIn, 1));
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
  const facetByKey = new Map();
  facets.forEach((facet) => {
    const key = facet.points
      .slice()
      .sort((a, b) => a - b)
      .join(":");
    facetByKey.set(key, facet);
  });

  if (!facetOpacity.size) return;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // Draw all facets that have any opacity (active + fading out)
  for (const [key, opacity] of facetOpacity) {
    const facet = facetByKey.get(key);
    if (!facet) continue; // fading-out facet whose particles moved — skip gracefully

    const [first, second, third] = facet.points;
    const a = particles[first];
    const b = particles[second];
    const c = particles[third];
    if (!a || !b || !c) continue;

    const colors = [a, b, c].map(
      (particle) => themeColors[particle.colorKey] || themeColors.accent,
    );
    const cyanGlass = blendColors(themeColors.accent, themeColors.data, 0.22);
    const glassColor = blendColors(averageColors(colors), cyanGlass, 0.72);
    const highlightColor = blendColors(glassColor, themeColors.node, 0.56);
    const baseAlpha = clamp(
      (config.glassFacetAlpha || 0.14) *
        (0.65 + facet.strength * 0.9) *
        (1 + intensity * 0.35),
      0,
      0.32,
    );
    const alpha = baseAlpha * opacity;

    const fill = ctx.createLinearGradient(a.x, a.y, c.x, c.y);
    fill.addColorStop(0, colorString(highlightColor, alpha * 0.82));
    fill.addColorStop(0.48, colorString(glassColor, alpha * 0.55));
    fill.addColorStop(1, colorString(cyanGlass, alpha * 0.28));

    ctx.shadowBlur = (16 + intensity * 8) * opacity;
    ctx.shadowColor = colorString(themeColors.accent, alpha * 1.7);
    ctx.fillStyle = fill;
    traceTriangle(ctx, a, b, c);
    ctx.fill();
    ctx.shadowBlur = 0;

    const sheen = ctx.createLinearGradient(
      facet.centroid.x - 18,
      facet.centroid.y - 18,
      facet.centroid.x + 42,
      facet.centroid.y + 28,
    );
    sheen.addColorStop(0, colorString(themeColors.node, alpha * 0.2));
    sheen.addColorStop(0.5, colorString(themeColors.node, alpha * 0.08));
    sheen.addColorStop(1, colorString(glassColor, 0));

    ctx.fillStyle = sheen;
    traceTriangle(ctx, a, b, c);
    ctx.fill();

    const edge = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    edge.addColorStop(0, colorString(highlightColor, alpha * 0.9));
    edge.addColorStop(0.55, colorString(themeColors.node, alpha * 0.72));
    edge.addColorStop(1, colorString(glassColor, alpha * 0.45));

    ctx.lineWidth = 0.85 + intensity * 0.25;
    ctx.strokeStyle = edge;
    traceTriangle(ctx, a, b, c);
    ctx.stroke();

    const [start, end] = longestTriangleEdge(a, b, c);
    ctx.lineWidth = 1.35 + intensity * 0.25;
    ctx.strokeStyle = colorString(highlightColor, alpha * 1.2);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawConnections(
  ctx,
  particles,
  config,
  width,
  height,
  intensity,
  themeColors,
  connections,
) {
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";

  connections.forEach((connection) => {
    const a = particles[connection.from];
    const b = particles[connection.to];
    const alpha = connection.alpha;
    const gi = config.glowIntensity || 1.0;

    const aColor = themeColors[a.colorKey] || themeColors.accent;
    const bColor = themeColors[b.colorKey] || themeColors.accent;
    const midColor = averageColors([aColor, bColor]);

    // Soft outer glow — single blended color avoids per-line gradient allocation
    ctx.lineWidth = 4.0 + intensity * 0.8;
    ctx.strokeStyle = colorString(midColor, alpha * 0.22 * gi);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    // Core line with gradient
    const line = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    line.addColorStop(0, colorString(aColor, alpha * 0.92));
    line.addColorStop(0.5, colorString(midColor, alpha));
    line.addColorStop(1, colorString(bColor, alpha * 0.92));

    ctx.lineWidth = 1.2 + intensity * 0.25;
    ctx.strokeStyle = line;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });

  ctx.lineCap = "butt";
}

function drawParticles(ctx, particles, elapsed, intensity, themeColors) {
  ctx.globalCompositeOperation = "lighter";

  particles.forEach((particle) => {
    // Layered organic pulse: primary + subtle harmonic for living feel
    const pulse =
      0.88 +
      Math.sin(elapsed * 0.55 + particle.pulseOffset) * 0.1 +
      Math.sin(elapsed * 1.3 + particle.pulseOffset * 1.7) * 0.04;
    const alpha = clamp(
      particle.alpha * pulse * (1 + intensity * 0.22),
      0,
      0.96,
    );
    const r = particle.radius * (1 + intensity * 0.12);
    const hr = r * (particle.zone === "speck" ? 4.0 : 5.4);
    const color = themeColors[particle.colorKey] || themeColors.accent;
    const coreRatio = r / hr;

    // Combined halo + core in a single gradient — halves GPU gradient ops
    const grad = ctx.createRadialGradient(
      particle.x,
      particle.y,
      0,
      particle.x,
      particle.y,
      hr,
    );

    // Bright core center (dimmed 50%)
    grad.addColorStop(0, colorString(themeColors.node, alpha * 0.48));
    grad.addColorStop(coreRatio * 0.55, colorString(color, alpha * 0.41));
    grad.addColorStop(coreRatio, colorString(color, alpha * 0.28));
    // Halo bloom
    grad.addColorStop(
      Math.min(coreRatio * 2.2, 0.48),
      colorString(color, alpha * 0.16),
    );
    grad.addColorStop(
      Math.min(coreRatio * 4.0, 0.72),
      colorString(color, alpha * 0.06),
    );
    grad.addColorStop(1, colorString(color, 0));

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, hr, 0, TWO_PI);
    ctx.fill();
  });
}

function mountPlexusBackground(canvas, profileName = getProfileName()) {
  if (!canvas || !shouldEnableBackground()) return null;

  const config = PROFILE_CONFIG[profileName] || PROFILE_CONFIG.desktop;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return null;

  const particles = [];
  const pointer = {
    active: false,
    x: POINTER_AWAY,
    y: POINTER_AWAY,
  };
  const smoothPointer = {
    active: false,
    x: POINTER_AWAY,
    y: POINTER_AWAY,
  };

  let width = 0;
  let height = 0;
  let resizeFrame = 0;
  let animationFrame = 0;
  let lastFrameTime = performance.now();
  let themeColors = readThemeColors();
  const facetOpacity = new Map();

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

    drawBackground(ctx, width, height);

    particles.forEach((particle) => {
      updateParticle(
        particle,
        delta,
        elapsed,
        width,
        height,
        smoothPointer,
        config,
        surgeIntensity,
      );
    });

    const connections = selectConnections(
      particles,
      config,
      width,
      height,
      surgeIntensity,
    );
    drawGlassFacets(
      ctx,
      particles,
      connections,
      config,
      width,
      height,
      surgeIntensity,
      themeColors,
      facetOpacity,
      delta,
    );
    drawConnections(
      ctx,
      particles,
      config,
      width,
      height,
      surgeIntensity,
      themeColors,
      connections,
    );
    drawParticles(ctx, particles, elapsed, surgeIntensity, themeColors);
  };

  setSize();
  window.addEventListener("resize", handleResize, { passive: true });

  const themeObserver = new MutationObserver(syncThemeColors);
  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });

  if (supportsHover.matches && profileName !== "mobile") {
    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    document.body.addEventListener("pointerleave", handlePointerLeave, {
      passive: true,
    });
  }

  animationFrame = window.requestAnimationFrame(render);

  return () => {
    window.cancelAnimationFrame(animationFrame);
    if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("pointermove", handlePointerMove);
    document.body.removeEventListener("pointerleave", handlePointerLeave);
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
