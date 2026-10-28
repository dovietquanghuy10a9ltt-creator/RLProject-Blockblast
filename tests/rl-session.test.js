import test from 'node:test';
import assert from 'node:assert/strict';
import { BlockNovaSession } from '../rl/session.js';
import { createBoard, generateHand, getValidPlacements, placePiece, resolveBlockConfig } from '../src/engine.js';

test('configurable pools never leak excluded shapes, including fallback', () => {
  for (const handSize of [1, 3, 9]) {
    const config = { handSize, enabledShapeIds: ['square3'] };
    for (const board of [createBoard(), Array.from({ length: 8 }, () => Array(8).fill('cyan'))]) {
      const hand = generateHand(board, () => 0.3, config);
      assert.equal(hand.length, handSize);
      assert.ok(hand.every((piece) => piece.shapeId === 'square3'));
    }
  }
  assert.equal(resolveBlockConfig({ shapeCount: 5 }).definitions.length, 5);
  assert.equal(resolveBlockConfig({ enabledShapeIds: ['single'], shapeCount: 99 }).definitions.length, 1);
  for (const config of [{ shapeCount: 0 }, { shapeCount: 31 }, { handSize: 10 }, { handSize: 1.5 },
    { enabledShapeIds: [] }, { enabledShapeIds: ['single', 'single'] }, { enabledShapeIds: ['unknown'] },
    { shapeWeights: { single: 0 } }, { shapeWeights: { unknown: 1 } }]) {
    assert.throws(() => resolveBlockConfig(config));
  }
});

test('headless transitions match direct browser engine play through multiple hands', () => {
  const seed = 42;
  const config = { handSize: 4, shapeCount: 12 };
  let rngState = seed;
  const random = () => {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 4294967296;
  };
  const session = new BlockNovaSession(config);
  let snapshot = session.reset(seed);
  let board = createBoard();
  let hand = generateHand(board, random, config);
  let score = 0;
  let combo = 0;
  for (let step = 0; step < 80 && !snapshot.terminated; step++) {
    assert.deepEqual(snapshot.hand.map((piece) => piece?.shapeId ?? null), hand.map((piece) => piece?.shapeId ?? null));
    const expectedMask = Array(config.handSize * 64).fill(false);
    hand.forEach((piece, slot) => {
      if (piece) for (const { row, col } of getValidPlacements(board, piece.cells)) expectedMask[slot * 64 + row * 8 + col] = true;
    });
    assert.deepEqual(snapshot.action_mask, expectedMask);
    const action = expectedMask.findIndex(Boolean);
    const slot = Math.floor(action / 64);
    const result = placePiece(board, hand[slot], Math.floor(action % 64 / 8), action % 8, combo);
    board = result.board;
    score += result.points;
    combo = result.combo;
    hand[slot] = null;
    if (hand.every((piece) => !piece)) hand = generateHand(board, random, config);
    snapshot = session.step(action);
    assert.equal(snapshot.reward, result.points);
    assert.equal(snapshot.score, score);
    assert.equal(snapshot.combo, combo);
    assert.deepEqual(snapshot.board, board.map((row) => row.map((cell) => Number(cell !== null))));
  }
  assert.ok(session.moves >= 8, 'Must exercise more than one complete hand');
});

test('session clears crossing lines and scores combo with the original rules', () => {
  const session = new BlockNovaSession({ enabledShapeIds: ['single'] });
  session.reset(10);
  for (let index = 0; index < 8; index++) {
    session.board[3][index] = 'cyan';
    session.board[index][4] = 'cyan';
  }
  session.board[3][4] = null;
  session.combo = 2;
  const result = session.step(3 * 8 + 4);
  assert.equal(result.reward, 610);
  assert.equal(result.combo, 3);
  assert.equal(result.lines, 2);
  assert.equal(result.board.flat().reduce((a, b) => a + b), 0);
});

test('session seed determinism, invalid no-op, and terminal masks', () => {
  const session = new BlockNovaSession({ enabledShapeIds: ['square3'] });
  const initial = session.reset(7);
  assert.deepEqual(session.reset(7), initial);
  const invalid = session.step(63);
  assert.equal(invalid.invalid_action, true);
  assert.equal(invalid.reward, 0);
  assert.equal(invalid.moves, 0);
  assert.deepEqual(invalid.board, initial.board);
  assert.throws(() => session.step(-1));
  session.board = Array.from({ length: 8 }, () => Array(8).fill('cyan'));
  session.board[0][0] = null;
  session.over = true;
  assert.ok(session.snapshot().action_mask.every((value) => !value));
  assert.throws(() => session.step(0));
});
