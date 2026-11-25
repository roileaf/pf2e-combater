import assert from "node:assert/strict";
import { findCustomAction } from "../../catalog/custom-actions.js";
import { readLeadByExampleActions } from "../../readers/envoy-reader.js";
import { getEmEffectData, getEmEffectUuid } from "../execution/get-em.js";
import { aimTargetsFollowMark, orphanSetupSteps } from "../planner.js";
import { aimTargetSourceStep } from "../planner/rules.js";
import { hasPlanConflict } from "../planner/conflicts.js";

const saved = globalThis.game;
try {
  // Get 'Em!: a curated setup marking one enemy.
  const getEm = findCustomAction("get-em");
  assert.equal(getEm?.role, "setup");
  assert.equal(getEm.activityProfile.getEm, true);
  assert.equal(getEm.executable, "get-em");

  // Lead by Example: 2 actions, the envoy's Strike plus Charisma on the damage.
  const item = { slug: "get-em", uuid: "Actor.navasi.Item.getem" };
  const envoy = { itemTypes: { action: [item] }, abilities: { cha: { mod: 4 } } };
  const pistol = { id: "strike-pistol", name: "Pistol", source: "strike", slug: "strike", actionCost: 1, averageDamage: 4.5, damageProfile: { average: 4.5 }, attackTrait: true, isRanged: true, available: true, variants: [] };
  const [lead] = readLeadByExampleActions(envoy, [pistol, { ...pistol, id: "strike-pistol-thrown", altUsage: "thrown" }]);
  assert.equal(lead.actionCost, 2);
  assert.equal(lead.executable, "get-em");
  assert.equal(lead.averageDamage, 8.5, "+4 Charisma on this Strike's damage");
  assert.equal(lead.activityProfile.leadByExample, true);
  assert.equal(readLeadByExampleActions({ itemTypes: { action: [] } }, [pistol]).length, 0, "no Get 'Em!, no Lead by Example");
  assert.equal(readLeadByExampleActions(envoy, [{ ...pistol, startsUnloaded: true }]).length, 0, "not with an empty weapon");

  // It pays off for allies even without a Strike of your own after it; alone, it needs one.
  const ogre = { id: "ogre" };
  const goblin = { id: "goblin" };
  const step = (allies) => ({ ...getEm, id: "get-em", name: "Get 'Em!", suggestedTarget: ogre, directiveAllies: allies });
  const strike = (target) => ({ id: `strike-${target.id}`, slug: "strike", source: "strike", attackTrait: true, suggestedTarget: target, range: { max: 60 } });
  assert.equal(orphanSetupSteps([step(2)]).length, 0, "allies use it");
  assert.equal(orphanSetupSteps([step(0)]).length, 1, "alone and no attack: wasted");
  assert.equal(orphanSetupSteps([step(0), strike(ogre)]).length, 0);
  assert.equal(orphanSetupSteps([step(0), strike(goblin)]).length, 1, "a Strike on someone else doesn't use it");
  // Later Strikes (melee too) go at the target; one directive per round.
  assert.equal(aimTargetSourceStep({ ...strike(goblin), isRanged: false }, [step(0)])?.id, "get-em");
  assert.equal(aimTargetsFollowMark({}, [{ ...step(0), suggestedTarget: { ...ogre, distance: 10 } }, strike(goblin)])[1].suggestedTarget.id, "ogre");
  assert.equal(hasPlanConflict({}, lead, [step(0)]), true, "one directive per round");
  assert.equal(hasPlanConflict({}, step(0), [lead]), true);

  // The effect: target in its context (TokenMark), Lead by Example's prompt answered up front.
  globalThis.game = { system: { id: "sf2e" } };
  assert.equal(getEmEffectUuid(), "Compendium.sf2e.feat-effects.Item.ey2zSEnprAGgvrij");
  const source = { toObject: () => ({ system: { rules: [{ key: "TokenMark", slug: "get-em" }, { key: "ChoiceSet", rollOption: "get-em", choices: [] }] } }) };
  const target = { token: { document: { uuid: "Scene.s.Token.ogre", actor: { uuid: "Actor.ogre" } } } };
  const plain = getEmEffectData(source, { actor: { uuid: "Actor.navasi" }, item, target, leadByExample: false });
  assert.equal(plain.system.context.target.token, "Scene.s.Token.ogre");
  assert.equal(plain.system.context.origin.actor, "Actor.navasi");
  assert.equal(plain.system.rules[1].selection, "not-lead-by-example");
  assert.equal(getEmEffectData(source, { actor: { uuid: "Actor.navasi" }, item, target, leadByExample: true }).system.rules[1].selection, "lead-by-example");
} finally {
  if (saved === undefined) delete globalThis.game; else globalThis.game = saved;
}
console.log("SF2e envoy (Get 'Em!) tests passed.");
