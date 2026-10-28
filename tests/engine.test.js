import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_SIZE, COLORS, SHAPES, createBoard, canPlace, placePiece,
  getValidPlacements, hasAnyMove, generateHand, isValidBoard, isValidPiece,
} from '../src/engine.js';

const pieceFor = (shapeId, color = 'cyan') => ({ id: 'test-piece', shapeId, cells: SHAPES.find((shape) => shape.id === shapeId).cells, color });

function seededRandom(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function canPlaySequence(board, pieces, index = 0) {
  if (index === pieces.length) return true;
  const piece = pieces[index];
  return getValidPlacements(board, piece.cells).some(({ row, col }) =>
    canPlaySequence(placePiece(board, piece, row, col).board, pieces, index + 1));
}

test('boards own independent rows and independently allocated cells', () => {
  const first = createBoard();
  const second = createBoard();
  assert.equal(first.length, BOARD_SIZE);
  assert.equal(first.flat().length, 64);
  first[0][0] = 'pink';
  assert.equal(first[1][0], null);
  assert.equal(second[0][0], null);
});

test('placement rejects occupied, out-of-bounds and malformed coordinates', () => {
  const board = createBoard();
  board[2][2] = 'violet';
  const cells = pieceFor('square2').cells;
  assert.equal(canPlace(board, cells, 0, 0), true);
  assert.equal(canPlace(board, cells, 1, 1), false);
  assert.equal(canPlace(board, cells, 7, 7), false);
  assert.equal(canPlace(board, cells, -1, 0), false);
  assert.equal(canPlace(board, cells, 0.5, 0), false);
  assert.equal(canPlace(board, [[0, 0], [0, 0]], 0, 0), false);
  assert.equal(canPlace(board, [], 0, 0), false);
  assert.equal(canPlace(board, [[NaN, 0]], 0, 0), false);
  assert.equal(canPlace([], cells, 0, 0), false);
  assert.equal(placePiece(board, pieceFor('square2'), 1, 1), null);
});

test('placement is immutable and awards block points without line clears', () => {
  const board = createBoard();
  const before = structuredClone(board);
  const result = placePiece(board, pieceFor('square2', 'mint'), 3, 4, 5);
  assert.deepEqual(board, before);
  assert.equal(result.board[3][4], 'mint');
  assert.equal(result.points, 40);
  assert.equal(result.lines, 0);
  assert.equal(result.combo, 0);
  assert.deepEqual(result.placedCells, [[3, 4], [3, 5], [4, 4], [4, 5]]);
  for (let row = 0; row < BOARD_SIZE; row += 1) assert.notEqual(result.board[row], board[row]);
});

test('a crossing placement clears row and column simultaneously, counting their intersection once', () => {
  const board = createBoard();
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    board[3][index] = 'pink';
    board[index][4] = 'blue';
  }
  board[3][4] = null;
  board[0][0] = 'mint';
  const before = structuredClone(board);
  const result = placePiece(board, pieceFor('single'), 3, 4, 2);
  assert.deepEqual(result.clearedRows, [3]);
  assert.deepEqual(result.clearedCols, [4]);
  assert.equal(result.lines, 2);
  assert.equal(result.clearedCells.length, 15);
  assert.equal(new Set(result.clearedCells.map((cell) => cell.join(','))).size, 15);
  assert.equal(result.combo, 3);
  assert.equal(result.points, 610);
  assert.equal(result.board[0][0], 'mint');
  assert.equal(result.board.flat().filter(Boolean).length, 1);
  assert.deepEqual(board, before);
});

test('one block can clear several lines and each new chain starts at one', () => {
  const board = createBoard();
  for (let row = 0; row < 2; row += 1) board[row].fill('amber', 0, 6);
  const result = placePiece(board, pieceFor('square2'), 0, 6);
  assert.equal(result.lines, 2);
  assert.equal(result.combo, 1);
  assert.equal(result.points, 240);
  assert.equal(result.clearedCells.length, 16);
  assert.deepEqual(result.board, createBoard());
});

test('available moves consider every remaining piece, including a lone playable piece', () => {
  const board = createBoard();
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if ((row + col) % 2 === 0) board[row][col] = 'blue';
    }
  }
  assert.equal(hasAnyMove(board, [pieceFor('square2'), pieceFor('line3-h')]), false);
  assert.equal(hasAnyMove(board, [null, pieceFor('square2'), pieceFor('single')]), true);
  assert.equal(hasAnyMove(board, []), false);
  assert.equal(getValidPlacements(board, pieceFor('single').cells).length, 32);
  assert.deepEqual(getValidPlacements(createBoard(), pieceFor('square3').cells).at(-1), { row: 5, col: 5 });
});

test('shape and persisted data validators reject unknown colors and altered shapes', () => {
  assert.equal(isValidBoard(createBoard()), true);
  const invalid = createBoard();
  invalid[0][0] = 'unknown';
  assert.equal(isValidBoard(invalid), false);
  assert.equal(isValidBoard(Array(8)), false);
  assert.equal(isValidBoard(Array.from({ length: 8 }, () => Array(8))), false);
  assert.equal(isValidPiece(pieceFor('square2')), true);
  assert.equal(isValidPiece({ ...pieceFor('square2'), cells: [[0, 0]] }), false);
  assert.equal(isValidPiece({ ...pieceFor('square2'), color: '<script>' }), false);
  assert.equal(isValidPiece(null), false);
  assert.equal(new Set(SHAPES.map((shape) => shape.id)).size, SHAPES.length);
  for (const definition of SHAPES) assert.equal(canPlace(createBoard(), definition.cells, 0, 0), true);
});

test('generated hands have unique identities, valid shapes and playable sequences on tight boards', () => {
  const random = seededRandom(2026);
  const seenIds = new Set();
  for (let trial = 0; trial < 20; trial += 1) {
    const board = createBoard();
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        if (random() < 0.73) board[row][col] = 'violet';
      }
    }
    // A board with no complete lines represents the settled gameplay state.
    for (let index = 0; index < BOARD_SIZE; index += 1) board[index][index] = null;
    const original = structuredClone(board);
    const hand = generateHand(board, random);
    assert.equal(hand.length, 3);
    for (const piece of hand) {
      assert.equal(isValidPiece(piece), true);
      assert.equal(COLORS.includes(piece.color), true);
      assert.equal(seenIds.has(piece.id), false);
      seenIds.add(piece.id);
    }
    assert.equal(canPlaySequence(board, hand), true, `Unplayable hand on trial ${trial}`);
    assert.deepEqual(board, original);
  }
});

test('hand generation terminates for full boards and edge-valued random sources', () => {
  const full = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill('amber'));
  const hand = generateHand(full, () => 1);
  assert.equal(hand.length, 3);
  assert.equal(hasAnyMove(full, hand), false);
  for (const randomValue of [0, 1, -1, NaN, Infinity]) {
    const edgeHand = generateHand(createBoard(), () => randomValue);
    assert.equal(edgeHand.every(isValidPiece), true);
    assert.equal(canPlaySequence(createBoard(), edgeHand), true);
  }
});
