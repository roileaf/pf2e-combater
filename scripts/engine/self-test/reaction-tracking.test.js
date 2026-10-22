import assert from "node:assert/strict";
import { readShieldBlockAvailability, readShieldSpellBlockActions } from "../../readers/defense-action-reader.js";
import { reactionCardSpend } from "../../state/turn-controls.js";
import { createGuidance } from "../execution/guidance.js";

// Live (Kimerus): Kim has Glass Shield up when the Magnetic Skink attacks. Combater offered no
// Shield Block (it only knew the Shield spell's effect), and Shield Block from the sheet never
// spent her reaction.
const glassShieldEffect = { id: "glass", type: "effect", name: "Spell Effect: Glass Shield", slug: "spell-effect-glass-shield" };
const kim = {
  id: "kim", type: "character", name: "Kim Yun-Hee",
  system: { attributes: { shield: { raised: true, itemId: "glass", hp: { value: 0 }, destroyed: false } } },
  items: { get: (id) => (id === "glass" ? glassShieldEffect : null) },
  itemTypes: { effect: [glassShieldEffect], action: [], feat: [] },
};
const context = { actor: { document: kim } };

const offered = readShieldSpellBlockActions(kim, context);
assert.equal(offered.length, 1, "Glass Shield's shield offers Shield Block, like the Shield spell");
assert.equal(offered[0].available, true);
assert.equal(readShieldBlockAvailability("shield-block", { name: "Shield Block" }, context).available, true);

const lowered = { ...kim, system: { attributes: { shield: { raised: false, itemId: "buckler" } } }, itemTypes: { effect: [], action: [], feat: [] } };
assert.deepEqual(readShieldSpellBlockActions(lowered, { actor: { document: lowered } }), []);
assert.equal(readShieldBlockAvailability("shield-block", { name: "Shield Block" }, { actor: { document: lowered } }).available, false,
  "a shield that isn't raised can't Shield Block");
const raisedBuckler = { ...lowered, system: { attributes: { shield: { raised: true, itemId: "buckler" } } }, items: { get: () => ({ type: "shield" }) } };
assert.equal(readShieldBlockAvailability("shield-block", { name: "Shield Block" }, { actor: { document: raisedBuckler } }).available, true,
  "a raised physical shield can Shield Block");
assert.deepEqual(readShieldSpellBlockActions(raisedBuckler, { actor: { document: raisedBuckler } }), [],
  "a physical shield uses the character's own Shield Block, not a spell one");

const previousGame = globalThis.game;
const previousChatMessage = globalThis.ChatMessage;
try {
  let checkerActive = false;
  globalThis.game = { ...previousGame, modules: { get: (id) => (id === "pf2e-reaction" ? { active: checkerActive } : undefined) } };
  const kimCombatant = { id: "kim-combatant", tokenId: "kim-token", actorId: "kim", flags: {}, actor: { itemTypes: { effect: [] } } };
  const combat = { started: true, combatants: [kimCombatant] };
  const shieldBlockCard = { speaker: { token: "kim-token", actor: "kim" }, item: { actionCost: { type: "reaction" } } };

  assert.equal(reactionCardSpend(shieldBlockCard, combat)?.combatant, kimCombatant,
    "Shield Block from the sheet spends Kim's reaction, off her turn");
  assert.equal(reactionCardSpend({ ...shieldBlockCard, item: { actionCost: { type: "action", value: 1 } } }, combat), null,
    "an ordinary action card doesn't");
  assert.equal(reactionCardSpend(shieldBlockCard, { ...combat, started: false }), null);

  checkerActive = true;
  assert.equal(reactionCardSpend(shieldBlockCard, combat), null, "PF2e Reaction Checker counts item cards itself");
  const combaterNote = { speaker: { token: "kim-token", actor: "kim" }, flags: { "pf2e-combater": { reactionUse: true } } };
  assert.equal(reactionCardSpend(combaterNote, combat)?.combatant, kimCombatant,
    "Combater's own reaction note counts, since other trackers can't see it");
  checkerActive = false;

  const spent = { ...kimCombatant, flags: { "pf2e-combater": { reactionUsed: { round: 1 } } } };
  assert.equal(reactionCardSpend(shieldBlockCard, { ...combat, combatants: [spent] }), null, "a spent reaction isn't spent twice");

  const created = [];
  globalThis.ChatMessage = { create: async (data) => created.push(data), getSpeaker: () => ({ token: "kim-token" }) };
  globalThis.game = { ...globalThis.game, user: { id: "gm" } };
  await createGuidance({ name: "Shield Block", actionCost: "reaction" }, kim);
  await createGuidance({ name: "Seek", actionCost: 1 }, kim);
  assert.equal(created[0].flags?.["pf2e-combater"]?.reactionUse, true, "Combater's Shield Block note is marked as a reaction");
  assert.equal(created[1].flags, undefined);
} finally {
  globalThis.game = previousGame;
  globalThis.ChatMessage = previousChatMessage;
}
console.log("Reaction tracking tests passed.");
