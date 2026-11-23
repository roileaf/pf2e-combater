import assert from "node:assert/strict";
import { intelIdentityKnown, isTokenMystified, unmystifyIdentifiedTokens } from "../../integrations/workbench-mystifier.js";

// Revealing a creature's Identity in Intel un-mystifies its PF2e Workbench-mystified tokens.
assert.equal(intelIdentityKnown({ identity: true }), true);
assert.equal(intelIdentityKnown({ identity: ["identity"] }), true);
assert.equal(intelIdentityKnown({ identity: false, traits: true }), false, "other facts don't name the creature");
assert.equal(intelIdentityKnown(null), false);

const goblin = { id: "goblin", prototypeToken: { name: "Goblin Warrior" } };
const ogre = { id: "ogre", prototypeToken: { name: "Ogre" } };
const token = (id, name, actor) => ({ id, name, actorId: actor.id, actor });
assert.equal(isTokenMystified(token("a", "Unknown Humanoid 12", goblin)), true);
assert.equal(isTokenMystified(token("a", "Goblin Warrior 12", goblin)), false, "a kept number postfix isn't mystification");

{
  const tokens = [token("t1", "Unknown Humanoid", goblin), token("t2", "Goblin Warrior", goblin), token("t3", "Small Humanoid", goblin), token("t4", "Unknown Giant", ogre)];
  const scene = { id: "cave", tokens };
  const calls = [];
  const api = { doMystificationFromToken: async (id, active) => { calls.push([id, active]); tokens.find((entry) => entry.id === id).name = "Goblin Warrior"; } };
  assert.equal(await unmystifyIdentifiedTokens(goblin, { api, scene, currentScene: scene }), 2);
  assert.deepEqual(calls, [["t1", true], ["t3", true]], "only this creature's mystified tokens");
  assert.equal(tokens[3].name, "Unknown Giant", "another creature stays mystified");
}
{
  // Workbench set to un-mystify all tokens of an actor: the first call names them all.
  const tokens = [token("t1", "Unknown Humanoid", goblin), token("t2", "Unknown Humanoid", goblin)];
  const scene = { id: "cave", tokens };
  let calls = 0;
  const api = { doMystificationFromToken: async () => { calls += 1; for (const entry of tokens) entry.name = "Goblin Warrior"; } };
  await unmystifyIdentifiedTokens(goblin, { api, scene, currentScene: scene });
  assert.equal(calls, 1, "an already-named token isn't toggled back");
}
{
  const scene = { id: "cave", tokens: [token("t1", "Unknown Humanoid", goblin)] };
  const api = { doMystificationFromToken: async () => { throw new Error("should not run"); } };
  assert.equal(await unmystifyIdentifiedTokens(goblin, { api, scene, currentScene: { id: "town" } }), 0, "viewed scene isn't the active one: Workbench can't reach it");
  assert.equal(await unmystifyIdentifiedTokens(goblin, { api: null, scene, currentScene: scene }), 0, "no Workbench, nothing happens");
}

console.log("Workbench mystifier tests passed.");
