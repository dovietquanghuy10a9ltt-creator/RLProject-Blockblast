import { BOARD_SIZE, SHAPES, createBoard, canPlace, placePiece, generateHand, getValidPlacements, hasAnyMove } from './engine.js';
import { GameAudio } from './audio.js';
import { loadData, saveGame, saveBest, saveSettings } from './storage.js';
import { findGrabPoint, resolveDragPosition } from './drag.js';
import { BlockRenderer3D } from './renderer3d.js';
import { GameEffects } from './effects.js';

const $ = (id) => document.getElementById(id);
const boardElement = $('board');
const trayElement = $('piece-tray');
const frame = $('board-frame');
const dialog = $('game-dialog');
const audio = new GameAudio();
const format = (value) => new Intl.NumberFormat('vi-VN').format(value);
const colorNames = { violet: 'tím', cyan: 'xanh ngọc', blue: 'xanh dương', pink: 'hồng', amber: 'vàng', mint: 'xanh lá' };
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const loaded = loadData(storage);
let settings = loaded.settings;
let bestScore = loaded.best;
let state = loaded.game || freshGame();
let previousRecord = Math.max(bestScore, state.score);
bestScore = previousRecord;
let selected = -1;
let busy = false;
let drag = null;
let dragFrame = 0;
let preview = null;
let cursor = { row: 0, col: 0 };
let keyboardMode = false;
let ignoreClickUntil = 0;
let toastTimer;
let visualTimer;
let resultTimer;
let recordCelebrated = false;
let storageWarningShown = false;
const cellElements = [];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let renderer = null;
let effects = null;

function freshGame() {
  const board = createBoard();
  return { board, hand: generateHand(board), score: 0, moves: 0, lines: 0, combo: 0, bestCombo: 0, elapsed: 0, over: false };
}

function persist() {
  const success = saveGame(storage, state) && saveBest(storage, bestScore);
  if (!success) {
    document.querySelector('.save-note').textContent = 'Trình duyệt đang tắt lưu trữ';
    if (!storageWarningShown) {
      storageWarningShown = true;
      toast('Vẫn chơi được, nhưng trình duyệt này không cho lưu ván.');
    }
  }
}

function makeBoard() {
  for (let row = 0; row < BOARD_SIZE; row++) {
    const rowElement = document.createElement('div');
    rowElement.className = 'board-row';
    rowElement.setAttribute('role', 'row');
    rowElement.setAttribute('aria-rowindex', row + 1);
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.row = row;
      cell.dataset.col = col;
      cell.tabIndex = row === 0 && col === 0 ? 0 : -1;
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-colindex', col + 1);
      rowElement.appendChild(cell);
      cellElements.push(cell);
    }
    boardElement.appendChild(rowElement);
  }
}

function renderBoard(board = state.board) {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = cellElements[row * BOARD_SIZE + col];
      const color = board[row][col];
      cell.className = color ? `cell jewel color-${color}` : 'cell';
      cell.setAttribute('aria-label', `Hàng ${row + 1}, cột ${col + 1}: ${color ? 'khối ' + colorNames[color] : 'trống'}`);
      cell.setAttribute('aria-selected', 'false');
      cell.tabIndex = row === cursor.row && col === cursor.col ? 0 : -1;
    }
  }
}

function pieceDimensions(piece) {
  return { rows: Math.max(...piece.cells.map(([row]) => row)) + 1, cols: Math.max(...piece.cells.map(([, col]) => col)) + 1 };
}

function buildShape(piece, ghost = false) {
  const shape = document.createElement('div');
  shape.className = ghost ? '' : 'piece-shape';
  const { rows, cols } = pieceDimensions(piece);
  shape.style.setProperty('--piece-cols', cols);
  shape.style.setProperty('--piece-rows', rows);
  shape.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  shape.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  for (const [row, col] of piece.cells) {
    const block = document.createElement('span');
    block.className = `jewel color-${piece.color}`;
    block.style.gridRow = row + 1;
    block.style.gridColumn = col + 1;
    block.dataset.pieceRow = row;
    block.dataset.pieceCol = col;
    shape.appendChild(block);
  }
  return shape;
}

function renderTray(newHand = false) {
  trayElement.replaceChildren();
  state.hand.forEach((piece, index) => {
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = `piece-slot${newHand ? ' new-hand' : ''}`;
    slot.dataset.index = index;
    slot.setAttribute('aria-pressed', selected === index ? 'true' : 'false');
    const key = document.createElement('span');
    key.className = 'slot-key';
    key.textContent = index + 1;
    key.setAttribute('aria-hidden', 'true');
    slot.appendChild(key);
    if (piece) {
      const name = SHAPES.find((shape) => shape.id === piece.shapeId)?.name || 'Khối';
      slot.setAttribute('aria-label', `Khối ${index + 1}: ${name}, màu ${colorNames[piece.color]}, ${piece.cells.length} ô`);
      slot.appendChild(buildShape(piece));
      slot.style.setProperty('--piece-glow', { violet:'#b88aff',cyan:'#67e8e5',blue:'#80acff',pink:'#f396c6',amber:'#ffda7d',mint:'#85edbb' }[piece.color]);
      if (getValidPlacements(state.board, piece.cells).length === 0) {
        slot.classList.add('unavailable');
        slot.setAttribute('aria-label', slot.getAttribute('aria-label') + ', hiện chưa có chỗ đặt');
      }
    } else {
      slot.disabled = true;
      slot.classList.add('used');
      slot.setAttribute('aria-label', `Khối ${index + 1} đã đặt`);
      slot.insertAdjacentHTML('beforeend', '<svg class="slot-check" aria-hidden="true"><use href="#i-check" /></svg>');
    }
    trayElement.appendChild(slot);
  });
  updateSelection();
  $('hand-count').textContent = `${state.hand.filter(Boolean).length} / 3`;
}

function updateSelection() {
  [...trayElement.children].forEach((slot, index) => {
    slot.classList.toggle('selected', index === selected);
    slot.setAttribute('aria-pressed', index === selected ? 'true' : 'false');
  });
  $('play-hint').innerHTML = selected >= 0
    ? '<span class="tiny-dot"></span> Chọn ô đặt góc trên bên trái của khối · Esc để bỏ chọn'
    : '<span class="mouse-icon" aria-hidden="true"></span> Kéo khối vào bảng, hoặc chạm để chọn và đặt';
}

function renderStats(bump = false) {
  $('score').textContent = format(state.score);
  $('best-score').textContent = format(bestScore);
  $('mobile-best').textContent = format(bestScore);
  $('moves-count').textContent = format(state.moves);
  $('lines-count').textContent = format(state.lines);
  $('mobile-lines').textContent = format(state.lines);
  $('best-combo').textContent = `×${state.bestCombo}`;
  $('combo-value').textContent = state.combo > 0 ? `COMBO ×${state.combo}` : 'Sẵn sàng!';
  $('combo-caption').textContent = state.combo > 0 ? 'Phá tiếp để nhân điểm!' : 'Tạo chuỗi, nhân điểm';
  $('combo-badge').classList.toggle('active', state.combo > 0);
  $('record-caption').textContent = state.score > 0 && state.score >= bestScore ? 'Bạn đang lập kỷ lục mới!' : bestScore > 0 ? 'Thử vượt qua chính mình nhé' : 'Kỷ lục mới đang chờ bạn';
  const target = (Math.floor(state.score / 1000) + 1) * 1000;
  const progress = document.querySelector('.milestone-progress');
  progress.setAttribute('aria-valuemax', target);
  progress.setAttribute('aria-valuenow', state.score);
  $('milestone-fill').style.width = `${state.score / target * 100}%`;
  $('milestone-current').textContent = format(state.score);
  $('milestone-target').textContent = `${format(target)} điểm`;
  document.querySelector('.milestone-title h2').textContent = state.score >= 1000 ? 'Tiến tới cột mốc mới' : 'Chạm mốc đầu tiên';
  if (bump) animate($('score'), 'bump', 350);
  renderTime();
}

function renderTime() {
  const minutes = Math.floor(state.elapsed / 60).toString().padStart(2, '0');
  const seconds = (state.elapsed % 60).toString().padStart(2, '0');
  $('session-time').textContent = `${minutes}:${seconds}`;
}

function effectsEnabled() { return settings.effects && !reducedMotion.matches; }
function animate(element, className, duration) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  setTimeout(() => element.classList.remove(className), duration);
}
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3300);
}
function announce(message) { $('announcer').textContent = message; }

function clearPreview() {
  if (preview || keyboardMode) renderBoard();
  preview = null;
}

function showPreview(row, col) {
  if (busy || state.over || selected < 0 || !state.hand[selected]) return;
  if (preview?.row === row && preview?.col === col && preview?.index === selected) return;
  clearPreview();
  const piece = state.hand[selected];
  const valid = canPlace(state.board, piece.cells, row, col);
  preview = { row, col, valid, index: selected };
  if (valid) {
    for (const [dr, dc] of piece.cells) {
      const cell = cellElements[(row + dr) * BOARD_SIZE + col + dc];
      cell.className = `cell jewel color-${piece.color} preview`;
      cell.setAttribute('aria-selected', 'true');
    }
    const result = placePiece(state.board, piece, row, col, state.combo);
    for (const [r, c] of result.clearedCells) cellElements[r * BOARD_SIZE + c].classList.add('clear-preview');
  }
  if (keyboardMode && row >= 0 && col >= 0 && row < 8 && col < 8) cellElements[row * BOARD_SIZE + col].classList.add('keyboard-target');
  updateKeyboardMarker();
}

function selectPiece(index, keyboard = false) {
  if (busy || state.over || !state.hand[index] || dialog.open) return;
  clearPreview();
  selected = index;
  keyboardMode = keyboard;
  updateSelection();
  audio.play('select');
  const name = SHAPES.find((shape) => shape.id === state.hand[index].shapeId)?.name;
  announce(`Đã chọn khối ${index + 1}: ${name}. Chọn vị trí rồi nhấn Enter để đặt.`);
  if (keyboard) {
    const { rows, cols } = pieceDimensions(state.hand[index]);
    cursor.row = Math.min(cursor.row, BOARD_SIZE - rows);
    cursor.col = Math.min(cursor.col, BOARD_SIZE - cols);
    renderBoard();
    cellElements[cursor.row * BOARD_SIZE + cursor.col].focus({ preventScroll: true });
    showPreview(cursor.row, cursor.col);
  }
}

function cancelSelection() {
  finishDrag();
  clearPreview();
  selected = -1;
  keyboardMode = false;
  renderBoard();
  updateKeyboardMarker();
  updateSelection();
}

function attemptPlace(row, col) {
  if (busy || state.over || selected < 0 || dialog.open) return;
  const piece = state.hand[selected];
  if (!piece) return;
  const result = placePiece(state.board, piece, row, col, state.combo);
  if (!result) {
    audio.play('invalid');
    animate(frame, 'invalid', 260);
    announce('Khối không vừa vị trí này. Hãy chọn vùng trống khác.');
    return;
  }
  const selectedBefore = selected;
  const wasKeyboard = keyboardMode;
  const visualBoard = state.board.map((line) => [...line]);
  result.placedCells.forEach(([r, c]) => { visualBoard[r][c] = piece.color; });
  clearPreview();
  state.board = result.board;
  state.hand[selectedBefore] = null;
  state.score += result.points;
  state.moves++;
  state.lines += result.lines;
  state.combo = result.combo;
  state.bestCombo = Math.max(state.bestCombo, result.combo);
  bestScore = Math.max(bestScore, state.score);
  const newHand = state.hand.every((item) => item === null);
  if (newHand) state.hand = generateHand(state.board);
  state.over = !hasAnyMove(state.board, state.hand);
  selected = -1;
  keyboardMode = false;
  busy = true;
  // Persist the final logical board before animation so closing the tab cannot lose a move.
  persist();
  renderStats(true);
  renderBoard(visualBoard);
  renderTray(newHand);
  updateKeyboardMarker();
  for (const [r, c] of result.placedCells) cellElements[r * BOARD_SIZE + c].classList.add('placed');
  const perfect = result.lines > 0 && result.board.every((line) => line.every((cell) => cell === null));
  audio.play(perfect ? 'perfect' : result.lines ? (result.combo > 1 ? 'combo' : 'clear') : 'place', Math.max(result.combo, result.lines));
  announce(`Cộng ${format(result.points)} điểm.${result.lines ? ` Phá ${result.lines} hàng. Combo ${result.combo}.` : ''} Tổng ${format(state.score)} điểm.`);

  if (result.lines) {
    for (const [r, c] of result.clearedCells) cellElements[r * BOARD_SIZE + c].classList.add('clearing');
    effects.clear(result, visualBoard);
    animate(frame, 'flash', 520);
    showBoardMessage(perfect ? 'SẠCH BẢNG!' : result.combo > 1 ? `COMBO ×${result.combo}` : result.lines > 1 ? 'TUYỆT ĐỈNH!' : 'BÙNG NỔ!', `+${format(result.points)} điểm`);
  } else effects.place(result.placedCells, piece.color);
  if (!recordCelebrated && previousRecord > 0 && state.score > previousRecord) {
    recordCelebrated = true;
    effects.celebrate();
    audio.play('record');
    animate(document.querySelector('.record-card'), 'record-hit', 1250);
    toast('✦ Kỷ lục mới! Bạn vừa vượt qua chính mình.');
  }

  clearTimeout(visualTimer);
  visualTimer = setTimeout(() => {
    renderBoard();
    busy = false;
    if (newHand && !state.over) audio.play('deal');
    if (wasKeyboard) {
      const next = state.hand.findIndex(Boolean);
      if (next >= 0 && !state.over) trayElement.children[next].focus({ preventScroll: true });
    }
    if (state.over) {
      clearTimeout(resultTimer);
      resultTimer = setTimeout(() => { if (state.over) showGameOver(); }, result.lines && effectsEnabled() ? 700 : 180);
    }
  }, effectsEnabled() ? (result.lines ? 470 : 360) : 25);
}

function showBoardMessage(title, subtitle) {
  const element = $('board-message');
  syncViewportScale();
  const rect = boardElement.getBoundingClientRect();
  Object.assign(element.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  element.replaceChildren();
  const text = document.createElement('span'); text.textContent = title;
  const small = document.createElement('small'); small.textContent = subtitle;
  element.append(text, small);
  animate(element, 'show', 1400);
}

function resizeCanvas() {
  syncViewportScale();
  effects?.resize();
}
function stopParticles() {
  effects?.reset();
}

function syncViewportScale() {
  // DOM rectangles are already scaled by CSS zoom. Fixed overlays must not
  // multiply those measured coordinates a second time.
  const rootZoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const bodyZoom = parseFloat(getComputedStyle(document.body).zoom) || 1;
  const inverse = String(1 / (rootZoom * bodyZoom));
  if (document.documentElement.style.getPropertyValue('--overlay-zoom') !== inverse) {
    document.documentElement.style.setProperty('--overlay-zoom', inverse);
  }
}

function updateKeyboardMarker() {
  const marker = $('keyboard-marker');
  if (!marker) return;
  const visible = keyboardMode && selected >= 0 && !busy && !dialog.open;
  marker.hidden = !visible;
  if (visible) {
    syncViewportScale();
    const rect = cellElements[cursor.row * 8 + cursor.col].getBoundingClientRect();
    Object.assign(marker.style, { left: `${rect.left - 2}px`, top: `${rect.top - 2}px`, width: `${rect.width + 4}px`, height: `${rect.height + 4}px` });
  }
}

function boardGeometry() {
  // Never cache viewport coordinates across pointer events: focus, wheel, zoom,
  // browser bars and responsive layout can all move the board while held.
  const first = cellElements[0].getBoundingClientRect();
  const next = cellElements[1].getBoundingClientRect();
  const below = cellElements[8].getBoundingClientRect();
  return { left: first.left, top: first.top, cellWidth: first.width, cellHeight: first.height,
    stepX: next.left - first.left, stepY: below.top - first.top };
}

trayElement.addEventListener('pointerdown', (event) => {
  const slot = event.target.closest('.piece-slot');
  if (!slot || event.button !== 0 || busy || state.over || dialog.open || drag) return;
  const index = Number(slot.dataset.index);
  const piece = state.hand[index];
  if (!piece) return;
  event.preventDefault();
  slot.focus({ preventScroll: true });
  audio.unlock();
  const pointer = { x: event.clientX, y: event.clientY };
  const blocks = [...slot.querySelectorAll('.jewel')].map((block) => {
    const rect = block.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      row: Number(block.dataset.pieceRow), col: Number(block.dataset.pieceCol) };
  });
  selectPiece(index);
  drag = { index, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
    pointer, moved: false, touch: event.pointerType === 'touch', grab: findGrabPoint(pointer, blocks),
    shape: pieceDimensions(piece), target: null };
  trayElement.setPointerCapture(event.pointerId);
});

window.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.pointer = { x: event.clientX, y: event.clientY };
  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
  if (!drag.moved) {
    drag.moved = true;
    trayElement.children[drag.index].classList.add('dragging');
    const piece = state.hand[drag.index];
    const shape = buildShape(piece, true);
    const ghost = $('drag-ghost');
    ghost.replaceChildren(...shape.childNodes);
    ghost.style.gridTemplateColumns = shape.style.gridTemplateColumns;
    ghost.style.gridTemplateRows = shape.style.gridTemplateRows;
    ghost.classList.add('active');
    document.body.classList.add('is-dragging');
    audio.play('pickup');
  }
  scheduleDragUpdate();
  event.preventDefault();
}, { passive: false });

function scheduleDragUpdate() {
  if (!drag?.moved || dragFrame) return;
  dragFrame = requestAnimationFrame(() => { dragFrame = 0; updateDragPosition(); });
}

function updateDragPosition() {
  if (!drag?.moved || !state.hand[drag.index]) return;
  syncViewportScale();
  const position = resolveDragPosition(drag.pointer, drag.grab, drag.shape, boardGeometry(), drag.touch ? 62 : 0);
  const valid = position.inBounds && canPlace(state.board, state.hand[drag.index].cells, position.row, position.col);
  const previous = drag.target;
  drag.target = { row: position.row, col: position.col, valid };
  const ghost = $('drag-ghost');
  ghost.style.width = `${position.width}px`;
  ghost.style.height = `${position.height}px`;
  ghost.style.columnGap = `${position.gapX}px`;
  ghost.style.rowGap = `${position.gapY}px`;
  // The visible shape, preview and final drop use this exact same snapped point.
  ghost.style.transform = `translate3d(${valid ? position.x : position.rawX}px, ${valid ? position.y : position.rawY}px, 0)`;
  ghost.classList.toggle('snapped', valid);
  ghost.classList.toggle('blocked', position.inBounds && !valid);
  frame.classList.toggle('drop-ready', valid);
  showPreview(position.row, position.col);
  if (valid && (previous?.row !== position.row || previous?.col !== position.col)) audio.play('hover');
  effects.trail(drag.pointer.x, drag.pointer.y, state.hand[drag.index].color);
}

window.addEventListener('pointerup', (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const moved = drag.moved;
  drag.pointer = { x: event.clientX, y: event.clientY };
  updateDragPosition();
  const target = drag.target;
  finishDrag();
  if (moved) {
    ignoreClickUntil = performance.now() + 300;
    if (target?.valid) attemptPlace(target.row, target.col);
    else { clearPreview(); audio.play('drop'); }
  }
});
window.addEventListener('pointercancel', (event) => {
  if (drag?.pointerId === event.pointerId) { finishDrag(); clearPreview(); }
});
trayElement.addEventListener('lostpointercapture', () => { if (drag) { finishDrag(); clearPreview(); } });

function finishDrag() {
  const ended = drag;
  drag = null;
  cancelAnimationFrame(dragFrame); dragFrame = 0;
  $('drag-ghost').classList.remove('active', 'snapped', 'blocked');
  frame.classList.remove('drop-ready');
  document.body.classList.remove('is-dragging');
  [...trayElement.children].forEach((slot) => slot.classList.remove('dragging'));
  if (ended && trayElement.hasPointerCapture(ended.pointerId)) trayElement.releasePointerCapture(ended.pointerId);
}

trayElement.addEventListener('click', (event) => {
  if (performance.now() < ignoreClickUntil) return;
  const slot = event.target.closest('.piece-slot');
  if (slot && event.detail === 0) { audio.unlock(); selectPiece(Number(slot.dataset.index), true); }
});
boardElement.addEventListener('pointermove', (event) => {
  if (drag || selected < 0 || event.pointerType === 'touch') return;
  const cell = event.target.closest('.cell');
  if (cell) { keyboardMode = false; showPreview(Number(cell.dataset.row), Number(cell.dataset.col)); }
});
boardElement.addEventListener('pointerleave', () => { if (!drag) clearPreview(); });
boardElement.addEventListener('click', (event) => {
  if (performance.now() < ignoreClickUntil || busy) return;
  const cell = event.target.closest('.cell');
  if (!cell) return;
  audio.unlock();
  if (selected < 0) { if (!state.over) toast('Chọn một khối bên dưới trước nhé.'); return; }
  cursor = { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
  attemptPlace(cursor.row, cursor.col);
});

window.addEventListener('keydown', (event) => {
  if (dialog.open || event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (drag && event.key !== 'Escape') return;
  if (['1', '2', '3'].includes(event.key)) {
    event.preventDefault(); audio.unlock(); selectPiece(Number(event.key) - 1, true); return;
  }
  if (event.key === 'Escape') { cancelSelection(); return; }
  if (event.key.toLowerCase() === 'm') { toggleSound(); return; }
  if (event.key.toLowerCase() === 'n') { requestNewGame(); return; }
  const arrow = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
  if (arrow && (selected >= 0 || boardElement.contains(document.activeElement))) {
    event.preventDefault();
    keyboardMode = true;
    cursor.row = Math.max(0, Math.min(7, cursor.row + arrow[0]));
    cursor.col = Math.max(0, Math.min(7, cursor.col + arrow[1]));
    renderBoard();
    cellElements[cursor.row * 8 + cursor.col].focus({ preventScroll: true });
    preview = null;
    if (selected >= 0) showPreview(cursor.row, cursor.col);
    return;
  }
  if ((event.key === 'Enter' || event.key === ' ') && selected >= 0 && boardElement.contains(document.activeElement)) {
    event.preventDefault(); audio.unlock(); attemptPlace(cursor.row, cursor.col);
  }
});

function openDialog(html) {
  finishDrag(); clearPreview();
  $('dialog-content').innerHTML = html;
  if (!dialog.open) dialog.showModal();
  updateKeyboardMarker();
}
function emblem(icon) { return `<div class="dialog-emblem"><svg aria-hidden="true"><use href="#i-${icon}" /></svg></div>`; }
const SHAPE_CATEGORIES = [
  { name: '1. Ô và thanh', ids: ['single', 'domino-h', 'domino-v', 'line3-h', 'line3-v', 'line4-h', 'line4-v'] },
  { name: '2. Vuông & Chữ nhật', ids: ['square2', 'square3'] },
  { name: '3. Khối góc', ids: ['corner-nw', 'corner-se'] },
  { name: '4. Khối chữ L', ids: ['ell-se', 'ell-sw'] },
  { name: '5. Khối chữ T', ids: ['tee-down', 'tee-up'] },
  { name: '6. Khối zích zắc', ids: ['zigzag-h', 'zagzig-h'] },
  { name: '7. Khối đặc biệt', ids: ['big-corner'] },
];

function showCatalog() {
  const categoryColors = ['cyan', 'amber', 'mint', 'blue', 'pink', 'violet', 'amber'];
  let html = `${emblem('sparkle')}<h2 id="dialog-title">Danh Mục 18 Khối</h2><p class="dialog-description">18 khối chuẩn cân bằng cho bàn cờ 8×8 (đủ 7 thể loại hình khối).</p><div class="catalog-content">`;
  SHAPE_CATEGORIES.forEach((cat, catIdx) => {
    const color = categoryColors[catIdx % categoryColors.length];
    html += `<div class="catalog-group"><div class="catalog-group-title"><span>${cat.name}</span><span class="catalog-group-badge">${cat.ids.length} khối</span></div><div class="catalog-grid">`;
    cat.ids.forEach((shapeId) => {
      const def = SHAPES.find((s) => s.id === shapeId);
      if (!def) return;
      html += `<div class="catalog-card"><div class="catalog-card-shape" data-shape="${def.id}" data-color="${color}"></div><div class="catalog-card-name">${def.name}</div><div class="catalog-card-size">${def.cells.length} ô</div></div>`;
    });
    html += `</div></div>`;
  });
  html += `</div><button class="dialog-primary" id="catalog-done">Quay lại chơi</button>`;
  openDialog(html);

  document.querySelectorAll('.catalog-card-shape').forEach((container) => {
    const shapeId = container.dataset.shape;
    const color = container.dataset.color || 'violet';
    const def = SHAPES.find((s) => s.id === shapeId);
    if (def) container.appendChild(buildShape({ cells: def.cells, color }));
  });
  $('catalog-done').addEventListener('click', () => dialog.close());
}

function showHelp() {
  openDialog(`${emblem('sparkle')}<h2 id="dialog-title">Vào nhịp trong tích tắc.</h2><p class="dialog-description">Một bảng trống. Ba khối màu.<br>Bạn sẽ đi được bao xa?</p><div class="dialog-steps"><div class="dialog-step"><span class="step-number">01</span><div><b>Chọn và xếp khối</b>Kéo một khối vào bảng. Bạn cũng có thể chạm khối rồi chạm vị trí đặt góc trên bên trái. Khối giữ nguyên hướng.</div></div><div class="dialog-step"><span class="step-number">02</span><div><b>Lấp đầy hàng hoặc cột</b>Mỗi ô đặt xuống được 10 điểm. Hàng hoặc cột đầy sẽ biến mất, cộng 100 điểm × combo cho mỗi hàng.</div></div><div class="dialog-step"><span class="step-number">03</span><div><b>Giữ chuỗi, phá kỷ lục</b>Phá hàng ở các lượt đặt liên tiếp để tăng combo. Đặt hết ba khối để nhận bộ mới. Ván kết thúc khi không khối còn lại nào vừa bảng.</div></div></div><div class="dialog-shortcuts">1 / 2 / 3: chọn khối · Phím mũi tên: di chuyển<br>Enter: đặt · Esc: bỏ chọn · M: âm thanh · N: ván mới</div><div style="display:flex;gap:10px;margin-top:14px"><button class="dialog-primary" id="help-done" style="flex:1">Chơi thôi <svg><use href="#i-arrow" /></svg></button><button class="dialog-secondary" id="help-catalog">Xem 18 khối</button></div>`);
  $('help-done').addEventListener('click', () => dialog.close());
  $('help-catalog').addEventListener('click', showCatalog);
}
function requestNewGame() {
  if (busy) return;
  if (!state.moves || state.over) { startNewGame(); return; }
  openDialog(`${emblem('restart')}<h2 id="dialog-title">Một khởi đầu mới?</h2><p class="dialog-description">Bạn đang có <strong>${format(state.score)} điểm</strong>.<br>Ván hiện tại sẽ kết thúc. Kỷ lục của bạn luôn được giữ lại.</p><button class="dialog-primary" id="confirm-new-game">Bắt đầu ván mới</button><button class="dialog-secondary" id="keep-playing">Chơi tiếp ván này</button>`);
  $('confirm-new-game').addEventListener('click', startNewGame);
  $('keep-playing').addEventListener('click', () => dialog.close());
}
function startNewGame() {
  clearTimeout(visualTimer); clearTimeout(resultTimer);
  dialog.close();
  cancelSelection();
  stopParticles();
  $('board-message').classList.remove('show');
  frame.classList.remove('flash', 'invalid');
  previousRecord = bestScore;
  recordCelebrated = false;
  state = freshGame();
  busy = false;
  cursor = { row: 0, col: 0 };
  renderBoard(); renderTray(true); renderStats(); persist();
  audio.unlock().then(() => audio.play('newgame'));
  announce('Ván mới đã bắt đầu. Chọn một trong ba khối để chơi.');
}
function showGameOver() {
  if (!state.over) return;
  audio.play('gameover');
  openDialog(`${emblem('trophy')}<h2 id="dialog-title">${state.score > previousRecord ? 'Một kỷ lục mới!' : 'Một ván thật đáng nhớ.'}</h2><p class="dialog-description">Các khối còn lại không còn chỗ đặt.<br>Một khởi đầu mới đang chờ bạn.</p><div class="dialog-score">${format(state.score)}</div><div class="dialog-score-label">ĐIỂM CỦA BẠN</div><div class="dialog-stats"><div><strong>${format(state.lines)}</strong><span>Hàng đã phá</span></div><div><strong>×${state.bestCombo}</strong><span>Combo cao nhất</span></div><div><strong>${format(bestScore)}</strong><span>Kỷ lục</span></div></div><button class="dialog-primary" id="play-again"><svg><use href="#i-restart" /></svg> Thêm một ván nữa</button><button class="dialog-secondary" id="view-board">Xem lại bảng</button>`);
  $('play-again').addEventListener('click', startNewGame);
  $('view-board').addEventListener('click', () => dialog.close());
  $('play-hint').textContent = 'Hết chỗ đặt rồi! Bắt đầu ván mới để thử lại nhé.';
  announce(`Ván kết thúc. Bạn đạt ${format(state.score)} điểm và phá ${state.lines} hàng.`);
}

function applySettings() {
  audio.setEnabled(settings.sound);
  audio.setVolume(settings.volume);
  $('sound-button').innerHTML = `<svg><use href="#i-${settings.sound ? 'sound' : 'muted'}" /></svg>`;
  $('sound-button').setAttribute('aria-label', settings.sound ? 'Tắt âm thanh' : 'Bật âm thanh');
  $('sound-button').title = settings.sound ? 'Tắt âm thanh' : 'Bật âm thanh';
  $('sound-button').setAttribute('aria-pressed', String(settings.sound));
  document.body.classList.toggle('reduce-motion', !settings.effects);
  effects?.setEnabled(effectsEnabled());
  renderer?.setMotionEnabled(effectsEnabled());
  renderer?.setEnabled(settings.threeD);
  updateRenderBadge();
  if (!effectsEnabled()) stopParticles();
}
function updateRenderBadge(available = renderer?.available) {
  const active = settings.threeD && available;
  $('render-badge').textContent = active ? '3D' : '2D';
  $('render-badge').dataset.mode = active ? '3d' : '2d';
}
function toggleSound() {
  settings.sound = !settings.sound;
  applySettings(); saveSettings(storage, settings);
  if (settings.sound) audio.unlock().then(() => audio.play('select'));
}
function showSettings() {
  openDialog(`${emblem('settings')}<h2 id="dialog-title">Theo nhịp của bạn.</h2><p class="dialog-description">Một không gian chơi thật thoải mái.</p><div class="setting-row"><div><strong>Âm thanh</strong><p>Tiếng khối chạm và giai điệu combo.</p></div><button class="toggle" id="setting-sound" role="switch" aria-label="Âm thanh" aria-checked="${settings.sound}"></button></div><div class="volume-control"><label for="setting-volume" class="volume-label">Âm lượng</label><output id="volume-value" for="setting-volume">${Math.round(settings.volume * 100)}%</output><input id="setting-volume" type="range" min="0" max="100" step="1" value="${Math.round(settings.volume * 100)}" aria-label="Âm lượng" style="grid-column:1 / -1"></div><div class="setting-row"><div><strong>Khối 3D</strong><p>Mặt vát, ánh sáng và chiều sâu.</p></div><button class="toggle" id="setting-3d" role="switch" aria-label="Khối 3D" aria-checked="${settings.threeD && renderer.available}" ${renderer.available ? '' : 'disabled'}></button></div>${renderer.available ? '' : '<p class="graphics-note">Trình duyệt này đang dùng chế độ 2D để bạn tiếp tục chơi mượt.</p>'}<div class="setting-row"><div><strong>Hiệu ứng chuyển động</strong><p>Tia sáng, mảnh khối và hiệu ứng combo.</p></div><button class="toggle" id="setting-effects" role="switch" aria-label="Hiệu ứng chuyển động" aria-checked="${settings.effects}"></button></div><p class="settings-footer">${reducedMotion.matches ? 'Thiết bị của bạn đang ưu tiên giảm chuyển động. Game sẽ tôn trọng lựa chọn này.<br>' : ''}Ván chơi, kỷ lục và cài đặt được lưu trên trình duyệt này.</p><button class="dialog-primary" id="settings-done">Tiếp tục chơi</button>`);
  $('setting-sound').addEventListener('click', () => { toggleSound(); $('setting-sound').setAttribute('aria-checked', String(settings.sound)); });
  $('setting-effects').addEventListener('click', () => { settings.effects = !settings.effects; applySettings(); saveSettings(storage, settings); $('setting-effects').setAttribute('aria-checked', String(settings.effects)); });
  $('setting-3d').addEventListener('click', () => { settings.threeD = !settings.threeD; applySettings(); saveSettings(storage, settings); $('setting-3d').setAttribute('aria-checked', String(settings.threeD)); });
  $('setting-volume').addEventListener('input', (event) => {
    settings.volume = Number(event.target.value) / 100;
    audio.setVolume(settings.volume);
    $('volume-value').textContent = `${Math.round(settings.volume * 100)}%`;
    saveSettings(storage, settings);
  });
  $('setting-volume').addEventListener('change', () => audio.unlock().then(() => audio.play('select')));
  $('settings-done').addEventListener('click', () => dialog.close());
}

$('sound-button').addEventListener('click', toggleSound);
$('catalog-button')?.addEventListener('click', showCatalog);
$('help-button').addEventListener('click', showHelp);
$('settings-button').addEventListener('click', showSettings);
$('new-game-button').addEventListener('click', requestNewGame);
$('mobile-restart').addEventListener('click', requestNewGame);
$('dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  if (keyboardMode && selected >= 0 && !state.over) showPreview(cursor.row, cursor.col);
  updateKeyboardMarker();
});
dialog.addEventListener('click', (event) => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
window.addEventListener('resize', () => { resizeCanvas(); scheduleDragUpdate(); updateKeyboardMarker(); });
window.addEventListener('scroll', () => { scheduleDragUpdate(); updateKeyboardMarker(); }, { passive: true, capture: true });
window.visualViewport?.addEventListener('resize', scheduleDragUpdate);
window.visualViewport?.addEventListener('scroll', scheduleDragUpdate);
window.addEventListener('blur', () => { if (drag) { finishDrag(); clearPreview(); } persist(); });
window.addEventListener('pagehide', persist);
document.addEventListener('visibilitychange', () => {
  audio.setPaused(document.hidden);
  if (document.hidden) { finishDrag(); clearPreview(); stopParticles(); persist(); }
});
reducedMotion.addEventListener('change', applySettings);
setInterval(() => {
  if (!document.hidden && !dialog.open && !state.over && state.moves > 0) {
    state.elapsed++;
    renderTime();
    if (state.elapsed % 10 === 0) persist();
  }
}, 1000);

makeBoard();
document.body.appendChild($('board-message'));
const keyboardMarker = document.createElement('div');
keyboardMarker.id = 'keyboard-marker'; keyboardMarker.hidden = true; keyboardMarker.setAttribute('aria-hidden', 'true');
document.body.appendChild(keyboardMarker);
effects = new GameEffects($('particles'), cellElements, boardElement);
syncViewportScale();
renderer = new BlockRenderer3D($('blocks-3d'), { onAvailabilityChange: updateRenderBadge });
resizeCanvas();
applySettings();
renderBoard();
renderTray(true);
renderStats();
persist();
if (loaded.game && state.over) showGameOver();
else if (loaded.game && state.moves > 0) toast('Đã khôi phục ván chơi. Tiếp tục bùng nổ nhé!');
