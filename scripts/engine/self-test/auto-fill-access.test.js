import assert from "node:assert/strict";
import { autoFillAllowed } from "../../ui/panel/auto-fill-access.js";
import { shouldAutoFillOnTurnStart } from "../../ui/panel/turn-start-auto-fill.js";

// Sherp: "third action suggestions only" -- the GM can hold Auto-fill back from players until they
// are down to their last action (or last two), so it suggests instead of planning the whole turn.
const previousGame = globalThis.game;
const withSettings = (values) => { globalThis.game = { settings: { get: (_module, key) => values[key] } }; };
const player = { id: "p1", isGM: false };
const gm = { id: "gm", isGM: true };
// A turn with `spent` normal actions used so far.
const turn = (spent) => ({ profile: { conditions: { slugs: [], values: {} } }, actionsSpent: { normal: spent, total: spent } });

try {
  withSettings({});
  assert.equal(autoFillAllowed(turn(0), player), true, "default: players always have Auto-fill");

  withSettings({ playerAutoFillWhen: "last" });
  assert.equal(autoFillAllowed(turn(0), player), false, "three actions left: not yet");
  assert.equal(autoFillAllowed(turn(1), player), false, "two left: not yet");
  assert.equal(autoFillAllowed(turn(2), player), true, "one left: Auto-fill suggests the third action");
  assert.equal(autoFillAllowed(turn(0), gm), true, "the GM always has it");
  assert.equal(autoFillAllowed(null, player), false, "no turn to read: held back");

  withSettings({ playerAutoFillWhen: "last-two" });
  assert.equal(autoFillAllowed(turn(0), player), false);
  assert.equal(autoFillAllowed(turn(1), player), true, "two left");

  withSettings({ playerAutoFillWhen: "always", hideAutoFillFromPlayers: true });
  assert.equal(autoFillAllowed(turn(2), player), false, "Hide Auto-fill from players still wins");

  // Auto-fill at turn start never runs for a player while it's held back.
  withSettings({ playerAutoFillWhen: "last", autoFillOnTurnStart: true });
  const actor = { testUserPermission: () => true };
  const combat = { started: true, combatant: { id: "c1", actor } };
  const panel = { _context: { ...turn(0), combatant: { id: "c1" } }, _builder: { draft: { steps: [] } } };
  assert.equal(shouldAutoFillOnTurnStart(panel, combat, player), false);
  withSettings({ playerAutoFillWhen: "always", autoFillOnTurnStart: true });
  assert.equal(shouldAutoFillOnTurnStart(panel, combat, player), true);
} finally {
  globalThis.game = previousGame;
}

console.log("Auto-fill access tests passed.");
