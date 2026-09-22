/**
 * 2048 - slide the grid, merge equal tiles, reach 2048.
 *
 * The rules live in `collapse()` and `move()`, which are pure and exported so
 * the tests can exercise the awkward cases directly (a row of four equal
 * tiles merges into two, not one; a tile that merged this move cannot merge
 * again on the same move). Everything below them is drawing.
 */

import { fitCanvas, createLoop, prefersReducedMotion } from "./engine.js";
import { bindKeys, bindSwipe } from "./input.js";

export const meta = {
  id: "2048",
  name: "2048",
  tagline: "Slide, merge, and chase the tile.",
  controls: "Arrow keys, WASD, or swipe",
  rules:
    "Merging two equal tiles scores their sum. The run ends when the board is full and nothing can merge.",
};

const SIZE = 4;
/** Seconds a slide takes. Short enough that fast play never queues up behind it. */
const SLIDE_DURATION = 0.1;

/**
 * Candy ramp keyed by log2 of the tile value; the last entry covers everything
 * above it. Each step carries its own ink because the ramp runs light to dark,
 * and no single text colour clears 3:1 against all eleven fills - the numbers
 * are the one thing on the board that has to stay legible at speed.
 */
const TILE_COLOURS = [
  { fill: "#56cbf5", ink: "#0e2f3d" }, // 2
  { fill: "#2fd6c4", ink: "#0b312d" }, // 4
  { fill: "#a5d94a", ink: "#20300b" }, // 8
  { fill: "#ffc933", ink: "#3a2a05" }, // 16
  { fill: "#ffa22e", ink: "#3a2205" }, // 32
  { fill: "#ff7a3d", ink: "#3d1e05" }, // 64
  { fill: "#f7594f", ink: "#fff6ec" }, // 128
  { fill: "#f0468a", ink: "#fff6ec" }, // 256
  { fill: "#d451d8", ink: "#fff6ec" }, // 512
  { fill: "#a05ee8", ink: "#fff6ec" }, // 1024
  { fill: "#6c7bff", ink: "#fff6ec" }, // 2048 and up
];

export const emptyGrid = () => Array.from({ length: SIZE * SIZE }, () => 0);

/**
 * Collapse one line towards index 0.
 *
 * Returns the resulting line, the points scored, and where each occupied cell
 * ended up - the mapping is what lets the renderer animate a slide instead of
 * teleporting tiles.
 */
export function collapse(line) {
  const filled = [];
  line.forEach((value, index) => {
    if (value) filled.push({ value, index });
  });

  const result = [];
  const moves = [];
  let score = 0;

  for (let i = 0; i < filled.length; i += 1) {
    const current = filled[i];
    const next = filled[i + 1];
    const target = result.length;

    // Merging consumes both tiles and advances the cursor past the second, so
    // a merged tile can never merge again within the same move.
    if (next && next.value === current.value) {
      const value = current.value * 2;
      result.push(value);
      score += value;
      moves.push({ from: current.index, to: target, merged: true });
      moves.push({ from: next.index, to: target, merged: true });
      i += 1;
    } else {
      result.push(current.value);
      moves.push({ from: current.index, to: target, merged: false });
    }
  }

  while (result.length < line.length) result.push(0);
  return { line: result, score, moves };
}

/** Cell indices of one line, ordered so that index 0 is the direction of travel. */
function lineIndices(direction, offset) {
  const forward = Array.from({ length: SIZE }, (_, i) => i);
  switch (direction) {
    case "left":
      return forward.map((i) => offset * SIZE + i);
    case "right":
      return forward.map((i) => offset * SIZE + (SIZE - 1 - i));
    case "up":
      return forward.map((i) => i * SIZE + offset);
    default:
      return forward.map((i) => (SIZE - 1 - i) * SIZE + offset);
  }
}

/**
 * Apply one move to a grid.
 *
 * Returns the new grid, the points gained, whether anything actually moved
 * (a move that changes nothing must not spawn a tile) and the per-tile
 * journeys in grid-cell terms.
 */
export function move(grid, direction) {
  const next = emptyGrid();
  const journeys = [];
  let score = 0;
  let moved = false;

  for (let offset = 0; offset < SIZE; offset += 1) {
    const indices = lineIndices(direction, offset);
    const line = indices.map((cell) => grid[cell]);
    const collapsed = collapse(line);

    collapsed.line.forEach((value, i) => {
      next[indices[i]] = value;
    });
    score += collapsed.score;

    collapsed.moves.forEach(({ from, to, merged }) => {
      const fromCell = indices[from];
      const toCell = indices[to];
      if (fromCell !== toCell) moved = true;
      journeys.push({ from: fromCell, to: toCell, value: line[from], merged });
    });
  }

  return { grid: next, score, moved, journeys };
}

/** True while any move would change the board. */
export function hasMoves(grid) {
  if (grid.some((value) => value === 0)) return true;
  return ["left", "up"].some((direction) => move(grid, direction).moved);
}

/** Place a 2 (90%) or 4 (10%) on a random empty cell. Mutates and returns the cell index. */
export function spawn(grid, random = Math.random) {
  const empty = [];
  grid.forEach((value, index) => {
    if (!value) empty.push(index);
  });
  if (!empty.length) return -1;

  const cell = empty[Math.floor(random() * empty.length)];
  grid[cell] = random() < 0.9 ? 2 : 4;
  return cell;
}

export function create({ mount, api }) {
  const reduceMotion = prefersReducedMotion();

  const root = document.createElement("div");
  root.className = "game game--2048";
  root.innerHTML = '<canvas class="game-canvas game-canvas--square"></canvas>';
  mount.append(root);

  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");

  let grid = emptyGrid();
  let score = 0;
  let finished = false;
  let reachedTarget = false;

  // Tiles currently sliding, plus the cells that should pop when they land.
  let animating = [];
  let popping = new Set();
  let animationTime = SLIDE_DURATION;

  spawn(grid);
  spawn(grid);

  function attemptMove(direction) {
    if (finished || animationTime < SLIDE_DURATION) return;

    const outcome = move(grid, direction);
    if (!outcome.moved) return;

    animating = outcome.journeys.filter(
      (journey) => journey.from !== journey.to || journey.merged,
    );
    popping = new Set(
      outcome.journeys.filter((j) => j.merged).map((j) => j.to),
    );

    grid = outcome.grid;
    score += outcome.score;
    api.setScore(score);

    const spawned = spawn(grid);
    if (spawned >= 0) popping.add(spawned);

    if (outcome.score) api.audio.blip(Math.min(Math.log2(outcome.score), 12));
    animationTime = reduceMotion ? SLIDE_DURATION : 0;

    if (!reachedTarget && grid.some((value) => value >= 2048)) {
      reachedTarget = true;
      api.audio.fanfare();
    }
    if (!hasMoves(grid)) {
      finished = true;
      api.audio.gameOver();
      api.gameOver(score);
    }
  }

  const releaseKeys = bindKeys({
    ArrowLeft: () => attemptMove("left"),
    ArrowRight: () => attemptMove("right"),
    ArrowUp: () => attemptMove("up"),
    ArrowDown: () => attemptMove("down"),
    a: () => attemptMove("left"),
    d: () => attemptMove("right"),
    w: () => attemptMove("up"),
    s: () => attemptMove("down"),
  });
  const releaseSwipe = bindSwipe(canvas, { onSwipe: attemptMove });

  const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

  function drawTile(x, y, size, value, scale = 1) {
    const inset = (size * (1 - scale)) / 2;
    const step =
      TILE_COLOURS[Math.min(Math.log2(value) - 1, TILE_COLOURS.length - 1)];
    const radius = size * 0.16 * scale;

    ctx.fillStyle = step.fill;
    ctx.beginPath();
    ctx.roundRect(x + inset, y + inset, size * scale, size * scale, radius);
    ctx.fill();

    // A light band across the top is the whole of the moulded-plastic read.
    ctx.fillStyle = "rgba(255, 255, 255, 0.26)";
    ctx.beginPath();
    ctx.roundRect(
      x + inset + size * 0.1 * scale,
      y + inset + size * 0.08 * scale,
      size * 0.8 * scale,
      size * 0.16 * scale,
      size * 0.08 * scale,
    );
    ctx.fill();

    ctx.fillStyle = step.ink;
    // Long numbers have to shrink or 131072 runs past the tile edge.
    const digits = String(value).length;
    ctx.font = `700 ${Math.round((size * scale) / Math.max(2.1, digits * 0.72))}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(value), x + size / 2, y + size / 2 + 1);
  }

  function render() {
    const box = fitCanvas(canvas, ctx);
    // The board is square; take the smaller side so a box constrained by
    // height (phones cap it) letterboxes instead of overflowing.
    const width = Math.min(box.width, box.height);
    const originX = (box.width - width) / 2;
    const originY = (box.height - width) / 2;
    const gap = Math.max(5, width * 0.022);
    const cell = (width - gap * (SIZE + 1)) / SIZE;
    const at = (index) => ({
      x: originX + gap + (index % SIZE) * (cell + gap),
      y: originY + gap + Math.floor(index / SIZE) * (cell + gap),
    });

    ctx.clearRect(0, 0, box.width, box.height);
    ctx.fillStyle = "#1d1614";
    ctx.beginPath();
    ctx.roundRect(originX, originY, width, width, width * 0.05);
    ctx.fill();

    for (let index = 0; index < SIZE * SIZE; index += 1) {
      const { x, y } = at(index);
      ctx.fillStyle = "#302724";
      ctx.beginPath();
      ctx.roundRect(x, y, cell, cell, cell * 0.16);
      ctx.fill();
    }

    const progress = Math.min(animationTime / SLIDE_DURATION, 1);
    if (progress < 1) {
      // Mid-slide: draw only the travellers, at their interpolated positions.
      // The settled grid stays hidden until they arrive, so a merged pair is
      // never drawn on top of its own result.
      const eased = 1 - (1 - progress) ** 3;
      animating.forEach(({ from, to, value }) => {
        const start = at(from);
        const end = at(to);
        drawTile(
          start.x + (end.x - start.x) * eased,
          start.y + (end.y - start.y) * eased,
          cell,
          value,
        );
      });
      return;
    }

    grid.forEach((value, index) => {
      if (!value) return;
      const { x, y } = at(index);
      // Freshly merged and freshly spawned tiles pop for the frame after landing.
      const pop =
        popping.has(index) && !reduceMotion
          ? 1 +
            0.12 * (1 - Math.min((animationTime - SLIDE_DURATION) / 0.09, 1))
          : 1;
      drawTile(x, y, cell, value, Math.min(pop, 1.1));
    });
  }

  const loop = createLoop({
    update: (dt) => {
      animationTime += dt;
    },
    render,
  });
  loop.start();

  return {
    destroy() {
      loop.stop();
      releaseKeys();
      releaseSwipe();
      root.remove();
    },
  };
}
