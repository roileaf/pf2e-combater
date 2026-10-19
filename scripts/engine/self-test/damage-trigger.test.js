import assert from "node:assert/strict";
import { rollActionDamageMessages } from "../execution/damage.js";

// Glass Shield carries 1d4 damage, but only for when the shield breaks on a Shield Block. Casting it
// must not roll that damage; its card keeps the Roll Damage button for the moment it happens.
const saved = globalThis.game;
const rolled = [];
globalThis.game = { pf2e: { DamageRoll: class {
  constructor(formula) { this.formula = formula; }
  async evaluate() {}
  async toMessage() { rolled.push(this.formula); return { id: `damage-${rolled.length}` }; }
} } };
try {
  const spell = (system) => ({ name: "Spell", item: { type: "spell", name: "Spell",
    system: { description: { value: "<p>deal @Damage[1d4[piercing]]</p>" }, ...system } } });
  assert.deepEqual(await rollActionDamageMessages({ actor: {}, action: spell({ target: { value: "" }, area: null }) }), [],
    "casting Glass Shield (no target, no area) rolls no damage");
  assert.equal(rolled.length, 0);
  assert.equal((await rollActionDamageMessages({ actor: {}, action: spell({ target: { value: "1 or 2 creatures" } }) })).length, 1,
    "a targeted spell (Electric Arc) still auto-rolls");
  assert.equal((await rollActionDamageMessages({ actor: {}, action: spell({ area: { type: "burst", value: 20 } }) })).length, 1,
    "an area spell (Fireball) still auto-rolls");
  assert.equal((await rollActionDamageMessages({ actor: {}, action: { name: "Breath", item: { type: "action",
    system: { description: { value: "<p>@Damage[2d6[fire]]</p>" } } } } })).length, 1, "non-spell actions are unaffected");
  console.log("Damage trigger tests passed.");
} finally {
  globalThis.game = saved;
}
