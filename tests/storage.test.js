import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, generateHand, SHAPES } from '../src/engine.js';
import { DEFAULT_SETTINGS, loadData, saveGame, saveBest, saveSettings } from '../src/storage.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function validGame() {
  return {
    board: createBoard(),
    hand: generateHand(createBoard(), () => 0.3),
    score: 320,
    moves: 4,
    lines: 2,
    bestCombo: 2,
    combo: 0,
    elapsed: 125,
    over: false,
  };
}

function loadedGame(game) {
  return loadData(memoryStorage({ 'blocknova.v1.game': JSON.stringify(game) })).game;
}

test('empty storage returns independent defaults and a readable-storage flag', () => {
  const result = loadData(memoryStorage());
  assert.deepEqual(result, { game: null, best: 0, settings: DEFAULT_SETTINGS, available: true });
  result.settings.sound = false;
  assert.equal(DEFAULT_SETTINGS.sound, true);
  assert.equal(loadData(memoryStorage()).settings.sound, true);
});

test('game, best and settings round-trip through versioned storage keys', () => {
  const storage = memoryStorage();
  const game = validGame();
  game.hand[1] = null;
  assert.equal(saveGame(storage, game), true);
  assert.equal(saveBest(storage, 15000), true);
  assert.equal(saveSettings(storage, { sound: false, effects: true }), true);
  assert.deepEqual(loadData(storage), {
    game,
    best: 15000,
    settings: { ...DEFAULT_SETTINGS, sound: false, effects: true },
    available: true,
  });
  assert.equal(typeof storage.getItem('blocknova.v1.game'), 'string');
  assert.equal(storage.getItem('blocknova.v1.best'), '15000');
  game.board[0][0] = 'cyan';
  assert.equal(loadData(storage).game.board[0][0], null);
});

test('corrupt JSON and invalid records fall back independently', () => {
  const result = loadData(memoryStorage({
    'blocknova.v1.game': '{broken',
    'blocknova.v1.best': '1234',
    'blocknova.v1.settings': '{"sound":false,"effects":"yes"}',
  }));
  assert.equal(result.game, null);
  assert.equal(result.best, 1234);
  assert.deepEqual(result.settings, { ...DEFAULT_SETTINGS, sound: false, effects: true });
  assert.equal(result.available, true);
  for (const malformed of ['null', '[]', 'false', '"text"', '{"unknown":1}']) {
    const data = loadData(memoryStorage({ 'blocknova.v1.game': malformed, 'blocknova.v1.settings': malformed }));
    assert.equal(data.game, null);
    assert.deepEqual(data.settings, DEFAULT_SETTINGS);
  }
});

test('invalid boards, shape definitions, duplicate identities and empty hands are rejected', () => {
  const mutations = [
    (game) => { game.board = []; },
    (game) => { game.board[0][0] = 'invalid-color'; },
    (game) => { game.board[0].fill('cyan'); },
    (game) => { for (const row of game.board) row[0] = 'pink'; },
    (game) => { game.hand = []; },
    (game) => { game.hand = [null, null, null]; },
    (game) => { game.hand[0].cells = [[0, 0], [0, 0]]; },
    (game) => { game.hand[0].shapeId = 'not-a-shape'; },
    (game) => { game.hand[0].color = 'invalid-color'; },
    (game) => { game.hand[0].id = game.hand[1].id; },
  ];
  for (const mutate of mutations) {
    const game = validGame();
    mutate(game);
    assert.equal(loadedGame(game), null);
    assert.equal(saveGame(memoryStorage(), game), false);
  }
});

test('numeric fields reject negative, fractional, unsafe, missing and nonfinite values', () => {
  for (const field of ['score', 'moves', 'lines', 'bestCombo', 'combo', 'elapsed']) {
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER, NaN, Infinity, null, '1', undefined]) {
      const game = validGame();
      game[field] = bad;
      assert.equal(loadedGame(game), null, `${field}: ${String(bad)}`);
      assert.equal(saveGame(memoryStorage(), game), false, `${field}: ${String(bad)}`);
    }
  }
  for (const bad of [-1, 0.5, NaN, Infinity, '1', 1e13]) {
    assert.equal(saveBest(memoryStorage(), bad), false);
    const storage = memoryStorage({ 'blocknova.v1.best': JSON.stringify(bad) });
    assert.equal(loadData(storage).best, 0);
  }
  assert.equal(saveBest(memoryStorage(), 0), true);
});

test('combo history must be consistent with moves', () => {
  for (const changes of [{ combo: 5 }, { bestCombo: 5 }, { combo: 2, bestCombo: 1 }]) {
    assert.equal(loadedGame({ ...validGame(), ...changes }), null);
  }
});

test('game-over state must be boolean and agree with actual moves', () => {
  for (const over of [0, 1, null, 'false', true]) {
    assert.equal(loadedGame({ ...validGame(), over }), null);
  }
  const game = validGame();
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if ((row + col) % 2 === 0) game.board[row][col] = 'blue';
    }
  }
  const square = SHAPES.find((shape) => shape.id === 'square2');
  game.hand = [{ id: 'blocked-piece', shapeId: square.id, color: 'mint', cells: square.cells }, null, null];
  game.over = true;
  assert.deepEqual(loadedGame(game), game);
  game.over = false;
  assert.equal(loadedGame(game), null);
});

test('denied or unavailable browser storage never throws', () => {
  const denied = {
    getItem() { throw new Error('Storage denied'); },
    setItem() { throw new Error('Quota exceeded'); },
  };
  for (const storage of [denied, null, undefined, {}]) {
    assert.deepEqual(loadData(storage), { game: null, best: 0, settings: DEFAULT_SETTINGS, available: false });
    assert.equal(saveGame(storage, validGame()), false);
    assert.equal(saveBest(storage, 100), false);
    assert.equal(saveSettings(storage, DEFAULT_SETTINGS), false);
  }
  const readOnly = { getItem() { return null; }, setItem() { throw new Error('Quota exceeded'); } };
  assert.equal(loadData(readOnly).available, true);
  assert.equal(saveGame(readOnly, validGame()), false);
});

test('invalid writes leave an existing save intact and settings only store known fields', () => {
  const storage = memoryStorage();
  const game = validGame();
  assert.equal(saveGame(storage, game), true);
  assert.equal(saveGame(storage, { ...game, score: NaN }), false);
  assert.deepEqual(loadData(storage).game, game);
  assert.equal(saveSettings(storage, { sound: false, effects: false, extra: 'ignored' }), true);
  assert.equal(saveSettings(storage, { sound: 'false', effects: false }), false);
  assert.deepEqual(loadData(storage).settings, { ...DEFAULT_SETTINGS, sound: false, effects: false });
  assert.deepEqual(JSON.parse(storage.getItem('blocknova.v1.settings')), { ...DEFAULT_SETTINGS, sound: false, effects: false });
});

test('legacy sound/effects preferences migrate without changing previous choices', () => {
  const legacy = { sound: false, effects: false };
  const storage = memoryStorage({ 'blocknova.v1.settings': JSON.stringify(legacy) });
  const expected = { ...legacy, threeD: true, volume: 0.65 };
  assert.deepEqual(loadData(storage).settings, expected);
  assert.equal(saveSettings(storage, legacy), true);
  assert.deepEqual(JSON.parse(storage.getItem('blocknova.v1.settings')), expected);
});

test('3D preference and the full volume range round-trip independently of sound', () => {
  for (const volume of [0, 0.01, 0.35, 0.65, 1]) {
    for (const sound of [false, true]) {
      const storage = memoryStorage();
      const settings = { sound, effects: true, threeD: false, volume };
      assert.equal(saveSettings(storage, settings), true);
      assert.deepEqual(loadData(storage).settings, settings);
    }
  }
});

test('invalid 3D and volume values use defaults without discarding valid settings', () => {
  for (const threeD of [0, 1, 'false', null, undefined, {}, []]) {
    const settings = { sound: false, effects: false, threeD, volume: 0.25 };
    const storage = memoryStorage({ 'blocknova.v1.settings': JSON.stringify(settings) });
    const expected = { sound: false, effects: false, threeD: true, volume: 0.25 };
    assert.deepEqual(loadData(storage).settings, expected);
    assert.equal(saveSettings(storage, settings), true);
    assert.deepEqual(JSON.parse(storage.getItem('blocknova.v1.settings')), expected);
  }
  for (const volume of [-0.01, 1.01, NaN, Infinity, -Infinity, '0.5', null, undefined, {}, []]) {
    const settings = { sound: false, effects: true, threeD: false, volume };
    const storage = memoryStorage({ 'blocknova.v1.settings': JSON.stringify(settings) });
    const expected = { sound: false, effects: true, threeD: false, volume: 0.65 };
    assert.deepEqual(loadData(storage).settings, expected);
    assert.equal(saveSettings(storage, settings), true);
    assert.deepEqual(JSON.parse(storage.getItem('blocknova.v1.settings')), expected);
  }
});
