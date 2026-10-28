/** Shared by the browser game and Gymnasium. Restart the game/env after editing. */
export const BLOCK_CONFIG = Object.freeze({
  // Number of pieces dealt together (1–9).
  handSize: 3,
  // Use the first N entries in SHAPES. null means all available shapes.
  shapeCount: 30,
  // Alternatively list exact shape IDs; when set, this takes priority over shapeCount.
  enabledShapeIds: null,
  // Optional positive multipliers on the original generator weights.
  shapeWeights: {},
});
