import assert from "node:assert/strict";
import { classifySystemAction } from "../action/classifier.js";
import { grabbedBySelf } from "../own-grab.js";
import { bestTargetForAction } from "../scoring/targets.js";

// Live: a Puma's Maul, "two claw Strikes against a creature it has Grabbed", had no Requirements
// line, so any creature, grabbed by anyone or no one, was a target.
const maulText = "<p>The leopard makes two claw Strikes against a creature it has @UUID[Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei]{Grabbed}. Both count toward its multiple attack penalty, but the penalty increases only after both attacks are made.</p>";
const maul = classifySystemAction({
  name: "Maul",
  system: { actionType: { value: "action" }, actions: { value: 1 }, description: { value: maulText } },
}, { actionCost: 1 });
assert.equal(maul.activityProfile.requiresTargetCondition, "grabbed", "Maul needs a grabbed target");
assert.equal(maul.activityProfile.requiresOwnGrab, true, "...grabbed by the puma itself");

const plainDouble = classifySystemAction({
  name: "Double Claw",
  system: { actionType: { value: "action" }, actions: { value: 1 }, description: { value: "<p>The beast makes two claw Strikes.</p>" } },
}, { actionCost: 1 });
assert.notEqual(plainDouble.activityProfile?.requiresOwnGrab, true, "a plain double Strike needs no grab");

// Who grabbed: the condition's origin when PF2e recorded one, otherwise whoever is within reach.
const puma = { actorId: "puma", actor: { id: "puma", uuid: "Scene.s.Token.t1.Actor.puma" } };
const grabbedBy = (origin, distance = 5) => ({ distance, conditions: { slugs: ["grabbed"], values: { grabbed: null }, ...(origin ? { origins: { grabbed: [origin] } } : {}) } });
assert.equal(grabbedBySelf(puma, grabbedBy("Scene.s.Token.t1.Actor.puma")), true, "grabbed by this puma's token");
assert.equal(grabbedBySelf(puma, grabbedBy("Scene.s.Token.t2.Actor.puma")), false, "another puma of the same kind grabbed it");
assert.equal(grabbedBySelf(puma, grabbedBy("Actor.fighter")), false, "an ally's grab isn't the puma's");
assert.equal(grabbedBySelf(puma, grabbedBy(null, 5)), true, "no origin: adjacent counts as the puma's grab");
assert.equal(grabbedBySelf(puma, grabbedBy(null, 30)), false, "no origin: a far creature isn't held by the puma");

// Target choice: a creature someone else is grabbing is skipped for one the puma holds.
const mauler = { ...maul, name: "Maul", slug: "maul", source: "action", actionCost: 1 };
const enemy = (id, origin) => ({ id, name: id, distance: 5, hp: { value: 20, max: 20 }, ...grabbedBy(origin) });
const context = {
  ...puma,
  profile: { reach: 5 },
  enemies: [enemy("held-by-ally", "Actor.fighter"), enemy("held-by-puma", "Scene.s.Token.t1.Actor.puma")],
};
assert.equal(bestTargetForAction(context, mauler, maul.role)?.id, "held-by-puma", "Maul goes to the creature the puma grabbed");

console.log("Own grab tests passed.");
