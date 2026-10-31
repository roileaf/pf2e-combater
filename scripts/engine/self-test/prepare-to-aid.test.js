import assert from "node:assert/strict";
import { fighterContext } from "../fixtures.js";
import { buildCandidates } from "../candidates.js";
import { buildTurnPlans } from "../planner.js";
import { executeDraftStep } from "../action/executor.js";
import {
  aidBonus, aidCheckOptions, aidedCheckOptions, aidEffectSource, defaultAidedCheck, rollAid,
} from "../execution/prepare-to-aid.js";

// Kimerus: Aid is a reaction, so Strike, Strike, Aid couldn't be planned. Preparing to Aid is the
// action spent on your turn; it is now a generic action the player can add to a plan.
const ally = { id: "ally-1", name: "Sirena Valcrest", distance: 5, hpPercent: 100, token: { id: "ally-1" } };
const context = { ...fighterContext, battlefield: { ...fighterContext.battlefield, allies: [ally] } };
const { candidates, rejected } = buildCandidates(context);
const prepare = candidates.find((action) => action.slug === "prepare-to-aid");
assert.ok(prepare, `Prepare to Aid is offered: ${rejected.find((entry) => entry.action?.slug === "prepare-to-aid")?.reason ?? "not detected"}`);
assert.equal(prepare.actionCost, 1);
const { actionArt } = await import("../../ui/action-art.js");
assert.equal(actionArt("prepare-to-aid", "systems/pf2e/icons/actions/OneAction.webp"), "systems/pf2e/icons/spells/efficient-apport.webp", "it shows the Aid art, not the cost glyph");
assert.equal(prepare.suggestedTarget?.id, "ally-1", "it targets an ally");

const plans = buildTurnPlans(context, [...candidates.filter((action) => action.slug !== "prepare-to-aid"), { ...prepare, score: 999 }]);
assert.equal(plans.some((plan) => plan.steps.some((step) => step.slug === "prepare-to-aid")), false, "Auto-fill never plans it on its own");

const saved = Object.fromEntries(["game", "canvas", "ChatMessage", "ui"].map((key) => [key, globalThis[key]]));
try {
  const warnings = [];
  globalThis.ui = { notifications: { warn: (message) => warnings.push(message), info() {} } };
  const token = { id: "ally-1", name: "Sirena Valcrest", document: { id: "ally-1", name: "Sirena Valcrest" }, actor: { id: "sirena", uuid: "Actor.sirena", name: "Sirena Valcrest", type: "character" }, setTarget() {} };
  const posted = [];
  globalThis.game = { user: { id: "player", isGM: false, targets: new Set() } };
  globalThis.canvas = { tokens: { placeables: [token], get: (id) => (id === token.id ? token : null), setTargets() {} } };
  globalThis.ChatMessage = { getSpeaker: () => ({ alias: "Edran Voss" }), create: async (data) => { posted.push(data); return { id: "aid-card" }; } };
  const step = { instanceId: "aid", targetTokenIds: ["ally-1"], targetSelection: "recommended", action: prepare };
  const result = await executeDraftStep({ context, step, action: prepare });
  assert.equal(result.status, "done");
  assert.match(posted.at(-1)?.content ?? "", /Ready to Aid Sirena Valcrest/, "chat says who is ready to help whom");
  assert.equal(posted.at(-1)?.whisper, undefined, "the table sees it, so the ally knows to call for the Aid");
  assert.match(warnings[0] ?? "", /No GM is connected/, "without the turn controls to hold it, the player is told to roll Aid by hand");
  assert.doesNotMatch(posted.at(-1).content, /<button/, "the chat card never carries a button: chat scrolls away");
  assert.deepEqual(result.patch.execution.revert?.ops?.[0], { kind: "chat", messageId: "aid-card" }, "undo removes the card");

  // In an encounter the Aid waits in the turn controls instead, where chat can't scroll it away.
  const { setSocket } = await import("../../socket.js");
  const requests = [];
  setSocket({ executeAsUser: async (name, _gm, request) => { requests.push({ name, request }); return true; } });
  try {
    globalThis.game.users = { activeGM: { id: "gm" } };
    const combat = { id: "combat-1", started: true, round: 2, combatant: { id: "edran" } };
    globalThis.game.combats = { get: (id) => (id === combat.id ? combat : null) };
    const inCombat = { ...context, combat, combatant: combat.combatant };
    const stored = await executeDraftStep({ context: inCombat, step: { ...step, instanceId: "aid-2" }, action: prepare });
    assert.equal(requests[0].request.action, "prepare-aid");
    assert.deepEqual([requests[0].request.readiedId, requests[0].request.allyUuid, requests[0].request.allyName], ["edran", "Actor.sirena", "Sirena Valcrest"]);
    assert.equal(warnings.length, 1, "no warning when the turn controls hold the Aid");
    const ops = stored.patch.execution.revert.ops;
    assert.deepEqual(ops.find((op) => op.kind === "prepared-aid"), { kind: "prepared-aid", combatId: "combat-1", combatantId: "edran" });
    const { revertDraftStep } = await import("../action/revert.js");
    await revertDraftStep({ context: inCombat, step: { ...step, instanceId: "aid-2", execution: stored.patch.execution } });
    assert.deepEqual(
      [requests.at(-1).request.action, requests.at(-1).request.readiedId, requests.at(-1).request.used],
      ["ready-clear", "edran", false],
      "undo takes the prepared Aid away without spending the reaction",
    );
  } finally {
    setSocket(null);
  }
} finally {
  Object.assign(globalThis, saved);
}
// Rolling Aid: the chosen check against DC 15. Skills come best-first, then Strikes for helping an attack.
{
  const rolls = [];
  const statistic = (label, mod, rank, degreeOfSuccess) => ({
    label, mod, rank, roll: async (args) => { rolls.push({ ...args, statistic: label }); return { total: 20, degreeOfSuccess }; },
  });
  const strike = { type: "strike", slug: "longsword", label: "Longsword", totalModifier: 11, ready: true, item: { category: "martial" } };
  const actor = {
    skills: { athletics: statistic("Athletics", 7, 3, 3), medicine: statistic("Medicine", 9, 2, 2) },
    perception: statistic("Perception", 8, 2, 0),
    system: { actions: [strike], proficiencies: { attacks: { martial: { rank: 4 } } } },
  };
  const options = aidCheckOptions(actor);
  assert.deepEqual(options.map((option) => option.slug), ["medicine", "perception", "athletics", "strike:longsword"]);
  assert.equal(options.at(-1).rank, 4, "an attack Aid uses the weapon proficiency rank");
  assert.deepEqual(options.filter((option) => option.gmRuling).map((option) => option.slug), ["perception"], "Perception isn't a skill: it's the GM's call");

  const athletics = await rollAid({ actor, check: "athletics" });
  assert.equal(rolls[0].statistic, "Athletics");
  assert.equal(rolls[0].label, "Aid");
  assert.equal(rolls[0].dc.value, 15);
  assert.ok(rolls[0].extraRollOptions.includes("action:aid"));
  assert.equal(athletics.bonus, 3, "a master's critical success gives +3");
  assert.equal((await rollAid({ actor, check: "medicine" })).bonus, 1);
  assert.equal((await rollAid({ actor, check: "perception" })).bonus, -1, "a critical failure gives −1");
  assert.equal(await rollAid({ actor, check: "arcana" }), null, "an unknown check rolls nothing");

  const savedGame = globalThis.game;
  try {
    const checks = [];
    globalThis.game = { pf2e: {
      CheckModifier: function CheckModifier(slug, base) { this.slug = slug; this.base = base; },
      Check: { roll: async (check, context) => { checks.push({ check, context }); return { degreeOfSuccess: 3 }; } },
    } };
    const attack = await rollAid({ actor, check: "strike:longsword", dc: 20 });
    assert.equal(checks[0].check.base, strike, "the Strike's own modifiers are rolled");
    assert.equal(checks[0].context.type, "attack-roll");
    assert.equal(checks[0].context.dc.value, 20, "against the Aid DC, not the ally's AC");
    assert.ok(checks[0].context.options.has("action:aid"));
    assert.equal(attack.bonus, 4, "a legendary critical success gives +4");
  } finally {
    globalThis.game = savedGame;
  }

  assert.deepEqual([3, 2, 1, 0].map((degree) => aidBonus(degree, 1)), [2, 1, 0, -1]);
  const effect = { _id: "AHMUpMbaVkZ5A1KX", name: "Effect: Aid", system: { rules: [{ key: "ChoiceSet", flag: "aidBonus", choices: [] }, { key: "FlatModifier" }] } };
  const source = aidEffectSource(effect, 2, "Actor.edran");
  assert.equal(source._id, undefined);
  assert.equal(source.system.rules[0].selection, 2, "the bonus is preselected, so the ally isn't asked");
  assert.equal(source.flags.system.rulesSelections.aidBonus, 2);
  assert.equal(source.system.context.origin.actor, "Actor.edran");
  assert.equal(effect.system.rules[0].selection, undefined, "the compendium effect is left alone");

  // Only the aided check gets the bonus, not any attack roll or skill check.
  const aidedOptions = aidedCheckOptions({ skills: { thievery: { label: "Thievery" }, athletics: { label: "Athletics" } } });
  assert.deepEqual(aidedOptions.map((option) => option.slug), ["attack-roll", "athletics", "thievery", "perception"]);
  assert.equal(aidedOptions.at(-1).gmRuling, true, "helping a Perception check is the GM's call");
  assert.equal(defaultAidedCheck("perception", aidedOptions), "perception");
  assert.equal(defaultAidedCheck("athletics", aidedOptions), "athletics", "a skill helps the same skill");
  assert.equal(defaultAidedCheck("strike:longsword", aidedOptions), "attack-roll", "a Strike helps an attack");
  const narrowed = aidEffectSource(effect, 1, null, { slug: "athletics", label: "Athletics" });
  assert.deepEqual(narrowed.system.rules[1].selector, ["athletics"]);
  assert.equal(narrowed.name, "Effect: Aid: Athletics");
  assert.equal(effect.system.rules[1].selector, undefined);
}
// The player picks the check; the GM sets the DC over the socket and can refuse the help.
{
  const { performAid } = await import("../../ui/aid.js");
  const { setSocket } = await import("../../socket.js");
  const saved = Object.fromEntries(["game", "foundry", "ui"].map((key) => [key, globalThis[key]]));
  try {
    const rolls = [];
    const asked = [];
    let gmAnswer = { dc: 18 };
    const actor = { name: "Silva", skills: { athletics: { label: "Athletics", mod: 7, rank: 1, roll: async (args) => { rolls.push(args); return { degreeOfSuccess: 2 }; } } } };
    const prompts = [];
    globalThis.game = { user: { isGM: false }, users: { activeGM: { id: "gm" } } };
    globalThis.ui = { notifications: { info() {}, warn() {} } };
    globalThis.foundry = { utils: { escapeHTML: String }, applications: { api: { DialogV2: {
      prompt: async (options) => { prompts.push(options.content); return { check: "athletics", aided: "athletics", dc: 15 }; },
    } } } };
    setSocket({ executeAsGM: async (name, args) => { asked.push({ name, args }); return gmAnswer; } });

    const ally = { name: "Sirena", uuid: "Actor.sirena", isOwner: true, skills: { athletics: { label: "Athletics" } } };
    assert.equal(await performAid({ actor, ally }), true);
    assert.doesNotMatch(prompts[0], /name="dc"/, "the player isn't offered the DC");
    assert.match(prompts[0], /name="aided"/, "the player says which check they help with");
    assert.deepEqual(asked[0], { name: "promptAidDc", args: { actorName: "Silva", allyName: "Sirena", checkLabel: "Athletics", aidedLabel: "Athletics" } });
    assert.equal(rolls[0].dc.value, 18, "the roll uses the GM's DC");

    gmAnswer = { cancelled: true };
    assert.equal(await performAid({ actor }), false, "a refused Aid isn't rolled");
    assert.equal(rolls.length, 1);

    globalThis.game.user.isGM = true;
    assert.equal(await performAid({ actor }), true);
    assert.match(prompts.at(-1), /name="dc"/, "a GM aiding sets the DC in the same dialog");
    assert.equal(asked.length, 2, "a GM isn't asked over the socket");
  } finally {
    setSocket(null);
    Object.assign(globalThis, saved);
  }
}
console.log("Prepare to Aid tests passed.");
