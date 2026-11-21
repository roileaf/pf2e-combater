import assert from "node:assert/strict";
import {
  describeIntelChanges,
  intelChangeNotice,
  intelLedgerView,
  normalizeIntelDetails,
  readIntelDetails,
  saveIntelDecision,
} from "../../rules/intel-ledger.js";

// Roi: the intel save should say what changed, and the GM needs a free-text "Details" note about the
// creature that players can read.
const MODULE_ID = "pf2e-combater";

function dragon(flags = {}) {
  const store = { ...flags };
  return {
    id: "dragon",
    uuid: "Actor.dragon",
    name: "Blue Dragon (Adult)",
    type: "npc",
    level: 13,
    system: {
      traits: { value: ["dragon", "electricity"] },
      attributes: { weaknesses: [], resistances: [], immunities: [{ type: "electricity" }, { type: "paralyzed" }] },
    },
    flags: { [MODULE_ID]: store },
    getFlag(scope, key) { return scope === MODULE_ID ? store[key] : undefined; },
    async setFlag(scope, key, value) { store[key] = structuredClone(value); },
  };
}

// --- Details are text plus their own reveal tick ----------------------------------------------
assert.deepEqual(normalizeIntelDetails({ text: "  Lairs under the dunes.\r\nHates the sun. ", revealed: true }),
  { text: "Lairs under the dunes.\nHates the sun.", revealed: true });
assert.deepEqual(normalizeIntelDetails({ text: "   ", revealed: true }), { text: "", revealed: false }, "empty notes are never 'revealed'");
assert.equal(normalizeIntelDetails({ text: "x".repeat(5000) }).text.length, 4000, "notes are capped");
assert.deepEqual(normalizeIntelDetails(null), { text: "", revealed: false });

{
  const hidden = dragon({ intelDetails: { text: "Secretly allied with the sphinx.", revealed: false } });
  const gm = intelLedgerView({ isGM: true, intelTargets: [{ actor: hidden }] });
  assert.equal(gm.entries[0].details.text, "Secretly allied with the sphinx.", "the GM always sees the notes");
  const player = intelLedgerView({ isGM: false, intelTargets: [{ actor: hidden }] });
  assert.equal(player.visible, false, "prepared notes alone don't open the intel window for players");

  const shown = dragon({ intelDetails: { text: "Breath weapon recharges fast.", revealed: true } });
  const playerView = intelLedgerView({ isGM: false, intelTargets: [{ actor: shown }] });
  assert.equal(playerView.visible, true, "revealed notes are player-visible intel");
  assert.equal(playerView.entries[0].hasRevealed, true);
  assert.deepEqual(playerView.entries[0].details, { text: "Breath weapon recharges fast.", revealed: true });

  const playerOfHidden = intelLedgerView({ isGM: false, intelTargets: [{ actor: dragon({
    intelDetails: { text: "GM only", revealed: false },
    intelLedger: { traits: ["dragon"] },
  }) }] });
  assert.equal(playerOfHidden.entries[0].details.text, "", "players never receive unrevealed notes");
}

// --- Saving says what changed ------------------------------------------------------------------
{
  const actor = dragon({ intelLedger: { traits: ["dragon"] } });
  const changes = describeIntelChanges(actor, {
    ledger: { traits: [], weaknesses: ["__none"], immunities: true },
    details: { text: "Lairs under the dunes.", revealed: true },
  });
  assert.deepEqual(changes.map((change) => [change.kind, change.text]), [
    ["hidden", "Traits: Dragon"],
    ["revealed", "Weaknesses: None"],
    ["revealed", "Immunities: Electricity, Paralyzed"],
    ["revealed", "Details"],
  ]);
  assert.equal(intelChangeNotice(actor.name, changes),
    "Blue Dragon (Adult): revealed Weaknesses: None; Immunities: Electricity, Paralyzed; Details · hid Traits: Dragon");
  assert.equal(intelChangeNotice(actor.name, []), "Blue Dragon (Adult): intel saved, nothing changed.");
  assert.deepEqual(describeIntelChanges(actor, { details: { text: "draft", revealed: false } }).map((change) => change.text),
    ["GM notes edited"], "hidden notes say they were edited, not revealed");
}

{
  const actor = dragon();
  const notices = await saveIntelDecision([{
    actor,
    value: { weaknesses: ["__none"] },
    revealMode: "exact",
    falseInformation: [],
    details: { text: "Keeps a hoard of glass.", revealed: true },
  }]);
  assert.deepEqual(notices, ["Blue Dragon (Adult): revealed Weaknesses: None; Details"]);
  assert.deepEqual(readIntelDetails(actor), { text: "Keeps a hoard of glass.", revealed: true }, "notes are saved on the actor");
  assert.deepEqual(actor.getFlag(MODULE_ID, "intelLedger").weaknesses, ["__none"]);
}

// --- The intel window's Details row ------------------------------------------------------------
{
  globalThis.foundry ??= {};
  globalThis.foundry.applications ??= {};
  globalThis.foundry.applications.api ??= { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {} };
  const { detailsModel } = await import("../../ui/intel-window.js");
  const empty = detailsModel({}, 0, { editable: true });
  assert.equal(empty.visible, true, "the GM always gets the Details box");
  assert.equal(empty.autoReveal, true, "new notes are shown to players unless the GM unticks them");
  assert.equal(empty.inputName, "intel.0.details");
  const prepared = detailsModel({ details: { text: "Hidden plan", revealed: false } }, 1, { editable: true });
  assert.equal(prepared.autoReveal, false, "existing hidden notes stay hidden");
  assert.equal(prepared.statusLabel, "Hidden from players");
  assert.equal(detailsModel({ details: { text: "Hidden plan", revealed: false } }, 0).visible, false);
  assert.equal(detailsModel({ details: { text: "Known lore", revealed: true } }, 0).visible, true);
}

// --- Recall Knowledge request: the GM sees what the player asked ------------------------------
{
  const { requestModel } = await import("../../ui/intel-window.js");
  const { recallKnowledgeIntelRequest, openRecallKnowledgeIntelWindow } = await import("../../ui/recall-knowledge.js");
  const request = recallKnowledgeIntelRequest({
    actor: { name: "Celdar" },
    payload: { question: "protections", attempt: 2 },
    outcome: "success",
  });
  assert.deepEqual(request.categories, ["resistances", "immunities"]);
  const banner = requestModel(request);
  assert.equal(banner.title, "Celdar asked about Resistances and immunities");
  assert.equal(banner.outcomeLabel, "Success");
  assert.equal(banner.attemptLabel, "Attempt 2");
  assert.equal(requestModel({ ...request, outcome: "criticalfailure" }).hint, "Give false information in the highlighted rows.");
  assert.equal(requestModel(null), null);
  assert.equal(recallKnowledgeIntelRequest({ payload: { question: "nope" } }), null);

  const previousGame = globalThis.game;
  globalThis.game = { user: { isGM: true } };
  let opened = null;
  await openRecallKnowledgeIntelWindow(dragon(), { request, openWindow: async (view) => { opened = view; } });
  globalThis.game = previousGame;
  assert.equal(opened.request, request, "the window gets the request");
  assert.deepEqual(opened.entries[0].requestedCategories, ["resistances", "immunities"], "the asked categories are marked");
}

console.log("Intel details tests passed.");
