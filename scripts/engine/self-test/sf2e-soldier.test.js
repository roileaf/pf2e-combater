import assert from "node:assert/strict";
import { readAreaFireActions } from "../../readers/area-fire-reader.js";
import { primaryTargetToken } from "../execution/area-fire.js";
import { endSuppressionBy, suppressingFireFailure } from "../../rules/suppressing-fire.js";
import { reloadQuantity } from "../execution/equipment.js";

const saved = globalThis.game;
try {
  // Soldier features mark the Area Fire candidate; Primary Target uses the weapon's own Strike.
  const gun = { id: "mg", name: "Machine Gun", system: { traits: { value: ["automatic"], config: {} }, range: 40, expend: 1, damage: { dice: 1, die: "d8" } } };
  const strike = { type: "strike", label: "Machine Gun", item: gun, ready: true, variants: [{ roll() {} }], altUsages: [] };
  strike.altUsages.push({ type: "auto-fire", label: "Machine Gun", glyph: "2", item: gun, ready: true, statistic: { dc: { value: 20 } }, variants: [{ roll() {} }] });
  const soldier = { itemTypes: { feat: [{ slug: "suppressing-fire" }, { slug: "primary-target" }] } };
  const [autoFire] = readAreaFireActions([strike], { actor: soldier });
  assert.equal(autoFire.activityProfile.suppressingFire, true);
  assert.equal(autoFire.activityProfile.primaryTarget, true);
  assert.equal(autoFire.primaryStrike, strike, "Primary Target fires the weapon's own Strike");
  const [plain] = readAreaFireActions([strike], { actor: { itemTypes: { feat: [] } } });
  assert.equal(plain.activityProfile.suppressingFire, undefined);
  assert.equal(plain.primaryStrike, null);

  // Empty weapon: SF2e's "remaining" is free capacity, not rounds left.
  const empty = readAreaFireActions([{ ...strike, altUsages: [{ ...strike.altUsages[0], ammunition: { loaded: [], capacity: 20, remaining: 20 } }] }], { actor: soldier })[0];
  assert.equal(empty.available, false);

  // Primary Target: closest to the shooter for a cone, closest to the center for a burst; enemies only.
  globalThis.game = { system: { id: "sf2e" } };
  const tok = (id, x, y) => ({ id, name: id, center: { x, y }, document: { id } });
  const near = tok("near", 500, 500); const far = tok("far", 900, 500); const ally = tok("ally", 450, 500);
  const context = { token: { center: { x: 350, y: 500 } }, battlefield: { enemies: [{ id: "near", token: { id: "near" } }, { id: "far", token: { id: "far" } }] } };
  assert.equal(primaryTargetToken({ context, action: { targetingProfile: { type: "cone" } }, tokens: [far, ally, near] })?.id, "near");
  assert.equal(primaryTargetToken({ context, action: { targetingProfile: { type: "burst" } }, tokens: [far, near], marker: { center: { x: 880, y: 500 } } })?.id, "far");

  // Suppressing Fire: a failed Reflex save against the soldier's weapon (as SF2e posts it) → Suppressed.
  const soldierActor = { uuid: "Actor.obozaya", itemTypes: { feat: [{ slug: "suppressing-fire" }] } };
  const goon = { uuid: "Actor.goon", isAllyOf: () => false };
  const save = (outcome, extra = {}) => ({
    actor: goon,
    flags: { sf2e: {
      context: { type: "saving-throw", outcome, token: "Scene.s.Token.goonA", domains: ["reflex", "saving-throw"], options: ["check:statistic:reflex", "item:type:weapon"], origin: { actor: "Actor.obozaya" } },
      origin: { actor: "Actor.obozaya", type: "weapon" },
    } },
    ...extra,
  });
  const resolveActor = (uuid) => (uuid === "Actor.obozaya" ? soldierActor : null);
  assert.equal(suppressingFireFailure(save("failure"), { resolveActor, messages: [] })?.target, goon);
  assert.ok(suppressingFireFailure(save("criticalFailure"), { resolveActor, messages: [] }));
  assert.equal(suppressingFireFailure(save("success"), { resolveActor, messages: [] }), null);
  const fortSave = save("failure"); fortSave.flags.sf2e.context.domains = ["fortitude"]; fortSave.flags.sf2e.context.options = ["check:statistic:fortitude", "item:type:weapon"];
  assert.equal(suppressingFireFailure(fortSave, { resolveActor, messages: [] }), null, "only the Reflex save an area weapon asks for");
  const spellSave = save("failure"); spellSave.flags.sf2e.origin.type = "spell"; spellSave.flags.sf2e.context.options = ["check:statistic:reflex"];
  assert.equal(suppressingFireFailure(spellSave, { resolveActor, messages: [] }), null, "a spell's Reflex save isn't Suppressing Fire");
  assert.equal(suppressingFireFailure({ ...save("failure"), actor: { uuid: "Actor.ally", isAllyOf: () => true } }, { resolveActor, messages: [] }), null, "allies aren't suppressed");
  assert.equal(suppressingFireFailure(save("failure"), { resolveActor: () => ({ uuid: "Actor.obozaya", itemTypes: { feat: [] } }), messages: [] }), null, "no Suppressing Fire, no condition");
  // Primary Target hit: this creature's success counts as a failure.
  const hit = { flags: { "pf2e-combater": { primaryTarget: true }, sf2e: { context: { type: "attack-roll", outcome: "success", origin: { actor: "Actor.obozaya" }, target: { token: "Scene.s.Token.goonA" } } } } };
  assert.equal(suppressingFireFailure(save("success"), { resolveActor, messages: [hit] })?.primaryTarget, true);
  const missed = { flags: { ...hit.flags, sf2e: { context: { ...hit.flags.sf2e.context, outcome: "failure" } } } };
  assert.equal(suppressingFireFailure(save("success"), { resolveActor, messages: [missed] }), null);

  // It ends at the start of that soldier's turn, and only the Suppressed it applied.
  const deleted = [];
  const condition = (by) => ({ slug: "suppressed", flags: { "pf2e-combater": by ? { suppressedBy: by } : {} }, delete: async () => { deleted.push(by ?? "other"); } });
  await endSuppressionBy("Actor.obozaya", [{ itemTypes: { condition: [condition("Actor.obozaya"), condition("Actor.other"), condition(null)] } }]);
  assert.deepEqual(deleted, ["Actor.obozaya"]);

  // SF2e Reload refills a weapon with a capacity; PF2e (and magazines) load one.
  const subitems = (n) => ({ forEach: (fn) => (n ? [{ quantity: n }] : []).forEach(fn) });
  const machineGun = { system: { ammo: { capacity: 20 } }, subitems: subitems(1) };
  assert.equal(reloadQuantity(machineGun, { quantity: 18, system: { uses: { max: 1 } } }), 18);
  assert.equal(reloadQuantity({ ...machineGun, subitems: subitems(0) }, { quantity: 50, system: { uses: { max: 1 } } }), 20);
  assert.equal(reloadQuantity(machineGun, { quantity: 3, system: { uses: { max: 20 } } }), 1, "a magazine is one magazine");
  globalThis.game = { system: { id: "pf2e" } };
  assert.equal(reloadQuantity(machineGun, { quantity: 18 }), 1, "PF2e unchanged");
} finally {
  if (saved === undefined) delete globalThis.game; else globalThis.game = saved;
}
console.log("SF2e soldier (Suppressing Fire, Primary Target) tests passed.");
