/** Pure, immutable rules for the 8 × 8 block puzzle. */
import { BLOCK_CONFIG } from './block-config.js';
export const BOARD_SIZE = 8;
export const COLORS = Object.freeze(['violet', 'cyan', 'blue', 'pink', 'amber', 'mint']);

const shape = (id, name, cells) => Object.freeze({
  id,
  name,
  cells: Object.freeze(cells.map((cell) => Object.freeze(cell))),
});

export const SHAPES = Object.freeze([
  shape('single', 'Một ô', [[0, 0]]),
  shape('domino-h', 'Đôi ngang', [[0, 0], [0, 1]]),
  shape('domino-v', 'Đôi dọc', [[0, 0], [1, 0]]),
  shape('line3-h', 'Ba ô ngang', [[0, 0], [0, 1], [0, 2]]),
  shape('line3-v', 'Ba ô dọc', [[0, 0], [1, 0], [2, 0]]),
  shape('line4-h', 'Bốn ô ngang', [[0, 0], [0, 1], [0, 2], [0, 3]]),
  shape('line4-v', 'Bốn ô dọc', [[0, 0], [1, 0], [2, 0], [3, 0]]),
  shape('line5-h', 'Năm ô ngang', [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]),
  shape('line5-v', 'Năm ô dọc', [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]),
  shape('square2', 'Vuông nhỏ', [[0, 0], [0, 1], [1, 0], [1, 1]]),
  shape('square3', 'Vuông lớn', [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]]),
  shape('rectangle-h', 'Chữ nhật ngang', [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]),
  shape('rectangle-v', 'Chữ nhật dọc', [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]]),
  shape('corner-ne', 'Góc trên phải', [[0, 0], [0, 1], [1, 1]]),
  shape('corner-nw', 'Góc trên trái', [[0, 0], [0, 1], [1, 0]]),
  shape('corner-se', 'Góc dưới phải', [[0, 1], [1, 0], [1, 1]]),
  shape('corner-sw', 'Góc dưới trái', [[0, 0], [1, 0], [1, 1]]),
  shape('ell-se', 'Chữ L phải', [[0, 0], [1, 0], [2, 0], [2, 1]]),
  shape('ell-sw', 'Chữ L trái', [[0, 1], [1, 1], [2, 0], [2, 1]]),
  shape('ell-ne', 'Chữ L trên phải', [[0, 0], [0, 1], [1, 0], [2, 0]]),
  shape('ell-nw', 'Chữ L trên trái', [[0, 0], [0, 1], [1, 1], [2, 1]]),
  shape('tee-down', 'Chữ T xuống', [[0, 0], [0, 1], [0, 2], [1, 1]]),
  shape('tee-up', 'Chữ T lên', [[0, 1], [1, 0], [1, 1], [1, 2]]),
  shape('tee-right', 'Chữ T phải', [[0, 0], [1, 0], [1, 1], [2, 0]]),
  shape('tee-left', 'Chữ T trái', [[0, 1], [1, 0], [1, 1], [2, 1]]),
  shape('zigzag-h', 'Zíc zắc ngang', [[0, 1], [0, 2], [1, 0], [1, 1]]),
  shape('zigzag-v', 'Zíc zắc dọc', [[0, 0], [1, 0], [1, 1], [2, 1]]),
  shape('zagzig-h', 'Chữ Z ngang', [[0, 0], [0, 1], [1, 1], [1, 2]]),
  shape('zagzig-v', 'Chữ Z dọc', [[0, 1], [1, 0], [1, 1], [2, 0]]),
  shape('big-corner', 'Góc lớn', [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]),
]);

/** Validate configuration rather than silently introducing excluded shapes. */
export function resolveBlockConfig(overrides = {}) {
  const config = { ...BLOCK_CONFIG, ...overrides };
  if (!Number.isInteger(config.handSize) || config.handSize < 1 || config.handSize > 9) {
    throw new RangeError('handSize must be an integer from 1 to 9');
  }
  let definitions;
  if (config.enabledShapeIds !== null) {
    const ids = config.enabledShapeIds;
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) {
      throw new TypeError('enabledShapeIds must be a nonempty array of unique shape IDs');
    }
    definitions = ids.map((id) => {
      const definition = SHAPES.find((candidate) => candidate.id === id);
      if (!definition) throw new RangeError(`Unknown shape ID: ${id}`);
      return definition;
    });
  } else {
    const count = config.shapeCount ?? SHAPES.length;
    if (!Number.isInteger(count) || count < 1 || count > SHAPES.length) {
      throw new RangeError(`shapeCount must be an integer from 1 to ${SHAPES.length}, or null`);
    }
    definitions = SHAPES.slice(0, count);
  }
  if (!config.shapeWeights || typeof config.shapeWeights !== 'object' || Array.isArray(config.shapeWeights)) {
    throw new TypeError('shapeWeights must be an object');
  }
  const shapeWeights = { ...config.shapeWeights };
  for (const [id, weight] of Object.entries(shapeWeights)) {
    if (!SHAPES.some((definition) => definition.id === id) || !Number.isFinite(weight) || weight <= 0) {
      throw new RangeError(`Invalid positive weight for shape: ${id}`);
    }
  }
  return { handSize: config.handSize, definitions, shapeWeights };
}

export function createBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

export function isValidBoard(board) {
  return Array.isArray(board) && board.length === BOARD_SIZE && Array.from(board).every((row) =>
    Array.isArray(row) && row.length === BOARD_SIZE && Array.from(row).every((cell) => cell === null || COLORS.includes(cell)));
}

function isValidCells(cells) {
  if (!Array.isArray(cells) || cells.length === 0 || cells.length > BOARD_SIZE * BOARD_SIZE) return false;
  const seen = new Set();
  for (const cell of cells) {
    if (!Array.isArray(cell) || cell.length !== 2) return false;
    const [row, col] = cell;
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return false;
    const key = row * BOARD_SIZE + col;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

export function isValidPiece(piece) {
  if (!piece || typeof piece.id !== 'string' || !piece.id || !COLORS.includes(piece.color)) return false;
  const knownShape = SHAPES.find((candidate) => candidate.id === piece.shapeId);
  return Boolean(knownShape && isValidCells(piece.cells) &&
    knownShape.cells.length === piece.cells.length && knownShape.cells.every(([row, col], index) =>
      piece.cells[index][0] === row && piece.cells[index][1] === col));
}

function fits(board, cells, row, col) {
  return cells.every(([offsetRow, offsetCol]) => {
    const nextRow = row + offsetRow;
    const nextCol = col + offsetCol;
    return nextRow >= 0 && nextRow < BOARD_SIZE && nextCol >= 0 && nextCol < BOARD_SIZE && board[nextRow][nextCol] === null;
  });
}

export function canPlace(board, cells, row, col) {
  return isValidBoard(board) && isValidCells(cells) && Number.isInteger(row) && Number.isInteger(col) &&
    row >= 0 && col >= 0 && fits(board, cells, row, col);
}

/** Placement earns 10 per block, plus 100 per line × the new combo. */
export function placePiece(board, piece, row, col, combo = 0) {
  if (!piece || !COLORS.includes(piece.color) || !canPlace(board, piece.cells, row, col)) return null;

  const nextBoard = board.map((boardRow) => [...boardRow]);
  const placedCells = piece.cells.map(([offsetRow, offsetCol]) => [row + offsetRow, col + offsetCol]);
  for (const [placedRow, placedCol] of placedCells) nextBoard[placedRow][placedCol] = piece.color;

  // Discover every full line before clearing any cells: intersections clear once.
  const clearedRows = [];
  const clearedCols = [];
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    if (nextBoard[index].every((cell) => cell !== null)) clearedRows.push(index);
    if (nextBoard.every((boardRow) => boardRow[index] !== null)) clearedCols.push(index);
  }

  const clearedCells = [];
  for (let boardRow = 0; boardRow < BOARD_SIZE; boardRow += 1) {
    for (let boardCol = 0; boardCol < BOARD_SIZE; boardCol += 1) {
      if (clearedRows.includes(boardRow) || clearedCols.includes(boardCol)) {
        clearedCells.push([boardRow, boardCol]);
        nextBoard[boardRow][boardCol] = null;
      }
    }
  }
  const lines = clearedRows.length + clearedCols.length;
  const previousCombo = Number.isSafeInteger(combo) && combo >= 0 ? combo : 0;
  const nextCombo = lines > 0 ? previousCombo + 1 : 0;
  const points = placedCells.length * 10 + lines * 100 * nextCombo;

  return { board: nextBoard, clearedCells, clearedRows, clearedCols, lines, points, combo: nextCombo, placedCells };
}

export function getValidPlacements(board, cells) {
  if (!isValidBoard(board) || !isValidCells(cells)) return [];
  const placements = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (fits(board, cells, row, col)) placements.push({ row, col });
    }
  }
  return placements;
}

export function hasAnyMove(board, pieces) {
  return isValidBoard(board) && Array.isArray(pieces) && pieces.some((piece) =>
    piece && isValidCells(piece.cells) && getValidPlacements(board, piece.cells).length > 0);
}

let pieceSequence = 0;

function randomUnit(rng) {
  const value = Number(rng());
  return Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0.5;
}

function chooseWeighted(candidates, rng, chosenShapeIds, emptyCount, shapeWeights) {
  const weights = candidates.map(({ definition }) => {
    const count = definition.cells.length;
    let weight = count === 1 ? 0.25 : count === 2 ? 0.65 : 1;
    if (count >= 6 && emptyCount > 36) weight *= 1.6;
    if (chosenShapeIds.has(definition.id)) weight *= 0.35;
    weight *= shapeWeights[definition.id] ?? 1;
    return weight;
  });
  let target = randomUnit(rng) * weights.reduce((total, weight) => total + weight, 0);
  for (let index = 0; index < candidates.length; index += 1) {
    target -= weights[index];
    if (target < 0) return candidates[index];
  }
  return candidates[candidates.length - 1];
}

/**
 * Builds a hand along a simulated legal sequence. The returned order therefore
 * has at least one complete solution with the default pool whenever the input
 * board has an empty cell. Restricted pools can run out of fitting shapes.
 * Bounded scans also allow full boards and unusual random sources to return.
 */
export function generateHand(board, rng = Math.random, config = {}) {
  const { handSize, definitions, shapeWeights } = resolveBlockConfig(config);
  let simulation = isValidBoard(board) ? board.map((row) => [...row]) : createBoard();
  const random = typeof rng === 'function' ? rng : Math.random;
  const hand = [];
  const chosenShapeIds = new Set();

  for (let slot = 0; slot < handSize; slot += 1) {
    const emptyCount = simulation.flat().filter((cell) => cell === null).length;
    const candidates = definitions.map((definition) => ({
      definition,
      placements: getValidPlacements(simulation, definition.cells),
    })).filter((candidate) => candidate.placements.length > 0);
    const selected = candidates.length > 0
      ? chooseWeighted(candidates, random, chosenShapeIds, emptyCount, shapeWeights)
      : { definition: definitions[Math.floor(randomUnit(random) * definitions.length)], placements: [] };
    const color = COLORS[Math.floor(randomUnit(random) * COLORS.length)];
    const piece = {
      id: `piece-${++pieceSequence}`,
      shapeId: selected.definition.id,
      cells: selected.definition.cells.map((cell) => [...cell]),
      color,
    };
    hand.push(piece);
    chosenShapeIds.add(piece.shapeId);

    // Prefer clear opportunities and leave space around compact placements.
    let bestBoard = simulation;
    let bestValue = -Infinity;
    for (const { row, col } of selected.placements) {
      const result = placePiece(simulation, piece, row, col);
      let neighbors = 0;
      for (const [offsetRow, offsetCol] of piece.cells) {
        for (const [deltaRow, deltaCol] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const neighborRow = row + offsetRow + deltaRow;
          const neighborCol = col + offsetCol + deltaCol;
          if (neighborRow < 0 || neighborRow >= BOARD_SIZE || neighborCol < 0 || neighborCol >= BOARD_SIZE ||
            simulation[neighborRow][neighborCol] !== null) neighbors += 1;
        }
      }
      const value = result.lines * 100 + neighbors + randomUnit(random) * 3;
      if (value > bestValue) {
        bestValue = value;
        bestBoard = result.board;
      }
    }
    simulation = bestBoard;
  }
  return hand;
}
