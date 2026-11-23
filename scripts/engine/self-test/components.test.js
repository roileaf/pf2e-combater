import assert from "node:assert/strict";
import { combatTrackerActions, componentEnabled, minimalHiddenParts, panelComponentsEnabled, trackerOnlyMode } from "../../settings.js";
import { turnControlsView } from "../../ui/panel/turn-controls.js";
import { upcomingTurnsView } from "../../ui/panel/upcoming-turns.js";
import { panelIntelLedgerView } from "../../ui/panel/context-workflow.js";

// Roi: "add components so people can actually turn on/off these 3": action tracker, turn planner
// and executioner, intel tracker. Each is a world setting, on by default.
const previousGame = globalThis.game;
const world = (values, user = { isGM: true }) => { globalThis.game = { user, settings: { get: (_module, key) => values[key] } }; };

try {
  world({});
  assert.deepEqual(["tracker", "planner", "intel"].map(componentEnabled), [true, true, true], "everything is on by default");
  assert.equal(trackerOnlyMode(), false);
  assert.equal(panelComponentsEnabled(), true);

  // Planner off: everyone, the GM included, gets the tracker bar only.
  world({ componentPlanner: false });
  assert.equal(trackerOnlyMode(), true);
  assert.equal(panelComponentsEnabled(), true, "the window still has the tracker to show");
  world({ componentPlanner: false, panelMode: "full" });
  assert.equal(trackerOnlyMode(), true, "a user's own Full planner choice can't bring a switched-off planner back");

  // Tracker off: no glyphs, turn controls, upcoming turns or tracker glyphs in the combat tracker.
  world({ componentTracker: false, combatTrackerActions: true, showTurnNavigation: true });
  assert.equal(combatTrackerActions(), false);
  const combat = { id: "c", started: true, turns: [{ id: "a" }], turn: 0, combatant: { id: "a" } };
  assert.equal(turnControlsView({ combat: { id: "c" }, combatant: { id: "a" } }, combat, { isGM: true }).visible, false);
  assert.equal(upcomingTurnsView(combat, { isGM: true }).visible, false);
  for (const part of ["tracker", "readied", "delay", "upcoming", "turn"]) {
    assert.ok(minimalHiddenParts().includes(part), `the minimal bar drops its ${part} part`);
  }
  assert.ok(!minimalHiddenParts().includes("autofill"), "the planner's parts stay");
  assert.equal(panelComponentsEnabled(), true, "the planner alone still opens the window");

  // Tracker and planner both off: the window has nothing to show.
  world({ componentTracker: false, componentPlanner: false });
  assert.equal(panelComponentsEnabled(), false);

  // Intel off: no Intel entry in the panel, and the minimal bar's Intel part can't be turned on.
  world({ componentIntel: false, minimalParts: { intel: true } });
  assert.equal(panelIntelLedgerView({ enemies: [] }).visible, false);
  assert.ok(minimalHiddenParts().includes("intel"));
  world({ minimalParts: { intel: true } });
  assert.ok(!minimalHiddenParts().includes("intel"));
} finally {
  globalThis.game = previousGame;
}

console.log("Component switch tests passed.");
