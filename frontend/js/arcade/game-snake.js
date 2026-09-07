/**
 * Snake - eat, grow, and stay out of your own way.
 *
 * The fifth game, and the one the other four leave room for: 2048 is a puzzle,
 * Tetris is placement under gravity, Flapper and Stack are timing. Snake is the
 * only one where the hazard is the trail you left behind, so the board gets
 * harder because of what you did rather than because a counter went up.
 *
 * Three rules carry the whole game and all three are pure and exported, so the
 * cases that are invisible on screen are covered by tests rather than by eye:
 *
 *   `step`       - the tail vacates its cell on the same tick the head enters,
 *                  so chasing your own tail is legal. Resolving the collision
 *                  against the body *before* the tail moves is the classic
 *                  version of this bug: a run that ends on a move that was
 *                  never fatal.
 *   `isReversal` - a turn back through the neck would kill instantly, so it is
 *                  refused rather than obeyed. Queuing turns (below) is what
 *                  makes this necessary: two fast presses inside one tick would
 *                  otherwise resolve as right-then-left.
 *   `spawnFood`  - picks from the list of free cells rather than guessing at
 *                  random cells until one is free. Rejection sampling is fine
 *                  at the start and pathological at the end, where the last
 *                  free cell of 289 would take hundreds of guesses to hit.
 */

import { fitCanvas, createLoop, prefersReducedMotion } from "./engine.js";
import { bindKeys, bindSwipe } from "./input.js";

export const meta = {
  id: "snake",
  name: "Snake",
  tagline: "Eat, grow, and stay out of your own way.",
  controls: "Arrow keys, WASD, or swipe",
};

export const COLUMNS = 17;
export const ROWS = 17;
const CELL = 24;
const WORLD = { width: COLUMNS * CELL, height: ROWS * CELL };

export const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Seconds per tick. Fast enough to stay tense, floored so it stays playable. */
export function tickFor(eaten) {
  return Math.max(0.075, 0.185 - eaten * 0.0055);
}

/** Three segments, mid-board, already heading right - see `create` for why. */
export const startBody = () => [
  { x: 9, y: 8 },
  { x: 8, y: 8 },
  { x: 7, y: 8 },
];

/** True when `next` would send the head straight back through the neck. */
export function isReversal(current, next) {
  return current.x + next.x === 0 && current.y + next.y === 0;
}

const sameCell = (a, b) => a.x === b.x && a.y === b.y;

/** Every cell the snake is not on. The list `spawnFood` picks from. */
export function freeCells(body) {
  const taken = new Set(body.map((cell) => `${cell.x},${cell.y}`));
  const free = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLUMNS; x += 1) {
      if (!taken.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  return free;
}

/** A free cell, or null once the snake covers the board - which is the win. */
export function spawnFood(body, random = Math.random) {
  const free = freeCells(body);
  if (!free.length) return null;
  return free[Math.floor(random() * free.length)];
}

/**
 * Advance one tick.
 *
 * Returns the body that results, whether the food was taken, and whether the
 * run ended. The order matters: the tail is removed first when nothing was
 * eaten, and the head is tested against what is left. That is what makes
 * following your own tail legal, which is most of what skilled play looks like.
 */
export function step(body, direction, food) {
  const head = {
    x: body[0].x + direction.x,
    y: body[0].y + direction.y,
  };
  const ate = Boolean(food) && sameCell(head, food);
  const kept = ate ? body : body.slice(0, -1);
  const dead =
    head.x < 0 ||
    head.y < 0 ||
    head.x >= COLUMNS ||
    head.y >= ROWS ||
    kept.some((cell) => sameCell(cell, head));

  return { body: [head, ...kept], ate, dead };
}

export function create({ mount, api }) {
  const reduceMotion = prefersReducedMotion();

  const root = document.createElement("div");
  root.className = "game game--snake";
  root.innerHTML = `
    <canvas class="game-canvas game-canvas--square"></canvas>
    <p class="game-hint" data-role="hint">Swipe or press an arrow key to set off</p>`;
  mount.append(root);

  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const hint = root.querySelector('[data-role="hint"]');

  let body = startBody();
  // Where each segment sat on the previous tick. Movement is one whole cell at
  // a time, and at four ticks a second that reads as a stutter unless the
  // render interpolates between the two.
  let previous = body;
  let direction = DIRECTIONS.right;
  /* Turns are queued rather than applied on the spot. A player rounding a
     corner presses two keys well inside one tick, and applying the second
     immediately would either be swallowed or turn the snake through itself. At
     most two are held: a third press is a mistake, not an intention. */
  let queued = [];
  let food = spawnFood(body);
  let timer = 0;
  let score = 0;
  let started = false;
  let finished = false;
  let flash = 0;

  /** The direction a new turn is judged against: the last one already queued. */
  const pending = () => queued[queued.length - 1] ?? direction;

  function turn(next) {
    if (finished) return;
    if (!started) {
      started = true;
      hint.hidden = true;
      // The clock only starts once the player has, so a run is never lost to
      // the seconds spent working out which way is which.
      timer = 0;
    }
    const from = pending();
    if (sameCell(from, next) || isReversal(from, next)) return;
    if (queued.length < 2) queued.push(next);
  }

  function end(won = false) {
    finished = true;
    if (won) api.audio.fanfare();
    else api.audio.gameOver();
    api.gameOver(score);
  }

  function tick() {
    if (queued.length) direction = queued.shift();

    const result = step(body, direction, food);
    previous = body;
    body = result.body;

    if (result.dead) {
      if (!reduceMotion) flash = 0.3;
      end();
      return;
    }

    if (result.ate) {
      score += 1;
      api.setScore(score);
      // Milestones get the flourish; every other bite gets a note that climbs
      // with the score, so a long run is audibly a long run.
      if (score % 5 === 0) api.audio.fanfare();
      else api.audio.blip(Math.min(score, 12));
      if (!reduceMotion) flash = 0.16;

      food = spawnFood(body);
      // No free cell left means the snake covers the board. There is nothing
      // further to do, so the run ends on a win rather than on a wall.
      if (!food) end(true);
    }
  }

  const turnTo = (name) => () => turn(DIRECTIONS[name]);
  const releaseKeys = bindKeys({
    ArrowUp: turnTo("up"),
    ArrowDown: turnTo("down"),
    ArrowLeft: turnTo("left"),
    ArrowRight: turnTo("right"),
    w: turnTo("up"),
    s: turnTo("down"),
    a: turnTo("left"),
    d: turnTo("right"),
  });
  const releaseSwipe = bindSwipe(canvas, {
    onSwipe: (name) => turn(DIRECTIONS[name]),
  });

  function update(dt) {
    if (flash > 0) flash = Math.max(0, flash - dt);
    if (finished || !started) return;

    timer += dt;
    const length = tickFor(score);
    // A `while` rather than an `if`: the loop hands out fixed steps, and a
    // slow frame can cover more than one tick at the top speed.
    while (!finished && timer >= length) {
      timer -= length;
      tick();
    }
  }

  /** Head hue first, walking towards cyan down the body. */
  const hueAt = (index) => 88 + Math.min(index * 4, 96);

  function cellRect(index, t) {
    const to = body[index];
    const from = previous[index] ?? to;
    return {
      x: (from.x + (to.x - from.x) * t) * CELL,
      y: (from.y + (to.y - from.y) * t) * CELL,
    };
  }

  function drawEyes(x, y) {
    // Set into the leading face, so the head reads as facing where it is going
    // even when the body behind it is a straight line.
    const cx = x + CELL / 2 + direction.x * 4;
    const cy = y + CELL / 2 + direction.y * 4;
    const across = { x: direction.y, y: direction.x };

    ctx.fillStyle = "#15102e";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(
        cx + across.x * side * 4.5,
        cy + across.y * side * 4.5,
        2.4,
        0,
        Math.PI * 2,
      );
      ctx.fill();
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

    /* Nothing is painted past the world here, and that is the difference
       between this game and the other three that scale a fixed world into
       whatever box the layout hands them. Flapper and Stack bleed their sky to
       the canvas corners so a tall phone does not letterbox them - they can,
       because their hazards are drawn objects. Snake's hazard is the edge of
       the board itself, so a field that carried on past the last row would be
       painting open ground over a wall that kills. The board stops where it
       stops, and the panel behind it shows through. */
    ctx.beginPath();
    ctx.roundRect(0, 0, WORLD.width, WORLD.height, 14);
    ctx.save();
    ctx.clip();

    const field = ctx.createLinearGradient(0, 0, 0, WORLD.height);
    field.addColorStop(0, "#2c1c56");
    field.addColorStop(1, "#151033");
    ctx.fillStyle = field;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    // A checkerboard rather than grid lines: it says where the cells are
    // without drawing a cage around the board.
    ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = y % 2; x < COLUMNS; x += 2) {
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }

    if (flash > 0) {
      ctx.fillStyle = `rgba(255, 233, 150, ${(flash / 0.3) * 0.2})`;
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    }

    if (food) {
      const pulse = reduceMotion ? 0 : Math.sin(performance.now() / 220) * 1.6;
      const r = CELL / 2 - 4 + pulse;
      const cx = food.x * CELL + CELL / 2;
      const cy = food.y * CELL + CELL / 2;
      ctx.fillStyle = "rgba(255, 95, 156, 0.35)";
      ctx.beginPath();
      ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffc933";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      ctx.beginPath();
      ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }

    /* The clip comes off before the snake is drawn. Every cell of a live snake
       is inside the board anyway, and the one that is not is the head of the
       run that just ended - showing it over the wall it hit is the clearest
       statement of what happened. */
    ctx.restore();

    const length = tickFor(score);
    const t =
      finished || !started || reduceMotion ? 1 : Math.min(timer / length, 1);

    // Back to front, so each segment's rounded corners sit under the one ahead
    // of it and the body reads as one piece rather than a row of tiles.
    for (let i = body.length - 1; i >= 0; i -= 1) {
      const { x, y } = cellRect(i, t);
      const inset = i === 0 ? 1 : 2;
      // The head is lighter than the body it leads: at three segments the hue
      // walk has not yet separated them, and knowing which end is which is the
      // one thing the player cannot afford to work out late.
      const lightness = i === 0 ? 68 : 56;
      ctx.fillStyle =
        finished && i === 0
          ? "#ff5f9c"
          : `hsl(${hueAt(i)}, 78%, ${lightness}%)`;
      ctx.beginPath();
      ctx.roundRect(
        x + inset,
        y + inset,
        CELL - inset * 2,
        CELL - inset * 2,
        i === 0 ? 9 : 7,
      );
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
      ctx.beginPath();
      ctx.roundRect(x + inset + 3, y + inset + 2, CELL - inset * 2 - 6, 4, 2);
      ctx.fill();
      if (i === 0) drawEyes(x, y);
    }

    // The wall last, over everything: the one line on this board a player has
    // to be able to find at a glance.
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(176, 108, 240, 0.85)";
    ctx.beginPath();
    ctx.roundRect(1.5, 1.5, WORLD.width - 3, WORLD.height - 3, 13);
    ctx.stroke();

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
