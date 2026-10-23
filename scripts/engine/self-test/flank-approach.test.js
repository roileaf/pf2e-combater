import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { recommendedMovementForStep } from "../../ui/movement-preview.js";
import { centerFlanksTarget } from "../../readers/positional/flank-reader.js";

// Roi, live: a Hobgoblin Strode next to its target, Struck, then spent another action on a 5-foot
// Stride to Flank. Both moves fit in one Stride: close on the target at a flanking square.
const saved = Object.fromEntries(["canvas"].map((key) => [key, globalThis[key]]));
try {
  globalThis.canvas = { scene: { grid: { distance: 5 } }, grid: { size: 100, distance: 5 }, tokens: { placeables: [] } };
  const goblin = { id: "goblin", name: "Goblin", distance: 10, token: { id: "goblin", center: { x: 250, y: 250 } } };
  const ally = { id: "ally", name: "Ally", token: { id: "ally", center: { x: 350, y: 250 } } };
  const context = {
    token: { id: "hob", center: { x: 50, y: 50 } },
    actor: { profile: { speed: 25 } },
    profile: { speed: 25, reach: 5 },
    battlefield: { targets: [goblin], enemies: [goblin], allies: [ally] },
  };
  assert.equal(centerFlanksTarget(context, { x: 150, y: 250 }, goblin), true, "west of the goblin flanks it with the ally on its east");
  assert.equal(centerFlanksTarget(context, { x: 150, y: 150 }, goblin), false, "its north-west corner doesn't");

  const approach = recommendedMovementForStep(context, { slug: "stride", preferredTarget: goblin });
  assert.deepEqual(approach?.destination, { x: 150, y: 250 },
    "the Stride closing on the goblin ends flanking it, not at the nearest square");

  const lonely = recommendedMovementForStep({ ...context, battlefield: { ...context.battlefield, allies: [] } }, { slug: "stride", preferredTarget: goblin });
  assert.deepEqual(lonely?.destination, { x: 150, y: 150 }, "with no ally to flank with, the nearest square is still chosen");
} finally {
  Object.assign(globalThis, saved);
}

// Auto-fill then drops the planned Stride to Flank: the creature already flanks from where the
// earlier Stride leaves it, so it would spend an action standing still.
const draftWorkflowSource = await readFile(new URL("../../ui/panel/draft-workflow.js", import.meta.url), "utf8");
assert.ok(/autoFillPanelDraft\([\s\S]*setsUpFlank[\s\S]*centerFlanksTarget\(mc, moveOrigin/.test(draftWorkflowSource),
  "auto-fill drops a Stride to Flank once an earlier move already flanks its target");
console.log("Flank approach tests passed.");
