import assert from "node:assert/strict";
import { reachSpellDraftStepActions } from "../../ui/panel/context-workflow.js";

// Live (Kimerus): Reach Spell, then Electric Arc picked from Browse at a target 40 ft away. The
// Electric Arc step was re-checked at its normal 30 ft and read "can't be done any more".
const foe = { id: "foe", name: "Umbral Gnome Scout", distance: 40 };
const context = { targets: [foe], battlefield: { targets: [foe], enemies: [foe], allies: [] }, actor: { profile: {} } };
const reachSpell = { id: "reach-spell", name: "Reach Spell", activityProfile: { rangeBuff: true, spellshape: true } };
const electricArc = { id: "electric-arc", slug: "electric-arc", name: "Electric Arc", source: "spell-curated",
  targetingProfile: { enemy: true, maxRange: 30 }, suggestedTarget: { id: "foe", name: "Umbral Gnome Scout" },
  needsApproach: true, available: false, unavailableReason: "No target within 30 feet." };
const draft = { steps: [
  { instanceId: "reach", actionKey: "reach-spell" },
  { instanceId: "arc", actionKey: "electric-arc" },
] };
const overrides = reachSpellDraftStepActions(context, draft, [reachSpell], [electricArc]);
assert.ok(overrides.arc, "the spell after a drafted Reach Spell is re-checked at +30 ft");
assert.equal(overrides.arc.available, true, "and can be cast");
assert.equal(overrides.arc.rangeBoostedFrom, 30);
assert.equal(overrides.reach, undefined, "Reach Spell itself is unchanged");

const noReach = reachSpellDraftStepActions(context, { steps: [{ instanceId: "arc", actionKey: "electric-arc" }] }, [reachSpell], [electricArc]);
assert.deepEqual(noReach, {}, "without Reach Spell before it the spell keeps its normal range");
console.log("Reach Spell draft tests passed.");
