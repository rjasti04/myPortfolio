/**
 * Stack - drop a sliding block onto the tower without overhang.
 *
 * Flat 2D side view: blocks travel left and right above the tower, a drop
 * trims whatever hangs past the block below, and the trimmed width is what the
 * next block inherits. Miss entirely, or shrink past the point where a block
 * can land, and the run ends. A run of perfect drops walks up a pentatonic
 * scale and slowly gives width back, which is the only way a long run stays
 * survivable.
 *
 * `place()` holds all of that geometry and is pure, so the awkward cases -
 * exact-edge contact, a perfect drop inside the snap tolerance, an overhang on
 * either side - are covered by tests rather than by eye.
 */

import { fitCanvas, createLoop, prefersReducedMotion } from "./engine.js";
import { bindKeys, bindSwipe } from "./input.js";

export const meta = {
  id: "stack",
  name: "Stack",
  tagline: "Trim the overhang. Perfect drops give width back.",
  controls: "Space, click, or tap to drop",
};

const WORLD = { width: 360, height: 560 };
const BLOCK_HEIGHT = 26;
const BASE_WIDTH = 168;
/** Within this many units of a clean edge counts as perfect and snaps flush. */
export const PERFECT_TOLERANCE = 4;
/** Below this the block can no longer be landed on, which ends the run. */
export const MIN_WIDTH = 9;
/** Width handed back per perfect once the streak reward kicks in. */
const PERFECT_REWARD = 6;
const REWARD_AFTER = 3;

/**
 * Resolve a drop.
 *
 * `base` is the block below, `moving` the one being dropped; both are
 * `{ x, width }`. Returns the block that survives, the offcut to animate away,
 * and whether the drop was perfect or missed entirely.
 */
export function place(base, moving, tolerance = PERFECT_TOLERANCE) {
  const delta = moving.x - base.x;

  // A near-miss snaps flush rather than shaving a sliver off. Without the
  // tolerance, "perfect" would be unreachable on a touchscreen and the reward
  // that keeps long runs alive would be dead code.
  if (Math.abs(delta) <= tolerance) {
    return {
      x: base.x,
      width: base.width,
      sliced: null,
      perfect: true,
      missed: false,
    };
  }

  const left = Math.max(base.x, moving.x);
  const right = Math.min(base.x + base.width, moving.x + moving.width);
  const width = right - left;

  if (width <= 0) {
    return {
      x: moving.x,
      width: 0,
      sliced: { ...moving },
      perfect: false,
      missed: true,
    };
  }

  const sliced =
    delta > 0
      ? { x: right, width: moving.x + moving.width - right }
      : { x: moving.x, width: left - moving.x };

  return { x: left, width, sliced, perfect: false, missed: false };
}

/** Horizontal travel speed, in world units per second, at a given height. */
export const speedFor = (height) => Math.min(320, 108 + height * 3.6);

export function create({ mount, api }) {
  const reduceMotion = prefersReducedMotion();

  const root = document.createElement("div");
  root.className = "game game--stack";
  root.innerHTML = `
    <canvas class="game-canvas game-canvas--portrait"></canvas>
    <p class="game-hint" data-role="hint">Tap, click or press Space to drop</p>`;
  mount.append(root);

  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const hint = root.querySelector('[data-role="hint"]');

  const tower = [{ x: (WORLD.width - BASE_WIDTH) / 2, width: BASE_WIDTH }];
  let moving = null;
  let debris = [];
  let score = 0;
  let streak = 0;
  let finished = false;
  let started = false;
  let cameraY = 0;
  let flash = 0;

  /** Hue walks with height, so the tower reads as a gradient as it climbs. */
  const hueAt = (index) => (188 + index * 7) % 360;

  function nextBlock() {
    const previous = tower[tower.length - 1];
    // Alternate the entry side so the rhythm does not become memorisable.
    const fromLeft = tower.length % 2 === 0;
    moving = {
      x: fromLeft ? 0 : WORLD.width - previous.width,
      width: previous.width,
      direction: fromLeft ? 1 : -1,
    };
  }

  function drop() {
    if (finished || !moving) return;
    if (!started) {
      started = true;
      hint.hidden = true;
    }

    const base = tower[tower.length - 1];
    const result = place(base, moving);

    if (result.missed) {
      debris.push({ ...result.sliced, y: tower.length, velocity: 0, spin: 0 });
      finished = true;
      moving = null;
      api.audio.gameOver();
      api.gameOver(score);
      return;
    }

    if (result.perfect) {
      streak += 1;
      api.audio.perfect(streak - 1);
      if (!reduceMotion) flash = 0.22;
      // The reward is deliberately slow and capped: it should extend a good
      // run, not undo the trimming that makes the game a game.
      if (streak >= REWARD_AFTER) {
        result.width = Math.min(BASE_WIDTH, result.width + PERFECT_REWARD);
        result.x = Math.max(
          0,
          Math.min(WORLD.width - result.width, result.x - PERFECT_REWARD / 2),
        );
      }
    } else {
      streak = 0;
      api.audio.blip(-2);
      debris.push({
        ...result.sliced,
        y: tower.length,
        velocity: 0,
        spin: (Math.random() - 0.5) * 3,
      });
    }

    tower.push({ x: result.x, width: result.width });
    score += result.perfect ? 2 : 1;
    api.setScore(score);

    if (result.width < MIN_WIDTH) {
      finished = true;
      moving = null;
      api.audio.gameOver();
      api.gameOver(score);
      return;
    }

    nextBlock();
  }

  const releaseKeys = bindKeys({
    " ": { run: drop, ignoreRepeat: true },
    ArrowDown: drop,
    Enter: drop,
    s: drop,
  });
  const releaseSwipe = bindSwipe(canvas, { onTap: drop, onSwipe: drop });

  nextBlock();

  function update(dt) {
    if (flash > 0) flash = Math.max(0, flash - dt);

    debris.forEach((piece) => {
      piece.velocity += 900 * dt;
      piece.y -= (piece.velocity * dt) / BLOCK_HEIGHT;
      piece.spin *= 0.99;
    });
    debris = debris.filter((piece) => piece.y > -6);

    if (finished || !moving) return;

    const speed = speedFor(tower.length);
    moving.x += moving.direction * speed * dt;

    // Bounce off both walls, clamping first so a long frame cannot leave the
    // block outside the world and then immediately reverse it back out again.
    if (moving.x <= 0) {
      moving.x = 0;
      moving.direction = 1;
    } else if (moving.x + moving.width >= WORLD.width) {
      moving.x = WORLD.width - moving.width;
      moving.direction = -1;
    }
  }

  function drawBlock(x, rowFromTop, width, hue, alpha = 1, spin = 0) {
    const y = WORLD.height - 60 - rowFromTop * BLOCK_HEIGHT;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (spin) {
      ctx.translate(x + width / 2, y + BLOCK_HEIGHT / 2);
      ctx.rotate(spin);
      ctx.translate(-(x + width / 2), -(y + BLOCK_HEIGHT / 2));
    }
    ctx.fillStyle = `hsl(${hue}, 72%, 58%)`;
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(width, 1), BLOCK_HEIGHT - 3, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
    ctx.fillRect(x + 2, y + 2, Math.max(width - 4, 1), 4);
    ctx.restore();
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
    sky.addColorStop(0, "#14082b");
    sky.addColorStop(1, "#04121f");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    if (flash > 0) {
      ctx.fillStyle = `rgba(46, 230, 197, ${(flash / 0.22) * 0.16})`;
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    }

    // The camera keeps the working row at a constant height, so the tower
    // scrolls past instead of running off the top of the canvas.
    const target = Math.max(0, tower.length - 12);
    cameraY += (target - cameraY) * (reduceMotion ? 1 : 0.16);

    const rowOf = (index) => index - cameraY;

    tower.forEach((block, index) => {
      const row = rowOf(index);
      if (row < -2 || row > 24) return;
      drawBlock(block.x, row, block.width, hueAt(index));
    });

    debris.forEach((piece) => {
      drawBlock(
        piece.x,
        rowOf(piece.y),
        piece.width,
        hueAt(Math.round(piece.y)),
        0.65,
        piece.spin,
      );
    });

    if (moving) {
      drawBlock(
        moving.x,
        rowOf(tower.length),
        moving.width,
        hueAt(tower.length),
      );
    }

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
