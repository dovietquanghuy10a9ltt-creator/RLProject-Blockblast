import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDragPosition, findGrabPoint } from '../src/drag.js';

const geometry = { left: 100, top: 200, stepX: 55, stepY: 55, cellWidth: 50, cellHeight: 50 };
const grab = { row: 0, col: 0, fx: .5, fy: .5 };
const shape = { rows: 2, cols: 3 };
test('a snapped visual and its drop target share exactly the same coordinates', () => {
  const p = resolveDragPosition({ x: 244, y: 398 }, grab, shape, geometry);
  assert.equal(p.col, 2); assert.equal(p.row, 3);
  assert.equal(p.x, geometry.left + p.col * geometry.stepX);
  assert.equal(p.y, geometry.top + p.row * geometry.stepY);
  assert.equal(p.width, 160); assert.equal(p.height, 105); assert.equal(p.inBounds, true);
});
test('a stationary pointer is reinterpreted using the current scrolled board', () => {
  const pointer = { x: 235, y: 390 };
  const before = resolveDragPosition(pointer, grab, shape, geometry);
  const after = resolveDragPosition(pointer, grab, shape, { ...geometry, top: 90 });
  assert.equal(after.row, before.row + 2);
  assert.equal(after.y, before.y);
});
test('changing zoom and cell dimensions preserves the grabbed cell and point', () => {
  const held = { row: 1, col: 2, fx: .25, fy: .75 };
  const g = { left: 40.25, top: -22.5, stepX: 42.625, stepY: 43.125, cellWidth: 38.25, cellHeight: 38.75 };
  const pointer = { x: g.left + 3 * g.stepX + held.col * g.stepX + held.fx * g.cellWidth,
    y: g.top + 2 * g.stepY + held.row * g.stepY + held.fy * g.cellHeight };
  const p = resolveDragPosition(pointer, held, shape, g);
  assert.equal(p.row, 2); assert.equal(p.col, 3);
  assert.equal(p.gapX, 4.375); assert.equal(p.gapY, 4.375);
});
test('touch lift is applied once to both the visual and logical position', () => {
  const pointer = { x: 125, y: 225 };
  const mouse = resolveDragPosition(pointer, grab, shape, geometry);
  const touch = resolveDragPosition({ x: pointer.x, y: pointer.y + 62 }, grab, shape, geometry, 62);
  assert.deepEqual(touch, mouse);
});
test('an oversized or outside shape does not become an in-bounds target', () => {
  assert.equal(resolveDragPosition({ x: 1000, y: 1000 }, grab, shape, geometry).inBounds, false);
  assert.equal(resolveDragPosition({ x: 10, y: 10 }, grab, shape, geometry).inBounds, false);
});
test('grabbing a sparse shape retains an occupied cell, not its empty bounding corner', () => {
  const blocks = [{ row: 0, col: 1, left: 123, top: 100, width: 20, height: 20 },
    { row: 1, col: 0, left: 100, top: 123, width: 20, height: 20 }];
  assert.deepEqual(findGrabPoint({ x: 128, y: 115 }, blocks), { row: 0, col: 1, fx: .25, fy: .75 });
  assert.equal(findGrabPoint({ x: 90, y: 140 }, blocks).row, 1);
});
