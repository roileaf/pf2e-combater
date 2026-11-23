import assert from "node:assert/strict";
import { believedFalseFacts, canUseIntelCategory, canUseIntelFact, withBelievedDefenses } from "../../rules/intel-ledger.js";
import { canUseTargetSave, damageAdjustment, targetTraitSlugs } from "../scoring/facts.js";
import { falseIntelSteersPlans } from "../../settings.js";

// Juan / Roi: false information the GM reveals reads as true to the player, so the player's planner
// must follow it too. Believing a skeleton is weak to fire makes fire attractive, even though it isn't.
const lie = (category, factId, value = null, extra = {}) => ({ id: `${category}-${factId}`, category, factId, value, revealed: true, ...extra });
// A player's view of an NPC, as a combat context builds it: no actor document, only what is known.
const skeleton = (falseInformation, known = {}) => ({
  id: "sk", name: "Skeleton Guard", type: "npc", actor: { type: "npc" },
  intelLedger: known.ledger ?? {},
  intelFalseInformation: falseInformation,
  weaknesses: withBelievedDefenses({ intelFalseInformation: falseInformation }, "weaknesses", known.weaknesses ?? []),
  resistances: withBelievedDefenses({ intelFalseInformation: falseInformation }, "resistances", known.resistances ?? []),
  immunities: [],
  traits: known.traits ?? [],
  saves: known.saves ?? {},
});
const player = { isGM: false };
const fireball = { name: "Fireball", damageProfile: { type: "fire", average: 21 }, averageDamage: 21 };

// --- A believed weakness counts like a known one ---------------------------------------------------
{
  const believing = skeleton([lie("weaknesses", "fire", 5)]);
  assert.equal(canUseIntelCategory(player, believing, "weaknesses"), true, "the character 'knows' a weakness");
  const adjusted = damageAdjustment(player, fireball, believing);
  const plain = damageAdjustment(player, fireball, skeleton([]));
  assert.ok((adjusted?.scoreDelta ?? 0) > (plain?.scoreDelta ?? 0), "fire scores higher against a creature believed weak to fire");
}

// --- A believed resistance replaces the real, known one of the same type ---------------------------
{
  const real = [{ type: "fire", value: 5 }];
  const merged = withBelievedDefenses({ intelFalseInformation: [lie("resistances", "fire", 15)] }, "resistances", real);
  assert.deepEqual(merged.map((entry) => entry.value), [15], "the false value is the one believed");
  const other = withBelievedDefenses({ intelFalseInformation: [lie("resistances", "cold", 10)] }, "resistances", real);
  assert.deepEqual(other.map((entry) => `${entry.type} ${entry.value}`), ["fire 5", "cold 10"], "a different type is added beside it");
}

// --- A believed save DC and trait are usable --------------------------------------------------------
{
  const believing = skeleton([lie("saves", "reflex", 12), lie("traits", "undead")]);
  assert.equal(canUseTargetSave(player, believing, "reflex"), true);
  assert.equal(canUseTargetSave(player, believing, "will"), false, "only the save they were told about");
  assert.equal(canUseIntelFact(player, believing, "traits", "undead"), true);
  assert.ok(targetTraitSlugs(player, { ...believing, traits: ["undead"] }).has("undead"), "the believed trait passes the planner's trait filter");
}

// --- Only revealed false facts, and only the list the context gave this character ------------------
assert.equal(believedFalseFacts({ intelFalseInformation: [{ ...lie("weaknesses", "fire", 5), revealed: false }] }).length, 0, "a prepared, hidden falsehood isn't believed yet");
assert.equal(canUseIntelCategory(player, skeleton([]), "weaknesses"), false, "no belief, no knowledge");

// --- World setting: the GM can keep falsehoods out of player plans ----------------------------------
{
  const previousGame = globalThis.game;
  try {
    globalThis.game = { settings: { get: () => undefined } };
    assert.equal(falseIntelSteersPlans(), true, "on by default");
    globalThis.game = { settings: { get: () => false } };
    assert.equal(falseIntelSteersPlans(), false, "off: plans use real facts only");
  } finally {
    globalThis.game = previousGame;
  }
}

console.log("False intel planning tests passed.");
