import assert from "node:assert/strict";
import {
  HAZARD_DISABLE_EXECUTABLE,
  readHazardDisableActions,
  rollHazardDisable,
  tokenUpdateChangesHazarderState,
} from "../../integrations/hazarder.js";
import { hazardDisableSuccessChance, hazardDisableTactic } from "../scoring/hazard.js";
import { requiresTargetForAction } from "../action/requirements.js";
import { scoreCandidate } from "../scoring.js";

// PF2e Hazarder runs complex hazards; on a character's turn Combater offers a "Disable <hazard>"
// step per tracked hazard part and rolls it through Hazarder's API.
const option = (overrides = {}) => ({
  instanceKey: "lock:0", instanceLabel: null, disableId: "thievery", skill: "thievery", label: "Thievery",
  dc: 20, minRank: null, traits: ["action:disable-a-device"], have: 0, successesLeft: 2, pooledWith: [], ...overrides,
});
const hazard = (overrides = {}) => ({
  tokenUuid: "Scene.s.Token.trap", tokenId: "trap", name: "Poisoned Lock", status: "active", disabled: false,
  options: [option()], ...overrides,
});
const actor = {
  type: "character",
  getStatistic: (slug) => ({ thievery: { check: { mod: 12 } }, athletics: { check: { mod: 5 } }, religion: { check: { mod: 9 } } })[slug] ?? null,
};
const apiWith = (hazards, { canAttempt = () => ({ ok: true, reason: null, rank: 2 }) } = {}) => ({ hazards: () => hazards, canAttempt });
// Grid of 1-unit squares where 5 units is one square: adjacent tokens are 5 apart.
const context = { token: { center: { x: 0, y: 0 }, width: 1, height: 1 } };
const nearby = () => ({ center: { x: 5, y: 0 }, document: { width: 1, height: 1 } });
const read = (hazards, options = {}) => readHazardDisableActions(actor, context, { resolveToken: nearby, ...options, api: options.api ?? apiWith(hazards) });

// --- Absent Hazarder: nothing changes ------------------------------------------------------------
assert.deepEqual(readHazardDisableActions(actor, context, { api: null }), [], "no Hazarder, no disable steps");
assert.deepEqual(read([hazard()], { api: { hazards: () => { throw new Error("old api"); } } }), [], "a throwing API offers nothing");

// --- One candidate per hazard part, the option this character is best at -------------------------
{
  const [step, ...rest] = read([hazard({ options: [
    option({ disableId: "athletics", skill: "athletics", label: "Athletics", dc: 18, traits: [] }),
    option(),
  ] })]);
  assert.equal(rest.length, 0, "two options on one part give one step");
  assert.equal(step.hazardDisable.disableId, "thievery", "Thievery +12 vs DC 20 beats Athletics +5 vs DC 18");
  assert.equal(step.slug, "disable-hazard");
  assert.equal(step.executable, HAZARD_DISABLE_EXECUTABLE);
  assert.equal(step.actionCost, 1);
  assert.equal(step.available, true, "adjacent: in reach");
  assert.equal(step.hazardDisable.modifier, 12);
  assert.match(step.name, /Poisoned Lock/);
  assert.equal(requiresTargetForAction(step), false, "a disable step never asks for a creature target");
}
{
  const steps = read([hazard({ options: [option(), option({ instanceKey: "lock:1", instanceLabel: "Lock 2" })] })]);
  assert.equal(steps.length, 2, "each part of a multi-part hazard is its own step");
  assert.match(steps[1].name, /Lock 2/);
}

// --- What isn't offered ---------------------------------------------------------------------------
assert.deepEqual(read([hazard({ disabled: true, status: "disabled" })]), [], "a disabled hazard");
assert.deepEqual(read([hazard({ options: [option({ successesLeft: 0 })] })]), [], "an option with nothing left to add");
assert.deepEqual(
  read([hazard()], { api: apiWith([hazard()], { canAttempt: () => ({ ok: false, reason: "rank-too-low", rank: 1 }) }) }),
  [], "an option Hazarder says this character can't attempt",
);
assert.deepEqual(readHazardDisableActions({ ...actor, type: "hazard" }, context, { api: apiWith([hazard()]), resolveToken: nearby }), [],
  "a hazard never disables a hazard");

// --- Reach: hands-on disables need adjacency, others work from nearby -----------------------------
{
  const far = () => ({ center: { x: 20, y: 0 }, document: { width: 1, height: 1 } });
  const [handsOn] = read([hazard()], { resolveToken: far });
  assert.equal(handsOn.available, false, "Disable a Device from 20 ft away");
  assert.match(handsOn.unavailableReason, /20 ft/);
  const [rite] = read([hazard({ options: [option({ disableId: "religion", skill: "religion", label: "Religion", traits: [] })] })], { resolveToken: far });
  assert.equal(rite.available, true, "a Religion disable works from 20 ft");
  const [noCanvas] = read([hazard()], { resolveToken: () => null });
  assert.equal(noCanvas.available, true, "no canvas to measure: offered, not hidden");
}

// --- A hidden DC doesn't leak or crash --------------------------------------------------------------
{
  const [step] = read([hazard({ options: [option({ dc: null })] })]);
  assert.equal(step.hazardDisable.dc, null);
  assert.equal(hazardDisableSuccessChance(12, null), null);
  const acc = { score: 42, reasons: [] };
  hazardDisableTactic(acc, { action: step });
  assert.ok(Number.isFinite(acc.score));
  assert.ok(acc.reasons.some((reason) => /unknown/i.test(reason)), "says the odds are a guess");
  assert.ok(!acc.reasons.some((reason) => /DC \d/.test(reason)), "never shows a DC players can't see");
}

// --- Scoring: odds, threat and progress, kept below a good Strike ----------------------------------
{
  const scored = (plan) => {
    const acc = { score: 42, reasons: [] };
    hazardDisableTactic(acc, { action: { hazardDisable: { hazardName: "Trap", modifier: 12, dc: 20, successesLeft: 2, status: "active", ...plan } } });
    return acc.score;
  };
  assert.equal(hazardDisableSuccessChance(12, 20), 0.65);
  assert.equal(hazardDisableSuccessChance(30, 10), 0.95, "a natural 1 still fails");
  assert.ok(scored({ status: "active" }) > scored({ status: "armed" }), "an active hazard matters more than an armed one");
  assert.ok(scored({ modifier: 18 }) > scored({ modifier: 6 }), "better odds score higher");
  assert.ok(scored({ successesLeft: 1 }) > scored({ successesLeft: 3 }), "the finishing success is worth more");
  assert.ok(scored({ modifier: 40, successesLeft: 1 }) <= 42 + 32, "even a sure finishing disable stays below a good Strike (~80+)");
}

// --- Through Combater's own scoring: offered, no creature target, below a plain Strike -------------
{
  const goblin = { id: "gob", name: "Goblin", distance: 5, hpPercent: 100, ac: 16, conditions: { slugs: [], values: {} }, token: { id: "gob", center: { x: 5, y: 5 } } };
  const scoringContext = {
    isGM: true,
    actor: { document: { type: "character", system: {}, itemTypes: {} } },
    profile: { actorType: "character", conditions: { slugs: [], values: {} } },
    token: { id: "pc", center: { x: 0, y: 0 } },
    targets: [goblin], battlefield: { targets: [goblin], enemies: [goblin], allies: [] },
  };
  const [step] = read([hazard()]);
  const scored = scoreCandidate(scoringContext, step);
  assert.ok(scored.score > -900, `a disable step isn't rejected (score ${scored.score})`);
  assert.equal(scored.suggestedTarget ?? null, null, "and names no creature");
  const strike = { id: "sword", name: "Longsword", slug: "strike", source: "strike", role: "damage", actionCost: 1, range: { max: 5 }, averageDamage: 9, available: true };
  const strikeScore = scoreCandidate(scoringContext, strike).score;
  assert.ok(scored.score < strikeScore, `a 65% disable (${scored.score}) stays below a Strike on an adjacent goblin (${strikeScore})`);
}

// --- Execution goes through Hazarder's rollDisable as the acting actor -----------------------------
{
  const calls = [];
  const api = { hazards: () => [], rollDisable: async (args) => { calls.push(args); return { total: 25 }; } };
  const [step] = read([hazard()]);
  const event = { shiftKey: true };
  const roll = await rollHazardDisable(step, actor, { api, event });
  assert.deepEqual(roll, { total: 25 });
  assert.deepEqual(calls, [{ tokenUuid: "Scene.s.Token.trap", instanceKey: "lock:0", disableId: "thievery", actor, rollParams: { event } }]);
  assert.equal(await rollHazardDisable(step, actor, { api: { hazards: () => [] } }), null, "no rollDisable: nothing rolled");
  assert.equal(await rollHazardDisable(step, actor, { api: { rollDisable: async () => { throw new Error("x"); } } }), null, "a throwing roll fails quietly");
}

// --- Refresh when a hazard's state changes -----------------------------------------------------------
assert.equal(tokenUpdateChangesHazarderState({ flags: { "pf2e-hazarder": { state: {} } } }), true);
assert.equal(tokenUpdateChangesHazarderState({ flags: { "pf2e-hazarder": { "-=state": null } } }), true);
assert.equal(tokenUpdateChangesHazarderState({ x: 5 }), false);
assert.equal(tokenUpdateChangesHazarderState({ flags: { other: { state: 1 } } }), false);

console.log("Hazarder integration tests passed.");
