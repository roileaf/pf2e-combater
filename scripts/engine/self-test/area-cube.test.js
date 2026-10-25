import assert from "node:assert/strict";
import { createAreaRegionData, tokensInAreaMarker } from "../area/region.js";

// Roi, live: Spout (a 5-foot cube) placed a square turned toward the caster and hanging off its
// corner. Foundry anchors a rectangle at its top-left, Combater handed it the center, and turned it
// to face the caster. A cube now sits on the grid, centered where it was placed, never turned.
const saved = Object.fromEntries(["canvas"].map((key) => [key, globalThis[key]]));
try {
  const token = (id, x, y) => ({ id, center: { x, y }, document: { id } });
  const caster = token("silva", 1050, 250);
  const inside = token("dragon", 1150, 350);
  const corner = token("flint", 1250, 450);
  globalThis.canvas = {
    grid: { size: 100, isSquare: true },
    dimensions: { distance: 5, distancePixels: 20 },
    tokens: { placeables: [caster, inside, corner] },
  };
  const spout = { name: "Spout", area: { type: "cube", value: 5 }, targetingProfile: { area: "cube", distance: 5 } };
  const context = { token: { id: "silva", center: caster.center } };

  const shape = createAreaRegionData({ context, action: spout, marker: { center: { x: 1162, y: 371 }, rotation: 37 } }).shapes[0];
  assert.equal(shape.type, "rectangle");
  assert.deepEqual([shape.x, shape.y], [1100, 300], "a 5-foot cube snaps onto the square it was placed on, its corner on a vertex");
  assert.deepEqual([shape.width, shape.height, shape.anchorX, shape.anchorY], [100, 100, 0, 0], "anchored at that corner");
  assert.equal(shape.rotation, 0, "a cube never turns to face the caster");

  const tenFoot = createAreaRegionData({ context, action: { ...spout, targetingProfile: { area: "cube", distance: 10 } }, marker: { center: { x: 1162, y: 371 } } }).shapes[0];
  assert.deepEqual([tenFoot.x, tenFoot.y], [1050, 250], "a 10-foot cube snaps to the nearest half square too");

  const hit = tokensInAreaMarker({ context, action: spout, marker: { center: { x: 1162, y: 371 } } }).map((entry) => entry.id);
  assert.deepEqual(hit, ["dragon"], "only the creature in that square is in the area");

  // Roi, live: a cube on a Huge dragon's corner square and a Medium creature's square hit only the
  // Medium one: the dragon's center was outside. Any square a creature occupies counts.
  const huge = { id: "tamir", center: { x: 1350, y: 650 }, document: { id: "tamir", width: 3, height: 3 } };
  const medium = { id: "ezren", center: { x: 1150, y: 550 }, document: { id: "ezren", width: 1, height: 1 } };
  globalThis.canvas.tokens.placeables = [huge, medium];
  const both = tokensInAreaMarker({ context, action: spout, marker: { center: { x: 1250, y: 550 } } }).map((entry) => entry.id);
  assert.deepEqual(both, ["tamir"], "a cube on the Huge dragon's corner square hits it");
  const tenOnCorner = createAreaRegionData({ context, action: { ...spout, targetingProfile: { area: "cube", distance: 10 } }, marker: { center: { x: 1220, y: 580 } } }).shapes[0];
  assert.deepEqual([tenOnCorner.x, tenOnCorner.y], [1100, 500]);
  const pair = tokensInAreaMarker({ context, action: { ...spout, targetingProfile: { area: "cube", distance: 10 } }, marker: { center: { x: 1220, y: 580 } } }).map((entry) => entry.id).sort();
  assert.deepEqual(pair, ["ezren", "tamir"], "a 10-foot cube over both hits both");
} finally {
  Object.assign(globalThis, saved);
}
console.log("Area cube tests passed.");

// Roi, live: Spout's damage went to the Blue Dragon, targeted from before, not the creature in the
// cube. The area always replaces the targets with what it covers, even nobody.
{
  const { prepareAreaExecution } = await import("../execution/area.js");
  const savedCanvas = globalThis.canvas;
  try {
    let targets = ["dragon"];
    const dragon = { id: "dragon", center: { x: 3050, y: 1050 }, document: { id: "dragon" }, setTarget: () => targets.push("dragon") };
    globalThis.canvas = {
      grid: { size: 100, isSquare: true },
      dimensions: { distance: 5, distancePixels: 20 },
      tokens: { placeables: [dragon], setTargets: (list) => { targets = [...list]; } },
    };
    const spout = { name: "Spout", area: { type: "cube", value: 5 }, targetingProfile: { area: "cube", distance: 5 }, activityProfile: { spell: true } };
    const step = { instanceId: "spout", areaMarker: { shape: "cube", center: { x: 150, y: 150 }, distance: 5 } };
    const prepared = await prepareAreaExecution({ context: { token: { id: "silva" } }, action: spout, step });
    assert.equal(prepared.status, "ready");
    assert.deepEqual(targets, [], "an empty area clears the creatures targeted before");
    assert.deepEqual(prepared.patch.targetTokenIds, []);
  } finally {
    globalThis.canvas = savedCanvas;
  }
}
console.log("Area targets tests passed.");

// Roi, live: "we should be able to put cube 5 ft on any vertices", like PF2e's own placement. On a
// vertex it touches the four squares around it, and every creature in them.
{
  const savedCanvas = globalThis.canvas;
  try {
    const at = (id, x, y) => ({ id, center: { x, y }, document: { id, width: 1, height: 1 } });
    globalThis.canvas = {
      grid: { size: 100, isSquare: true },
      dimensions: { distance: 5, distancePixels: 20 },
      tokens: { placeables: [at("a", 150, 150), at("b", 250, 250), at("c", 350, 150)] },
    };
    const cube = { name: "Spout", area: { type: "cube", value: 5 }, targetingProfile: { area: "cube", distance: 5 } };
    const onVertex = createAreaRegionData({ context: {}, action: cube, marker: { center: { x: 208, y: 193 } } }).shapes[0];
    assert.deepEqual([onVertex.x, onVertex.y], [150, 150], "a 5-foot cube can sit centered on a grid vertex");
    const touched = tokensInAreaMarker({ context: {}, action: cube, marker: { center: { x: 208, y: 193 } } }).map((entry) => entry.id);
    assert.deepEqual(touched, ["a", "b"], "and hits the creatures in the squares it touches");
  } finally {
    globalThis.canvas = savedCanvas;
  }
}
console.log("Area cube vertex tests passed.");
