import assert from "node:assert/strict";
import { fighterContext } from "../fixtures.js";
import { buildCandidates } from "../candidates.js";
import { buildTurnPlans } from "../planner.js";
import { executeDraftStep } from "../action/executor.js";

// Kimerus: Aid is a reaction, so Strike, Strike, Aid couldn't be planned. Preparing to Aid is the
// action spent on your turn; it is now a generic action the player can add to a plan.
const ally = { id: "ally-1", name: "Sirena Valcrest", distance: 5, hpPercent: 100, token: { id: "ally-1" } };
const context = { ...fighterContext, battlefield: { ...fighterContext.battlefield, allies: [ally] } };
const { candidates, rejected } = buildCandidates(context);
const prepare = candidates.find((action) => action.slug === "prepare-to-aid");
assert.ok(prepare, `Prepare to Aid is offered: ${rejected.find((entry) => entry.action?.slug === "prepare-to-aid")?.reason ?? "not detected"}`);
assert.equal(prepare.actionCost, 1);
assert.equal(prepare.suggestedTarget?.id, "ally-1", "it targets an ally");

const plans = buildTurnPlans(context, [...candidates.filter((action) => action.slug !== "prepare-to-aid"), { ...prepare, score: 999 }]);
assert.equal(plans.some((plan) => plan.steps.some((step) => step.slug === "prepare-to-aid")), false, "Auto-fill never plans it on its own");

const saved = Object.fromEntries(["game", "canvas", "ChatMessage"].map((key) => [key, globalThis[key]]));
try {
  const token = { id: "ally-1", name: "Sirena Valcrest", document: { id: "ally-1", name: "Sirena Valcrest" }, actor: { id: "sirena", name: "Sirena Valcrest", type: "character" }, setTarget() {} };
  const posted = [];
  globalThis.game = { user: { id: "player", isGM: false, targets: new Set() } };
  globalThis.canvas = { tokens: { placeables: [token], get: (id) => (id === token.id ? token : null), setTargets() {} } };
  globalThis.ChatMessage = { getSpeaker: () => ({ alias: "Edran Voss" }), create: async (data) => { posted.push(data); return { id: "aid-card" }; } };
  const step = { instanceId: "aid", targetTokenIds: ["ally-1"], targetSelection: "recommended", action: prepare };
  const result = await executeDraftStep({ context, step, action: prepare });
  assert.equal(result.status, "done");
  assert.match(posted.at(-1)?.content ?? "", /Ready to Aid Sirena Valcrest/, "chat says who is ready to help whom");
  assert.equal(posted.at(-1)?.whisper, undefined, "the table sees it, so the ally knows to call for the Aid");
  assert.deepEqual(result.patch.execution.revert?.ops?.[0], { kind: "chat", messageId: "aid-card" }, "undo removes the card");
} finally {
  Object.assign(globalThis, saved);
}
console.log("Prepare to Aid tests passed.");
