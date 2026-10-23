import assert from "node:assert/strict";
import { readSpellActions } from "../../readers/spell-reader.js";
import { executeDraftStep } from "../action/executor.js";
import { scoreCandidate } from "../scoring.js";

// Roi, live: Ignition has a ranged variant and a melee one (touch, d6s instead of d4s) at the same
// cost. The step said only "Ignition", so you couldn't tell which it would cast.
const saved = Object.fromEntries(["game", "canvas", "Hooks"].map((key) => [key, globalThis[key]]));
try {
  let castWith = null;
  const loads = [];
  const spell = {
    id: "ignition", uuid: "Actor.ezren.Item.ignition", type: "spell", slug: "ignition", name: "Ignition",
    system: {
      slug: "ignition", location: { value: "arcane" }, level: { value: 1 }, time: { value: "2" },
      traits: { value: ["attack", "cantrip", "concentrate", "fire", "manipulate"] }, range: { value: "30 feet" },
      target: { value: "1 creature" }, defense: null,
      damage: { fire: { formula: "2d4", kinds: ["damage"], type: "fire" } },
      overlays: {
        ranged: { _id: "ranged", overlayType: "override", sort: 1, system: {} },
        melee: { _id: "melee", name: "Ignition (Melee)", overlayType: "override", sort: 2,
          system: { damage: { fire: { formula: "2d6" } }, range: { value: "touch" } } },
      },
    },
    loadVariant({ overlayIds }) { loads.push(overlayIds); return { ...this, variantOf: overlayIds[0] }; },
  };
  const entry = { id: "arcane", system: { prepared: { value: "spontaneous" } }, async cast(cast) { castWith = cast; return { id: "ignition-card" }; } };
  const actor = { id: "ezren", type: "character", system: {}, itemTypes: { spell: [spell], spellcastingEntry: [entry] }, spellcasting: [entry] };
  const goblin = { id: "goblin", name: "Goblin", setTarget() {} };
  globalThis.game = { user: { id: "gm", targets: new Set() } };
  globalThis.canvas = { tokens: { placeables: [goblin], get: (id) => (id === "goblin" ? goblin : null), setTargets() {} } };
  globalThis.Hooks = undefined;
  const contextAt = (distance) => ({ actor: { document: actor }, profile: { reach: 5 },
    battlefield: { enemies: [{ ...goblin, distance }], targets: [{ ...goblin, distance }], allies: [] } });
  const ignition = readSpellActions(contextAt(5)).find((action) => action.slug === "ignition");
  assert.ok(ignition, "Ignition is read");

  const adjacent = scoreCandidate(contextAt(5), ignition);
  assert.equal(adjacent.spellVariant?.id, "melee", "next to the target, the melee variant hits harder");
  assert.equal(adjacent.name, "Ignition (Melee)", "the step names its variant");
  const distant = scoreCandidate(contextAt(20), ignition);
  assert.equal(distant.spellVariant?.id, "ranged", "out of reach, the ranged variant is the one that works");
  assert.equal(distant.name, "Ignition");

  const result = await executeDraftStep({ context: contextAt(5), step: { instanceId: "ignite", spellVariant: { id: "melee", name: "Ignition (Melee)" }, targetTokenIds: ["goblin"], targetSelection: "manual" }, action: ignition });
  assert.equal(result.status, "done");
  assert.deepEqual(loads.at(-1), ["melee"], "the planned variant is the one cast");
  assert.equal(castWith?.variantOf, "melee");

  // Kimerus, live: with undead around, the browser offered only "Heal (vs. Living)" -- 2.5.18 took
  // Heal's two 2-action variants for a range choice and renamed it after the healing one.
  const loadedHeal = [];
  const heal = {
    id: "heal", uuid: "Actor.kim.Item.heal", type: "spell", slug: "heal", name: "Heal",
    system: {
      slug: "heal", location: { value: "divine" }, level: { value: 1 }, time: { value: "1 to 3" },
      traits: { value: ["healing", "manipulate", "vitality"] }, range: { value: "varies" },
      target: { value: "1 willing living creature or 1 undead" },
      defense: { save: { basic: true, statistic: "fortitude" } },
      damage: { 0: { formula: "1d8", kinds: ["damage", "healing"], type: "vitality" } },
      overlays: {
        living: { _id: "living", name: "Heal (vs. Living)", overlayType: "override", sort: 2,
          system: { damage: { 0: { formula: "1d8+8", kinds: ["healing"] } }, range: { value: "30 feet" }, time: { value: "2" } } },
        touch: { _id: "touch", overlayType: "override", sort: 1, system: { range: { value: "touch" }, time: { value: "1" } } },
        undead: { _id: "undead", name: "Heal (vs. Undead)", overlayType: "override", sort: 3,
          system: { damage: { 0: { kinds: ["damage"] } }, range: { value: "30 feet" }, target: { value: "1 undead" }, time: { value: "2" } } },
      },
    },
    loadVariant({ overlayIds }) { loadedHeal.push(overlayIds); return { ...this, variantOf: overlayIds[0] }; },
  };
  const divine = { id: "divine", system: { prepared: { value: "spontaneous" } }, async cast(cast) { castWith = cast; return { id: "heal-card" }; } };
  const kim = { id: "kim", type: "character", system: {}, itemTypes: { spell: [heal], spellcastingEntry: [divine] }, spellcasting: [divine] };
  const zombie = { id: "zombie", name: "Zombie Shambler", distance: 20, traits: ["undead", "zombie"], setTarget() {} };
  globalThis.canvas = { tokens: { placeables: [zombie], get: (id) => (id === "zombie" ? zombie : null), setTargets() {} } };
  const healContext = { actor: { document: kim }, profile: { reach: 5 }, battlefield: { enemies: [zombie], targets: [zombie], allies: [] } };
  const heals = readSpellActions(healContext).filter((action) => action.slug === "heal" && action.actionCost === 2);
  assert.deepEqual(heals.map((action) => action.name).sort(), ["Heal", "Heal — vs. Undead"], "Heal offers healing and harming undead");
  const healAlly = heals.find((action) => action.role === "healing");
  assert.equal(scoreCandidate(healContext, healAlly).name, "Heal", "healing Heal is not renamed after a variant");
  const vsUndead = heals.find((action) => action.role === "save-damage");
  assert.deepEqual(vsUndead.targetingProfile.requiresAnyTrait, ["undead"], "the damage mode only targets undead");
  const smite = await executeDraftStep({ context: healContext, step: { instanceId: "smite", targetTokenIds: ["zombie"], targetSelection: "manual" }, action: vsUndead });
  assert.equal(smite.status, "done");
  assert.deepEqual(loadedHeal.at(-1), ["undead"], "it casts PF2e's Heal (vs. Undead)");
} finally {
  Object.assign(globalThis, saved);
}
console.log("Spell variant choice tests passed.");
