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
} finally {
  Object.assign(globalThis, saved);
}
console.log("Spell variant choice tests passed.");
