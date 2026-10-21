import assert from "node:assert/strict";
import { npcAdjustmentModifier, rollActionDamageMessages } from "../execution/damage.js";

// Live (Kimerus): a weak Magnetic Skink's Launch Metal rolled 2d6, not PF2e's 2d6-2, and its damage
// landed apart from PF2e Toolbelt's saves. Combater rolled its own formula instead of the card's link.
const description = "<p>dealing @Damage[2d6[bludgeoning]|options:area-damage] damage (@Check[reflex|dc:13|basic|options:area-effect] save) to all creatures adjacent to the skink.</p>";
const launchMetal = { name: "Launch Metal", actionCost: 2, item: { type: "action", name: "Launch Metal", system: { description: { value: description } } } };
const weakSkink = { id: "skink", type: "npc", isWeak: true, isElite: false, getRollData: () => ({}) };

const previous = { game: globalThis.game, Hooks: globalThis.Hooks, document: globalThis.document, ChatMessage: globalThis.ChatMessage };
const rolled = [];
class DamageRoll {
  constructor(formula) { this.formula = formula; rolled.push(formula); }
  async evaluate() { return this; }
  async toMessage() { return { id: `rolled-${rolled.length}` }; }
}
try {
  globalThis.game = { pf2e: { DamageRoll, settings: { metagame: { breakdowns: false } } } };
  globalThis.ChatMessage = { getSpeaker: () => ({ actor: "skink" }) };

  assert.equal(npcAdjustmentModifier(weakSkink, launchMetal), -2);
  assert.equal(npcAdjustmentModifier({ ...weakSkink, isWeak: false, isElite: true }, launchMetal), 2);
  assert.equal(npcAdjustmentModifier(weakSkink, { item: { system: { frequency: { max: 1, per: "day" } } } }), -4,
    "a limited-use ability adjusts by 4, as PF2e does");
  assert.equal(npcAdjustmentModifier({ type: "character", isWeak: true }, launchMetal), 0);

  // No rendered card: Combater rolls itself, now with the weak adjustment.
  globalThis.document = { querySelectorAll: () => [] };
  globalThis.Hooks = { on: () => 1, off: () => {} };
  const fallback = await rollActionDamageMessages({ actor: weakSkink, action: launchMetal, cardMessage: null });
  assert.deepEqual(rolled, ["(2d6-2)[bludgeoning]"], "a weak NPC's damage is 2d6-2, like the card shows");
  assert.equal(fallback.length, 1);

  // A rendered card: click its own damage link, and keep the damage message PF2e creates.
  rolled.length = 0;
  const listeners = new Map();
  let nextHook = 0;
  globalThis.Hooks = {
    on: (name, fn) => { nextHook += 1; listeners.set(nextHook, { name, fn }); return nextHook; },
    off: (_name, id) => listeners.delete(id),
  };
  const emit = (message) => { for (const { name, fn } of [...listeners.values()]) if (name === "createChatMessage") fn(message); };
  let clicks = 0;
  let createsMessage = true;
  const link = { click: () => { clicks += 1; if (createsMessage) emit({ id: "pf2e-damage", isDamageRoll: true, speaker: { actor: "skink" } }); } };
  globalThis.document = {
    querySelectorAll: (selector) => (selector.includes("launch-metal-card")
      ? [{ querySelector: (inner) => (inner.includes("data-damage-roll") ? link : null) }]
      : []),
  };
  const cardMessage = { id: "launch-metal-card" };
  const fromCard = await rollActionDamageMessages({ actor: weakSkink, action: launchMetal, cardMessage });
  assert.equal(clicks, 1, "the card's own damage link is clicked");
  assert.deepEqual(fromCard, ["pf2e-damage"], "that damage message is the one undo removes");
  assert.deepEqual(rolled, [], "Combater doesn't roll its own damage as well");
  assert.equal(listeners.size, 0, "the one-shot hook is removed");

  // The GM cancels PF2e's damage dialog: nothing is rolled behind their back.
  createsMessage = false;
  const { setTimeout: realTimeout } = globalThis;
  globalThis.setTimeout = (fn, ms) => realTimeout(fn, Math.min(ms, 5));
  try {
    assert.deepEqual(await rollActionDamageMessages({ actor: weakSkink, action: launchMetal, cardMessage }), []);
  } finally {
    globalThis.setTimeout = realTimeout;
  }
  assert.deepEqual(rolled, [], "a cancelled dialog is not replaced by Combater's roll");

  // Spells keep their own damage path (Toolbelt reads the spell's save from the origin).
  clicks = 0;
  const spell = { ...launchMetal, item: { ...launchMetal.item, type: "spell", system: { ...launchMetal.item.system, area: { type: "burst", value: 5 } } } };
  await rollActionDamageMessages({ actor: weakSkink, action: spell, cardMessage });
  assert.equal(clicks, 0);
  assert.equal(rolled.length, 1);
} finally {
  globalThis.game = previous.game;
  globalThis.Hooks = previous.Hooks;
  globalThis.document = previous.document;
  globalThis.ChatMessage = previous.ChatMessage;
}
console.log("NPC inline damage tests passed.");
