import assert from "node:assert/strict";
import { readIntelLedger, readIntelRevealMode, writeIntelFlags } from "../../rules/intel-ledger.js";
import { recordObservedIntel } from "../../rules/observed-intel.js";

// Roi, live: Intel learned about one Goblin Warrior didn't show for the other Goblin Warriors.
// Unlinked tokens each have their own copy of the actor, and Intel was saved on that copy. It now
// lives on the base actor, so every token of the same actor shares it.
const flagged = (flags = {}) => ({
  flags: { "pf2e-combater": { ...flags } },
  getFlag(scope, key) { return this.flags[scope]?.[key]; },
  async setFlag(scope, key, value) { this.flags[scope] = { ...this.flags[scope], [key]: value }; },
  async unsetFlag(scope, key) { delete this.flags[scope][key]; },
});
const base = { id: "goblin", type: "npc", ...flagged() };
// A token's actor reads the base actor's flags unless its own delta overrides them.
const tokenActor = (own = {}) => {
  const delta = { _source: { flags: { "pf2e-combater": { ...own } } } };
  const actor = {
    id: "goblin", type: "npc", isToken: true, token: { baseActor: base, delta },
    get flags() { return { "pf2e-combater": { ...base.flags["pf2e-combater"], ...delta._source.flags["pf2e-combater"] } }; },
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    async setFlag(scope, key, value) { delta._source.flags[scope][key] = value; },
    async unsetFlag(scope, key) { delete delta._source.flags[scope][key]; },
  };
  return { actor, delta };
};

const first = tokenActor();
const second = tokenActor();
await writeIntelFlags(first.actor, { ledger: { saves: ["fortitude"] }, revealMode: "band" });
assert.deepEqual(readIntelLedger(second.actor).saves, ["fortitude"], "Intel saved from one token shows on the other");
assert.equal(readIntelRevealMode(second.actor), "band", "and so does how it's revealed");
assert.deepEqual(first.delta._source.flags["pf2e-combater"], {}, "nothing is left on the token itself");

// A token that learned something before Intel was shared keeps it, and the next save shares it.
const veteran = tokenActor({ intelLedger: { traits: ["goblin"] } });
assert.deepEqual(readIntelLedger(veteran.actor).traits, ["goblin"], "a token's older Intel still reads");
assert.deepEqual(readIntelLedger(veteran.actor).saves, ["fortitude"], "alongside the shared Intel");
await writeIntelFlags(veteran.actor, { ledger: readIntelLedger(veteran.actor) });
assert.equal(veteran.delta._source.flags["pf2e-combater"].intelLedger, undefined, "saving moves it to the base actor");
assert.deepEqual(readIntelLedger(second.actor).traits, ["goblin"], "where every token reads it");

// Watching one token Strike teaches the party about all of them.
assert.equal(await recordObservedIntel(second.actor, "strikes", "dogslicer"), true);
assert.deepEqual(readIntelLedger(first.actor).strikes, ["dogslicer"]);
assert.deepEqual(readIntelLedger(first.actor).saves, ["fortitude"], "without losing what was known");

// A linked actor (a PC, a unique NPC) is its own base actor, as before.
const linked = { id: "boss", type: "npc", ...flagged() };
await writeIntelFlags(linked, { ledger: { saves: ["will"] } });
assert.deepEqual(readIntelLedger(linked).saves, ["will"]);
console.log("Intel per actor tests passed.");
