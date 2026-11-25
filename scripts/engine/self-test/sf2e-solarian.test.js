import assert from "node:assert/strict";
import { currentAttunement, readSolarianActions } from "../../readers/solarian-reader.js";
import { executeAttune, revertAttunement } from "../execution/attune.js";
import { orphanSetupSteps } from "../planner.js";
import { hasPlanConflict } from "../planner/conflicts.js";

const toggles = [];
const feat = { id: "feat-attune", slug: "stellar-attunement", system: { rules: [{ key: "RollOption", option: "stellar-attunement", selection: "graviton" }] } };
const attune = { id: "attune", slug: "attune", uuid: "Actor.dae.Item.attune", system: { frequency: { value: 1, max: 1, per: "round" } }, update: async (data) => { attune.system.frequency.value = data["system.frequency.value"]; } };
const solarian = (aspect) => ({
  uuid: "Actor.dae",
  items: [feat, attune],
  abilities: { str: { mod: 3 } },
  getRollOptions: () => ["feature:stellar-attunement", `stellar-attunement:${aspect}`],
  toggleRollOption: async (...args) => { toggles.push(args); },
});
const flare = { id: "strike-solar-flare", name: "Solar Flare", source: "strike", slug: "strike", strike: { slug: "solar-flare" }, traits: ["attack", "attuned", "solarian"], range: { increment: 15, max: 90 }, isRanged: true, averageDamage: 7.5, attackTrait: true, variants: [] };
const fist = { id: "strike-fist", name: "Unarmed Attack", source: "strike", slug: "strike", item: { slug: "basic-unarmed" }, traits: ["attack", "unarmed", "agile"], averageDamage: 5.5, attackTrait: true, variants: [] };

// The aspect comes from the Stellar Attunement roll option.
assert.equal(currentAttunement(solarian("photon")), "photon");
assert.equal(currentAttunement({ items: [feat] }), "graviton", "falls back to the rule's selection");

// Graviton-attuned: Attune (Photon) plus the photon Solar Flare it unlocks.
const fromGraviton = readSolarianActions(solarian("graviton"), [flare, fist]);
assert.deepEqual(fromGraviton.map((action) => action.id), ["attune-photon", "strike-solar-flare-photon"]);
const [attunePhoton, photonFlare] = fromGraviton;
assert.equal(attunePhoton.actionCost, 1);
assert.equal(attunePhoton.activityProfile.fromUnattuned, false);
assert.deepEqual(photonFlare.range, { increment: 30, max: 180 }, "photon flare: 30-ft increment");
assert.equal(photonFlare.damageProfile.type, "fire");
assert.equal(photonFlare.averageDamage, 3.5 + 3, "1d6 + Strength");
assert.equal(photonFlare.requiresAttunement, "photon");
assert.equal(photonFlare.refreshStrikeSlug, "solar-flare");
assert.equal(photonFlare.activityProfile.orderAfterKey, "attune-photon");

// Unattuned: both aspects, flares built from the unarmed Strike's proficiency.
const fromUnattuned = readSolarianActions(solarian("unattuned"), [fist]);
assert.deepEqual(fromUnattuned.map((action) => action.id), ["attune-photon", "strike-solar-flare-photon", "attune-graviton", "strike-solar-flare-graviton"]);
assert.equal(fromUnattuned[0].activityProfile.fromUnattuned, true);
assert.equal(fromUnattuned[3].damageProfile.type, "bludgeoning");
assert.equal(fromUnattuned[3].traits.includes("unarmed"), false);
assert.equal(fromUnattuned[3].item, null, "not the fist (no fist-fallback penalty)");
assert.equal(readSolarianActions({ items: [] }, [fist]).length, 0, "not a solarian");

// Plan rules: the new aspect's flare needs its Attune first; one Attune a round; switching aspect
// removes the current aspect's flare; a switch with nothing after it is wasted, from unattuned it isn't.
assert.equal(hasPlanConflict({}, photonFlare, []), true);
assert.equal(hasPlanConflict({}, photonFlare, [attunePhoton]), false);
assert.equal(hasPlanConflict({}, { ...attunePhoton, id: "attune-graviton", activityProfile: { attune: true, attuneAspect: "graviton" } }, [attunePhoton]), true);
assert.equal(hasPlanConflict({}, flare, [attunePhoton]), true, "graviton flare after switching to photon");
assert.equal(hasPlanConflict({}, attunePhoton, [flare]), true);
assert.equal(orphanSetupSteps([attunePhoton]).length, 1);
assert.equal(orphanSetupSteps([attunePhoton, photonFlare]).length, 0);
assert.equal(orphanSetupSteps([fromUnattuned[0]]).length, 0);

// Running Attune switches the roll option and spends the round's use; Undo puts the aspect back.
const actor = solarian("graviton");
const result = await executeAttune({ actor, action: attunePhoton, patch: {} });
assert.equal(result.status, "done");
assert.deepEqual(toggles.at(-1), ["all", "stellar-attunement", "feat-attune", true, "photon"]);
assert.equal(attune.system.frequency.value, 0);
assert.deepEqual(result.patch.execution.revert.ops[0], { kind: "attunement", actorUuid: "Actor.dae", itemId: "feat-attune", previous: "graviton" });
const savedFromUuid = globalThis.fromUuid;
globalThis.fromUuid = async () => actor;
await revertAttunement(result.patch.execution.revert.ops[0]);
globalThis.fromUuid = savedFromUuid;
assert.deepEqual(toggles.at(-1), ["all", "stellar-attunement", "feat-attune", true, "graviton"]);
// Used this round: no Attune offered as available.
assert.equal(readSolarianActions(solarian("graviton"), [flare])[0].available, false);

console.log("SF2e solarian (attunement) tests passed.");
