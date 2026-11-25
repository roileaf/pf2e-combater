import assert from "node:assert/strict";
import { compendiumUuid, isSupportedSystem, systemAsset, systemFlags, systemSettingKey } from "../../system.js";
import { GENERIC_ACTIONS } from "../../catalog/generic-actions.js";
import { aidEffectUuid } from "../execution/prepare-to-aid.js";
import { observedIntelFact } from "../../rules/observed-intel.js";

const previousGame = globalThis.game;
const raiseAShield = GENERIC_ACTIONS.find((action) => action.slug === "raise-a-shield");
const stand = GENERIC_ACTIONS.find((action) => action.slug === "stand");

try {
  // No game (or PF2e): unchanged PF2e scope.
  delete globalThis.game;
  assert.equal(raiseAShield.uuid, "Compendium.pf2e.actionspf2e.Item.xjGwis0uaC2305pm");
  assert.equal(systemAsset("icons/actions/OneAction.webp"), "systems/pf2e/icons/actions/OneAction.webp");
  assert.deepEqual(systemFlags({ flags: { pf2e: { context: { type: "damage-taken" } } } }), { context: { type: "damage-taken" } });
  assert.deepEqual(systemFlags({ flags: { sf2e: { context: {} } } }), {}, "PF2e ignores flags.sf2e");

  // Starfinder 2e: own flag scope, assets, setting namespace and pack names; same item ids.
  globalThis.game = { system: { id: "sf2e" } };
  assert.equal(isSupportedSystem(), true);
  assert.equal(isSupportedSystem("dnd5e"), false);
  assert.equal(raiseAShield.uuid, "Compendium.sf2e.actions.Item.xjGwis0uaC2305pm", "generic actions open SF2e's action pack");
  assert.equal(stand.uuid, "Compendium.sf2e.conditions.Item.j91X7x0XSomq8d60", "condition overrides open SF2e's conditions pack");
  assert.equal({ ...raiseAShield }.uuid, raiseAShield.uuid, "spread copies keep the uuid");
  assert.equal(aidEffectUuid(), "Compendium.sf2e.other-effects.Item.AHMUpMbaVkZ5A1KX");
  assert.equal(compendiumUuid("equipment-effects", "2YgXoHvJfrDHucMr"), "Compendium.sf2e.equipment-effects.Item.2YgXoHvJfrDHucMr");
  assert.equal(systemAsset("icons/conditions/slowed.webp"), "systems/sf2e/icons/conditions/slowed.webp");
  assert.equal(systemSettingKey("metagame_tokenSetsNameVisibility"), "sf2e.metagame_tokenSetsNameVisibility");
  assert.deepEqual(
    systemFlags({ flags: { sf2e: { context: { type: "attack-roll" } }, pf2e: { kineticist: { gate: 1 }, context: { type: "old" } } } }),
    { kineticist: { gate: 1 }, context: { type: "attack-roll" } },
    "SF2e reads flags.sf2e first, with leftover flags.pf2e keys filling gaps",
  );
  assert.deepEqual(systemFlags(null), {});

  // Intel sees an SF2e attack roll (flags.sf2e.context.type) with a weapon item as a Strike.
  const actor = { type: "npc" };
  const message = { actor, item: { type: "weapon", name: "Laser Pistol", actor }, flags: { sf2e: { context: { type: "attack-roll" } } } };
  assert.equal(observedIntelFact(message)?.category, "strikes");
} finally {
  if (previousGame === undefined) delete globalThis.game;
  else globalThis.game = previousGame;
}

console.log("System scope (PF2e/SF2e) tests passed.");
