import assert from "node:assert/strict";
import {
  nextRecallKnowledgeAttempts,
  recallKnowledgeAttemptExpired,
  recallKnowledgeAttemptState,
  recallKnowledgeTargetKey,
} from "../../rules/recall-knowledge.js";
import { intelRevealRecipients, recallKnowledgeAutoDecision, recallKnowledgeAutoOutcome } from "../../ui/recall-knowledge.js";
import { unavailableActionRows } from "../../ui/browser-view.js";
import { journalEntryMatches, journalSearchFields, journalTraitFilters } from "../../ui/intel-window.js";

// --- A failed Recall Knowledge check is forgotten after enough in-game time ------------------------
const HOUR = 3600;
assert.equal(recallKnowledgeAttemptExpired({ blocked: true, time: 0 }, { now: 24 * HOUR, hours: 24 }), true);
assert.equal(recallKnowledgeAttemptExpired({ blocked: true, time: 0 }, { now: 24 * HOUR - 1, hours: 24 }), false, "not yet");
assert.equal(recallKnowledgeAttemptExpired({ blocked: true, time: 0 }, { now: 99 * HOUR, hours: 0 }), false, "0 hours: never");
assert.equal(recallKnowledgeAttemptExpired({ blocked: true }, { now: 99 * HOUR, hours: 1 }), false, "no recorded time: manual reset only");
assert.equal(recallKnowledgeAttemptExpired({ blocked: false, time: 0 }, { now: 99 * HOUR, hours: 1 }), false, "successes keep their raised DC");

{
  const ogre = { uuid: "Actor.ogre", id: "ogre" };
  const key = recallKnowledgeTargetKey(ogre);
  const previousGame = globalThis.game;
  let hours = 8;
  globalThis.game = { time: { worldTime: 1000 }, settings: { get: (_scope, name) => (name === "recallKnowledgeForgetHours" ? hours : undefined) } };
  try {
    const failed = nextRecallKnowledgeAttempts({}, ogre, { outcome: "failure", skill: "nature" });
    assert.equal(failed[key].time, 1000, "the attempt is stamped with world time");
    const actor = { flags: { "pf2e-combater": { recallKnowledgeAttempts: failed } } };
    assert.equal(recallKnowledgeAttemptState(actor, ogre).blocked, true, "still blocked the same day");

    globalThis.game.time.worldTime = 1000 + 8 * HOUR;
    const fresh = recallKnowledgeAttemptState(actor, ogre);
    assert.deepEqual([fresh.blocked, fresh.attempts], [false, 0], "eight hours later the character starts over");
    const again = nextRecallKnowledgeAttempts(failed, ogre, { outcome: "success" });
    assert.deepEqual([again[key].attempts, again[key].blocked], [1, false], "and the next attempt counts as the first");

    hours = 0;
    assert.equal(recallKnowledgeAttemptState(actor, ogre).blocked, true, "setting off: blocked until the GM resets it");
  } finally {
    globalThis.game = previousGame;
  }
}

// --- Players are told when a GM save teaches them something ----------------------------------------
{
  const troll = { id: "troll", name: "Forest Troll" };
  const ezren = { id: "ezren", name: "Ezren", ownership: { u1: 3 } };
  const kyra = { id: "kyra", name: "Kyra", ownership: { u2: 3 } };
  const actors = { get: (id) => ({ ezren, kyra })[id] };
  const users = [{ id: "gm", isGM: true }, { id: "u1" }, { id: "u2" }, { id: "u3", active: false }];
  const revealed = () => [{ kind: "revealed", category: "weaknesses", text: "Weaknesses: Fire 10" }];
  const nothing = () => [{ kind: "hidden", category: "traits", text: "Traits: Giant" }];

  assert.deepEqual(
    intelRevealRecipients([{ actor: troll, audience: "party", value: { weaknesses: true } }], { users, actors, describe: revealed }),
    [{ userId: "u1", character: null }, { userId: "u2", character: null }], "a party reveal reaches every connected player, never the GM");
  assert.deepEqual(
    intelRevealRecipients([{ actor: troll, audience: "party", value: {} }], { users, actors, describe: nothing }),
    [], "hiding a fact tells nobody");
  assert.deepEqual(
    intelRevealRecipients([{ actor: troll, audiences: ["ezren"], audienceNames: { ezren: "Ezren" }, added: { weaknesses: ["fire-10"] }, removed: {} }], { users, actors, describe: nothing }),
    [{ userId: "u1", character: "Ezren" }], "a single character's reveal reaches only that character's owner");
  assert.deepEqual(
    intelRevealRecipients([{ actor: troll, audiences: ["ezren", "kyra"], added: {}, removed: { traits: ["giant"] } }], { users, actors, describe: revealed }),
    [], "nothing added for the characters");
}

// --- Resolving a roll without the GM ----------------------------------------------------------------
{
  const matrix = { skills: ["nature"], standardDc: 20, broadLoreDc: 18, specificLoreDc: 15 };
  const rows = [
    { slug: "nature", kind: "standard", total: 22 },
    { slug: "arcana", kind: "standard", total: 35 },
    { slug: "troll-lore", kind: "lore", total: 16 },
  ];
  assert.equal(recallKnowledgeAutoOutcome(rows, matrix, 10, "off"), null, "off: the GM decides");
  assert.equal(recallKnowledgeAutoOutcome(rows, matrix, 10, "standard"), "success", "Nature 22 vs DC 20; Arcana isn't a listed skill");
  assert.equal(recallKnowledgeAutoOutcome([rows[2]], matrix, 10, "standard"), null, "only a Lore rolled: standard mode asks the GM");
  assert.equal(recallKnowledgeAutoOutcome([rows[2]], matrix, 10, "broad"), "failure", "Lore 16 vs the broad DC 18, never the specific DC 15");
  assert.equal(recallKnowledgeAutoOutcome([{ slug: "arcana", kind: "standard", total: 35 }], matrix, 10, "broad"), null, "no allowed check applies");

  const troll = { id: "troll", name: "Forest Troll" };
  const view = {
    entries: [{
      actor: troll,
      revealMode: "exact",
      falseInformation: [{ id: "f1" }],
      values: { identity: false, weaknesses: ["fire-10"], traits: true },
      revealedFacts: { identity: [], weaknesses: [{ id: "fire-10" }] },
      availableFacts: { identity: [{ id: "identity" }], weaknesses: [{ id: "fire-10" }, { id: "acid-10" }] },
    }],
  };
  const request = { actorId: "ezren", actorName: "Ezren", categories: ["weaknesses"] };
  const [own] = recallKnowledgeAutoDecision(troll, request, { view });
  assert.deepEqual([own.audiences, own.added, own.removed], [["ezren"], { identity: ["identity"], weaknesses: ["acid-10"] }, {}],
    "the roller learns the question's categories and the identity, minus what they knew");
  assert.deepEqual(own.falseInformation, [{ id: "f1" }], "existing false information is carried, not wiped");
  const [party] = recallKnowledgeAutoDecision(troll, request, { view, audience: "party" });
  assert.deepEqual(party.value, { identity: ["identity"], weaknesses: ["fire-10", "acid-10"], traits: true }, "a party reveal adds to the party's ledger");
  const [none] = recallKnowledgeAutoDecision(troll, { ...request, categories: ["immunities"] }, { view });
  assert.deepEqual(none.added.immunities, ["__none"], "a category the creature has nothing in is learned as None");
  const allKnown = { entries: [{ ...view.entries[0], revealedFacts: { identity: [{ id: "identity" }], weaknesses: [{ id: "fire-10" }, { id: "acid-10" }] } }] };
  assert.equal(recallKnowledgeAutoDecision(troll, request, { view: allKnown }), null, "nothing new: no save");
}

// --- Browser: actions the planner ruled out ----------------------------------------------------------
{
  const rejected = [
    { action: { name: "Ray of Frost", costLabel: "2" }, reason: "No target in range." },
    { action: { name: "Ray of Frost", costLabel: "2" }, reason: "No target in range." },
    { action: { name: "Stand" }, reason: "Duplicate detected action replaced by preferred source." },
    { action: { name: "Battle Medicine" }, reason: "No badly injured healing target is in reach." },
    { action: { name: "" }, reason: "x" },
  ];
  assert.deepEqual(unavailableActionRows(rejected).map((row) => row.name), ["Battle Medicine", "Ray of Frost"], "each once, bookkeeping rejections left out, by name");
  assert.deepEqual(unavailableActionRows(rejected, { query: "ray" }).map((row) => [row.name, row.reason, row.costLabel]), [["Ray of Frost", "No target in range.", "2"]]);
}

// --- Known creatures journal: search what's revealed, filter by trait --------------------------------
{
  const troll = { name: "Forest Troll", revealed: { traits: ["Giant", "Troll"], actions: ["Rend"], strikes: ["Claw (reach 10 ft)"] } };
  const ghoul = { name: "Unknown creature", revealed: { traits: ["Undead"], passives: ["Paralysis"] } };
  const fields = journalSearchFields(troll);
  assert.equal(journalEntryMatches(fields, { query: "rend" }), true, "an ability's name finds its creature");
  assert.equal(journalEntryMatches(fields, { query: "CLAW" }), true, "so does a Strike");
  assert.equal(journalEntryMatches(fields, { query: "paralysis" }), false);
  assert.equal(journalEntryMatches(fields, { traits: new Set(["giant", "troll"]) }), true);
  assert.equal(journalEntryMatches(fields, { traits: new Set(["giant", "undead"]) }), false, "every picked trait must match");
  assert.equal(journalEntryMatches(journalSearchFields(ghoul), { query: "ghoul" }), false, "an unidentified creature isn't found by its real name");
  assert.deepEqual(journalTraitFilters([troll, ghoul, { name: "Ogre", revealed: { traits: ["Giant"] } }]).map((trait) => [trait.id, trait.count]),
    [["giant", 2], ["troll", 1], ["undead", 1]], "most common first");
}

console.log("Recall Knowledge option tests passed.");
