/**
 * Flapper - hold altitude through a gap in the columns.
 *
 * A flappy-style game with its own name and its own art: the player is a
 * glowing orb with a trail, drawn entirely from canvas primitives, and the
 * obstacles are neon columns rather than pipes. The mechanic is the genre's;
 * nothing here borrows another game's identity.
 *
 * `overlaps` is pure and exported so the collision geometry can be tested
 * without a canvas - it is the one piece where an off-by-one is invisible on
 * screen but decides whether a run was fair.
 */

import { fitCanvas, createLoop, prefersReducedMotion } from "./engine.js";
import { bindKeys, bindSwipe } from "./input.js";

export const meta = {
  id: "flapper",
  name: "Flapper",
  tagline: "One button. Mind the gap.",
  controls: "Space, click, or tap to flap",
};

/**
 * The world is simulated in a fixed 400x600 coordinate space and scaled to
 * whatever the canvas is. Tuning gravity against a variable pixel height would
 * mean the game is harder on a tall phone than a short laptop window.
 */
export const WORLD = { width: 400, height: 600 };

const GRAVITY = 1250;
const FLAP_VELOCITY = -390;
const SCROLL_SPEED = 165;
export const COLUMN_WIDTH = 62;
const COLUMN_SPACING = 210;
export const GAP_HEIGHT = 168;
/** Keeps a gap from opening flush against the ceiling or floor. */
const GAP_MARGIN = 70;
const ORB_RADIUS = 13;
const ORB_X = 110;

/** Axis-aligned overlap between the orb's bounding box and a rectangle. */
export function overlaps(orb, rect) {
  return (
    orb.x + orb.r > rect.x &&
    orb.x - orb.r < rect.x + rect.width &&
    orb.y + orb.r > rect.y &&
    orb.y - orb.r < rect.y + rect.height
  );
}

/** The two rectangles a column occupies, above and below its gap. */
export function columnRects(column) {
  return [
    { x: column.x, y: 0, width: COLUMN_WIDTH, height: column.gapY },
    {
      x: column.x,
      y: column.gapY + GAP_HEIGHT,
      width: COLUMN_WIDTH,
      height: WORLD.height - (column.gapY + GAP_HEIGHT),
    },
  ];
}

export function makeColumn(x, random = Math.random) {
  const span = WORLD.height - GAP_HEIGHT - GAP_MARGIN * 2;
  return { x, gapY: GAP_MARGIN + random() * span, passed: false };
}

export function create({ mount, api }) {
  const reduceMotion = prefersReducedMotion();

  const root = document.createElement("div");
  root.className = "game game--flapper";
  root.innerHTML = `
    <canvas class="game-canvas game-canvas--portrait"></canvas>
    <p class="game-hint" data-role="hint">Tap, click or press Space to flap</p>`;
  mount.append(root);

  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const hint = root.querySelector('[data-role="hint"]');

  let orb = { x: ORB_X, y: WORLD.height / 2, r: ORB_RADIUS, velocity: 0 };
  let columns = [];
  let trail = [];
  let score = 0;
  let started = false;
  let finished = false;
  let groundOffset = 0;

  for (let i = 0; i < 4; i += 1) {
    columns.push(makeColumn(WORLD.width + 60 + i * COLUMN_SPACING));
  }

  function flap() {
    if (finished) return;
    if (!started) {
      started = true;
      hint.hidden = true;
    }
    orb.velocity = FLAP_VELOCITY;
    api.audio.blip(7);
  }

  function end() {
    finished = true;
    api.audio.gameOver();
    api.gameOver(score);
  }

  const releaseKeys = bindKeys({
    " ": { run: flap, ignoreRepeat: true },
    ArrowUp: flap,
    w: flap,
  });
  const releaseSwipe = bindSwipe(canvas, { onTap: flap, onSwipe: flap });

  function update(dt) {
    if (finished) return;

    // Before the first flap the orb hovers: a run should not be lost to
    // gravity that started before the player did.
    if (!started) {
      orb.y =
        WORLD.height / 2 +
        Math.sin(performance.now() / 320) * (reduceMotion ? 0 : 8);
      return;
    }

    orb.velocity += GRAVITY * dt;
    orb.y += orb.velocity * dt;
    groundOffset = (groundOffset + SCROLL_SPEED * dt) % 40;

    if (!reduceMotion) {
      trail.unshift({ x: orb.x, y: orb.y });
      trail = trail.slice(0, 12);
    }

    columns.forEach((column) => {
      column.x -= SCROLL_SPEED * dt;
      if (!column.passed && column.x + COLUMN_WIDTH < orb.x - orb.r) {
        column.passed = true;
        score += 1;
        api.setScore(score);
        api.audio.blip(Math.min(score, 12));
      }
    });

    // Recycle rather than allocate: a column that leaves on the left comes
    // back on the right, so the array stays four long for the whole run.
    if (columns[0].x + COLUMN_WIDTH < -20) {
      const last = columns[columns.length - 1];
      columns.shift();
      columns.push(makeColumn(last.x + COLUMN_SPACING));
    }

    // The ceiling only stops the orb - every column reaches down from it, so
    // hugging the roof still has to be paid for at the next gap. The floor is
    // fatal, because nothing else would stop a player resting on it.
    if (orb.y - orb.r <= 0) {
      orb.y = orb.r;
      orb.velocity = 0;
    }
    if (orb.y + orb.r >= WORLD.height - 24) {
      end();
      return;
    }
    for (const column of columns) {
      if (columnRects(column).some((rect) => overlaps(orb, rect))) {
        end();
        return;
      }
    }
  }

  function render() {
    const { width, height } = fitCanvas(canvas, ctx);
    const scale = Math.min(width / WORLD.width, height / WORLD.height);
    const offsetX = (width - WORLD.width * scale) / 2;
    const offsetY = (height - WORLD.height * scale) / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    const sky = ctx.createLinearGradient(0, 0, 0, WORLD.height);
    sky.addColorStop(0, "#120b2e");
    sky.addColorStop(1, "#06202e");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    columns.forEach((column) => {
      columnRects(column).forEach((rect) => {
        ctx.fillStyle = "#1b6f7d";
        ctx.beginPath();
        ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 5);
        ctx.fill();
        ctx.fillStyle = "#2ee6c5";
        // Lip on the gap-facing end, so the hazard boundary is unambiguous.
        const lipY = rect.y === 0 ? rect.height - 14 : rect.y;
        ctx.beginPath();
        ctx.roundRect(rect.x - 4, lipY, rect.width + 8, 14, 4);
        ctx.fill();
      });
    });

    ctx.fillStyle = "#0b1720";
    ctx.fillRect(0, WORLD.height - 24, WORLD.width, 24);
    ctx.fillStyle = "#2ee6c5";
    for (let x = -groundOffset; x < WORLD.width; x += 40) {
      ctx.fillRect(x, WORLD.height - 24, 20, 3);
    }

    trail.forEach((point, i) => {
      ctx.globalAlpha = (1 - i / trail.length) * 0.32;
      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.arc(
        point.x,
        point.y,
        ORB_RADIUS * (1 - i / trail.length) * 0.8,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, ORB_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    ctx.beginPath();
    ctx.arc(orb.x - 4, orb.y - 4, ORB_RADIUS * 0.34, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  const loop = createLoop({ update, render });
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
