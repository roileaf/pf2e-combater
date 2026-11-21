import assert from "node:assert/strict";
import { movementRouteForStep, reachableMovementCenters } from "../movement-route.js";

// Live: an animal companion isn't on the encounter tracker (PF2e keeps it off), so it was neither an
// ally nor an enemy, and a Stride could end on its square. Off-tracker creatures come in as bystanders.
const companion = { id: "wolf", name: "Wolf", center: { x: 5, y: 0 }, width: 1, height: 1 };
const context = {
  token: { id: "ranger", center: { x: 0, y: 0 }, width: 1, height: 1 },
  actor: { profile: { speed: 25 } },
  battlefield: { allies: [], enemies: [], bystanders: [companion] },
};

const route = movementRouteForStep(context, { slug: "stride", destination: { x: 5, y: 0 } }, { gridSize: 5 });
assert.equal(route.reachable, false, "a Stride can't end on the companion's square");
assert.match(route.reason, /occupied/i);

const centers = reachableMovementCenters({ x: 0, y: 0 }, 10, { gridSize: 5, context });
assert.equal(centers.some((center) => center.x === 5 && center.y === 0), false, "the companion's square isn't a landing spot");
assert.equal(centers.some((center) => center.x === 10 && center.y === 0), true, "the square past it still is");

console.log("Companion occupancy tests passed.");
