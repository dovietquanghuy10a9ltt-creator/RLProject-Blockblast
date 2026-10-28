import {
  BOARD_SIZE, SHAPES, createBoard, generateHand, getValidPlacements,
  placePiece, hasAnyMove, resolveBlockConfig,
} from '../src/engine.js';

/** Headless game using exactly the browser engine, with a private seeded RNG. */
export class BlockNovaSession {
  constructor(config = {}) {
    const resolved = resolveBlockConfig(config);
    this.config = {
      handSize: resolved.handSize,
      enabledShapeIds: resolved.definitions.map((definition) => definition.id),
      shapeWeights: resolved.shapeWeights,
    };
    this.ready = false;
  }

  spec() {
    return { boardSize: BOARD_SIZE, shapes: SHAPES, config: this.config };
  }

  reset(seed) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Expected a uint32 seed');
    let state = seed >>> 0;
    this.random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    this.board = createBoard();
    this.hand = generateHand(this.board, this.random, this.config);
    this.score = 0;
    this.moves = 0;
    this.lines = 0;
    this.combo = 0;
    this.over = !hasAnyMove(this.board, this.hand);
    this.ready = true;
    return this.snapshot();
  }

  actionMasks() {
    const mask = Array(this.config.handSize * BOARD_SIZE * BOARD_SIZE).fill(false);
    if (this.over) return mask;
    this.hand.forEach((piece, slot) => {
      if (!piece) return;
      for (const { row, col } of getValidPlacements(this.board, piece.cells)) {
        mask[slot * 64 + row * 8 + col] = true;
      }
    });
    return mask;
  }

  snapshot() {
    if (!this.ready) throw new Error('Call reset before reading the game');
    return {
      board: this.board.map((row) => row.map((cell) => Number(cell !== null))),
      hand: this.hand.map((piece) => piece ? { shapeId: piece.shapeId, cells: piece.cells } : null),
      score: this.score, moves: this.moves, lines: this.lines, combo: this.combo,
      terminated: this.over, action_mask: this.actionMasks(),
    };
  }

  step(action) {
    if (!this.ready || this.over) throw new Error('Call reset before stepping a new episode');
    if (!Number.isInteger(action) || action < 0 || action >= this.config.handSize * 64) {
      throw new RangeError('Action outside action space');
    }
    const slot = Math.floor(action / 64);
    const row = Math.floor((action % 64) / 8);
    const col = action % 8;
    const result = placePiece(this.board, this.hand[slot], row, col, this.combo);
    // Invalid in-range actions are no-ops with zero reward. The Python time
    // limit counts attempts, so an unmasked random agent cannot loop forever.
    if (!result) return { ...this.snapshot(), reward: 0, invalid_action: true };
    this.board = result.board;
    this.hand[slot] = null;
    this.score += result.points;
    this.moves += 1;
    this.lines += result.lines;
    this.combo = result.combo;
    if (this.hand.every((piece) => piece === null)) this.hand = generateHand(this.board, this.random, this.config);
    this.over = !hasAnyMove(this.board, this.hand);
    return { ...this.snapshot(), reward: result.points, invalid_action: false };
  }
}
