import { BOARD_SIZE, hasAnyMove, isValidBoard, isValidPiece, resolveBlockConfig } from './engine.js';

const blockConfig = resolveBlockConfig();
const enabledShapes = new Set(blockConfig.definitions.map((definition) => definition.id));

export const DEFAULT_SETTINGS = Object.freeze({ sound: true, effects: true, threeD: true, volume: 0.65 });

const KEYS = Object.freeze({
  game: 'blocknova.v1.game',
  best: 'blocknova.v1.best',
  settings: 'blocknova.v1.settings',
});
const SCORE_LIMIT = 1_000_000_000_000;
const COUNT_LIMIT = 1_000_000_000;
const TIME_LIMIT = 1_000_000_000_000;

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonnegativeInteger(value, limit) {
  return Number.isSafeInteger(value) && value >= 0 && value <= limit;
}

function parse(value) {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function settingsFrom(value) {
  const settings = record(value) ? value : {};
  return {
    sound: typeof settings.sound === 'boolean' ? settings.sound : DEFAULT_SETTINGS.sound,
    effects: typeof settings.effects === 'boolean' ? settings.effects : DEFAULT_SETTINGS.effects,
    threeD: typeof settings.threeD === 'boolean' ? settings.threeD : DEFAULT_SETTINGS.threeD,
    volume: typeof settings.volume === 'number' && Number.isFinite(settings.volume) && settings.volume >= 0 && settings.volume <= 1
      ? settings.volume : DEFAULT_SETTINGS.volume,
  };
}

/** Accept only a settled, self-consistent game, then copy known fields. */
function gameFrom(value) {
  if (!record(value) || !isValidBoard(value.board) || !Array.isArray(value.hand) || value.hand.length !== blockConfig.handSize) return null;
  if (!Array.from(value.hand).every((piece) => piece === null || (isValidPiece(piece) && enabledShapes.has(piece.shapeId)))) return null;
  const remainingPieces = value.hand.filter((piece) => piece !== null);
  if (remainingPieces.length === 0 || new Set(remainingPieces.map((piece) => piece.id)).size !== remainingPieces.length) return null;

  if (!nonnegativeInteger(value.score, SCORE_LIMIT) || !nonnegativeInteger(value.elapsed, TIME_LIMIT)) return null;
  for (const field of ['moves', 'lines', 'bestCombo', 'combo']) {
    if (!nonnegativeInteger(value[field], COUNT_LIMIT)) return null;
  }
  if (value.combo > value.moves || value.bestCombo > value.moves || value.bestCombo < value.combo) return null;
  if (typeof value.over !== 'boolean' || value.over !== !hasAnyMove(value.board, value.hand)) return null;

  // A saved position is taken after the move's completed lines have cleared.
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    if (value.board[index].every((cell) => cell !== null) || value.board.every((row) => row[index] !== null)) return null;
  }

  return {
    board: value.board.map((row) => [...row]),
    hand: value.hand.map((piece) => piece === null ? null : {
      id: piece.id,
      shapeId: piece.shapeId,
      cells: piece.cells.map((cell) => [...cell]),
      color: piece.color,
    }),
    score: value.score,
    moves: value.moves,
    lines: value.lines,
    bestCombo: value.bestCombo,
    combo: value.combo,
    elapsed: value.elapsed,
    over: value.over,
  };
}

/** Malformed values fall back independently; a denied storage read never throws. */
export function loadData(storage) {
  const defaults = { game: null, best: 0, settings: { ...DEFAULT_SETTINGS }, available: false };
  try {
    if (!storage || typeof storage.getItem !== 'function') return defaults;
    const game = gameFrom(parse(storage.getItem(KEYS.game)));
    const savedBest = parse(storage.getItem(KEYS.best));
    const settings = settingsFrom(parse(storage.getItem(KEYS.settings)));
    return {
      game,
      best: nonnegativeInteger(savedBest, SCORE_LIMIT) ? savedBest : 0,
      settings,
      available: true,
    };
  } catch {
    return defaults;
  }
}

function write(storage, key, value) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  storage.setItem(key, JSON.stringify(value));
  return true;
}

export function saveGame(storage, game) {
  try {
    const validGame = gameFrom(game);
    return validGame !== null && write(storage, KEYS.game, validGame);
  } catch {
    return false;
  }
}

export function saveBest(storage, best) {
  try {
    return nonnegativeInteger(best, SCORE_LIMIT) && write(storage, KEYS.best, best);
  } catch {
    return false;
  }
}

export function saveSettings(storage, settings) {
  try {
    if (!record(settings) || typeof settings.sound !== 'boolean' || typeof settings.effects !== 'boolean') return false;
    return write(storage, KEYS.settings, settingsFrom(settings));
  } catch {
    return false;
  }
}
