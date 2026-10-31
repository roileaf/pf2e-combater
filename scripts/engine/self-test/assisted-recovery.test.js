import assert from "node:assert/strict";
import { fighterContext } from "../fixtures.js";
import { buildCandidates } from "../candidates.js";
import { buildTurnPlans } from "../planner.js";
import { executeDraftStep } from "../action/executor.js";
import { setSocket } from "../../socket.js";

// Kimerus: helping an ally put out persistent fire. Aid can't (a flat check isn't a skill check);
// PF2e's assisted recovery gives the ally an extra flat check, DC 10 for especially fitting help.
const ally = { id: "ally-1", name: "Sirena Valcrest", distance: 5, hpPercent: 100, token: { id: "ally-1" } };
const context = { ...fighterContext, battlefield: { ...fighterContext.battlefield, allies: [ally] } };
const { candidates } = buildCandidates(context);
const recovery = candidates.find((action) => action.slug === "assisted-recovery");
assert.ok(recovery, "Assisted Recovery is offered");
assert.equal(recovery.actionCost, 2);
assert.equal(recovery.suggestedTarget?.id, "ally-1", "it targets an ally");
assert.equal(recovery.uuid, "Compendium.pf2e.conditionitems.Item.lDVqvLKA6eF3Df60", "its details open PF2e's Persistent Damage");
const plans = buildTurnPlans(context, [...candidates.filter((action) => action.slug !== "assisted-recovery"), { ...recovery, score: 999 }]);
assert.equal(plans.some((plan) => plan.steps.some((step) => step.slug === "assisted-recovery")), false, "Auto-fill never plans it on its own");

const saved = Object.fromEntries(["game", "canvas", "ChatMessage", "Roll"].map((key) => [key, globalThis[key]]));
try {
  const deleted = [];
  const condition = (id, formula, damageType, isOwner = true, dc = 15) => ({
    id, uuid: `Actor.sirena.Item.${id}`, slug: "persistent-damage", name: "Persistent Damage", isOwner,
    system: { persistent: { formula, damageType, dc } },
    delete: async () => { deleted.push(id); },
  });
  const allyActor = { id: "sirena", name: "Sirena Valcrest", type: "character", itemTypes: { condition: [] } };
  const token = { id: "ally-1", name: "Sirena Valcrest", document: { id: "ally-1", name: "Sirena Valcrest" }, actor: allyActor, setTarget() {} };
  const messages = [];
  let die = 12;
  globalThis.game = { user: { id: "player", isGM: false, targets: new Set() } };
  globalThis.canvas = { tokens: { placeables: [token], get: (id) => (id === token.id ? token : null), setTargets() {} } };
  globalThis.ChatMessage = { getSpeaker: () => ({ alias: "Sirena Valcrest" }), create: async () => ({ id: "card" }) };
  globalThis.Roll = class { constructor(formula) { this.formula = formula; } async evaluate() { this.total = die; return this; } async toMessage(data) { messages.push(data); return { id: "flat-check" }; } };
  const step = { instanceId: "recovery", targetTokenIds: ["ally-1"], targetSelection: "manual", action: recovery };
  const run = (choices = {}) => executeDraftStep({ context, step, action: recovery, choices });

  let result = await run();
  assert.equal(result.status, "failed", "an ally without persistent damage has nothing to recover from");
  assert.match(result.error, /no persistent damage/);

  allyActor.itemTypes.condition = [condition("fire", "1d6", "fire"), condition("bleed", "2", "bleed", true, 17)];
  result = await run();
  assert.equal(result.status, "needs-choice");
  assert.deepEqual(result.choices, ["recovery-dc"]);
  assert.deepEqual(result.recovery.damages, [{ id: "fire", label: "1d6 fire", dc: 15 }, { id: "bleed", label: "2 bleed", dc: 17 }],
    "the helper picks which persistent damage, each with its own recovery DC");

  result = await run({ persistentId: "fire", dc: 10 });
  assert.equal(result.status, "done");
  assert.equal(messages[0].flavor.includes("Flat check DC 10 to end persistent 1d6 fire"), true);
  assert.deepEqual(deleted, ["fire"], "a 12 beats DC 10: the fire goes out");
  assert.deepEqual(result.patch.execution.revert?.ops?.[0], { kind: "chat", messageId: "flat-check" });

  result = await run({ persistentId: "fire", dc: 15 });
  assert.equal(result.status, "done");
  assert.match(result.patch.execution.result, /continues/, "a 12 misses DC 15");
  assert.deepEqual(deleted, ["fire"]);

  // A player who doesn't own the ally has the GM end it.
  allyActor.itemTypes.condition = [condition("fire", "1d6", "fire", false)];
  const asked = [];
  setSocket({ executeAsGM: async (name, args) => { asked.push({ name, args }); return true; } });
  result = await run({ dc: 15, persistentId: "fire" });
  assert.equal(result.status, "done");
  assert.match(result.patch.execution.result, /continues/);
  die = 18;
  result = await run({ dc: 15, persistentId: "fire" });
  assert.deepEqual(asked, [{ name: "endPersistentDamage", args: { conditionUuid: "Actor.sirena.Item.fire" } }]);
  assert.match(result.patch.execution.result, /ends/);
} finally {
  setSocket(null);
  Object.assign(globalThis, saved);
}

// The GM's side: only a persistent damage condition can be ended through the socket.
{
  const { endPersistentDamageRequest } = await import("../../ui/assisted-recovery.js");
  const savedUuid = globalThis.fromUuid;
  const gone = [];
  try {
    globalThis.fromUuid = async (uuid) => ({ slug: uuid.endsWith("fire") ? "persistent-damage" : "prone", delete: async () => { gone.push(uuid); } });
    assert.equal(await endPersistentDamageRequest({ conditionUuid: "Actor.a.Item.fire" }), true);
    assert.equal(await endPersistentDamageRequest({ conditionUuid: "Actor.a.Item.prone" }), false, "nothing else can be deleted this way");
    assert.deepEqual(gone, ["Actor.a.Item.fire"]);
  } finally {
    globalThis.fromUuid = savedUuid;
  }
}
// The helper picks the damage (how they help is said at the table); the DC is that damage's own, and the GM only
// rules whether the help counts and whether it's especially fitting (DC 10).
{
  const { chooseRecovery, promptRecoveryDc } = await import("../../ui/assisted-recovery.js");
  const { fittingRecoveryDc } = await import("../execution/assisted-recovery.js");
  assert.deepEqual([fittingRecoveryDc(15), fittingRecoveryDc(17), fittingRecoveryDc(8)], [10, 10, 8], "fitting help lowers the DC to 10, never raises it");
  const keep = Object.fromEntries(["game", "foundry", "ui"].map((key) => [key, globalThis[key]]));
  try {
    const prompts = [];
    const asked = [];
    let gmAnswer = { dc: 10 };
    let helpAnswer = { persistentId: "fire", fitting: false };
    const waits = [];
    globalThis.game = { user: { isGM: false }, users: { activeGM: { id: "gm" } } };
    globalThis.ui = { notifications: { info() {}, warn() {} } };
    globalThis.foundry = { utils: { escapeHTML: String }, applications: { api: { DialogV2: {
      prompt: async (options) => { prompts.push(options.content); return helpAnswer; },
      wait: async (options) => { waits.push(options); return options.buttons.find((button) => button.action === "fitting")?.callback(); },
    } } } };
    setSocket({ executeAsGM: async (name, args) => { asked.push({ name, args }); return gmAnswer; } });
    const pending = { allyName: "Sirena", damages: [{ id: "fire", label: "1d6 fire", dc: 15 }, { id: "bleed", label: "2 bleed", dc: 17 }], persistentId: null };

    assert.deepEqual(await chooseRecovery({ actorName: "Edran", recovery: pending }), { persistentId: "fire", dc: 10 }, "the GM's ruling is used");
    assert.match(prompts[0], /name="persistent"/, "with several, the helper picks which persistent damage");
    assert.match(prompts[0], /2 bleed \(DC 17\)/, "each shows its own DC");
    assert.doesNotMatch(prompts[0], /name="how"/, "no free-text field: the player says it out loud");
    assert.doesNotMatch(prompts[0], /name="dc"|name="fitting"/, "the player rules on nothing");
    assert.deepEqual(asked[0], { name: "promptRecoveryDc", args: { actorName: "Edran", allyName: "Sirena", damage: "1d6 fire", dc: 15 } });
    gmAnswer = { cancelled: true };
    assert.equal(await chooseRecovery({ actorName: "Edran", recovery: pending }), null, "help the GM doesn't allow isn't rolled");
    gmAnswer = null;
    helpAnswer = { persistentId: "bleed", fitting: false };
    assert.deepEqual(await chooseRecovery({ actorName: "Edran", recovery: pending }), { persistentId: "bleed", dc: 17 }, "without a GM, the damage's own DC");

    globalThis.game.user.isGM = true;
    helpAnswer = { persistentId: "bleed", fitting: true };
    assert.deepEqual(await chooseRecovery({ actorName: "Edran", recovery: pending }), { persistentId: "bleed", dc: 10 }, "a GM helping marks especially fitting help");
    assert.match(prompts.at(-1), /name="fitting"/);
    helpAnswer = { persistentId: "bleed", fitting: false };
    assert.deepEqual(await chooseRecovery({ actorName: "Edran", recovery: pending }), { persistentId: "bleed", dc: 17 });
    assert.equal(asked.length, 3, "a GM isn't asked over the socket");

    // The GM's prompt: the damage's own DC, the fitting DC 10, or not allowed.
    assert.deepEqual(await promptRecoveryDc({ actorName: "Edran", allyName: "Sirena", damage: "1d6 fire", dc: 15 }), { dc: 10 });
    assert.deepEqual(waits.at(-1).buttons.map((button) => button.label), ["Counts (DC 15)", "Fitting help (DC 10)", "Not allowed"]);
    await promptRecoveryDc({ dc: 8 });
    assert.deepEqual(waits.at(-1).buttons.map((button) => button.action), ["ok", "cancel"], "no fitting button when the DC is already 10 or lower");
  } finally {
    setSocket(null);
    Object.assign(globalThis, keep);
  }
}
console.log("Assisted recovery tests passed.");
