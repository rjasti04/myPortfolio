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
