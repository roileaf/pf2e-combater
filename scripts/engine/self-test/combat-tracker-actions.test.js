import assert from "node:assert/strict";
import { createTurnSnapshot } from "../../state/action-tracker.js";
import { combatTrackerActionsView } from "../../ui/combat-tracker-actions.js";
import { adjustGuarderReaction } from "../../integrations/guarder.js";
import { reactionCardSpend, reactionUsed } from "../../state/turn-controls.js";

// Setting "Show actions in the combat tracker": each row of Foundry's and PF2e HUD's trackers
// shows the creature's actions on its turn and its reaction, read from Combater's own tracker.
const saved = Object.fromEntries(["game"].map((key) => [key, globalThis[key]]));
try {
  const actor = (id) => ({ id, type: "character", flags: {}, itemTypes: { condition: [], effect: [] }, items: [] });
  const kim = { id: "kim", tokenId: "kim-token", actorId: "kim", actor: actor("kim"), flags: {} };
  const skink = { id: "skink", tokenId: "skink-token", actorId: "skink", actor: actor("skink"),
    flags: { "pf2e-combater": { reactionUsed: { round: 1 } } } };
  const combat = { id: "combat", started: true, round: 1, turn: 0, turns: [kim, skink], combatants: [kim, skink], combatant: kim, flags: {} };
  combat.flags["pf2e-combater"] = { actionTurn: createTurnSnapshot(combat, { key: "turn-1" }) };
  globalThis.game = { combat, user: { id: "gm", isGM: true }, messages: [] };

  const current = combatTrackerActionsView(combat, kim);
  assert.equal(current.pips.length, 3, "the creature whose turn it is shows its three actions");
  assert.equal(current.pips.filter((pip) => pip.spent).length, 0);
  assert.equal(current.reaction?.used, false, "and its reaction, still available");

  assert.equal(current.tipTitle, "Actions left: 3/3");

  // Roi, live: "3/3" while quickened. The quickened diamond is counted in the tooltip too.
  const quickenedTurn = { ...combat, flags: { "pf2e-combater": { actionTurn: { ...combat.flags["pf2e-combater"].actionTurn,
    pool: { ...combat.flags["pf2e-combater"].actionTurn.pool, quickened: 1, quickenedActions: 1, totalActions: 4 } } } } };
  assert.equal(combatTrackerActionsView(quickenedTurn, kim).tipTitle, "Actions left: 3/3 · Quickened 1/1");

  kim.actor.flags = { "pf2e-combater": { actionReceipts: { turnKey: "turn-1", entries: { stride: { cost: 1, slug: "stride" } } } } };
  assert.equal(combatTrackerActionsView(combat, kim).pips.filter((pip) => pip.spent).length, 1, "a spent action dims one diamond");

  const waiting = combatTrackerActionsView(combat, skink);
  assert.equal(waiting.forecast, true, "a creature waiting for its turn shows its next-turn forecast (on hover)");
  assert.equal(waiting.pips.length, 3);
  assert.equal(waiting.pipControls, false, "a forecast can't be spent");
  assert.equal(waiting.reaction?.used, true, "and its used reaction shows");
  assert.match(waiting.countLabel, /^Next turn: 3 actions$/);

  // Why the count is lower: Slowed 1 costs it an action next turn, and says so.
  skink.actor.itemTypes.condition = [{ slug: "slowed", value: 1, system: { value: { value: 1 } } }];
  const slowed = combatTrackerActionsView(combat, skink);
  assert.equal(slowed.pips.length, 2, "Slowed 1: two actions next turn");
  assert.match(slowed.countLabel, /^Next turn: 2 actions · Slowed 1$/, "the tooltip says why");
  assert.deepEqual(slowed.conditionIcons.map((icon) => icon.slug), ["slowed"], "with the condition's icon");

  assert.equal(combatTrackerActionsView({ ...combat, started: false }, kim), null, "nothing before the encounter starts");

  // The GM can click them, as on the panel: spend/refund actions, use/give back a reaction.
  const gmView = combatTrackerActionsView(combat, kim);
  assert.equal(gmView.pipControls, true, "the GM spends and refunds actions from the tracker");
  assert.equal(gmView.canRefund, true);
  assert.equal(gmView.reactionControls, true);
  globalThis.game = { ...globalThis.game, user: { id: "player", isGM: false } };
  const playerView = combatTrackerActionsView(combat, kim);
  assert.equal(playerView.pipControls, false, "players see them read-only");
  assert.equal(playerView.reactionControls, false);

  // PF2e Guarder tracks a guardian's reactions: Combater shows its pool and spends through it.
  globalThis.game = { ...globalThis.game, user: { id: "gm", isGM: true } };
  let pool = { general: 1, guardian: 1, boundless: 0 };
  const calls = [];
  const guarder = { active: true, api: {
    // Like the real API: a pool for any combatant, guardian or not.
    reactions: (actor) => (actor === kim.actor ? pool : { general: 1, guardian: 0 }),
    setReactions: async (_actor, next) => { calls.push(["set", next]); pool = next; },
  } };
  globalThis.game.modules = { get: (id) => (id === "pf2e-guarder" ? guarder : undefined) };
  kim.actor.items = [{ slug: "intercept-attack", type: "action" }];
  const guardianView = combatTrackerActionsView(combat, kim);
  assert.deepEqual(guardianView.reaction.guarder, { general: 1, guardianOnly: 1, generalSlots: 1, guardianSlots: 1 },
    "a guardian shows its general and guardian-only reactions");
  // Guarder's slot limit: Ever Ready at initiative is one guardian-only slot, no general one.
  guarder.api.reactionLimit = () => ({ general: 0, guardian: 1 });
  pool = { general: 0, guardian: 1 };
  assert.deepEqual(combatTrackerActionsView(combat, kim).reaction.guarder, { general: 0, guardianOnly: 1, generalSlots: 0, guardianSlots: 1 },
    "Ever Ready before the first turn draws a single gold glyph");
  // Roi, live: as the encounter starts the limit already says "one general slot" while the pool
  // still holds Ever Ready's reaction, and two glyphs flashed. Only the limit's slots are drawn.
  guarder.api.reactionLimit = () => ({ general: 1, guardian: 0 });
  assert.equal(combatTrackerActionsView(combat, kim).reaction.guarder.guardianSlots, 0, "no glyph past the current limit");
  delete guarder.api.reactionLimit;
  pool = { general: 1, guardian: 1, boundless: 0 };
  assert.equal(guardianView.reaction.used, false);
  assert.match(guardianView.reaction.label, /Reactions: 1 · guardian-only: 1/);
  assert.equal(combatTrackerActionsView(combat, skink).reaction.guarder, undefined,
    "others keep Combater's own reaction, though Guarder answers for every combatant");
  // Roi, live: every creature took Guarder's pool, so "Reactions before first turn" off did nothing.
  globalThis.game.settings = { get: (_module, key) => (key === "reactionsBeforeFirstTurn" ? false : undefined) };
  const waitingSkink = combatTrackerActionsView(combat, skink).reaction;
  assert.equal(waitingSkink.blocked, true, "a non-guardian still waits for its first turn");
  assert.match(waitingSkink.label, /No reaction until its first turn/);
  delete globalThis.game.settings;
  assert.equal(reactionCardSpend({ speaker: { token: "kim-token", actor: "kim" }, item: { actionCost: { type: "reaction" } } }, combat), null,
    "Guarder counts a guardian's reaction cards itself");
  await adjustGuarderReaction(kim.actor, 1);
  assert.deepEqual(calls.at(-1), ["set", { general: 1, guardian: 0, boundless: 0 }], "spending takes a guardian-only reaction first");
  pool = { general: 0, guardian: 0, boundless: 0 };
  assert.equal(reactionUsed(kim), true, "no reactions left in Guarder means used");
  guarder.api.spendReaction = async (actor) => { calls.push(["spend", actor.id]); return true; };
  guarder.api.restoreReaction = async (actor) => { calls.push(["restore", actor.id]); return true; };
  await adjustGuarderReaction(kim.actor, -1);
  assert.deepEqual(calls.at(-1), ["restore", "kim"], "Guarder's own restore (with Sundry and its limits) is used when it offers one");
} finally {
  Object.assign(globalThis, saved);
}
console.log("Combat tracker actions tests passed.");
