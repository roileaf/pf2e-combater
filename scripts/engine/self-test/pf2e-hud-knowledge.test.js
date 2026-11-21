import assert from "node:assert/strict";
import {
  KNOWLEDGE_TARGET_FLAG,
  adjudicateExploitVulnerability,
  afterThaumVulnPicker,
  exploitVulnerabilityDetailsReveal,
  exploitVulnerabilityLedgerUpdate,
  exploitVulnerabilityOutcomeContent,
  exploitVulnerabilityOutcomeRows,
  exploitVulnerabilitySuggestedOutcome,
  handlePf2eHudRecallKnowledge,
  isExploitVulnerabilityCheckMessage,
  knowledgeTargetFromTargets,
  registerPf2eHudKnowledgeHooks,
  showKnowledgeReveal,
  stampKnowledgeTarget,
  standardDcForLevel,
} from "../../integrations/pf2e-hud-knowledge.js";
import { isRecallKnowledgeMatrixMessage } from "../execution/recall-knowledge.js";

// Roi: PF2e HUD's Recall Knowledge and Exploit Vulnerability should feed Combater's intel the same
// way Combater's own Recall Knowledge does.
const MODULE_ID = "pf2e-combater";

const npc = (overrides = {}) => ({
  uuid: "Scene.s.Token.t.Actor.ogre",
  id: "ogre",
  name: "Ogre Warrior",
  type: "npc",
  level: 3,
  flags: {},
  system: {
    attributes: {
      weaknesses: [{ type: "cold-iron", value: 3 }, { type: "fire", value: 5 }],
      resistances: [],
      immunities: [],
    },
  },
  ...overrides,
});
const pc = { uuid: "Actor.thaum", id: "thaum", name: "Thaum", type: "character", flags: {} };
const targetToken = (actor) => ({ actor, document: { uuid: "Scene.s.Token.t", name: "Ogre" } });

function messageWith(flags, extra = {}) {
  const message = {
    id: "msg1",
    author: { id: "player1" },
    speaker: { actor: pc.id },
    actor: pc,
    flags: structuredClone(flags),
    rolls: [],
    updateSource(changes) {
      for (const [path, value] of Object.entries(changes)) {
        const parts = path.split(".");
        let cursor = this;
        for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
        cursor[parts.at(-1)] = value;
      }
    },
    ...extra,
  };
  return message;
}

const hudRk = () => messageWith({ "pf2e-hud": { action: "recall-knowledge" } }, {
  rolls: [{ total: 14, dice: [{ total: 14, results: [{ result: 14 }] }] }],
});
const evCheck = (total = 20, die = 12) => messageWith({
  pf2e: { context: { type: "skill-check", options: ["target:action:slug:exploit-vulnerability", "skill:esoteric-lore"] } },
}, { rolls: [{ total, dice: [{ total: die, results: [{ result: die }] }] }] });

// --- Detection --------------------------------------------------------------------------------
assert.equal(isRecallKnowledgeMatrixMessage(hudRk()), true, "the GM resolver accepts PF2e HUD's Recall Knowledge card");
assert.equal(isExploitVulnerabilityCheckMessage(evCheck()), true, "the action card's inline Esoteric Lore check is Exploit Vulnerability");
assert.equal(isExploitVulnerabilityCheckMessage(messageWith({
  pf2e: { context: { type: "skill-check", options: ["skill:esoteric-lore"] }, origin: { rollOptions: ["origin:item:slug:exploit-vulnerability"] } },
})), true, "a check whose origin is the Exploit Vulnerability item counts too");
assert.equal(isExploitVulnerabilityCheckMessage(messageWith({
  pf2e: { context: { type: "skill-check", options: ["action:recall-knowledge"] } },
})), false, "other checks are ignored");

// --- Target stamp (roller's client) ----------------------------------------------------------
assert.equal(knowledgeTargetFromTargets(new Set([targetToken(npc()), targetToken(npc())])), null, "two targets: no target, like PF2e HUD");
assert.equal(knowledgeTargetFromTargets(new Set([targetToken(pc)])), null, "a PC target is not an intel target");
{
  const message = hudRk();
  assert.equal(stampKnowledgeTarget(message, { targets: new Set([targetToken(npc())]) }), true);
  assert.deepEqual(message.flags[MODULE_ID][KNOWLEDGE_TARGET_FLAG], {
    actorUuid: "Scene.s.Token.t.Actor.ogre",
    tokenUuid: "Scene.s.Token.t",
    name: "Ogre",
  }, "the targeted NPC rides on the message");
  const plain = messageWith({ pf2e: { context: { type: "skill-check", options: [] } } });
  assert.equal(stampKnowledgeTarget(plain, { targets: new Set([targetToken(npc())]) }), false, "unrelated messages stay untouched");
  assert.equal(plain.flags[MODULE_ID], undefined);
}

// --- Recall Knowledge: the roller asks a question, the GM adjudicates --------------------------
{
  const target = npc();
  const message = hudRk();
  stampKnowledgeTarget(message, { targets: new Set([targetToken(target)]) });
  const sent = [];
  const result = await handlePf2eHudRecallKnowledge(message, {
    userId: "player1",
    isGM: false,
    hasActiveGM: true,
    fromUuid: async (uuid) => (uuid === target.uuid ? target : null),
    promptQuestion: async ({ attempt }) => {
      assert.equal(attempt, 1, "first attempt against this creature");
      return { id: "weaknesses" };
    },
    requestGm: async (payload) => {
      sent.push(payload);
      return { completed: true, revealed: 0 };
    },
    resolveLocally: async () => assert.fail("a player asks the GM over the socket"),
  });
  assert.equal(result.completed, true);
  assert.deepEqual(sent, [{
    actorUuid: "Actor.thaum",
    actorName: "Thaum",
    targetActorUuid: "Scene.s.Token.t.Actor.ogre",
    targetName: "Ogre",
    question: "weaknesses",
    messageId: "msg1",
  }], "the same payload Combater's own Recall Knowledge sends to the GM");

  const otherClient = await handlePf2eHudRecallKnowledge(message, {
    userId: "player2",
    promptQuestion: async () => assert.fail("only the roller is asked"),
  });
  assert.equal(otherClient, null, "other clients ignore the roll");

  const blockedActor = { ...pc, flags: { [MODULE_ID]: { recallKnowledgeAttempts: {
    "target:Scene%2Es%2EToken%2Et%2EActor%2Eogre": { attempts: 1, blocked: true, lastOutcome: "failure" },
  } } } };
  const blocked = await handlePf2eHudRecallKnowledge({ ...message, actor: blockedActor }, {
    userId: "player1",
    isGM: false,
    hasActiveGM: true,
    fromUuid: async () => target,
    promptQuestion: async () => assert.fail("a blocked attempt is not adjudicated"),
  });
  assert.equal(blocked.reason, "blocked", "a failed Recall Knowledge still blocks further attempts");

  const unstamped = await handlePf2eHudRecallKnowledge(hudRk(), { userId: "player1" });
  assert.equal(unstamped, null, "a roll without a target (PF2e HUD's untargeted card) is left alone");
}

// --- Exploit Vulnerability: outcome → intel ----------------------------------------------------
assert.equal(standardDcForLevel(3), 18);
assert.equal(standardDcForLevel(-1), 13);
assert.equal(standardDcForLevel(30), 50);
assert.equal(exploitVulnerabilitySuggestedOutcome(evCheck(20, 12), 18), "success");
assert.equal(exploitVulnerabilitySuggestedOutcome(evCheck(28, 12), 18), "criticalsuccess");
assert.equal(exploitVulnerabilitySuggestedOutcome(evCheck(17, 20), 18), "success", "a natural 20 raises the degree");
assert.equal(exploitVulnerabilitySuggestedOutcome(messageWith({ pf2e: { context: { outcome: "failure" } } }), 18), "failure",
  "a check rolled with a DC keeps its own degree");

{
  const target = npc();
  assert.deepEqual(exploitVulnerabilityLedgerUpdate({}, "success", target), { weaknesses: ["fire-5"] },
    "success reveals the highest weakness only");
  assert.deepEqual(exploitVulnerabilityLedgerUpdate({}, "criticalsuccess", target),
    { weaknesses: true, resistances: true, immunities: true }, "critical success reveals every weakness, resistance and immunity");
  assert.equal(exploitVulnerabilityLedgerUpdate({}, "failure", target), null, "failure reveals nothing");
  assert.equal(exploitVulnerabilityLedgerUpdate({ weaknesses: ["fire-5"] }, "success", target), null, "already known: nothing new");
  assert.deepEqual(exploitVulnerabilityLedgerUpdate({}, "success", npc({ system: { attributes: { weaknesses: [] } } })),
    { weaknesses: ["__none"] }, "no weaknesses is learned as 'none'");
}

{
  const target = npc();
  const message = evCheck(20, 12);
  stampKnowledgeTarget(message, { targets: new Set([targetToken(target)]) });
  const saved = [];
  let prompted = null;
  const result = await adjudicateExploitVulnerability(message, {
    isActiveGM: true,
    fromUuid: async () => target,
    promptOutcome: async (details) => {
      prompted = details;
      assert.equal(details.die, 12, "the natural d20 is shown");
      return { id: details.suggested };
    },
    saveUpdate: async (actor, update) => saved.push({ actor, update }),
  });
  assert.equal(prompted.dc, 18, "the GM rules against the standard DC for the creature's level");
  assert.equal(prompted.suggested, "success");
  assert.equal(result.completed, true);
  assert.deepEqual(saved, [{ actor: target, update: { weaknesses: ["fire-5"] } }], "the highest weakness is written to the ledger");

  const playerSide = await adjudicateExploitVulnerability(message, {
    isActiveGM: false,
    promptOutcome: async () => assert.fail("only the active GM rules"),
  });
  assert.equal(playerSide, null);

  const knownTarget = npc({ flags: { [MODULE_ID]: { intelLedger: { weaknesses: true, resistances: true, immunities: true } } } });
  const quiet = await adjudicateExploitVulnerability(message, {
    isActiveGM: true,
    fromUuid: async () => knownTarget,
    promptOutcome: async () => assert.fail("nothing to reveal: the GM isn't interrupted"),
  });
  assert.deepEqual(quiet, { completed: true, revealed: 0 });
}

// --- The save notice names what Exploit Vulnerability revealed --------------------------------
{
  const store = {};
  const target = npc({
    getFlag: (scope, key) => (scope === MODULE_ID ? store[key] : undefined),
    setFlag: async (scope, key, value) => { store[key] = value; },
  });
  const message = evCheck(20, 12);
  stampKnowledgeTarget(message, { targets: new Set([targetToken(target)]) });
  const result = await adjudicateExploitVulnerability(message, {
    isActiveGM: true,
    fromUuid: async () => target,
    promptOutcome: async () => ({ id: "success" }),
  });
  assert.equal(result.notice, "Ogre Warrior: revealed Weaknesses: Fire 5", "the notice says what was learned");
  assert.deepEqual(store.intelLedger.weaknesses, ["fire-5"]);
}

// --- PF2e Exploit Vulnerability already settled the degree: no second dialog ------------------
{
  const target = npc();
  const thaumCheck = messageWith({
    pf2e: { context: {
      type: "skill-check",
      options: ["action:exploit-vulnerability"],
      dc: { slug: "exploit-vulnerability", value: 17 },
      outcome: "criticalSuccess",
      target: { actor: target.uuid, token: "Scene.s.Token.t" },
    } },
  }, { rolls: [{ total: 27, dice: [{ total: 15, results: [{ result: 15 }] }] }] });
  const saved = [];
  const result = await adjudicateExploitVulnerability(thaumCheck, {
    isActiveGM: true,
    thaumVuln: true,
    fromUuid: async (uuid) => (uuid === target.uuid ? target : null),
    promptOutcome: async () => assert.fail("the module's own picker is the only dialog"),
    saveUpdate: async (actor, update) => { saved.push(update); return "notice"; },
  });
  assert.equal(result.outcome, "criticalsuccess", "the module's degree of success is used as is");
  assert.deepEqual(saved, [{ weaknesses: true, resistances: true, immunities: true }]);

  let promptedDc = null;
  await adjudicateExploitVulnerability(thaumCheck, {
    isActiveGM: true,
    thaumVuln: false,
    fromUuid: async () => target,
    promptOutcome: async (details) => { promptedDc = details.dc; return null; },
  });
  assert.equal(promptedDc, 17, "without the module active Combater still asks, using the check's own DC");
}

// --- A success also reveals the GM's Details notes, and the roller is told -------------------
{
  const notes = { text: "Nests in the old well.", revealed: false };
  const target = npc({ flags: { [MODULE_ID]: { intelDetails: notes, intelLedger: { weaknesses: ["fire-5"] } } } });
  assert.deepEqual(exploitVulnerabilityDetailsReveal(target, "success"), { text: "Nests in the old well.", revealed: true });
  assert.equal(exploitVulnerabilityDetailsReveal(target, "failure"), null, "a failure reveals no notes");
  const thaumCheck = messageWith({
    pf2e: { context: { type: "skill-check", options: ["action:exploit-vulnerability"], dc: { slug: "exploit-vulnerability", value: 17 },
      outcome: "success", target: { actor: target.uuid, token: "Scene.s.Token.t" } } },
  }, { rolls: [{ total: 20, dice: [{ total: 12, results: [{ result: 12 }] }] }] });
  const saves = [];
  const told = [];
  const result = await adjudicateExploitVulnerability(thaumCheck, {
    isActiveGM: true,
    thaumVuln: true,
    fromUuid: async () => target,
    saveUpdate: async (_actor, update, options) => { saves.push({ update, details: options.details }); return "Ogre Warrior: revealed Details"; },
    informRoller: async (message, payload) => { told.push({ author: message.author.id, payload }); },
  });
  assert.equal(result.completed, true);
  assert.deepEqual(saves, [{ update: null, details: { text: "Nests in the old well.", revealed: true } }],
    "the weakness was already known, but the notes are still revealed");
  assert.deepEqual(told, [{ author: "player1", payload: {
    notice: "Ogre Warrior: revealed Details",
    targetActorUuid: target.uuid,
    tokenUuid: "Scene.s.Token.t",
  } }], "the player who rolled is told what was revealed");
}

// --- The roller's client: notice, then Known Intel once the module's picker closes ------------
{
  const hookHandlers = new Map();
  const hooks = {
    on: (name, fn) => { hookHandlers.set(name, fn); return 7; },
    off: (name) => hookHandlers.delete(name),
  };
  let ran = 0;
  afterThaumVulnPicker(() => { ran += 1; }, { instances: new Map(), hooks });
  assert.equal(ran, 1, "no picker open: open Known Intel right away");
  afterThaumVulnPicker(() => { ran += 1; }, { instances: new Map([["ev-dialog", {}]]), hooks });
  assert.equal(ran, 1, "waits while the picker is open");
  hookHandlers.get("closeApplicationV2")({ id: "some-other-window" });
  assert.equal(ran, 1);
  hookHandlers.get("closeApplicationV2")({ id: "ev-dialog" });
  assert.equal(ran, 2, "opens once the picker closes");
  assert.equal(hookHandlers.has("closeApplicationV2"), false, "and stops listening");

  const notices = [];
  const previousUi = globalThis.ui;
  globalThis.ui = { notifications: { info: (text) => notices.push(text) } };
  const opened = [];
  await showKnowledgeReveal({ notice: "Ogre Warrior: revealed Weaknesses: Fire 5", targetActorUuid: "Actor.ogre", tokenUuid: "Token.t" }, {
    accessAllowed: () => true,
    whenPickerCloses: (fn) => fn(),
    openIntel: async (...args) => { opened.push(args); },
  });
  const blocked = await showKnowledgeReveal({ notice: "x", targetActorUuid: "Actor.ogre" }, {
    accessAllowed: () => false,
    openIntel: async () => assert.fail("players locked out of Combater don't get its window"),
  });
  globalThis.ui = previousUi;
  assert.deepEqual(notices, ["Ogre Warrior: revealed Weaknesses: Fire 5", "x"]);
  assert.deepEqual(opened, [["Actor.ogre", "Token.t"]], "Known Intel opens for that creature");
  assert.equal(blocked, false);
}

// --- Outcome dialog: each degree says what it does for this creature ---------------------------
{
  const target = npc();
  const rows = exploitVulnerabilityOutcomeRows({ target, ledger: {}, suggested: "success" });
  assert.deepEqual(rows.map((row) => row.outcome), ["criticalsuccess", "success", "failure", "criticalfailure"]);
  assert.equal(rows[1].text, "Reveals its highest weakness: Fire 5", "success names the weakness it would reveal");
  assert.equal(rows[1].suggested, true);
  const known = exploitVulnerabilityOutcomeRows({ target, ledger: { weaknesses: ["fire-5"] } });
  assert.equal(known[1].known, true, "a weakness the party already knows is marked known");
  assert.equal(known[0].known, false, "critical success still has more to reveal");
  const html = exploitVulnerabilityOutcomeContent({
    actor: pc, target, ledger: {}, total: 20, die: 12, dc: 18, suggested: "success",
  });
  assert.match(html, /pf2e-combater-rk-verdict/, "reuses the Recall Knowledge verdict layout");
  assert.match(html, /ev-outcome rk-degree-success is-suggested/);
  assert.match(html, /DC 18/);
}

// --- Hooks register without PF2e HUD: Exploit Vulnerability works from the sheet too ------------
{
  const registered = [];
  const hooks = { on: (name) => registered.push(name) };
  assert.equal(registerPf2eHudKnowledgeHooks({ hooks }), true, "registers with no PF2e HUD");
  assert.deepEqual(registered, ["preCreateChatMessage", "createChatMessage"]);
}

console.log("pf2e-hud-knowledge tests passed");
