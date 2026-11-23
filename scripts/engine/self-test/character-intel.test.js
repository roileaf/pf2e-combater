import assert from "node:assert/strict";
import {
  INTEL_CHARACTER_LEDGERS_FLAG,
  INTEL_LEDGER_FLAG,
  PARTY_INTEL_AUDIENCE,
  falseInformationKnownBy,
  intelLedgerView,
  readCharacterIntelLedgers,
  readKnownIntelLedger,
  saveIntelDecision,
  subtractIntelLedger,
  viewerIntelKnowerIds,
} from "../../rules/intel-ledger.js";
import { openRecallKnowledgeIntelWindow } from "../../ui/recall-knowledge.js";
import { intelAudienceIds, knowledgeGridModel, nextIntelAudience } from "../../ui/intel-window.js";
import { minimalHiddenParts } from "../../settings.js";

// Intel per character: a Recall Knowledge success is the roller's to know (the GM can share it with
// the party), a critical failure's falsehood is believed by the roller alone, and the planner only
// uses what the acting character knows.
const MODULE_ID = "pf2e-combater";

function creature(flags = {}) {
  const store = { ...flags };
  return {
    id: "skeleton", uuid: "Actor.skeleton", name: "Skeleton Guard", type: "npc", flags: {},
    system: { attributes: { weaknesses: [{ type: "vitality", value: 5 }, { type: "bludgeoning", value: 3 }], resistances: [], immunities: [] }, traits: { value: ["undead"] } },
    itemTypes: {},
    getFlag: (scope, key) => (scope === MODULE_ID ? store[key] ?? null : null),
    setFlag: async (scope, key, value) => { if (scope === MODULE_ID) store[key] = value; },
    store,
  };
}

// --- Party knowledge plus each character's own -----------------------------------------------------
{
  const skeleton = creature({
    [INTEL_LEDGER_FLAG]: { weaknesses: ["vitality-5"] },
    [INTEL_CHARACTER_LEDGERS_FLAG]: {
      ezren: { name: "Ezren", ledger: { weaknesses: ["bludgeoning-3"] } },
      kyra: { name: "Kyra", ledger: { traits: ["undead"] } },
    },
  });
  assert.deepEqual(readKnownIntelLedger(skeleton, ["ezren"]).weaknesses, ["vitality-5", "bludgeoning-3"], "Ezren knows the party's fact and his own");
  assert.deepEqual(readKnownIntelLedger(skeleton, ["kyra"]).weaknesses, ["vitality-5"], "Kyra doesn't know what Ezren learned");
  assert.deepEqual(readKnownIntelLedger(skeleton, ["kyra"]).traits, ["undead"]);
  assert.deepEqual(readKnownIntelLedger(skeleton, []).weaknesses, ["vitality-5"], "nobody in particular: the party's only");
  assert.deepEqual(readKnownIntelLedger(skeleton, null).weaknesses, ["vitality-5", "bludgeoning-3"], "the GM: everything anyone learned");
  assert.deepEqual(Object.keys(readCharacterIntelLedgers(skeleton)), ["ezren", "kyra"]);
}

assert.deepEqual(subtractIntelLedger({ weaknesses: ["a", "b"], traits: true }, { weaknesses: ["a"] }).weaknesses, ["b"]);
assert.equal(subtractIntelLedger({ weaknesses: ["a"] }, { weaknesses: true }).weaknesses, false, "the party already knows the whole category");

// --- False information: the party's for everyone, a character's for that character -----------------
assert.equal(falseInformationKnownBy({ knownBy: [] }, ["kyra"]), true);
assert.equal(falseInformationKnownBy({ knownBy: ["ezren"] }, ["kyra"]), false);
assert.equal(falseInformationKnownBy({ knownBy: ["ezren"] }, ["ezren"]), true);
assert.equal(falseInformationKnownBy({ knownBy: ["ezren"] }, null), true, "the GM sees every falsehood");

// --- Saving for a character files only what the party doesn't already know -------------------------
{
  const skeleton = creature({ [INTEL_LEDGER_FLAG]: { weaknesses: ["vitality-5"] } });
  const [notice] = await saveIntelDecision([{
    actor: skeleton,
    audience: "ezren",
    audienceName: "Ezren",
    revealMode: "exact",
    falseInformation: [],
    value: { weaknesses: ["vitality-5", "bludgeoning-3"] },
  }]);
  assert.deepEqual(skeleton.store[INTEL_LEDGER_FLAG], { weaknesses: ["vitality-5"] }, "the party's intel is untouched");
  assert.deepEqual(skeleton.store[INTEL_CHARACTER_LEDGERS_FLAG].ezren.ledger.weaknesses, ["bludgeoning-3"], "Ezren holds only his new fact");
  assert.equal(skeleton.store[INTEL_CHARACTER_LEDGERS_FLAG].ezren.name, "Ezren");
  assert.match(notice, /Ezren/);
  assert.match(notice, /Bludgeoning 3/);
  assert.doesNotMatch(notice, /Vitality/, "a fact the party already knew isn't news");

  await saveIntelDecision([{ actor: skeleton, audience: PARTY_INTEL_AUDIENCE, revealMode: "exact", falseInformation: [], value: { weaknesses: ["vitality-5"], traits: ["undead"] } }]);
  assert.deepEqual(skeleton.store[INTEL_LEDGER_FLAG].traits, ["undead"], "the party audience writes the party's intel");
  assert.deepEqual(skeleton.store[INTEL_CHARACTER_LEDGERS_FLAG].ezren.ledger.weaknesses, ["bludgeoning-3"], "and leaves Ezren's alone");
}

// --- What each player sees ------------------------------------------------------------------------------
{
  const previousGame = globalThis.game;
  const ezren = { id: "ezren", type: "character", name: "Ezren", testUserPermission: (user) => user.id === "p1" };
  const kyra = { id: "kyra", type: "character", name: "Kyra", testUserPermission: (user) => user.id === "p2" };
  const skeleton = creature({
    [INTEL_LEDGER_FLAG]: { weaknesses: ["vitality-5"] },
    [INTEL_CHARACTER_LEDGERS_FLAG]: { ezren: { name: "Ezren", ledger: { weaknesses: ["bludgeoning-3"] } } },
    intelFalseInformation: [
      { id: "lie", category: "resistances", factId: "fire", factLabel: "Fire", value: 10, revealed: true, knownBy: ["ezren"] },
    ],
  });
  try {
    for (const [userId, sees, believes] of [["p1", ["Vitality 5", "Bludgeoning 3"], true], ["p2", ["Vitality 5"], false]]) {
      const user = { id: userId, isGM: false, character: null };
      globalThis.game = { user, actors: { contents: [ezren, kyra], get: (id) => [ezren, kyra].find((a) => a.id === id) }, i18n: { localize: (key) => key } };
      assert.deepEqual(viewerIntelKnowerIds(user), [userId === "p1" ? "ezren" : "kyra"]);
      const view = intelLedgerView({ isGM: false, intelTargets: [{ actor: skeleton, name: "Skeleton Guard" }] });
      const entry = view.entries[0];
      assert.deepEqual(entry.revealed.weaknesses, sees, `${userId} sees the party's facts${userId === "p1" ? " and Ezren's" : " only"}`);
      assert.equal(entry.revealed.resistances.some((label) => /Fire/.test(label)), believes, "only Ezren's player sees Ezren's falsehood");
    }

    globalThis.game = { user: { id: "gm", isGM: true }, actors: { contents: [ezren, kyra], get: (id) => [ezren, kyra].find((a) => a.id === id) }, i18n: { localize: (key) => key } };
    const gmView = intelLedgerView({ isGM: true, intelAudience: "ezren", intelTargets: [{ actor: skeleton, name: "Skeleton Guard" }] });
    assert.equal(gmView.entries[0].audience, "ezren");
    assert.deepEqual(gmView.entries[0].values.weaknesses, ["vitality-5", "bludgeoning-3"], "the GM editing Ezren sees what Ezren knows");
    assert.deepEqual(gmView.entries[0].partyValues.weaknesses, ["vitality-5"], "and which of it the whole party knows (locked)");
    const partyView = intelLedgerView({ isGM: true, intelTargets: [{ actor: skeleton, name: "Skeleton Guard" }] });
    assert.deepEqual(partyView.entries[0].values.weaknesses, ["vitality-5"], "the party audience edits the party's intel");

    // A Recall Knowledge result opens on the roller, and a critical failure's falsehood is theirs alone.
    let opened = null;
    await openRecallKnowledgeIntelWindow(skeleton, {
      request: { actorId: "kyra", actorName: "Kyra", question: "weaknesses", questionLabel: "Weaknesses", categories: ["weaknesses"], outcome: "criticalfailure", attempt: 1 },
      preselectIdentity: false,
      falseInformationContext: { actorId: "kyra", actorUuid: "Actor.kyra", actorName: "Kyra", category: "weaknesses", question: "weaknesses", attempt: 1 },
      openWindow: async (view) => { opened = view; },
    });
    assert.equal(opened.intelAudience, "kyra", "the GM's window starts on the roller");
    assert.ok(opened.audienceOptions.some((option) => option.id === PARTY_INTEL_AUDIENCE), "and can switch to the whole party");
    assert.ok(opened.audienceOptions.some((option) => option.id === "kyra"));
    const planted = opened.entries[0].falseInformation.at(-1);
    assert.deepEqual(planted.knownBy, ["kyra"], "only Kyra believes the falsehood");
  } finally {
    globalThis.game = previousGame;
  }
}

// --- The GM picks any characters at once (cards), or the whole party ------------------------------------
assert.deepEqual(nextIntelAudience(["party"], "ezren"), ["ezren"], "a character replaces the whole party");
assert.deepEqual(nextIntelAudience(["ezren"], "kyra"), ["ezren", "kyra"], "and more characters join");
assert.deepEqual(nextIntelAudience(["ezren", "kyra"], "ezren"), ["kyra"], "clicking a selected one takes it out");
assert.deepEqual(nextIntelAudience(["kyra"], "kyra"), ["party"], "with nobody left, the whole party");
assert.deepEqual(nextIntelAudience(["ezren", "kyra"], "party"), ["party"], "the party card stands alone");
assert.deepEqual(intelAudienceIds({ intelAudience: "ezren" }), ["ezren"]);
assert.deepEqual(intelAudienceIds({ intelAudiences: ["ezren", "party"] }), ["party"]);
assert.deepEqual(intelAudienceIds({}), ["party"]);

// --- Saving for several characters applies what changed to each of them -----------------------------
{
  const skeleton = creature({
    [INTEL_LEDGER_FLAG]: { traits: ["undead"] },
    [INTEL_CHARACTER_LEDGERS_FLAG]: {
      ezren: { name: "Ezren", ledger: { weaknesses: ["vitality-5"] } },
      kyra: { name: "Kyra", ledger: { weaknesses: true } },
    },
  });
  const [notice] = await saveIntelDecision([{
    actor: skeleton,
    audiences: ["ezren", "kyra", "merisiel"],
    audienceNames: { ezren: "Ezren", kyra: "Kyra", merisiel: "Merisiel" },
    revealMode: "exact",
    falseInformation: [],
    added: { weaknesses: ["bludgeoning-3"] },
    removed: { weaknesses: ["vitality-5"] },
  }]);
  const ledgers = skeleton.store[INTEL_CHARACTER_LEDGERS_FLAG];
  assert.deepEqual(ledgers.ezren.ledger.weaknesses, ["bludgeoning-3"], "Ezren gains the new fact and loses the unticked one");
  assert.deepEqual(ledgers.kyra.ledger.weaknesses, ["bludgeoning-3"], "Kyra's whole-category knowledge becomes the facts left");
  assert.deepEqual(ledgers.merisiel.ledger.weaknesses, ["bludgeoning-3"], "Merisiel, who knew nothing, gains the new fact");
  assert.equal(ledgers.merisiel.name, "Merisiel");
  assert.deepEqual(skeleton.store[INTEL_LEDGER_FLAG], { traits: ["undead"] }, "the party's intel is untouched");
  assert.match(notice, /Ezren, Kyra, Merisiel learned Weaknesses: Bludgeoning 3/);
  assert.match(notice, /no longer know Weaknesses: Vitality 5/);
}

// --- Who knows what: characters across, every known fact down -------------------------------------------
{
  const facts = (ids) => ids.map((id) => ({ id, label: id, exactLabel: id }));
  const entry = {
    availableFacts: { traits: facts(["undead", "skeleton", "mindless"]), weaknesses: facts(["vitality-5"]) },
    partyValues: { traits: ["undead"] },
    characterLedgers: { ezren: { name: "Ezren", ledger: { traits: ["skeleton"], weaknesses: true } } },
    falseInformation: [
      { category: "weaknesses", label: "Fire 10", revealed: true, knownBy: ["kyra"] },
      { category: "weaknesses", label: "Cold 5", revealed: false, knownBy: [] },
    ],
  };
  const categories = [{ id: "traits", label: "Traits" }, { id: "weaknesses", label: "Weaknesses" }];
  const grid = knowledgeGridModel(entry, categories, [
    { id: "party", label: "Whole party", isParty: true },
    { id: "ezren", label: "Ezren" },
    { id: "kyra", label: "Kyra" },
  ]);
  assert.deepEqual(grid.columns.map((column) => column.id), ["ezren", "kyra"], "one column per character, not the party");
  const rows = Object.fromEntries(grid.groups.flatMap((group) => group.rows).map((row) => [row.label, row.cells.map((cell) => cell.kind)]));
  assert.deepEqual(rows.undead, ["party", "party"], "a party fact is everyone's");
  assert.deepEqual(rows.skeleton, ["own", ""], "Ezren's own fact");
  assert.deepEqual(rows["vitality-5"], ["own", ""], "a whole category Ezren knows");
  assert.deepEqual(rows["Fire 10"], ["", "false"], "Kyra's false belief");
  assert.equal(rows.mindless, undefined, "facts nobody knows are left out");
  assert.equal(rows["Cold 5"], undefined, "a prepared, unrevealed falsehood isn't anyone's belief yet");
  assert.equal(knowledgeGridModel(entry, categories, [{ id: "party", isParty: true }]).columns.length, 1, "characters holding intel still get a column");
}

// --- Minimal bar: the Intel shortcut is opt-in ------------------------------------------------------------
{
  const previousGame = globalThis.game;
  try {
    globalThis.game = { settings: { get: () => ({}) } };
    assert.ok(minimalHiddenParts().includes("intel"), "off until the user turns it on");
    assert.ok(!minimalHiddenParts().includes("browse"), "other parts stay on by default");
    globalThis.game = { settings: { get: () => ({ intel: true }) } };
    assert.ok(!minimalHiddenParts().includes("intel"), "shown once turned on");
  } finally {
    globalThis.game = previousGame;
  }
}

console.log("Character intel tests passed.");
