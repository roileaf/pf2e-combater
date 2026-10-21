import assert from "node:assert/strict";
import { classifySystemAction } from "../action/classifier.js";
import { prepareAreaExecution } from "../execution/area.js";
import { clearRechargeForMessage, rechargeStatus, recordRechargeUse } from "../npc-recharge-state.js";

// Live (Kimerus): a Magnetic Skink's Launch Metal, "all creatures in a @Template[emanation|distance:10]",
// with a recharge of 1d4 rounds.
const description = "<p>The gecko repulses the metal attached to its body in all directions, dealing @Damage[2d6[bludgeoning]|options:area-damage] damage (@Check[reflex|dc:17|basic|options:area-effect] save) to all creatures in a @Template[emanation|distance:10]. The gecko can't use Launch Metal again for [[/gmr 1d4 #Recharge Launch Metal]]{1d4 rounds}.</p>";
const launchMetal = classifySystemAction({
  name: "Launch Metal",
  system: { actionType: { value: "action" }, actions: { value: 2 }, description: { value: description } },
}, { actionCost: 2 });

// The Magnetic Skink's own text (video): no @Template, "all creatures adjacent to the skink". It was
// read as one enemy within 5 feet, so Run targeted a single creature. It is a 5-foot self emanation.
const skinkText = (tail) => `<p>The skink repulses the metal attached to its body in all directions, dealing @Damage[2d6[bludgeoning]|options:area-damage] damage (@Check[reflex|dc:13|basic|options:area-effect] save) to ${tail}. The skink can't use Launch Metal again for [[/gmr 1d4 #Recharge Launch Metal]]{1d4 rounds}.</p>`;
const classifySkink = (tail) => classifySystemAction({
  name: "Launch Metal",
  system: { actionType: { value: "action" }, actions: { value: 2 }, description: { value: skinkText(tail) } },
}, { actionCost: 2 });
assert.deepEqual(
  (({ area, type, distance, selfCentered }) => ({ area, type, distance, selfCentered }))(classifySkink("all creatures adjacent to the skink").targetingProfile),
  { area: true, type: "emanation", distance: 5, selfCentered: true },
  "\"all creatures adjacent to the skink\" hits everyone around it",
);
assert.equal(classifySkink("each creature adjacent to it").targetingProfile.selfCentered, true);
assert.notEqual(classifySkink("all creatures adjacent to the target").targetingProfile?.selfCentered, true,
  "adjacent to the target is centered on someone else");

const previous = { canvas: globalThis.canvas, game: globalThis.game, Roll: globalThis.Roll, ChatMessage: globalThis.ChatMessage };
try {
  // 1. Run, it targets every creature the placed emanation covers, by Foundry's own region test.
  // The far PC sits 2 squares diagonally: outside Combater's center-distance circle, inside the region
  // Foundry drew (the world's diagonal rule), so the old geometry dropped it.
  const region = { id: "launch-metal-region", inside: new Set(["skink", "near-pc", "far-pc"]) };
  const targeted = new Set();
  const token = (id, x, y) => ({
    id, name: id, center: { x, y }, w: 100, h: 100, document: { id, width: 1, height: 1, testInsideRegion: (tested) => tested === region && region.inside.has(id) },
    setTarget(selected) { if (selected) targeted.add(id); },
  });
  const skink = token("skink", 150, 150);
  const placeables = [skink, token("near-pc", 250, 150), token("far-pc", 350, 350), token("distant-pc", 750, 150)];
  globalThis.canvas = {
    grid: { size: 100, distance: 5 },
    tokens: { placeables, get: (id) => placeables.find((entry) => entry.id === id), setTargets: () => targeted.clear() },
    scene: {
      id: "scene", grid: { size: 100, distance: 5 },
      createEmbeddedDocuments: async () => [{ id: region.id }],
      regions: { get: (id) => (id === region.id ? region : undefined) },
    },
  };
  globalThis.game = { ...previous.game, scenes: { get: () => globalThis.canvas.scene } };
  const context = { token: { id: "skink", center: skink.center, width: 1, height: 1 }, actor: { type: "npc" } };
  const prepared = await prepareAreaExecution({ context, action: launchMetal, step: { instanceId: "launch-metal" } });
  assert.equal(prepared.status, "ready");
  assert.ok(prepared.patch.targetTokenIds.includes("near-pc") && prepared.patch.targetTokenIds.includes("far-pc"),
    "both creatures inside the drawn emanation are targeted");
  assert.ok(!prepared.patch.targetTokenIds.includes("distant-pc"));
  assert.ok(targeted.has("far-pc"), "the far creature is actually targeted on the canvas");

  // 2. Undoing the step deletes its card, and that takes the recharge back.
  const flags = {};
  const actor = {
    type: "npc", flags,
    async setFlag(scope, key, value) {
      const path = [scope, ...key.split(".")];
      let node = flags;
      for (const part of path.slice(0, -1)) node = node[part] ??= {};
      node[path.at(-1)] = value;
    },
    async update(changes) {
      for (const key of Object.keys(changes)) {
        const [, scope, group, removed] = key.match(/^flags\.([^.]+)\.([^.]+)\.-=(.+)$/) ?? [];
        if (removed) delete flags[scope]?.[group]?.[removed];
      }
    },
  };
  const item = { id: "launch-metal", name: "Launch Metal", system: { description: { value: description } } };
  const combat = { id: "combat", round: 2 };
  const deleted = [];
  globalThis.Roll = class { constructor() {} async evaluate() { return { total: 3 }; } };
  globalThis.ChatMessage = { create: async () => ({ id: "recharge-note" }), getWhisperRecipients: () => [], getSpeaker: () => ({}) };
  globalThis.game = { ...globalThis.game, messages: { get: (id) => ({ id, delete: async () => deleted.push(id) }) } };
  await recordRechargeUse(actor, item, combat, { messageId: "launch-metal-card" });
  assert.equal(rechargeStatus(actor, item, combat)?.roundsLeft, 3, "using Launch Metal starts its recharge");
  assert.equal(await clearRechargeForMessage(actor, "some-other-card"), false, "an unrelated card leaves it recharging");
  assert.equal(rechargeStatus(actor, item, combat)?.roundsLeft, 3);
  assert.equal(await clearRechargeForMessage(actor, "launch-metal-card"), true);
  assert.equal(rechargeStatus(actor, item, combat), null, "deleting the card that used it makes Launch Metal ready again");
  assert.deepEqual(deleted, ["recharge-note"], "its GM recharge note goes too");
} finally {
  globalThis.canvas = previous.canvas;
  globalThis.game = previous.game;
  globalThis.Roll = previous.Roll;
  globalThis.ChatMessage = previous.ChatMessage;
}
console.log("Launch Metal area and recharge tests passed.");
