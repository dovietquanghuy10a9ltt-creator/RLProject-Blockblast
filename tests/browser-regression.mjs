/** Run a local server first, then: node tests/browser-regression.mjs */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { SHAPES, createBoard } from '../src/engine.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BLOCKNOVA_MODULES
  ? path.join(process.env.BLOCKNOVA_MODULES, 'playwright') : 'playwright');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const executablePath = process.env.BLOCKNOVA_BROWSER || (existsSync(edge) ? edge : undefined);
const baseURL = process.env.BLOCKNOVA_URL || 'http://localhost:5173';
const browser = await chromium.launch({ executablePath, headless: true });
const failures = [];
const pageErrors = [];
let retriedRendererImport = false;
mkdirSync('.qa', { recursive: true });

const piece = (shapeId, color = 'violet', id = `regression-${shapeId}`) => ({
  id, shapeId, color, cells: SHAPES.find((shape) => shape.id === shapeId).cells.map((cell) => [...cell]),
});
const fixture = (first = piece('square2')) => ({
  board: createBoard(),
  hand: [first, piece('line5-h', 'cyan'), piece('tee-right', 'amber')],
  score: 0, moves: 0, lines: 0, combo: 0, bestCombo: 0, elapsed: 0, over: false,
});

async function newPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 650 }, deviceScaleFactor: 1, ...options });
  const page = await context.newPage();
  const requests404 = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => { if (response.status() === 404) requests404.push(response.url()); });
  await page.addInitScript(() => {
    const next = sessionStorage.getItem('regression-next-game');
    if (next) {
      // Load after pagehide persisted the outgoing game, avoiding fixture races.
      localStorage.setItem('blocknova.v1.game', next);
      localStorage.setItem('blocknova.v1.settings', JSON.stringify({ sound: false, effects: true, threeD: true, volume: 0.65 }));
      sessionStorage.removeItem('regression-next-game');
    }
    window.__regressionPointerMoves = 0;
    window.addEventListener('pointerdown', (event) => { window.__regressionPointerId = event.pointerId; }, true);
    window.addEventListener('pointermove', () => { window.__regressionPointerMoves += 1; });
  });
  await page.goto(baseURL);
  try {
    await page.locator('.piece-slot').first().waitFor({ timeout: 5000 });
  } catch (error) {
    // During local development the renderer module may be written after main.js.
    if (retriedRendererImport || !requests404.some((url) => url.endsWith('/src/renderer3d.js'))) throw error;
    retriedRendererImport = true;
    await page.waitForTimeout(1000);
    await page.reload();
    await page.locator('.piece-slot').first().waitFor({ timeout: 5000 });
  }
  return page;
}

async function setFixture(page, first = piece('square2')) {
  await page.evaluate((game) => sessionStorage.setItem('regression-next-game', JSON.stringify(game)), fixture(first));
  await page.reload();
  await page.locator('.piece-slot').first().waitFor();
  await page.waitForTimeout(450);
}

const cell = (page, row, col) => page.locator(`.cell[data-row="${row}"][data-col="${col}"]`);
const center = (rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const readGame = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('blocknova.v1.game')));

async function startDrag(page, grabbed = [0, 0], viewportBottomMargin = 45) {
  const source = page.locator(`.piece-slot[data-index="0"] .jewel[data-piece-row="${grabbed[0]}"][data-piece-col="${grabbed[1]}"]`);
  await source.evaluate((element, margin) => {
    const rect = element.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + rect.top + rect.height / 2 - (innerHeight - margin));
  }, viewportBottomMargin);
  await frames(page);
  await page.mouse.move(...Object.values(center(await source.boundingBox())));
  await page.waitForTimeout(240); // Let the source button's hover transition settle.
  const from = center(await source.boundingBox());
  assert.ok(from.y >= 0 && from.y < page.viewportSize().height, `Source is visible: ${JSON.stringify(from)}`);
  await page.mouse.move(from.x, from.y);
  const before = await page.evaluate(() => scrollY);
  await page.mouse.down();
  await frames(page);
  const after = await page.evaluate(() => scrollY);
  assert.ok(Math.abs(after - before) < 1, `Pointer focus scrolled page: ${before} → ${after}`);
  return { grabbed, scroll: after };
}

async function dragTo(page, row, col, grabbed = [0, 0]) {
  const to = center(await cell(page, row + grabbed[0], col + grabbed[1]).boundingBox());
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await frames(page);
  return to;
}

async function previewCoordinates(page) {
  return page.locator('.cell.preview').evaluateAll((cells) => cells.map((element) => [Number(element.dataset.row), Number(element.dataset.col)]));
}

const sorted = (cells) => cells.map(([row, col]) => `${row},${col}`).sort();
const placedAt = (shape, row, col) => shape.cells.map(([dr, dc]) => [row + dr, col + dc]);

async function assertAligned(page, shape, row, col) {
  assert.deepEqual(sorted(await previewCoordinates(page)), sorted(placedAt(shape, row, col)), 'Preview must mark exact target cells');
  const measurements = await page.evaluate(() => {
    const ghost = document.getElementById('drag-ghost');
    return {
      active: ghost.classList.contains('active'), snapped: ghost.classList.contains('snapped'),
      blocks: [...ghost.querySelectorAll('.jewel')].map((block) => {
        const rect = block.getBoundingClientRect();
        return { row: Number(block.dataset.pieceRow), col: Number(block.dataset.pieceCol), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
      preview: [...document.querySelectorAll('.cell.preview')].map((block) => {
        const rect = block.getBoundingClientRect();
        return { row: Number(block.dataset.row), col: Number(block.dataset.col), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    };
  });
  assert.equal(measurements.active, true, 'Ghost remains active while held');
  assert.equal(measurements.snapped, true, 'A legal target is snapped');
  assert.equal(measurements.blocks.length, shape.cells.length);
  for (const block of measurements.blocks) {
    const target = measurements.preview.find((candidate) => candidate.row === row + block.row && candidate.col === col + block.col);
    assert.ok(target, `Missing target for ghost offset ${block.row},${block.col}`);
    for (const dimension of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(block[dimension] - target[dimension]) <= 1,
        `Ghost ${block.row},${block.col} ${dimension}: ${block[dimension].toFixed(3)} vs cell ${target[dimension].toFixed(3)} (delta ${(block[dimension] - target[dimension]).toFixed(3)}px)`);
    }
  }
}

async function assertPlaced(page, shape, row, col) {
  await page.waitForTimeout(460);
  const game = await readGame(page);
  const occupied = [];
  game.board.forEach((line, r) => line.forEach((color, c) => { if (color) occupied.push([r, c]); }));
  assert.deepEqual(sorted(occupied), sorted(placedAt(shape, row, col)), 'Saved placement must equal visible drop target');
  assert.equal(game.moves, 1);
  assert.equal(game.score, shape.cells.length * 10);
  assert.equal(game.hand[0], null);
  assert.equal(await page.locator('#drag-ghost.active').count(), 0);
}

async function run(name, action, page) {
  try {
    await action();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.error(`FAIL ${name}\n${error.stack}`);
    await page.screenshot({ path: `.qa/regression-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`, fullPage: true }).catch(() => {});
  } finally {
    await page.keyboard.press('Escape').catch(() => {});
    await page.mouse.up().catch(() => {});
  }
}

try {
  const page = await newPage();

  await run('initial scrolled viewport and focus without auto-scroll', async () => {
    const shape = piece('square2');
    await setFixture(page, shape);
    const drag = await startDrag(page, [0, 0], 12);
    assert.ok(drag.scroll > 100, 'Test must start on a substantially scrolled page');
    await dragTo(page, 2, 3);
    await assertAligned(page, shape, 2, 3);
    await page.mouse.up();
    await assertPlaced(page, shape, 2, 3);
  }, page);

  for (const direction of [1, -1]) {
    await run(`scroll ${direction > 0 ? 'down' : 'up'} during stationary drag`, async () => {
      const shape = piece('square2');
      await setFixture(page, shape);
      await startDrag(page);
      const initialRow = direction > 0 ? 2 : 4;
      await dragTo(page, initialRow, 2);
      await assertAligned(page, shape, initialRow, 2);
      const actualRows = await page.evaluate((direction) => {
        const first = document.querySelector('.cell[data-row="0"][data-col="0"]').getBoundingClientRect();
        const below = document.querySelector('.cell[data-row="1"][data-col="0"]').getBoundingClientRect();
        const step = below.top - first.top;
        const before = scrollY;
        window.scrollBy(0, direction * step * 2);
        return Math.round((scrollY - before) / step);
      }, direction);
      assert.ok(actualRows * direction >= 1, 'Fixture must actually scroll by at least one grid row');
      await frames(page);
      const finalRow = initialRow + actualRows;
      await assertAligned(page, shape, finalRow, 2);
      await page.mouse.up(); // No new pointermove after the scroll.
      await assertPlaced(page, shape, finalRow, 2);
    }, page);
  }

  await run('scroll and release before the next animation frame', async () => {
    const shape = piece('square2');
    await setFixture(page, shape);
    await startDrag(page);
    const pointer = await dragTo(page, 4, 2);
    const finalRow = await page.evaluate((pointer) => {
      const first = document.querySelector('.cell[data-row="0"][data-col="0"]').getBoundingClientRect();
      const below = document.querySelector('.cell[data-row="1"][data-col="0"]').getBoundingClientRect();
      const step = below.top - first.top;
      const before = scrollY;
      window.scrollBy(0, -step * 2);
      const row = 4 + Math.round((scrollY - before) / step);
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: pointer.x, clientY: pointer.y, pointerId: window.__regressionPointerId, pointerType: 'mouse', button: 0, bubbles: true }));
      return row;
    }, pointer);
    await assertPlaced(page, shape, finalRow, 2);
  }, page);

  await run('responsive resize while pointer remains held', async () => {
    const shape = piece('square2');
    await setFixture(page, shape);
    await startDrag(page);
    await dragTo(page, 2, 2);
    await page.setViewportSize({ width: 680, height: 650 });
    await frames(page);
    assert.equal(await page.locator('#drag-ghost.active').count(), 1, 'Resize preserves active drag');
    await dragTo(page, 2, 2);
    await assertAligned(page, shape, 2, 2);
    await page.mouse.up();
    await assertPlaced(page, shape, 2, 2);
  }, page);
  await page.setViewportSize({ width: 1440, height: 650 });

  for (const grabbed of [[0, 1], [2, 0], [2, 1]]) {
    await run(`sparse shape grabbed at ${grabbed.join('-')}`, async () => {
      const shape = piece('ell-sw');
      await setFixture(page, shape);
      await startDrag(page, grabbed);
      await dragTo(page, 2, 3, grabbed);
      await assertAligned(page, shape, 2, 3);
      await page.mouse.up();
      await assertPlaced(page, shape, 2, 3);
    }, page);
  }

  await run('root zoom 1.25 aligns every ghost block', async () => {
    const shape = piece('ell-sw');
    await setFixture(page, shape);
    await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
    await frames(page);
    await startDrag(page, [2, 1]);
    await dragTo(page, 2, 2, [2, 1]);
    await assertAligned(page, shape, 2, 2);
    await page.mouse.up();
    await assertPlaced(page, shape, 2, 2);
  }, page);

  for (const outside of [false, true]) {
    await run(`pointerup uses final coordinates ${outside ? 'outside board' : 'without latest move'}`, async () => {
      const shape = piece('square2');
      await setFixture(page, shape);
      await startDrag(page);
      await dragTo(page, 1, 1);
      await assertAligned(page, shape, 1, 1);
      const beforeMoveCount = await page.evaluate(() => window.__regressionPointerMoves);
      const destination = outside ? { x: 5, y: 5 } : center(await cell(page, 4, 4).boundingBox());
      const session = await page.context().newCDPSession(page);
      await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: destination.x, y: destination.y, button: 'left', buttons: 0, clickCount: 1 });
      await session.detach();
      assert.equal(await page.evaluate(() => window.__regressionPointerMoves), beforeMoveCount, 'Release must not include an intervening pointermove');
      if (outside) {
        await page.waitForTimeout(460);
        const game = await readGame(page);
        assert.equal(game.moves, 0);
        assert.equal(game.board.flat().filter(Boolean).length, 0);
        assert.equal(await page.locator('.cell.preview').count(), 0);
      } else await assertPlaced(page, shape, 4, 4);
    }, page);
  }

  for (const cancellation of ['Escape', 'pointercancel', 'lostpointercapture']) {
    await run(`cancellation via ${cancellation}`, async () => {
      const shape = piece('square2');
      await setFixture(page, shape);
      await startDrag(page);
      await dragTo(page, 2, 2);
      if (cancellation === 'Escape') await page.keyboard.press('Escape');
      else await page.evaluate((type) => {
        if (type === 'lostpointercapture') document.getElementById('piece-tray').releasePointerCapture(window.__regressionPointerId);
        else window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.__regressionPointerId, pointerType: 'mouse', bubbles: true }));
      }, cancellation);
      await frames(page);
      await page.mouse.up();
      await page.waitForTimeout(350);
      assert.equal((await readGame(page)).moves, 0);
      assert.equal(await page.locator('#drag-ghost.active').count(), 0);
      assert.equal(await page.locator('.cell.preview').count(), 0);
      assert.equal(await page.locator('body.is-dragging').count(), 0);
    }, page);
  }

  await run('keyboard selection and placement remains exact', async () => {
    const shape = piece('square2');
    await setFixture(page, shape);
    await page.keyboard.press('1');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(sorted(await previewCoordinates(page)), sorted(placedAt(shape, 1, 2)));
    await page.keyboard.press('Enter');
    await assertPlaced(page, shape, 1, 2);
  }, page);

  const fractional = await newPage({ deviceScaleFactor: 1.25 });
  await run('fractional device scale 1.25', async () => {
    const shape = piece('ell-sw');
    await setFixture(fractional, shape);
    await startDrag(fractional, [2, 1]);
    await dragTo(fractional, 2, 2, [2, 1]);
    await assertAligned(fractional, shape, 2, 2);
    await fractional.mouse.up();
    await assertPlaced(fractional, shape, 2, 2);
  }, fractional);

  for (const handSize of [1, 2, 5, 9]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const configured = await context.newPage();
    configured.on('pageerror', (error) => pageErrors.push(error.message));
    await configured.route('**/src/block-config.js', (route) => route.fulfill({
      contentType: 'text/javascript',
      body: `export const BLOCK_CONFIG = { handSize: ${handSize}, shapeCount: 30, enabledShapeIds: ['single'], shapeWeights: {} };`,
    }));
    await run(`configured hand size ${handSize}: keyboard, layout and saved game`, async () => {
      await configured.goto(baseURL);
      await configured.locator('.piece-slot').first().waitFor();
      assert.equal(await configured.locator('.piece-slot').count(), handSize);
      assert.equal(await configured.locator('#hand-count').textContent(), `${handSize} / ${handSize}`);
      await configured.keyboard.press(String(handSize));
      assert.equal(await configured.locator('.piece-slot.selected').getAttribute('data-index'), String(handSize - 1));
      await configured.keyboard.press('Enter');
      await configured.waitForFunction(() => document.getElementById('moves-count').textContent === '1');
      const bounds = await configured.locator('.piece-slot').evaluateAll((slots) => slots.map((slot) => {
        const box = slot.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width };
      }));
      assert.ok(bounds.every((box) => box.left >= 0 && box.right <= 390 && box.width > 0));
      await configured.reload();
      await configured.locator('.piece-slot').first().waitFor();
      assert.equal(await configured.locator('.piece-slot').count(), handSize);
      assert.equal(await configured.locator('#moves-count').textContent(), '1');
    }, configured);
    await context.close();
  }

  const actualErrors = pageErrors.filter((message) => !(retriedRendererImport && /Failed to fetch dynamically imported module: .*\/src\/renderer3d\.js/.test(message)));
  if (actualErrors.length) failures.push({ name: 'browser runtime errors', message: actualErrors.join('\n') });
  assert.deepEqual(failures, [], `${failures.length} browser regression(s) failed. Screenshots are in .qa/regression-*.png`);
  console.log('PASS all browser regressions and no runtime errors');
} finally {
  await browser.close();
}
