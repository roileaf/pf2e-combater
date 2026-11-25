import assert from "node:assert/strict";
import { areaFireShape, readAreaFireActions } from "../../readers/area-fire-reader.js";
import { actorStrikeOptions } from "../../readers/action/reader.js";
import { buildCandidates } from "../candidates.js";
import { fighterContext } from "../fixtures.js";
import { findCustomAction } from "../../catalog/custom-actions.js";
import { aimTargetsFollowMark, orphanSetupSteps } from "../planner.js";
import { hasPlanConflict } from "../planner/conflicts.js";
import { areaTemplatePersists } from "../execution/area.js";
import { executeAreaFire } from "../execution/area-fire.js";
import { applyTargetMarkSelfEffect } from "../execution/mark-effect.js";
import { normalizedActionFacts } from "../action/facts.js";
import { aimTargetSourceStep, sameTargetReference } from "../planner/rules.js";

// SF2e weapons, shaped like sf2e 1.7.1 character system.actions entries.
const weapon = (id, name, traits, range, extra = {}) => ({
  id, name, isRanged: true,
  system: { traits: { value: traits, config: {} }, range, expend: 1, damage: { dice: 1, die: "d10", damageType: "piercing" }, equipped: { carryType: "held", handsHeld: 2 }, ...extra },
});
const rolled = [];
const variant = (label) => ({ label, roll: async (options) => { rolled.push({ label, options }); return { id: "card" }; } });
const strikeEntry = (item, extra = {}) => ({ type: "strike", slug: item.name.toLowerCase().replace(/\s+/g, "-"), label: item.name, item, ready: true, visible: true, canAttack: true, variants: [variant("+8"), variant("+3"), variant("-2")], altUsages: [], ...extra });
const areaEntry = (item, type, dc = 19, extra = {}) => ({ type, slug: item.name.toLowerCase().replace(/\s+/g, "-"), label: item.name, glyph: "2", item, ready: true, visible: true, canAttack: true, statistic: { dc: { value: dc } }, variants: [variant(`${type} DC ${dc}`)], altUsages: [], ...extra });

const cannon = weapon("cannon", "Stellar Cannon", ["analog", "area-burst-10", "unwieldy"], 50);
const machineGun = weapon("mg", "Machine Gun", ["analog", "automatic"], 40);
const flamethrower = weapon("flame", "Flamethrower", ["area-cone", "tech", "unwieldy"], 15, { expend: 2 });
const pistol = weapon("pistol", "Semi-Auto Pistol", ["analog"], 60);

// Area shapes follow SF2e's prepareAreaAttack.
assert.deepEqual(areaFireShape(cannon, "area-fire"), { type: "burst", distance: 10, maxRange: 50 });
assert.deepEqual(areaFireShape(flamethrower, "area-fire"), { type: "cone", distance: 15, maxRange: 0 });
assert.deepEqual(areaFireShape(weapon("rail", "Rail", ["area-line"], 60), "area-fire"), { type: "line", distance: 60, width: 5, maxRange: 0 });
assert.deepEqual(areaFireShape(machineGun, "auto-fire"), { type: "cone", distance: 20, maxRange: 0 }, "Auto-Fire: half the range increment");
assert.deepEqual(areaFireShape(weapon("smg", "SMG", ["automatic"], 30), "auto-fire"), { type: "cone", distance: 15, maxRange: 0 }, "rounded down to whole squares");

const cannonArea = areaEntry(cannon, "area-fire", 19);
cannonArea.altUsages.push(strikeEntry(cannon));
const mgStrike = strikeEntry(machineGun);
mgStrike.altUsages.push(areaEntry(machineGun, "auto-fire", 18));
const actions = [cannonArea, mgStrike, strikeEntry(pistol), areaEntry(flamethrower, "area-fire", 17, { ammunition: { loaded: [{ quantity: 1 }], capacity: 1, remaining: 0 } })];

const areaActions = readAreaFireActions(actions);
assert.deepEqual(areaActions.map((action) => action.name), ["Area Fire (Stellar Cannon)", "Auto-Fire (Machine Gun)", "Area Fire (Flamethrower)"]);
const [areaFire, autoFire, flame] = areaActions;
assert.equal(areaFire.actionCost, 2);
assert.equal(areaFire.executable, "area-fire");
assert.equal(areaFire.role, "area-damage");
assert.equal(areaFire.source, "system-inferred", "scored by the area-damage role tactic");
assert.deepEqual(areaFire.saveProfile, { stat: "reflex", dc: 19, basic: true });
assert.deepEqual(areaFire.targetingProfile, { area: true, type: "burst", distance: 10, maxRange: 50 });
assert.equal(areaFire.attackTrait, true);
assert.equal(areaFire.activityProfile.noAttackRoll, true);
assert.equal(areaFire.unwieldy, true);
assert.equal(autoFire.targetingProfile.type, "cone");
assert.equal(autoFire.saveProfile.dc, 18);
assert.equal(flame.available, false, "Flamethrower expends 2 with 1 round loaded");
assert.match(flame.unavailableReason, /1 of 2/);

// Facts: it raises the MAP for later attacks but takes no MAP itself, no single target needed.
const facts = normalizedActionFacts(areaFire);
assert.equal(facts.resolution.attack, true, "attack trait: counts toward MAP");

// Strikes: the area weapon's plain Strike is listed once, not as "(Thrown)"; auto-fire isn't a Strike.
const actor = { id: "obozaya", name: "Obozaya", type: "character", system: { actions }, items: [], itemTypes: {} };
const strikes = actorStrikeOptions(actor, null);
assert.deepEqual(strikes.map((strike) => strike.name), ["Stellar Cannon", "Machine Gun", "Semi-Auto Pistol"]);

// Candidates: Area Fire comes from its own reader, not as an unclassified generated activity.
const { candidates } = buildCandidates({ ...fighterContext, actor });
assert.deepEqual(candidates.filter((candidate) => candidate.executable === "area-fire").map((candidate) => candidate.name),
  ["Area Fire (Stellar Cannon)", "Auto-Fire (Machine Gun)"], "the Flamethrower without enough ammo is left out");
assert.equal(candidates.some((candidate) => candidate.id?.startsWith("generated-") && /area-fire|auto-fire|stellar-cannon/.test(candidate.slug ?? "")), false);

// Unwieldy: one attack per round with that weapon.
const cannonStrike = strikes.find((strike) => strike.name === "Stellar Cannon");
assert.equal(hasPlanConflict(fighterContext, areaFire, [cannonStrike]), true, "no Area Fire after a Strike with the same unwieldy weapon");
assert.equal(hasPlanConflict(fighterContext, cannonStrike, [areaFire]), true);
assert.equal(hasPlanConflict(fighterContext, autoFire, [{ ...autoFire, id: "auto-2" }]), false, "a machine gun isn't unwieldy");

// Area Fire is instantaneous: no lingering region; execution runs the system's own roll.
assert.equal(areaTemplatePersists(areaFire), false);
const result = await executeAreaFire({ action: areaFire, patch: {} });
assert.equal(result.status, "done");
assert.equal(rolled.at(-1).label, "area-fire DC 19");

// Operative Aim: a curated setup that only pays off with a ranged Strike on the marked creature.
const aim = findCustomAction("aim");
assert.equal(aim?.role, "setup");
assert.equal(aim.activityProfile.targetMark, "aim");
const ogre = { id: "ogre" };
const goblin = { id: "goblin" };
const aimStep = { ...aim, id: "aim", name: "Aim", suggestedTarget: ogre };
const rangedStrike = (target) => ({ id: `strike-pistol-${target.id}`, slug: "strike", source: "strike", isRanged: true, attackTrait: true, suggestedTarget: target });
assert.equal(orphanSetupSteps([aimStep, rangedStrike(ogre)]).length, 0, "Aim → ranged Strike on the mark");
assert.equal(orphanSetupSteps([aimStep, rangedStrike(goblin)]).length, 1, "a Strike on someone else wastes the Aim");
assert.equal(orphanSetupSteps([aimStep, { ...rangedStrike(ogre), isRanged: false }]).length, 1, "a melee Strike doesn't use it");
assert.equal(orphanSetupSteps([aimStep, areaFire]).length, 1, "Area Fire doesn't use it");

assert.equal(aimTargetSourceStep(rangedStrike(goblin), [aimStep]), aimStep, "a ranged Strike after Aim inherits the marked target");
assert.equal(aimTargetSourceStep({ ...rangedStrike(goblin), isRanged: false }, [aimStep]), null);

// Two tokens of one unlinked actor are different targets (shared actor id and name).
const goonA = { id: "tokA", name: "Security Goon", actor: { id: "goon" }, token: { id: "tokA" } };
const goonB = { id: "tokB", name: "Security Goon", actor: { id: "goon" }, token: { id: "tokB" } };
assert.equal(sameTargetReference(goonA, goonB), false);
assert.equal(sameTargetReference(goonA, { ...goonA }), true);
assert.equal(sameTargetReference({ id: "goon", name: "Security Goon" }, goonA), true, "without a token, the actor still matches");

// The search can pick a Strike's target before Aim joins the plan; the final plan shoots the mark.
const markA = { ...goonA, distance: 20 };
const aimed = aimTargetsFollowMark({}, [{ ...aimStep, suggestedTarget: markA }, { ...rangedStrike(goonB), range: { increment: 60, max: 360 } }]);
assert.equal(aimed[1].suggestedTarget.id, "tokA");
const farMark = { ...goonA, distance: 500 };
assert.equal(aimTargetsFollowMark({}, [{ ...aimStep, suggestedTarget: farMark }, { ...rangedStrike(goonB), range: { increment: 60, max: 360 } }])[1].suggestedTarget.id, "tokB", "out of range: left alone");

// Running Aim applies Effect: Aim with the target in its context (the TokenMark reads it), replacing an old mark.
{
  const savedFromUuid = globalThis.fromUuid;
  const created = [];
  const deleted = [];
  globalThis.fromUuid = async () => ({ slug: "effect-aim", toObject: () => ({ name: "Effect: Aim", system: {} }) });
  const operative = {
    uuid: "Actor.iseph", itemTypes: { effect: [{ id: "old", slug: "effect-aim" }] },
    getActiveTokens: () => [{ uuid: "Scene.s.Token.iseph" }],
    deleteEmbeddedDocuments: async (_type, ids) => { deleted.push(...ids); },
    createEmbeddedDocuments: async (_type, data) => { created.push(...data); return [{ uuid: "Actor.iseph.Item.new" }]; },
  };
  const aimItem = { uuid: "Actor.iseph.Item.aim", system: { selfEffect: { uuid: "Compendium.sf2e.feat-effects.Item.7o4KWymf4Yy2n2Qx" } } };
  const target = { token: { document: { uuid: "Scene.s.Token.tokA", actor: { uuid: "Actor.goon" } } } };
  const done = { status: "done", patch: { execution: { status: "done" } } };
  const out = await applyTargetMarkSelfEffect({ actor: operative, action: { item: aimItem }, target, result: done });
  assert.deepEqual(deleted, ["old"]);
  assert.equal(created[0].system.context.target.token, "Scene.s.Token.tokA");
  assert.deepEqual(out.patch.execution.revert.ops[0], { kind: "effect", effectUuid: "Actor.iseph.Item.new" }, "Undo removes the mark");
  globalThis.fromUuid = savedFromUuid;
}

console.log("SF2e mechanics (Area Fire, Auto-Fire, Aim) tests passed.");
