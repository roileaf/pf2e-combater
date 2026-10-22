import assert from "node:assert/strict";
import { executeNativeAction } from "../execution/native-item.js";
import { decorateBuilder } from "../../ui/panel/view-model.js";

// Live (Roi): Hand of the Apprentice posted its card with Attack / MAP -5 / MAP -10 buttons, but
// Combater never rolled the attack. An attack spell is rolled like a Strike, at the step's MAP.
const previous = { Hooks: globalThis.Hooks, game: globalThis.game };
const listeners = new Map();
let nextHook = 0;
globalThis.Hooks = {
  on: (name, fn) => { nextHook += 1; listeners.set(nextHook, { name, fn }); return nextHook; },
  off: (_name, id) => listeners.delete(id),
};
const emit = (message) => { for (const { name, fn } of [...listeners.values()]) if (name === "createChatMessage") fn(message); };

function spell({ defense = "ac", traits = ["attack"] } = {}) {
  const attacks = [];
  const item = {
    id: "hand", type: "spell", name: "Hand of the Apprentice",
    system: { traits: { value: traits }, defense: defense ? { passive: { statistic: defense } } : null },
    attacks,
    rollAttack: async (_event, number) => {
      attacks.push(number);
      emit({ id: `attack-${number}`, flags: { pf2e: { context: { type: "spell-attack-roll" } } } });
      return { total: 20 };
    },
  };
  item.cast = async () => ({ documentName: "ChatMessage", id: "hand-card", item, timestamp: 1 });
  return item;
}

try {
  globalThis.game = { ...previous.game, settings: { get: () => "publicroll" } };
  const ezren = { id: "ezren", type: "character", items: { get: () => null } };

  const hand = spell();
  const first = await executeNativeAction({ actor: ezren, action: { name: "Hand of the Apprentice", item: hand } });
  assert.deepEqual(hand.attacks, [1], "casting an attack spell rolls its attack");
  const ops = (first.patch?.execution?.revert?.ops ?? []).filter((op) => op.kind === "chat").map((op) => op.messageId);
  assert.ok(ops.includes("hand-card") && ops.includes("attack-1"), "undo removes the card and the attack");

  const second = spell();
  await executeNativeAction({ actor: ezren, action: { name: "Hand of the Apprentice", item: second }, attackNumber: 2 });
  assert.deepEqual(second.attacks, [2], "a second attack this turn rolls at MAP -5, like the card's MAP button");

  const arc = spell({ defense: "reflex", traits: ["concentrate", "manipulate"] });
  await executeNativeAction({ actor: ezren, action: { name: "Electric Arc", item: arc } });
  assert.deepEqual(arc.attacks, [], "a save spell has no attack to roll");
  assert.equal(listeners.size, 0, "the attack hook is removed");
  // The plan row shows the spell's attack bonus with MAP, as a Strike's does: "+12 MAP 0", "+7 MAP -5".
  const previousFromUuidSync = globalThis.fromUuidSync;
  globalThis.fromUuidSync = (uuid) => (uuid === "Actor.ezren.Item.hand"
    ? { type: "spell", spellcasting: { statistic: { check: { mod: 12 } } } } : null);
  try {
    const planned = { name: "Hand of the Apprentice", slug: "hand-of-the-apprentice", source: "spell", actionCost: 1, traits: ["attack", "focus"],
      item: { type: "spell", uuid: "Actor.ezren.Item.hand", system: { traits: { value: ["attack"] } } } };
    const tabs = Object.fromEntries(["one", "two", "three", "free", "reaction"].map((id) => [id, { all: [], favorites: [] }]));
    const rows = decorateBuilder({ tabs, draft: { steps: [{ instanceId: "a", action: planned }, { instanceId: "b", action: planned }] } }, "one").draft.steps;
    assert.deepEqual(rows.map((row) => [row.attackBonusLabel, row.mapToolLabel, row.canCycleMap]),
      [["+12", "MAP 0", true], ["+7", "MAP -5", true]], "an attack spell shows its bonus and MAP like a Strike");
  } finally {
    globalThis.fromUuidSync = previousFromUuidSync;
  }
} finally {
  globalThis.Hooks = previous.Hooks;
  globalThis.game = previous.game;
}
console.log("Spell attack roll tests passed.");
