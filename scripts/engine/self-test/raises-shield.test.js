import assert from "node:assert/strict";
import { raisesShield } from "../action/raises-shield.js";
import { hasPlanConflict } from "../planner/conflicts.js";

// Live: auto-fill planned Raise a Shield after Shields of the Spirit, which already raises it.
const spiritText = "<p><strong>Requirements</strong> You are wielding a shield.</p><hr /><p>You Raise your Shield, causing ephemeral spirit shields to float within your champion's aura.</p>";
const shieldsOfTheSpirit = {
  id: "shields-spell", slug: "shields-of-the-spirit", name: "Shields of the Spirit", source: "spell", actionCost: 1,
  item: { type: "spell", system: { description: { value: spiritText } } },
};
const raiseAShield = { id: "raise-a-shield", slug: "raise-a-shield", name: "Raise a Shield", source: "generic", role: "defense", actionCost: 1 };
const strike = { id: "strike", slug: "strike", name: "Strike", source: "strike", actionCost: 1 };

assert.equal(raisesShield(shieldsOfTheSpirit), true, "Shields of the Spirit raises the shield");
assert.equal(raisesShield(raiseAShield), true);
assert.equal(raisesShield({ slug: "x", description: "<p>If you Raise a Shield, you gain more.</p>" }), false, "a conditional doesn't raise it");
assert.equal(raisesShield({ slug: "x", description: "<p>You @UUID[Compendium.pf2e.actionspf2e.Item.x]{Raise a Shield} and Stride.</p>" }), true);

const context = { profile: { hasShield: true, combatState: {} }, enemies: [], allies: [] };
assert.equal(hasPlanConflict(context, raiseAShield, [shieldsOfTheSpirit]), true, "no Raise a Shield after Shields of the Spirit");
assert.equal(hasPlanConflict(context, shieldsOfTheSpirit, [raiseAShield]), true, "Raising first wastes the action");
assert.equal(hasPlanConflict(context, raiseAShield, [strike]), false, "Raise a Shield after a Strike is fine");
