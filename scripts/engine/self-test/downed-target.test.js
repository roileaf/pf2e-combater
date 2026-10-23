import assert from "node:assert/strict";
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
} finally {
  Object.assign(globalThis, saved);
}
console.log("Downed target tests passed.");
