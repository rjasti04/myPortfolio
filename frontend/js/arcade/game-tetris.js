/**
 * Tetris - 10x20 well, seven-bag randomiser, SRS rotation with wall kicks.
 *
 * The rotation system is the part worth doing properly. Naive rotation about a
 * matrix centre fails against a wall or a stack: the piece simply refuses to
 * turn, which reads as an unresponsive game rather than a rule. SRS answers
 * that with kick tables - when the rotated piece collides, five candidate
 * offsets are tried in order and the first that fits is taken. That is what
 * makes T-spins and wall slides possible, and it is what players who know the
 * game are expecting from their fingers.
 *
 * `rotateMatrix`, `collides`, `kickedRotation` and `clearLines` are pure and
 * exported for the tests.
 */

import { fitCanvas, createLoop, prefersReducedMotion } from "./engine.js";
import { bindKeys, bindSwipe } from "./input.js";

export const meta = {
  id: "tetris",
  name: "Tetris",
  tagline:
    "Seven-bag randomiser, wall kicks, and gravity that keeps its promises.",
  controls:
    "Arrows or swipe to move · Up or tap to rotate · Space or swipe down to drop",
  rules:
    "Lines score, and clearing several at once scores far more than clearing them one by one. The run ends when a new piece has nowhere to spawn.",
};

export const COLUMNS = 10;
export const ROWS = 20;

/**
 * Spawn orientations. The bounding box is load-bearing, not cosmetic: SRS is
 * defined in terms of these exact boxes, so I is 4x4, O is 2x2, and the rest
 * are 3x3. Change a box and the kick tables below stop meaning anything.
 */
export const SHAPES = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
};

/** One saturated colour per piece, the same seven the launcher card family uses. */
const COLOURS = {
  I: "#2fd6c4",
  O: "#ffc933",
  T: "#b06cf0",
  J: "#56cbf5",
  L: "#ff8a3d",
  S: "#a5d94a",
  Z: "#ff5f9c",
};

/**
 * SRS kick offsets, written in the standard's own coordinates where +y is up.
 * The board's y grows downward, so `kickedRotation` subtracts the y offset
 * rather than adding it. Keeping the published numbers verbatim and flipping
 * once at the point of use is far easier to check against a reference than a
 * table someone has pre-negated.
 */
const KICKS_JLSTZ = {
  "0>1": [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  "1>0": [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  "1>2": [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  "2>1": [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  "2>3": [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  "3>2": [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  "3>0": [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  "0>3": [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
};

const KICKS_I = {
  "0>1": [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  "1>0": [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  "1>2": [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
  "2>1": [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  "2>3": [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  "3>2": [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  "3>0": [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  "0>3": [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
};

/** Points per simultaneous line clear, multiplied by the level. */
const LINE_SCORES = [0, 100, 300, 500, 800];

export const emptyBoard = () =>
  Array.from({ length: ROWS }, () =>
    Array.from({ length: COLUMNS }, () => null),
  );

/** Quarter turn clockwise (`dir` 1) or anticlockwise (`dir` -1). */
export function rotateMatrix(matrix, dir = 1) {
  const size = matrix.length;
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) =>
      dir === 1 ? matrix[size - 1 - col][row] : matrix[col][size - 1 - row],
    ),
  );
}

/** True when `shape` placed at (x, y) leaves the well or overlaps a locked cell. */
export function collides(board, shape, x, y) {
  for (let row = 0; row < shape.length; row += 1) {
    for (let col = 0; col < shape[row].length; col += 1) {
      if (!shape[row][col]) continue;
      const boardX = x + col;
      const boardY = y + row;
      if (boardX < 0 || boardX >= COLUMNS || boardY >= ROWS) return true;
      // Above the ceiling is legal - pieces spawn partly off-screen and fall in.
      if (boardY >= 0 && board[boardY][boardX]) return true;
    }
  }
  return false;
}

/**
 * Rotate with wall kicks. Returns the accepted placement, or null when all
 * five candidate offsets collide and the rotation must be refused.
 */
export function kickedRotation(board, piece, dir) {
  const from = piece.rotation;
  const to = (from + (dir === 1 ? 1 : 3)) % 4;
  const shape = rotateMatrix(piece.shape, dir);

  if (piece.type === "O")
    return { shape, rotation: to, x: piece.x, y: piece.y };

  const table = piece.type === "I" ? KICKS_I : KICKS_JLSTZ;
  for (const [offsetX, offsetY] of table[`${from}>${to}`]) {
    const x = piece.x + offsetX;
    // SRS publishes +y as up; the board counts rows downward.
    const y = piece.y - offsetY;
    if (!collides(board, shape, x, y)) return { shape, rotation: to, x, y };
  }
  return null;
}

/** Remove full rows, returning the compacted board and how many went. */
export function clearLines(board) {
  const kept = board.filter((row) => row.some((cell) => !cell));
  const cleared = board.length - kept.length;
  const fresh = Array.from({ length: cleared }, () =>
    Array.from({ length: COLUMNS }, () => null),
  );
  return { board: [...fresh, ...kept], cleared };
}

/**
 * Seven-bag randomiser: every permutation of the seven pieces is dealt before
 * any repeats. Uniform random selection is the naive alternative and it
 * produces droughts long enough that players reasonably believe the game is
 * cheating them.
 */
function createBag(random = Math.random) {
  let bag = [];
  return () => {
    if (!bag.length) {
      bag = Object.keys(SHAPES);
      for (let i = bag.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    return bag.pop();
  };
}

/** Seconds per row at a given level. Flattens out rather than reaching zero. */
export const gravityFor = (level) => Math.max(0.05, 0.8 - (level - 1) * 0.07);

export function create({ mount, api }) {
  const reduceMotion = prefersReducedMotion();

  const root = document.createElement("div");
  root.className = "game game--tetris";
  root.innerHTML = `
    <canvas class="game-canvas game-canvas--well"></canvas>
    <aside class="tetris-side">
      <p class="tetris-side-label">Next</p>
      <canvas class="tetris-next"></canvas>
      <dl class="tetris-stats">
        <div><dt>Level</dt><dd data-stat="level">1</dd></div>
        <div><dt>Lines</dt><dd data-stat="lines">0</dd></div>
      </dl>
    </aside>`;
  mount.append(root);

  const canvas = root.querySelector(".game-canvas");
  const ctx = canvas.getContext("2d");
  const nextCanvas = root.querySelector(".tetris-next");
  const nextCtx = nextCanvas.getContext("2d");
  const levelOut = root.querySelector('[data-stat="level"]');
  const linesOut = root.querySelector('[data-stat="lines"]');

  const nextType = createBag();
  let board = emptyBoard();
  let piece = null;
  let queued = nextType();
  let score = 0;
  let lines = 0;
  let level = 1;
  let fallTimer = 0;
  let finished = false;
  let flashRows = [];
  let flashTimer = 0;

  function spawnPiece() {
    const type = queued;
    queued = nextType();
    const shape = SHAPES[type];
    piece = {
      type,
      shape,
      rotation: 0,
      x: Math.floor((COLUMNS - shape.length) / 2),
      // Start one row above the ceiling so a flat piece is visible as it enters.
      y: -1,
    };
    // Nowhere to put it: the well is full to the top.
    if (collides(board, piece.shape, piece.x, piece.y)) {
      finished = true;
      api.audio.gameOver();
      api.gameOver(score);
    }
  }

  function lockPiece() {
    piece.shape.forEach((row, r) => {
      row.forEach((filled, c) => {
        if (!filled) return;
        const y = piece.y + r;
        if (y >= 0) board[y][piece.x + c] = piece.type;
      });
    });

    const full = [];
    board.forEach((row, y) => {
      if (row.every((cell) => cell)) full.push(y);
    });

    const result = clearLines(board);
    board = result.board;

    if (result.cleared) {
      lines += result.cleared;
      score += LINE_SCORES[result.cleared] * level;
      level = Math.floor(lines / 10) + 1;
      linesOut.textContent = String(lines);
      levelOut.textContent = String(level);
      flashRows = reduceMotion ? [] : full;
      flashTimer = 0.18;
      if (result.cleared === 4) api.audio.fanfare();
      else api.audio.blip(result.cleared * 3);
      api.setScore(score);
    } else {
      api.audio.blip(-6);
    }

    spawnPiece();
  }

  function shift(dx) {
    if (finished || !piece) return;
    if (!collides(board, piece.shape, piece.x + dx, piece.y)) piece.x += dx;
  }

  function rotate(dir) {
    if (finished || !piece) return;
    const kicked = kickedRotation(board, piece, dir);
    if (!kicked) return;
    Object.assign(piece, kicked);
    api.audio.blip(2);
  }

  /** One row down. Returns false when the piece has landed. */
  function stepDown() {
    if (collides(board, piece.shape, piece.x, piece.y + 1)) {
      lockPiece();
      return false;
    }
    piece.y += 1;
    return true;
  }

  function softDrop() {
    if (finished || !piece) return;
    if (stepDown()) {
      score += 1;
      api.setScore(score);
    }
    fallTimer = 0;
  }

  function hardDrop() {
    if (finished || !piece) return;
    let distance = 0;
    while (!collides(board, piece.shape, piece.x, piece.y + 1)) {
      piece.y += 1;
      distance += 1;
    }
    score += distance * 2;
    api.setScore(score);
    lockPiece();
    fallTimer = 0;
  }

  const releaseKeys = bindKeys({
    ArrowLeft: () => shift(-1),
    ArrowRight: () => shift(1),
    ArrowDown: softDrop,
    ArrowUp: () => rotate(1),
    a: () => shift(-1),
    d: () => shift(1),
    s: softDrop,
    w: () => rotate(1),
    z: () => rotate(-1),
    x: () => rotate(1),
    " ": { run: hardDrop, ignoreRepeat: true },
  });

  const releaseSwipe = bindSwipe(canvas, {
    onTap: () => rotate(1),
    onSwipe: (direction) => {
      if (direction === "left") shift(-1);
      else if (direction === "right") shift(1);
      else if (direction === "down") hardDrop();
      else rotate(1);
    },
  });

  function drawCell(target, x, y, size, type, alpha = 1) {
    target.globalAlpha = alpha;
    target.fillStyle = COLOURS[type];
    target.beginPath();
    target.roundRect(x + 1, y + 1, size - 2, size - 2, size * 0.22);
    target.fill();
    // A lighter top edge is the whole of the 3D read at this size.
    target.fillStyle = "rgba(255, 255, 255, 0.34)";
    target.beginPath();
    target.roundRect(
      x + size * 0.16,
      y + size * 0.14,
      size * 0.68,
      Math.max(1, size * 0.16),
      size * 0.08,
    );
    target.fill();
    target.globalAlpha = 1;
  }

  function renderNext() {
    const { width, height } = fitCanvas(nextCanvas, nextCtx);
    nextCtx.clearRect(0, 0, width, height);

    const shape = SHAPES[queued];
    const cells = [];
    shape.forEach((row, r) =>
      row.forEach((filled, c) => filled && cells.push([c, r])),
    );
    const minX = Math.min(...cells.map(([c]) => c));
    const maxX = Math.max(...cells.map(([c]) => c));
    const minY = Math.min(...cells.map(([, r]) => r));
    const maxY = Math.max(...cells.map(([, r]) => r));

    const size =
      Math.min(width / (maxX - minX + 1), height / (maxY - minY + 1)) * 0.8;
    const offsetX = (width - (maxX - minX + 1) * size) / 2;
    const offsetY = (height - (maxY - minY + 1) * size) / 2;

    cells.forEach(([c, r]) => {
      drawCell(
        nextCtx,
        offsetX + (c - minX) * size,
        offsetY + (r - minY) * size,
        size,
        queued,
      );
    });
  }

  function render() {
    const { width, height } = fitCanvas(canvas, ctx);
    const cell = Math.min(width / COLUMNS, height / ROWS);
    const originX = (width - cell * COLUMNS) / 2;
    const originY = (height - cell * ROWS) / 2;

    ctx.clearRect(0, 0, width, height);
    // Darker than the panel behind it: the well has to read as a hole in the
    // cabinet, not as another shade of the frame.
    ctx.fillStyle = "#17110f";
    ctx.beginPath();
    ctx.roundRect(originX, originY, cell * COLUMNS, cell * ROWS, cell * 0.4);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
    ctx.lineWidth = 1;
    for (let c = 1; c < COLUMNS; c += 1) {
      ctx.beginPath();
      ctx.moveTo(originX + c * cell, originY);
      ctx.lineTo(originX + c * cell, originY + cell * ROWS);
      ctx.stroke();
    }
    for (let r = 1; r < ROWS; r += 1) {
      ctx.beginPath();
      ctx.moveTo(originX, originY + r * cell);
      ctx.lineTo(originX + cell * COLUMNS, originY + r * cell);
      ctx.stroke();
    }

    board.forEach((row, y) => {
      row.forEach((type, x) => {
        if (type)
          drawCell(ctx, originX + x * cell, originY + y * cell, cell, type);
      });
    });

    if (flashTimer > 0) {
      ctx.fillStyle = `rgba(255, 249, 235, ${(flashTimer / 0.18) * 0.72})`;
      flashRows.forEach((y) =>
        ctx.fillRect(originX, originY + y * cell, cell * COLUMNS, cell),
      );
    }

    if (piece && !finished) {
      // Ghost: where a hard drop would land. Without it, stacking cleanly at
      // speed is guesswork.
      let ghostY = piece.y;
      while (!collides(board, piece.shape, piece.x, ghostY + 1)) ghostY += 1;

      piece.shape.forEach((row, r) => {
        row.forEach((filled, c) => {
          if (!filled) return;
          const y = ghostY + r;
          if (y < 0) return;
          drawCell(
            ctx,
            originX + (piece.x + c) * cell,
            originY + y * cell,
            cell,
            piece.type,
            0.18,
          );
        });
      });

      piece.shape.forEach((row, r) => {
        row.forEach((filled, c) => {
          if (!filled) return;
          const y = piece.y + r;
          if (y < 0) return;
          drawCell(
            ctx,
            originX + (piece.x + c) * cell,
            originY + y * cell,
            cell,
            piece.type,
          );
        });
      });
    }

    renderNext();
  }

  spawnPiece();

  const loop = createLoop({
    update: (dt) => {
      if (finished) return;
      if (flashTimer > 0) flashTimer = Math.max(0, flashTimer - dt);
      fallTimer += dt;
      if (fallTimer >= gravityFor(level)) {
        fallTimer = 0;
        stepDown();
      }
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
