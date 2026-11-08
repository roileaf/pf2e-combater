import assert from "node:assert/strict";
import { suggestedTargetFor } from "../scoring/tactics.js";
import { executeDraftStep } from "../action/executor.js";

// Roi, live: Grimmyr's third Strike was planned at a Hobgoblin Soldier an earlier Strike dropped.
// Combater rightly won't swing at the body, but just said "Target a token in Foundry first."
// It now takes the nearest living enemy the Strike reaches, and says why when there is none.
const saved = Object.fromEntries(["game", "canvas"].map((key) => [key, globalThis[key]]));
try {
  const targeted = [];
  const token = (id, name, hp) => ({
    id, name, document: { id, name },
    actor: { id, name, type: "npc", system: { attributes: { hp: { value: hp, max: 20 } } } },
    setTarget(selected) { if (selected) targeted.push(id); },
  });
  const downed = token("hob-1", "Hobgoblin Soldier", 0);
  const living = token("hob-2", "Hobgoblin Soldier", 14);
  globalThis.game = { user: { id: "gm", isGM: true, targets: new Set() } };
  globalThis.canvas = { tokens: { placeables: [downed, living], get: (id) => [downed, living].find((entry) => entry.id === id) ?? null, setTargets() { targeted.length = 0; } } };
  const rolls = [];
  const flail = {
    name: "+1 Striking War Flail", slug: "strike", source: "strike", executable: "strike", actionCost: 1, attackTrait: true,
    targetingProfile: { enemy: true }, variants: [{ roll: async () => { rolls.push([...targeted]); return { id: "attack-card" }; } }],
  };
  const context = (enemies) => ({
    actor: { document: { id: "grimmyr", type: "character", system: {}, items: [] } },
    profile: { reach: 5 },
    battlefield: { enemies, targets: enemies, allies: [] },
  });
  const step = { instanceId: "third-strike", targetTokenIds: ["hob-1"], targetSelection: "recommended", action: flail };

  const retargeted = await executeDraftStep({ context: context([
    { id: "hob-1", name: "Hobgoblin Soldier", distance: 5, hpPercent: 0, token: { id: "hob-1" } },
    { id: "hob-2", name: "Hobgoblin Soldier", distance: 5, hpPercent: 70, token: { id: "hob-2" } },
  ]), step, action: flail });
  assert.equal(retargeted.status, "done", "the Strike runs at the living enemy next to you");
  assert.deepEqual(rolls.at(-1), ["hob-2"], "it targets the living Hobgoblin, not the body");

  const none = await executeDraftStep({ context: context([
    { id: "hob-1", name: "Hobgoblin Soldier", distance: 5, hpPercent: 0, token: { id: "hob-1" } },
    { id: "hob-2", name: "Hobgoblin Soldier", distance: 30, hpPercent: 70, token: { id: "hob-2" } },
  ]), step, action: flail });
  assert.equal(none.status, "needs-choice", "with no living enemy in reach it asks for a target");
  assert.match(none.reason, /Hobgoblin Soldier is down/, "and says why");
  assert.equal(rolls.length, 1, "it never Strikes the body");

  // Kimerus (Discord): a step run on the player's own Foundry target went at the Best target
  // instead. A target picked by hand, even an NPC at 0 HP, is used as given.
  const picked = await executeDraftStep({ context: context([
    { id: "hob-1", name: "Hobgoblin Soldier", distance: 5, hpPercent: 0, token: { id: "hob-1" } },
    { id: "hob-2", name: "Hobgoblin Soldier", distance: 5, hpPercent: 70, token: { id: "hob-2" } },
  ]), step: { ...step, targetSelection: "manual" }, action: flail });
  assert.equal(picked.status, "done");
  assert.deepEqual(rolls.at(-1), ["hob-1"], "a hand-picked target is never swapped for another");

  // Only Auto-fill picks targets: a step the player added never runs on the planner's pick.
  const added = await executeDraftStep({ context: context([]),
    step: { instanceId: "browser-strike", ownTarget: true, action: { ...flail, suggestedTarget: { type: "enemy", id: "hob-2", name: "Hobgoblin Soldier" } } },
    action: { ...flail, suggestedTarget: { type: "enemy", id: "hob-2", name: "Hobgoblin Soldier" } } });
  assert.equal(added.status, "needs-choice", "an added action asks for your target");
  assert.equal(rolls.length, 2);
} finally {
  Object.assign(globalThis, saved);
}
// Forbidding Ward wards an ally, never the caster: Auto-fill must not plan it on yourself.
const forbiddingWard = {
  name: "Forbidding Ward", slug: "forbidding-ward", role: "defense", source: "spell-curated",
  targetingProfile: { ally: true, self: false, enemy: false, maxRange: 30 },
  activityProfile: { acBuff: true, saveBuff: true },
  item: { type: "spell", system: { range: { value: "30 feet" }, target: { value: "1 ally and 1 enemy" } } },
};
const wardContext = (allies) => ({ actor: { id: "cleric", name: "Cleric" }, allies, enemies: [{ id: "ogre", name: "Ogre", distance: 10 }] });
const fighter = { id: "fighter", name: "Fighter", distance: 15, hp: { value: 30, max: 30 } };
assert.equal(suggestedTargetFor(wardContext([fighter]), forbiddingWard, "defense")?.id, "fighter", "Forbidding Ward goes to the ally in range");
assert.equal(suggestedTargetFor(wardContext([{ ...fighter, distance: 60 }]), forbiddingWard, "defense"), null, "with no ally in range it has no target, not the caster");
assert.equal(suggestedTargetFor(wardContext([]), { ...forbiddingWard, slug: "shield", targetingProfile: { self: true } }, "defense")?.type, "self", "a self defense still goes to the caster");

console.log("Downed target tests passed.");
