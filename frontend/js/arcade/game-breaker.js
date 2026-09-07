/**
 * Breaker - clear the wall, and choose the angle while you do it.
 *
 * The sixth game, and the one the other five leave room for. 2048 is a puzzle,
 * Tetris is placement under gravity, Flapper and Stack are timing, Snake is
 * the trail you left behind. Breaker is the only one where the player aims:
 * where the ball lands on the paddle decides where it goes next, so a run is
 * steered rather than survived.
 *
 * A brick-breaker's mechanic with its own name and its own canvas-drawn art,
 * the way Flapper is a flappy-style game rather than a copy of one.
 *
 * Three rules carry it, and all three are pure and exported, because each is a
 * case that is invisible on screen and decides whether a run was fair:
 *
 *   `contactAxis`  - which axis a hit reflects on. Reflecting both is what
 *                    makes a ball bounce back the way it came off a brick's
 *                    corner; picking by position rather than by how deep the
 *                    ball is on each axis is what makes it pass through one.
 *   `paddleBounce` - the aim. The angle comes from where on the paddle the
 *                    ball struck, and it is capped well short of horizontal:
 *                    an uncapped deflection lets the ball leave along the row
 *                    it is meant to be breaking and ping there until the run
 *                    is abandoned.
 *   `sliceCount`   - how finely a frame's travel has to be resolved. A ball
 *                    that covers more than its own radius between two tests
 *                    can be past a brick before anything looks at that brick,
 *                    and at the speed cap a whole 1/60 frame already is.
 */

import { fitCanvas, createLoop, prefersReducedMotion } from "./engine.js";
import { bindKeys, bindSwipe, bindPointerTrack } from "./input.js";

export const meta = {
  id: "breaker",
  name: "Breaker",
  tagline: "Clear the wall. The angle is yours to pick.",
  controls: "Arrow keys, drag, or tap to serve",
};

/**
 * Simulated in a fixed 400x600 space and scaled to the canvas, for the reason
 * Flapper is: tuning a bounce against a variable pixel height would make the
 * game a different game on a tall phone than on a short laptop window.
 */
export const WORLD = { width: 400, height: 600 };

export const COLUMNS = 8;
export const ROWS = 6;
const WALL_TOP = 92;
const BRICK_HEIGHT = 22;
const BRICK_WIDTH = WORLD.width / COLUMNS;
/** Trimmed off each brick when drawing, so the wall reads as bricks not a slab. */
const BRICK_INSET = 3;

const PADDLE_HEIGHT = 13;
const PADDLE_Y = WORLD.height - 46;
const PADDLE_WIDTH = 84;
/** Taken off the paddle per wall cleared, and the width it never goes below. */
const PADDLE_SHRINK = 8;
const PADDLE_MIN_WIDTH = 52;
/** World units per second the keys steer at; a drag is absolute, not a speed. */
const PADDLE_SPEED = 520;

export const BALL_RADIUS = 7;
const BASE_SPEED = 290;
export const MAX_SPEED = 520;
export const LIVES = 3;

/** Top rows are worth more, which is the whole reason to dig a channel up one side. */
const ROW_POINTS = [7, 6, 5, 3, 2, 1];
/** Row colours, the page's own palette top to bottom. */
const ROW_COLOURS = [
  "#ff5f9c",
  "#ff8a3d",
  "#ffc933",
  "#a5d94a",
  "#2fd6c4",
  "#56cbf5",
];

/**
 * How far from straight up the paddle can throw the ball, in radians.
 *
 * Just under 60 degrees. The cap is the rule, not the number: at 90 the tip of
 * the paddle returns the ball horizontally, and a horizontal ball inside a
 * gap in the wall bounces wall to wall without ever coming back down. That is
 * a run that cannot be lost or won, which is worse than a run that is lost.
 */
export const MAX_BOUNCE_ANGLE = 1.02;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Ball speed after `broken` bricks. Climbs across walls, then holds. */
export function speedFor(broken) {
  return Math.min(MAX_SPEED, BASE_SPEED + broken * 2.2);
}

/**
 * How many pieces a frame's travel is resolved in.
 *
 * Collision here is a test at a position, not a swept volume, so anything that
 * moves further than the ball is wide between two tests can cross a brick
 * without ever being inside it - the ball leaves through the wall and the run
 * carries on with a ball that cannot come back. At the speed cap a whole 1/60
 * frame is already further than a radius, so this is load-bearing rather than
 * defensive, and it stays correct if the cap or the ball's size ever moves.
 */
export function sliceCount(speed, dt, radius = BALL_RADIUS) {
  return Math.max(1, Math.ceil((speed * dt) / radius));
}

/** Keeps a paddle of this width inside the world, whatever asked to move it. */
export const clampPaddle = (x, width) => clamp(x, 0, WORLD.width - width);

/** A full wall: `ROWS` x `COLUMNS` bricks, laid out in world coordinates. */
export function buildWall() {
  const bricks = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      bricks.push({
        x: column * BRICK_WIDTH,
        y: WALL_TOP + row * BRICK_HEIGHT,
        width: BRICK_WIDTH,
        height: BRICK_HEIGHT,
        row,
      });
    }
  }
  return bricks;
}

/**
 * Which axis a ball/rectangle contact reflects on, or null for no contact.
 *
 * The ball is treated as its bounding box and the axis is chosen by which one
 * it is *less* deep on - that axis is the one it came in through. Deciding by
 * the ball's position relative to the brick instead gets a ball that clipped a
 * brick's underside from the left exactly backwards.
 *
 * Overlap is strict, so a ball grazing an edge has not hit it; that is the
 * same rule Flapper's columns use, and for the same reason - a run should not
 * end, or a brick fall, on contact the player cannot see.
 *
 * An exact corner resolves vertically. The wall's bricks are three times wider
 * than they are tall, so the horizontal reading of a corner is the one that
 * sends the ball off along the row it just hit.
 */
export function contactAxis(ball, rect) {
  const depthX =
    ball.r + rect.width / 2 - Math.abs(ball.x - (rect.x + rect.width / 2));
  const depthY =
    ball.r + rect.height / 2 - Math.abs(ball.y - (rect.y + rect.height / 2));
  if (depthX <= 0 || depthY <= 0) return null;
  return depthX < depthY ? "x" : "y";
}

/**
 * The velocity a ball leaves the paddle with.
 *
 * Speed is carried through unchanged and the direction is where the ball
 * struck: the middle sends it straight back up, the tips send it out at
 * `MAX_BOUNCE_ANGLE`. Reflecting the ball's own `vy` instead - the obvious
 * implementation - is a game with no aim in it at all, because the ball then
 * leaves at whatever angle it arrived and the paddle is a wall.
 */
export function paddleBounce(ball, paddle) {
  const speed = Math.hypot(ball.vx, ball.vy);
  const centre = paddle.x + paddle.width / 2;
  // -1 at the left tip, +1 at the right.
  const offset = clamp((ball.x - centre) / (paddle.width / 2), -1, 1);
  const angle = offset * MAX_BOUNCE_ANGLE;
  // cos is positive across the whole capped range, so `vy` is always upward -
  // there is no input to this that returns the ball into the floor.
  return { vx: Math.sin(angle) * speed, vy: -Math.cos(angle) * speed };
}

export function create({ mount, api }) {
  const reduceMotion = prefersReducedMotion();

  const root = document.createElement("div");
  root.className = "game game--breaker";
  root.innerHTML = `
    <canvas class="game-canvas game-canvas--portrait"></canvas>
    <p class="game-hint" data-role="hint">Tap, click or press Space to serve</p>`;
  mount.append(root);

  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const hint = root.querySelector('[data-role="hint"]');

  let bricks = buildWall();
  let paddle = {
    x: (WORLD.width - PADDLE_WIDTH) / 2,
    y: PADDLE_Y,
    width: PADDLE_WIDTH,
    height: PADDLE_HEIGHT,
  };
  let ball = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_RADIUS };
  let trail = [];
  let score = 0;
  let broken = 0;
  let lives = LIVES;
  /** -1, 0 or 1 from the keys. A drag sets the paddle outright and clears it. */
  let steer = 0;
  let served = false;
  let finished = false;
  let flash = 0;

  /** Park the ball on the paddle. The serve is the player's, not the clock's. */
  function rest() {
    served = false;
    ball.x = paddle.x + paddle.width / 2;
    ball.y = paddle.y - ball.r - 1;
    ball.vx = 0;
    ball.vy = 0;
    trail = [];
    hint.hidden = false;
  }

  function serve() {
    if (finished || served) return;
    served = true;
    hint.hidden = true;
    // A slight, random lean rather than dead vertical: served straight up, the
    // first wall is cleared from the middle out every single time.
    const angle = (Math.random() - 0.5) * 0.5;
    const speed = speedFor(broken);
    ball.vx = Math.sin(angle) * speed;
    ball.vy = -Math.cos(angle) * speed;
  }

  function end() {
    finished = true;
    api.audio.gameOver();
    api.gameOver(score);
  }

  /** A ball lost past the paddle. The wall stands; only the ball is returned. */
  function loseBall() {
    lives -= 1;
    if (!reduceMotion) flash = 0.3;
    if (lives <= 0) {
      end();
      return;
    }
    api.audio.blip(-9);
    rest();
  }

  function clearedWall() {
    api.audio.fanfare();
    bricks = buildWall();
    // The wall comes back whole, so the pressure has to come from somewhere -
    // a narrower paddle, and the speed `broken` has already bought.
    paddle.width = Math.max(PADDLE_MIN_WIDTH, paddle.width - PADDLE_SHRINK);
    paddle.x = clampPaddle(paddle.x, paddle.width);
    rest();
  }

  function hitBrick(index, axis) {
    const brick = bricks[index];
    if (axis === "x") ball.vx = -ball.vx;
    else ball.vy = -ball.vy;
    // Stepped clear of the brick along the axis it reflected on. Left inside,
    // the next step reads a second contact and reflects straight back in.
    if (axis === "x") {
      ball.x =
        ball.x < brick.x + brick.width / 2
          ? brick.x - ball.r
          : brick.x + brick.width + ball.r;
    } else {
      ball.y =
        ball.y < brick.y + brick.height / 2
          ? brick.y - ball.r
          : brick.y + brick.height + ball.r;
    }

    bricks.splice(index, 1);
    broken += 1;
    score += ROW_POINTS[brick.row];
    api.setScore(score);
    // Pitched by row, so digging upwards is audible as well as visible.
    api.audio.blip((ROWS - brick.row) * 2);
    if (!bricks.length) clearedWall();
  }

  /** One slice of the ball's travel, short enough that nothing is skipped. */
  function advance(dt) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x - ball.r < 0) {
      ball.x = ball.r;
      ball.vx = Math.abs(ball.vx);
    } else if (ball.x + ball.r > WORLD.width) {
      ball.x = WORLD.width - ball.r;
      ball.vx = -Math.abs(ball.vx);
    }
    if (ball.y - ball.r < 0) {
      ball.y = ball.r;
      ball.vy = Math.abs(ball.vy);
    }

    // Only on the way down. A ball climbing out of a contact would otherwise
    // be caught again by the paddle it has already left and driven back in.
    if (ball.vy > 0 && contactAxis(ball, paddle)) {
      const bounced = paddleBounce(ball, paddle);
      ball.vx = bounced.vx;
      ball.vy = bounced.vy;
      ball.y = paddle.y - ball.r;
      api.audio.blip(0);
      return;
    }

    for (let i = 0; i < bricks.length; i += 1) {
      const axis = contactAxis(ball, bricks[i]);
      // One brick per slice: reflecting off two in the same step cancels the
      // first reflection out, and the ball carries on through both.
      if (axis) {
        hitBrick(i, axis);
        return;
      }
    }

    if (ball.y - ball.r > WORLD.height) loseBall();
  }

  function update(dt) {
    if (flash > 0) flash = Math.max(0, flash - dt);
    if (finished) return;

    if (steer) {
      paddle.x = clampPaddle(
        paddle.x + steer * PADDLE_SPEED * dt,
        paddle.width,
      );
    }

    if (!served) {
      // Carried on the paddle, so aiming the serve is aiming the paddle.
      ball.x = paddle.x + paddle.width / 2;
      ball.y = paddle.y - ball.r - 1;
      return;
    }

    // Sliced so no piece of the travel is longer than the ball is wide.
    const speed = Math.hypot(ball.vx, ball.vy);
    const slices = sliceCount(speed, dt, ball.r);
    for (let i = 0; i < slices && served && !finished; i += 1) {
      advance(dt / slices);
    }

    if (!reduceMotion && served) {
      trail.unshift({ x: ball.x, y: ball.y });
      trail.length = Math.min(trail.length, 9);
    }
  }

  const steerTo = (direction) => ({
    run: () => {
      steer = direction;
    },
  });
  const releaseKeys = bindKeys({
    ArrowLeft: steerTo(-1),
    ArrowRight: steerTo(1),
    a: steerTo(-1),
    d: steerTo(1),
    " ": { run: serve, ignoreRepeat: true },
    ArrowUp: serve,
    Enter: serve,
  });

  /* Keys set a direction rather than a position, so something has to clear it.
     Bound here rather than in `bindKeys`, which is a keydown map by design:
     one game needing key-up is not a reason for every game to grow one. */
  const onKeyUp = (event) => {
    if (
      (steer < 0 && (event.key === "ArrowLeft" || event.key === "a")) ||
      (steer > 0 && (event.key === "ArrowRight" || event.key === "d"))
    ) {
      steer = 0;
    }
  };
  window.addEventListener("keyup", onKeyUp);

  const releasePointer = bindPointerTrack(canvas, (across) => {
    // A pointer is an absolute position, so it wins outright over a held key
    // rather than fighting it for the same pixel.
    steer = 0;
    paddle.x = clampPaddle(
      across * WORLD.width - paddle.width / 2,
      paddle.width,
    );
  });
  const releaseSwipe = bindSwipe(canvas, { onTap: serve, onSwipe: serve });

  rest();

  function drawRounded(x, y, width, height, radius, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
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

    /* Clipped to the world rather than bled to the canvas corners, the way
       Snake is and for the same reason: three of the four edges here are
       surfaces the ball bounces off, so a field painted past them would be
       showing open ground where there is a wall. */
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, WORLD.width, WORLD.height, 14);
    ctx.clip();

    const field = ctx.createLinearGradient(0, 0, 0, WORLD.height);
    field.addColorStop(0, "#241a4e");
    field.addColorStop(1, "#12102e");
    ctx.fillStyle = field;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    if (flash > 0) {
      ctx.fillStyle = `rgba(255, 95, 156, ${(flash / 0.3) * 0.26})`;
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    }

    for (const brick of bricks) {
      drawRounded(
        brick.x + BRICK_INSET,
        brick.y + BRICK_INSET,
        brick.width - BRICK_INSET * 2,
        brick.height - BRICK_INSET * 2,
        6,
        ROW_COLOURS[brick.row],
      );
      drawRounded(
        brick.x + BRICK_INSET + 4,
        brick.y + BRICK_INSET + 3,
        brick.width - BRICK_INSET * 2 - 8,
        4,
        2,
        "rgba(255, 255, 255, 0.32)",
      );
    }

    // Balls left, as pips in the corner. The HUD upstairs is score and best
    // for every game; a count that belongs to one of them belongs on its board.
    for (let i = 0; i < lives - 1; i += 1) {
      ctx.fillStyle = "rgba(255, 250, 242, 0.5)";
      ctx.beginPath();
      ctx.arc(16 + i * 17, WORLD.height - 16, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    trail.forEach((point, index) => {
      ctx.fillStyle = `rgba(255, 233, 150, ${0.24 * (1 - index / trail.length)})`;
      ctx.beginPath();
      ctx.arc(
        point.x,
        point.y,
        ball.r * (1 - index / (trail.length * 1.6)),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    });

    drawRounded(
      paddle.x,
      paddle.y,
      paddle.width,
      paddle.height,
      PADDLE_HEIGHT / 2,
      "#ffc933",
    );
    drawRounded(
      paddle.x + 6,
      paddle.y + 3,
      paddle.width - 12,
      4,
      2,
      "rgba(255, 255, 255, 0.42)",
    );

    ctx.fillStyle = "#fffaf2";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(86, 203, 245, 0.55)";
    ctx.beginPath();
    ctx.arc(ball.x - 2, ball.y + 2, ball.r * 0.45, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // The boundary last, over everything: the line the ball answers to.
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(86, 203, 245, 0.85)";
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
      releasePointer();
      releaseSwipe();
      window.removeEventListener("keyup", onKeyUp);
      root.remove();
    },
  };
}
