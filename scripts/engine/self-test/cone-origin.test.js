import assert from "node:assert/strict";
import { scoredAreaPlacement } from "../scoring/area.js";
import { casterEdgeOrigin, createAreaRegionData, tokensInAreaMarker } from "../area/region.js";

// PF2e/SF2e: a cone or line starts at the edge of the caster's space. A 20-ft cone from a Medium
// creature reaches the 4th square out; measured from its middle it fell a square short.
const previousCanvas = globalThis.canvas;
const token = (id, column, row, size = 1) => ({
  id, name: id,
  center: { x: (column + size / 2) * 100, y: (row + size / 2) * 100 },
  document: { id, width: size, height: size },
});
const shooter = token("shooter", 3, 7);
const goonA = token("goon-a", 7, 6);
const goonB = token("goon-b", 7, 8);
const junker = token("junker", 8, 7);
globalThis.canvas = {
  grid: { size: 100, distance: 5 }, scene: { grid: { size: 100, distance: 5 } }, dimensions: { distance: 5 },
  tokens: { placeables: [shooter, goonA, goonB, junker] },
};
try {
  const context = { token: { id: "shooter", center: shooter.center, width: 1, height: 1 }, profile: {} };
  const enemy = (entry, distance) => ({ id: entry.id, name: entry.id, center: entry.center, token: entry, distance });

  // The edge origin: straight ahead → the middle of the side; diagonal → the corner.
  assert.deepEqual(casterEdgeOrigin(context, shooter.center, 0), { x: 400, y: 750 });
  const diagonal = casterEdgeOrigin(context, shooter.center, Math.PI / 4);
  assert.ok(Math.abs(diagonal.x - 400) < 1e-6 && Math.abs(diagonal.y - 800) < 1e-6);
  assert.deepEqual(casterEdgeOrigin(context, { x: 900, y: 900 }, 0), { x: 900, y: 900 }, "a template placed elsewhere keeps its origin");
  // A Large caster's cone starts a full square out from its middle.
  const large = { token: { id: "ogre", center: { x: 400, y: 400 }, width: 2, height: 2 } };
  assert.deepEqual(casterEdgeOrigin(large, { x: 400, y: 400 }, 0), { x: 500, y: 400 });

  // Planning: three enemies 15 ft from the shooter's edge are inside a 20-ft cone.
  const cone = { targetingProfile: { area: true, type: "cone", distance: 20 } };
  const placement = scoredAreaPlacement(cone, context, {
    enemyValues: [enemy(goonA, 20), enemy(goonB, 20), enemy(junker, 25)], allyValues: [], maxCastRange: 20,
  });
  assert.deepEqual(placement.enemies.map((entry) => entry.id).sort(), ["goon-a", "goon-b"], "both Goons, not the Junker 20 ft past the edge");

  // Execution: the region and the creatures it targets use the same edge origin.
  const marker = { shape: "cone", center: shooter.center, distance: 20, rotation: 0 };
  const shape = createAreaRegionData({ context, action: cone, marker }).shapes[0];
  assert.equal(shape.x, 400);
  assert.equal(shape.y, 750);
  assert.deepEqual(tokensInAreaMarker({ context, action: cone, marker }).map((entry) => entry.id).sort(), ["goon-a", "goon-b"]);
  const placed = createAreaRegionData({ context, action: cone, marker: { ...marker, userPlaced: true } }).shapes[0];
  assert.equal(placed.x, 350, "a template placed by hand keeps its origin");

  // Lines too: a 20-ft line reaches 4 squares past the edge.
  const line = { targetingProfile: { area: true, type: "line", distance: 20, width: 5 } };
  const lineShape = createAreaRegionData({ context, action: line, marker: { shape: "line", center: shooter.center, distance: 20, width: 5, rotation: 0 } }).shapes[0];
  assert.equal(lineShape.x, 400);
} finally {
  globalThis.canvas = previousCanvas;
}
console.log("Cone origin tests passed.");
