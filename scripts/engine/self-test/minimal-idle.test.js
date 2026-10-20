import assert from "node:assert/strict";
import { minimalIdleLabel } from "../../ui/panel/context-workflow.js";

// Out of combat the minimal bar still offers Auto-fill, Browse and Plan setup for the selected
// creature, so its idle line must not claim there is nothing going on.
assert.equal(minimalIdleLabel({ actor: { name: "Silva" } }, null), "Out of combat · Silva", "a selected creature out of combat is named");
assert.equal(minimalIdleLabel(null, null), "No active encounter", "nothing selected and no encounter");
assert.equal(minimalIdleLabel({ actor: { name: "Silva" } }, { started: true }), "Waiting for a combatant");
console.log("Minimal idle label tests passed.");
