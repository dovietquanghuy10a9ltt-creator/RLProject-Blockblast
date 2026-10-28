/** Resolve both the visual block and its drop target in the same viewport space. */
export function resolveDragPosition(pointer, grab, shape, geometry, touchLift = 0) {
  const { left, top, stepX, stepY, cellWidth, cellHeight } = geometry;
  const width = (shape.cols - 1) * stepX + cellWidth;
  const height = (shape.rows - 1) * stepY + cellHeight;
  const rawX = pointer.x - grab.col * stepX - grab.fx * cellWidth;
  const rawY = pointer.y - grab.row * stepY - grab.fy * cellHeight - touchLift;
  const row = Math.round((rawY - top) / stepY);
  const col = Math.round((rawX - left) / stepX);
  return { row, col, rawX, rawY, x: left + col * stepX, y: top + row * stepY, width, height,
    gapX: stepX - cellWidth, gapY: stepY - cellHeight,
    inBounds: row >= 0 && col >= 0 && row + shape.rows <= 8 && col + shape.cols <= 8 };
}

/** Retain the occupied cell actually grabbed, even when the tray scales a shape. */
export function findGrabPoint(pointer, blocks) {
  let closest = null;
  let bestDistance = Infinity;
  for (const block of blocks) {
    const { left, top, width, height } = block;
    const dx = Math.max(left - pointer.x, 0, pointer.x - left - width);
    const dy = Math.max(top - pointer.y, 0, pointer.y - top - height);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) { closest = block; bestDistance = distance; }
  }
  if (!closest) return { row: 0, col: 0, fx: .5, fy: .5 };
  return { row: closest.row, col: closest.col,
    fx: Math.max(0, Math.min(1, (pointer.x - closest.left) / Math.max(1, closest.width))),
    fy: Math.max(0, Math.min(1, (pointer.y - closest.top) / Math.max(1, closest.height))) };
}
