import test from "node:test";
import assert from "node:assert/strict";

import {
  collapse,
  move,
  hasMoves,
  spawn,
  emptyGrid,
} from "../js/arcade/game-2048.js";
import {
  rotateMatrix,
  collides,
  kickedRotation,
  clearLines,
  gravityFor,
  emptyBoard,
  SHAPES,
  COLUMNS,
  ROWS,
} from "../js/arcade/game-tetris.js";
import {
  overlaps,
  columnRects,
  makeColumn,
  WORLD,
  GAP_HEIGHT,
  COLUMN_WIDTH,
} from "../js/arcade/game-flapper.js";
import { place, PERFECT_TOLERANCE, speedFor } from "../js/arcade/game-stack.js";
import {
  step,
  isReversal,
  spawnFood,
  freeCells,
  tickFor,
  startBody,
  DIRECTIONS,
  // Tetris exports a well of the same names; the snake's board is its own.
  COLUMNS as SNAKE_COLUMNS,
  ROWS as SNAKE_ROWS,
} from "../js/arcade/game-snake.js";
import {
  contactAxis,
  paddleBounce,
  buildWall,
  clampPaddle,
  sliceCount,
  speedFor as ballSpeedFor,
  MAX_BOUNCE_ANGLE,
  MAX_SPEED,
  BALL_RADIUS,
  WORLD as BREAKER_WORLD,
  COLUMNS as BREAKER_COLUMNS,
  ROWS as BREAKER_ROWS,
} from "../js/arcade/game-breaker.js";

/* ---- 2048 --------------------------------------------------------------- */

test("2048: four equal tiles make two pairs, not one tile", () => {
  const { line, score } = collapse([2, 2, 2, 2]);
  assert.deepEqual(line, [4, 4, 0, 0]);
  assert.equal(score, 8);
});

test("2048: a tile produced by a merge cannot merge again in the same move", () => {
  // [4, 2, 2] must settle as [4, 4] - never as a single 8.
  const { line, score } = collapse([4, 2, 2, 0]);
  assert.deepEqual(line, [4, 4, 0, 0]);
  assert.equal(score, 4);
});

test("2048: gaps close and distant equals meet", () => {
  assert.deepEqual(collapse([2, 0, 0, 2]).line, [4, 0, 0, 0]);
  assert.deepEqual(collapse([0, 0, 0, 8]).line, [8, 0, 0, 0]);
});

test("2048: unequal neighbours compact without merging", () => {
  const { line, score } = collapse([2, 4, 0, 8]);
  assert.deepEqual(line, [2, 4, 8, 0]);
  assert.equal(score, 0);
});

test("2048: a move that changes nothing is not a move", () => {
  const grid = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
  assert.equal(move(grid, "left").moved, false);
  assert.equal(move(grid, "up").moved, false);
});

test("2048: direction decides which edge tiles pile against", () => {
  const grid = emptyGrid();
  grid[1] = 2; // row 0, column 1
  assert.equal(move(grid, "left").grid[0], 2);
  assert.equal(move(grid, "right").grid[3], 2);
  assert.equal(move(grid, "down").grid[13], 2);
  assert.equal(move(grid, "up").grid[1], 2);
});

test("2048: a full board with no equal neighbours is game over", () => {
  const deadlocked = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
  assert.equal(hasMoves(deadlocked), false);

  const withPair = [...deadlocked];
  withPair[1] = 2;
  assert.equal(hasMoves(withPair), true);
});

test("2048: spawn fills an empty cell with a 2 or a 4", () => {
  const grid = emptyGrid().map(() => 2);
  grid[7] = 0;

  const low = [...grid];
  assert.equal(
    spawn(low, () => 0),
    7,
  );
  assert.equal(low[7], 2);

  const high = [...grid];
  spawn(high, () => 0.95);
  assert.equal(high[7], 4);

  // Nowhere to go: reported rather than looping or overwriting.
  assert.equal(
    spawn(
      grid.map(() => 2),
      () => 0,
    ),
    -1,
  );
});

/* ---- Tetris ------------------------------------------------------------- */

test("tetris: I rotates from the spawn row into a single column", () => {
  const rotated = rotateMatrix(SHAPES.I);
  rotated.forEach((row) => assert.deepEqual(row, [0, 0, 1, 0]));
});

test("tetris: four quarter turns is the identity, in both directions", () => {
  for (const shape of Object.values(SHAPES)) {
    let clockwise = shape;
    let anticlockwise = shape;
    for (let i = 0; i < 4; i += 1) {
      clockwise = rotateMatrix(clockwise, 1);
      anticlockwise = rotateMatrix(anticlockwise, -1);
    }
    assert.deepEqual(clockwise, shape);
    assert.deepEqual(anticlockwise, shape);
  }
});

test("tetris: collision covers both walls, the floor, and filled cells", () => {
  const board = emptyBoard();
  assert.equal(collides(board, SHAPES.O, -1, 0), true);
  assert.equal(collides(board, SHAPES.O, COLUMNS - 1, 0), true);
  assert.equal(collides(board, SHAPES.O, 0, ROWS - 1), true);
  assert.equal(collides(board, SHAPES.O, 0, 0), false);

  board[4][3] = "T";
  assert.equal(collides(board, SHAPES.O, 3, 3), true);
  assert.equal(collides(board, SHAPES.O, 5, 3), false);
});

test("tetris: the ceiling is open, so a piece can spawn partly above the well", () => {
  assert.equal(collides(emptyBoard(), SHAPES.O, 4, -2), false);
});

test("tetris: rotation against the left wall kicks inwards instead of failing", () => {
  const board = emptyBoard();
  // A T in its right-facing state leaves its box's first column empty, so it
  // can legally sit at x = -1 hugging the wall. Rotating it flat would put a
  // cell at x = -1, which is off the board - SRS has to offset it back in
  // rather than refusing the turn.
  const shape = rotateMatrix(SHAPES.T, 1);
  const piece = { type: "T", shape, rotation: 1, x: -1, y: 5 };
  assert.equal(
    collides(board, shape, piece.x, piece.y),
    false,
    "start state must be legal",
  );

  const kicked = kickedRotation(board, piece, 1);
  assert.notEqual(kicked, null);
  assert.equal(collides(board, kicked.shape, kicked.x, kicked.y), false);
  assert.ok(
    kicked.x > piece.x,
    "the piece should be pushed away from the wall",
  );
});

test("tetris: O never kicks, because it never changes shape", () => {
  const piece = { type: "O", shape: SHAPES.O, rotation: 0, x: 4, y: 5 };
  const kicked = kickedRotation(emptyBoard(), piece, 1);
  assert.equal(kicked.x, 4);
  assert.equal(kicked.y, 5);
  assert.deepEqual(kicked.shape, SHAPES.O);
});

test("tetris: rotation is refused when every kick collides", () => {
  const board = emptyBoard();
  // Fill everything except the column the piece occupies, so no offset fits.
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLUMNS; x += 1) {
      if (x !== 4) board[y][x] = "Z";
    }
  }
  const piece = {
    type: "I",
    shape: rotateMatrix(SHAPES.I),
    rotation: 1,
    x: 2,
    y: 5,
  };
  assert.equal(kickedRotation(board, piece, 1), null);
});

test("tetris: cleared rows are replaced at the top and the rest keep their order", () => {
  const board = emptyBoard();
  board[ROWS - 1] = Array.from({ length: COLUMNS }, () => "I");
  board[ROWS - 3][0] = "T";

  const { board: next, cleared } = clearLines(board);
  assert.equal(cleared, 1);
  assert.equal(next.length, ROWS);
  assert.equal(
    next[0].every((cell) => cell === null),
    true,
  );
  // The lone T started two rows above the cleared line and should now be one
  // row lower than it was.
  assert.equal(next[ROWS - 2][0], "T");
});

test("tetris: gravity accelerates with level but never reaches zero", () => {
  assert.ok(gravityFor(2) < gravityFor(1));
  assert.ok(gravityFor(99) >= 0.05);
});

/* ---- Flapper ------------------------------------------------------------ */

test("flapper: overlap is strict, so grazing an edge is not a collision", () => {
  const orb = { x: 50, y: 50, r: 10 };
  assert.equal(overlaps(orb, { x: 60, y: 0, width: 20, height: 100 }), false);
  assert.equal(overlaps(orb, { x: 59, y: 0, width: 20, height: 100 }), true);
  assert.equal(overlaps(orb, { x: 0, y: 61, width: 100, height: 20 }), false);
});

test("flapper: a column is two rectangles with exactly the gap between them", () => {
  const [top, bottom] = columnRects({ x: 100, gapY: 200 });
  assert.equal(top.height, 200);
  assert.equal(bottom.y - (top.y + top.height), GAP_HEIGHT);
  assert.equal(bottom.y + bottom.height, WORLD.height);
  assert.equal(top.width, COLUMN_WIDTH);
});

test("flapper: gaps never open flush against the ceiling or the floor", () => {
  for (const random of [() => 0, () => 0.5, () => 0.999]) {
    const [top, bottom] = columnRects(makeColumn(0, random));
    assert.ok(top.height > 0, "gap opened through the ceiling");
    assert.ok(bottom.height > 0, "gap opened through the floor");
  }
});

/* ---- Stack -------------------------------------------------------------- */

test("stack: a near-miss inside the tolerance snaps flush and loses nothing", () => {
  const base = { x: 100, width: 60 };
  const result = place(base, { x: 100 + PERFECT_TOLERANCE, width: 60 });

  assert.equal(result.perfect, true);
  assert.equal(result.x, 100);
  assert.equal(result.width, 60);
  assert.equal(result.sliced, null);
});

test("stack: an overhang is trimmed from the side it hangs over", () => {
  const base = { x: 100, width: 60 };

  const right = place(base, { x: 130, width: 60 });
  assert.equal(right.perfect, false);
  assert.equal(right.x, 130);
  assert.equal(right.width, 30);
  assert.deepEqual(right.sliced, { x: 160, width: 30 });

  const left = place(base, { x: 70, width: 60 });
  assert.equal(left.x, 100);
  assert.equal(left.width, 30);
  assert.deepEqual(left.sliced, { x: 70, width: 30 });
});

test("stack: the surviving block plus the offcut is the block that was dropped", () => {
  const result = place({ x: 100, width: 60 }, { x: 118, width: 60 });
  assert.equal(result.width + result.sliced.width, 60);
});

test("stack: no overlap ends the run, and touching edges counts as no overlap", () => {
  const base = { x: 100, width: 60 };
  assert.equal(place(base, { x: 400, width: 60 }).missed, true);
  // Right edge of the base is the left edge of the block: zero contact.
  assert.equal(place(base, { x: 160, width: 60 }).missed, true);
  assert.equal(place(base, { x: 159, width: 60 }).missed, false);
});

test("stack: blocks speed up with height but stay bounded", () => {
  assert.ok(speedFor(20) > speedFor(1));
  assert.ok(speedFor(10000) <= 320);
});

/* ---- Snake -------------------------------------------------------------- */

test("snake: the tail vacates its cell on the same tick, so chasing it is legal", () => {
  // A closed loop moving into the cell its own tail is leaving. Testing the
  // head against the body *before* the tail moves is the classic version of
  // this bug, and it ends runs on a move that was never fatal.
  const body = [
    { x: 5, y: 5 },
    { x: 4, y: 5 },
    { x: 4, y: 6 },
    { x: 5, y: 6 },
  ];
  const result = step(body, DIRECTIONS.down, null);

  assert.equal(result.dead, false);
  assert.deepEqual(result.body[0], { x: 5, y: 6 });
  assert.equal(result.body.length, body.length);
});

test("snake: eating keeps the tail, so the snake is one cell longer", () => {
  const body = [
    { x: 5, y: 5 },
    { x: 4, y: 5 },
  ];
  const result = step(body, DIRECTIONS.right, { x: 6, y: 5 });

  assert.equal(result.ate, true);
  assert.equal(result.dead, false);
  assert.equal(result.body.length, 3);
  assert.deepEqual(result.body[result.body.length - 1], { x: 4, y: 5 });
});

test("snake: the tail only stays put for the tick the food was taken", () => {
  // Growth is one segment per bite, not a tail that stops moving: the tick
  // after an eat has to shed a cell again or the snake grows without eating.
  const body = [
    { x: 5, y: 5 },
    { x: 4, y: 5 },
  ];
  const grown = step(body, DIRECTIONS.right, { x: 6, y: 5 }).body;
  const after = step(grown, DIRECTIONS.right, null);

  assert.equal(after.ate, false);
  assert.equal(after.body.length, grown.length);
  assert.deepEqual(after.body, [
    { x: 7, y: 5 },
    { x: 6, y: 5 },
    { x: 5, y: 5 },
  ]);
});

test("snake: the walls are fatal on every side", () => {
  assert.equal(step([{ x: 0, y: 4 }], DIRECTIONS.left, null).dead, true);
  assert.equal(step([{ x: 4, y: 0 }], DIRECTIONS.up, null).dead, true);
  assert.equal(
    step([{ x: SNAKE_COLUMNS - 1, y: 4 }], DIRECTIONS.right, null).dead,
    true,
  );
  assert.equal(
    step([{ x: 4, y: SNAKE_ROWS - 1 }], DIRECTIONS.down, null).dead,
    true,
  );
});

test("snake: running into the body ends the run", () => {
  const body = [
    { x: 5, y: 5 },
    { x: 5, y: 6 },
    { x: 6, y: 6 },
    { x: 6, y: 5 },
    { x: 7, y: 5 },
  ];
  assert.equal(step(body, DIRECTIONS.right, null).dead, true);
});

test("snake: a turn back through the neck is a reversal, a turn is not", () => {
  assert.equal(isReversal(DIRECTIONS.right, DIRECTIONS.left), true);
  assert.equal(isReversal(DIRECTIONS.up, DIRECTIONS.down), true);
  assert.equal(isReversal(DIRECTIONS.right, DIRECTIONS.up), false);
  assert.equal(isReversal(DIRECTIONS.right, DIRECTIONS.right), false);
});

test("snake: food never lands under the snake", () => {
  const body = startBody();
  const occupied = new Set(body.map((cell) => `${cell.x},${cell.y}`));

  // Both ends of the range, so neither the first nor the last free cell is
  // the one that slips through.
  for (const random of [() => 0, () => 0.999999, () => 0.5]) {
    const food = spawnFood(body, random);
    assert.equal(occupied.has(`${food.x},${food.y}`), false);
  }
});

test("snake: the free list is the board minus the snake", () => {
  const body = startBody();
  assert.equal(
    freeCells(body).length,
    SNAKE_COLUMNS * SNAKE_ROWS - body.length,
  );
});

test("snake: a covered board has nowhere to put food, which is the win", () => {
  const everyCell = [];
  for (let y = 0; y < SNAKE_ROWS; y += 1) {
    for (let x = 0; x < SNAKE_COLUMNS; x += 1) everyCell.push({ x, y });
  }
  assert.equal(spawnFood(everyCell), null);
});

test("snake: ticks shorten with the score but stay above the floor", () => {
  assert.ok(tickFor(10) < tickFor(0));
  assert.ok(tickFor(10000) >= 0.075);
});

/* ---- Breaker ------------------------------------------------------------ */

/** A brick from the middle of the wall, and a ball resting on its underside. */
const brick = { x: 100, y: 200, width: 50, height: 22 };
const ballAt = (x, y, speed = { vx: 0, vy: 0 }) => ({
  x,
  y,
  r: BALL_RADIUS,
  ...speed,
});

test("breaker: a hit reflects on the axis the ball came in through", () => {
  // Rising into the brick's underside: shallow on y, deep on x.
  assert.equal(contactAxis(ballAt(125, 227), brick), "y");
  // Arriving at the brick's left face: shallow on x, deep on y.
  assert.equal(contactAxis(ballAt(95, 211), brick), "x");
});

test("breaker: contact is strict, so grazing a brick is not a hit", () => {
  // Exactly one radius clear of the top edge, on the centre line.
  assert.equal(contactAxis(ballAt(125, 200 - BALL_RADIUS), brick), null);
  assert.equal(contactAxis(ballAt(125, 200 - BALL_RADIUS + 0.5), brick), "y");
  assert.equal(contactAxis(ballAt(100 - BALL_RADIUS, 211), brick), null);
});

test("breaker: a dead corner resolves vertically, not along the row", () => {
  // Equal depth on both axes. Reflecting x here sends the ball sideways along
  // the row it just hit, which is the direction with nothing to stop it.
  const corner = { x: 0, y: 0, width: 20, height: 20 };
  assert.equal(contactAxis(ballAt(-5, -5), corner), "y");
});

test("breaker: the paddle sets the angle from where it was struck", () => {
  const paddle = { x: 100, y: 500, width: 80, height: 13 };
  const arriving = { vx: 40, vy: 300 };

  const middle = paddleBounce(ballAt(140, 495, arriving), paddle);
  assert.equal(Math.round(middle.vx), 0);

  const left = paddleBounce(ballAt(100, 495, arriving), paddle);
  const right = paddleBounce(ballAt(180, 495, arriving), paddle);
  assert.ok(left.vx < 0, "the left tip should send the ball left");
  assert.ok(right.vx > 0, "the right tip should send the ball right");
  // The same ball, mirrored: the aim is where it struck, not how it arrived.
  assert.equal(Math.round(left.vx), -Math.round(right.vx));
});

test("breaker: the paddle never returns a ball downwards or sideways", () => {
  const paddle = { x: 100, y: 500, width: 80, height: 13 };
  const speed = Math.hypot(60, 280);

  // Every point across the paddle, and past both ends: a drag can put the
  // paddle's tip beyond the ball before the contact resolves.
  for (let x = 80; x <= 200; x += 2) {
    const out = paddleBounce(ballAt(x, 495, { vx: 60, vy: 280 }), paddle);
    assert.ok(out.vy < 0, `ball sent downwards from x=${x}`);
    // Speed is carried through, so a bounce neither stalls nor accelerates.
    assert.ok(Math.abs(Math.hypot(out.vx, out.vy) - speed) < 1e-9);
    // The angle from vertical stays inside the cap, which is what stops a ball
    // leaving flat and pinging wall to wall inside a gap in the row above.
    assert.ok(Math.abs(Math.atan2(out.vx, -out.vy)) <= MAX_BOUNCE_ANGLE + 1e-9);
  }
});

test("breaker: the wall is a full grid inside the world", () => {
  const wall = buildWall();
  assert.equal(wall.length, BREAKER_COLUMNS * BREAKER_ROWS);
  assert.equal(
    new Set(wall.map((cell) => `${cell.x},${cell.y}`)).size,
    wall.length,
  );
  for (const cell of wall) {
    assert.ok(cell.x >= 0 && cell.x + cell.width <= BREAKER_WORLD.width);
    assert.ok(cell.row >= 0 && cell.row < BREAKER_ROWS);
  }
});

test("breaker: the paddle stops at both walls whatever is asked of it", () => {
  assert.equal(clampPaddle(-40, 80), 0);
  assert.equal(clampPaddle(BREAKER_WORLD.width, 80), BREAKER_WORLD.width - 80);
  assert.equal(clampPaddle(120, 80), 120);
});

test("breaker: the ball speeds up with the bricks but stays under the cap", () => {
  assert.ok(ballSpeedFor(20) > ballSpeedFor(0));
  assert.equal(ballSpeedFor(100000), MAX_SPEED);
});

test("breaker: no slice of a frame is longer than the ball is wide", () => {
  // The whole point: a ball that crosses more than its own radius between two
  // collision tests can pass through a brick without ever being inside one,
  // and a full 1/60 frame at the cap already does.
  assert.ok(MAX_SPEED / 60 > BALL_RADIUS, "otherwise this guard is untested");

  for (const speed of [0, 120, ballSpeedFor(0), MAX_SPEED, MAX_SPEED * 4]) {
    const slices = sliceCount(speed, 1 / 60);
    assert.ok(slices >= 1, "a stationary ball still takes one step");
    assert.ok(speed / 60 / slices <= BALL_RADIUS, `skipped ahead at ${speed}`);
  }
});
