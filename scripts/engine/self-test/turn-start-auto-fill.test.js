import assert from "node:assert/strict";
import { autoFillAfterRender, autoFillOnTurnStart, shouldAutoFillOnTurnStart } from "../../ui/panel/turn-start-auto-fill.js";

// Setting "Auto-fill at turn start" (client): fill the turn that just started when it is this
// user's to plan, never replacing a plan already made.
const saved = Object.fromEntries(["game"].map((key) => [key, globalThis[key]]));
try {
  let settings = { autoFillOnTurnStart: true, hideAutoFillFromPlayers: false };
  const player = { id: "roi", active: true, isGM: false };
  const gm = { id: "gm", active: true, isGM: true };
  const ownedBy = (...owners) => ({ testUserPermission: (user, level) => level === "OWNER" && owners.includes(user.id) });
  globalThis.game = { users: [player, gm], settings: { get: (_module, key) => settings[key] } };
  const goblin = { id: "goblin", actor: ownedBy() };
  const ezren = { id: "ezren", actor: ownedBy("roi") };
  const combat = (current) => ({ started: true, combatant: current });
  const panel = (combatant, steps = []) => {
    const fills = [];
    return { fills, _context: { combatant }, _builder: { draft: { steps } }, _autoFillDraft: async (options) => fills.push(options) };
  };

  assert.equal(shouldAutoFillOnTurnStart(panel(goblin), combat(goblin), gm), true, "the GM's NPC turn is filled");
  assert.equal(shouldAutoFillOnTurnStart(panel(ezren), combat(ezren), gm), false, "the GM leaves an active player's character to them");
  assert.equal(shouldAutoFillOnTurnStart(panel(ezren), combat(ezren), player), true, "a player's own character is filled");
  assert.equal(shouldAutoFillOnTurnStart(panel(goblin), combat(goblin), player), false, "not someone else's creature");
  assert.equal(shouldAutoFillOnTurnStart(panel(goblin, [{ instanceId: "kept" }]), combat(goblin), gm), false, "a plan already made is kept");
  assert.equal(shouldAutoFillOnTurnStart(panel(ezren), combat(goblin), gm), false, "the panel must show the creature whose turn it is");
  settings = { ...settings, hideAutoFillFromPlayers: true };
  assert.equal(shouldAutoFillOnTurnStart(panel(ezren), combat(ezren), player), false, "not for players when the GM hides Auto-fill from them");
  settings = { ...settings, autoFillOnTurnStart: false, hideAutoFillFromPlayers: false };
  assert.equal(shouldAutoFillOnTurnStart(panel(goblin), combat(goblin), gm), false, "off by default");

  settings = { autoFillOnTurnStart: true };
  globalThis.game.user = gm;
  const npcPanel = panel(goblin);
  assert.equal(await autoFillOnTurnStart(npcPanel, combat(goblin)), true);
  assert.equal(npcPanel.fills.length, 1, "it runs the same Auto-fill as the button");

  // Roi, live: turned on, nothing filled. The turn hook can run before the panel shows the new
  // creature, so each render also checks, once per turn.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
  const turnOne = { id: "c", started: true, round: 1, turn: 0, combatant: goblin };
  const rendered = panel(ezren);
  assert.equal(autoFillAfterRender(rendered, turnOne), false, "while the panel shows another creature, nothing yet");
  rendered._context = { combatant: goblin };
  assert.equal(autoFillAfterRender(rendered, turnOne), true, "once it shows the creature whose turn it is, it fills");
  await tick();
  assert.equal(rendered.fills.length, 1);
  assert.equal(autoFillAfterRender(rendered, turnOne), false, "only once per turn, however often the panel re-renders");
  assert.equal(await autoFillOnTurnStart(rendered, turnOne), false, "nor again from the turn hook");
  assert.equal(autoFillAfterRender(rendered, { ...turnOne, round: 2 }), true, "the next turn fills again");
  await tick();
  assert.equal(rendered.fills.length, 2);
} finally {
  Object.assign(globalThis, saved);
}
console.log("Turn-start Auto-fill tests passed.");
