// PF2e HUD integration for knowledge checks.
//
// Recall Knowledge: PF2e HUD rolls one secret d20 against every skill (its own card, flagged
// `pf2e-hud.action = "recall-knowledge"`), against the single NPC the user targets. Combater stamps
// that target on the message, asks the roller what they want to recall, then hands the roll to the
// GM through the same adjudication as Combater's own Recall Knowledge (attempt counting, failure
// blocks, intel window, false information on a critical failure).
//
// Exploit Vulnerability: the Thaumaturge action is an `@Check[esoteric-lore]` from the action card
// (PF2e HUD posts that card from its sidebar). The check carries no DC and no target, so Combater
// stamps the target, and the active GM picks the outcome against the standard DC for the
// creature's level. Success reveals the creature's highest weakness; a critical success reveals
// all its weaknesses, resistances and immunities.
//
// With PF2e Exploit Vulnerability (pf2e-thaum-vuln) the check is that module's own action: it rolls
// against its own DC and applies the effects by the roll's degree, opening its Mortal Weakness /
// Personal Antithesis picker. Combater then takes that degree as settled and records the intel
// without a second dialog.

import { systemFlags } from "../system.js";
import { MODULE_ID } from "../constants.js";
import { collectionValues } from "../foundry-data.js";
import { t } from "../i18n.js";
import {
  NONE_FACT_ID,
  describeIntelChanges,
  intelActor,
  intelChangeNotice,
  intelLedgerView,
  readIntelDetails,
  intelDefenseFactId,
  isNpcIntelTarget,
  readIntelLedger,
  writeIntelFlags,
  INTEL_LEDGER_FLAG,
  intelKnowerId,
  mergeIntelLedgers,
  readCharacterIntelLedgers,
  readKnownIntelLedger,
  subtractIntelLedger,
} from "../rules/intel-ledger.js";
import { recallKnowledgeAttemptState } from "../rules/recall-knowledge.js";
import { isPf2eHudRecallKnowledgeMessage } from "../engine/execution/recall-knowledge.js";
import {
  buttonChoice,
  promptRecallKnowledgeQuestion,
  resolveRecallKnowledgeRequest,
} from "../ui/recall-knowledge.js";
import { requestRecallKnowledgeResolution, requestShowKnowledgeReveal } from "../socket.js";
import { componentEnabled, playerAccessAllowed } from "../settings.js";

const HUD_MODULE = "pf2e-hud";
export const KNOWLEDGE_TARGET_FLAG = "knowledgeTarget";
const OUTCOMES = ["criticalfailure", "failure", "success", "criticalsuccess"];

const THAUM_VULN_MODULE = "pf2e-thaum-vuln";

export function thaumVulnActive() {
  return globalThis.game?.modules?.get?.(THAUM_VULN_MODULE)?.active === true;
}

// PF2e Exploit Vulnerability's own action rolls against its "exploit-vulnerability" DC.
export function isThaumVulnCheckMessage(message) {
  return systemFlags(message)?.context?.dc?.slug === "exploit-vulnerability";
}

export function pf2eHudActive() {
  return globalThis.game?.modules?.get?.(HUD_MODULE)?.active === true;
}

function lower(value) {
  return String(value ?? "").trim().toLowerCase();
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function messageRollOptions(message) {
  const pf2e = systemFlags(message) ?? {};
  return [
    ...collectionValues(pf2e.context?.options),
    ...collectionValues(pf2e.origin?.rollOptions),
  ].map(lower);
}

// The inline check from the Exploit Vulnerability action card adds `target:action:slug:...` (and the
// action's own options); a check rolled from the item keeps it as its origin.
export function isExploitVulnerabilityCheckMessage(message) {
  const context = systemFlags(message)?.context;
  if (!context || !String(context.type ?? "").includes("check")) return false;
  return messageRollOptions(message).some((option) => option === "action:exploit-vulnerability"
    || option.endsWith(":action:slug:exploit-vulnerability")
    || option.endsWith("item:slug:exploit-vulnerability"));
}

export function isKnowledgeCheckMessage(message) {
  return isPf2eHudRecallKnowledgeMessage(message) || isExploitVulnerabilityCheckMessage(message);
}

function tokenActor(token) {
  return token?.actor ?? token?.document?.actor ?? null;
}

// PF2e HUD only rolls against a target when exactly one NPC is targeted; Exploit Vulnerability is
// one creature too.
export function knowledgeTargetFromTargets(targets) {
  const list = collectionValues(targets);
  if (list.length !== 1) return null;
  const token = list[0];
  const actor = tokenActor(token);
  if (!actor?.uuid || !isNpcIntelTarget({ actor })) return null;
  return {
    actorUuid: actor.uuid,
    tokenUuid: token?.document?.uuid ?? token?.uuid ?? null,
    name: token?.document?.name ?? token?.name ?? actor.name ?? "",
  };
}

export function knowledgeTargetFromMessage(message) {
  const stamped = message?.flags?.[MODULE_ID]?.[KNOWLEDGE_TARGET_FLAG];
  if (stamped?.actorUuid) return stamped;
  const target = systemFlags(message)?.context?.target;
  return target?.actor ? { actorUuid: target.actor, tokenUuid: target.token ?? null, name: "" } : null;
}

// preCreateChatMessage runs on the roller's client, while their targets are still the ones the
// roll used.
export function stampKnowledgeTarget(message, { targets = globalThis.game?.user?.targets } = {}) {
  if (!isKnowledgeCheckMessage(message) || knowledgeTargetFromMessage(message)) return false;
  const target = knowledgeTargetFromTargets(targets);
  if (!target || typeof message?.updateSource !== "function") return false;
  message.updateSource({ [`flags.${MODULE_ID}.${KNOWLEDGE_TARGET_FLAG}`]: target });
  return true;
}

async function documentFromUuid(uuid) {
  if (!uuid || typeof globalThis.fromUuid !== "function") return null;
  return globalThis.fromUuid(uuid);
}

function speakerActor(message) {
  return message?.actor
    ?? globalThis.ChatMessage?.getSpeakerActor?.(message?.speaker)
    ?? globalThis.game?.actors?.get?.(message?.speaker?.actor)
    ?? null;
}

function authorId(message) {
  return String(message?.author?.id ?? message?.user?.id ?? message?.user ?? message?.author ?? "");
}

function notify(level, text) {
  globalThis.ui?.notifications?.[level]?.(text);
}

// The roller's side of a PF2e HUD Recall Knowledge roll: Combater's question, then the GM's ruling.
export async function handlePf2eHudRecallKnowledge(message, {
  userId = globalThis.game?.user?.id,
  isGM = globalThis.game?.user?.isGM === true,
  hasActiveGM = Boolean(globalThis.game?.users?.activeGM),
  fromUuid = documentFromUuid,
  promptQuestion = promptRecallKnowledgeQuestion,
  resolveLocally = resolveRecallKnowledgeRequest,
  requestGm = requestRecallKnowledgeResolution,
} = {}) {
  if (!isPf2eHudRecallKnowledgeMessage(message) || authorId(message) !== String(userId ?? "")) return null;
  const stamped = knowledgeTargetFromMessage(message);
  if (!stamped) return null;
  const actor = speakerActor(message);
  const target = await fromUuid(stamped.actorUuid);
  if (!actor?.uuid || !target) return null;

  const attemptState = recallKnowledgeAttemptState(actor, target);
  if (attemptState.blocked) {
    notify("warn", t(
      "RecallKnowledge.Blocked",
      "A failed Recall Knowledge check prevents further attempts against this creature.",
    ));
    return { completed: false, reason: "blocked" };
  }
  if (!isGM && !hasActiveGM) {
    notify("warn", t("RecallKnowledge.GMUnavailable", "Recall Knowledge requires an active GM and socketlib."));
    return { completed: false, reason: "no-gm" };
  }
  const question = await promptQuestion({
    targetName: stamped.name || target.name || "",
    targetActor: target,
    rollerActor: actor,
    attempt: (Number(attemptState.attempts) || 0) + 1,
  });
  if (!question) return { completed: false, reason: "cancelled" };

  const payload = {
    actorUuid: actor.uuid,
    actorName: actor.name ?? "",
    targetActorUuid: target.uuid ?? stamped.actorUuid,
    targetName: stamped.name || target.name || "",
    question: question.id,
    messageId: message.id ?? message._id ?? null,
  };
  let result;
  if (isGM) {
    result = await resolveLocally(payload);
  } else {
    notify("info", t("RecallKnowledge.WaitingGM", "Roll sent. Waiting for the GM to adjudicate Recall Knowledge."));
    result = await requestGm(payload);
  }
  if (!result?.completed) {
    notify("warn", result?.reason ?? t("RecallKnowledge.GMUnavailable", "Recall Knowledge requires an active GM and socketlib."));
  }
  return result ?? null;
}

// Standard DC by level (Core Rulebook / GM Core table), the DC Exploit Vulnerability uses.
const LEVEL_DCS = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];

export function standardDcForLevel(level) {
  const value = Math.round(Number(level));
  if (!Number.isFinite(value)) return null;
  if (value < 0) return 13;
  return LEVEL_DCS[Math.min(value, LEVEL_DCS.length - 1)];
}

function actorLevel(actor) {
  return numeric(actor?.level ?? actor?.system?.details?.level?.value);
}

function defenseList(actor, category) {
  const value = actor?.system?.attributes?.[category] ?? actor?.[category] ?? [];
  return collectionValues(value);
}

function defenseValue(entry) {
  return numeric(entry?.value ?? entry?.amount) ?? 0;
}

// The highest weakness (the first of several tied), or null.
function highestWeakness(target) {
  return defenseList(target, "weaknesses")
    .reduce((top, entry) => (!top || defenseValue(entry) > defenseValue(top) ? entry : top), null);
}

function weaknessLabel(entry) {
  const type = String(entry?.type?.value ?? entry?.type ?? entry?.label ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const value = defenseValue(entry);
  return value > 0 ? `${type} ${value}` : type;
}

// What each outcome adds to the party's ledger, against what it already knows. Null: nothing new.
export function exploitVulnerabilityLedgerUpdate(ledger, outcome, target) {
  const current = ledger ?? {};
  const knowsAll = (category) => current[category] === true;
  if (outcome === "criticalsuccess") {
    const categories = ["weaknesses", "resistances", "immunities"].filter((category) => !knowsAll(category));
    return categories.length ? Object.fromEntries(categories.map((category) => [category, true])) : null;
  }
  if (outcome !== "success" || knowsAll("weaknesses")) return null;
  const highest = highestWeakness(target);
  const factId = highest ? intelDefenseFactId(highest) : NONE_FACT_ID;
  const known = Array.isArray(current.weaknesses) ? current.weaknesses : [];
  if (known.includes(factId)) return null;
  return { weaknesses: [...known, factId] };
}

function structuredOutcome(message) {
  const value = systemFlags(message)?.context?.outcome ?? message?.rolls?.[0]?.options?.degreeOfSuccess;
  if (Number.isInteger(Number(value)) && value !== null && value !== "") return OUTCOMES[Number(value)] ?? null;
  const normalized = lower(value).replace(/[\s_-]+/g, "");
  return OUTCOMES.includes(normalized) ? normalized : null;
}

function naturalD20(roll) {
  const value = numeric(roll?.dice?.[0]?.results?.find?.((result) => result?.active !== false)?.result
    ?? roll?.dice?.[0]?.total);
  return Number.isInteger(value) && value >= 1 && value <= 20 ? value : null;
}

// The check's own degree when it had a DC, otherwise its total against the creature's level DC.
export function exploitVulnerabilitySuggestedOutcome(message, dc) {
  const structured = structuredOutcome(message);
  if (structured) return structured;
  const roll = message?.rolls?.[0];
  const total = numeric(roll?.total);
  if (total === null || dc === null) return null;
  let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  const die = naturalD20(roll);
  if (die === 20) degree = Math.min(3, degree + 1);
  if (die === 1) degree = Math.max(0, degree - 1);
  return OUTCOMES[degree];
}

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "");
}

const OUTCOME_LABELS = {
  criticalsuccess: () => t("ExploitVulnerability.CriticalSuccess", "Critical Success"),
  success: () => t("ExploitVulnerability.Success", "Success"),
  failure: () => t("ExploitVulnerability.Failure", "Failure"),
  criticalfailure: () => t("ExploitVulnerability.CriticalFailure", "Critical Failure"),
};

// A success also hands the players the GM's prepared Details notes about the creature.
export function exploitVulnerabilityDetailsReveal(target, outcome) {
  if (outcome !== "success" && outcome !== "criticalsuccess") return null;
  const details = readIntelDetails(target);
  return details.text && !details.revealed ? { text: details.text, revealed: true } : null;
}

// What each outcome does for this creature, against what the party already knows.
export function exploitVulnerabilityOutcomeRows({ target, ledger = {}, suggested = null } = {}) {
  const highest = highestWeakness(target);
  const hiddenDetails = exploitVulnerabilityDetailsReveal(target, "success") !== null;
  const reveals = (outcome) => exploitVulnerabilityLedgerUpdate(ledger, outcome, target) !== null || hiddenDetails;
  const plusDetails = (text) => (hiddenDetails
    ? t("ExploitVulnerability.PlusDetails", "{text}, plus your Details notes", { text })
    : text);
  const effects = {
    criticalsuccess: {
      icon: "fa-solid fa-eye",
      text: plusDetails(t("ExploitVulnerability.RevealAll", "Reveals all weaknesses, resistances and immunities")),
      reveals: reveals("criticalsuccess"),
    },
    success: {
      icon: "fa-solid fa-heart-crack",
      text: plusDetails(highest
        ? t("ExploitVulnerability.RevealHighest", "Reveals its highest weakness: {weakness}", { weakness: weaknessLabel(highest) })
        : t("ExploitVulnerability.RevealNone", "Reveals that it has no weaknesses")),
      reveals: reveals("success"),
    },
    failure: {
      icon: "fa-solid fa-user-slash",
      text: t("ExploitVulnerability.FailureEffect", "Personal antithesis only; nothing revealed"),
      reveals: false,
    },
    criticalfailure: {
      icon: "fa-solid fa-person-falling",
      text: t("ExploitVulnerability.CriticalFailureEffect", "Off-guard until their next turn; nothing revealed"),
      reveals: false,
    },
  };
  return [...OUTCOMES].reverse().map((outcome) => ({
    outcome,
    label: OUTCOME_LABELS[outcome](),
    ...effects[outcome],
    known: (outcome === "success" || outcome === "criticalsuccess") && !effects[outcome].reveals,
    suggested: outcome === suggested,
  }));
}

export function exploitVulnerabilityOutcomeContent({ actor, target, ledger, total, die, dc, suggested } = {}) {
  const rows = exploitVulnerabilityOutcomeRows({ target, ledger, suggested });
  const level = actorLevel(target);
  const rowHtml = rows.map((row) => `<div class="ev-outcome rk-degree-${row.outcome}${row.suggested ? " is-suggested" : ""}${row.known ? " is-known" : ""}">
      <span class="ev-outcome-degree">${row.suggested ? '<i class="fa-solid fa-dice-d20"></i> ' : ""}${escapeHtml(row.label)}</span>
      <span class="ev-outcome-effect"><i class="${row.icon}"></i> ${escapeHtml(row.text)}</span>
      ${row.known ? `<span class="ev-known-tag">${escapeHtml(t("ExploitVulnerability.AlreadyKnown", "Already known"))}</span>` : ""}
    </div>`).join("");
  const suggestedRow = rows.find((row) => row.suggested);
  return `<div class="pf2e-combater-rk-verdict pf2e-combater-ev-verdict">
    <div class="rk-who">
      <div class="rk-who-text">
        <strong>${escapeHtml(actor?.name ?? "")} → ${escapeHtml(target?.name ?? "")}</strong>
        <span class="rk-chips"><span class="rk-chip">${escapeHtml(t("ExploitVulnerability.Title", "Exploit Vulnerability"))}</span>
          <span class="rk-chip">${escapeHtml(t("ExploitVulnerability.EsotericLore", "Esoteric Lore"))}</span></span>
      </div>
      <div class="rk-die"><b>${escapeHtml(die ?? "?")}</b><small>d20</small></div>
    </div>
    <div class="rk-dc-cards">
      <div class="rk-dc-card"><small>${escapeHtml(t("ExploitVulnerability.Result", "Esoteric Lore result"))}</small><b>${escapeHtml(total ?? "?")}</b></div>
      <div class="rk-dc-card"><small>${escapeHtml(t("ExploitVulnerability.StandardDc", "Standard DC"))}</small><b>DC ${escapeHtml(dc ?? "?")}</b>
        <span>${escapeHtml(t("ExploitVulnerability.ForLevel", "level {level}", { level: level ?? "?" }))}</span></div>
    </div>
    <div class="rk-section-title"><span>${escapeHtml(t("ExploitVulnerability.Outcomes", "Outcomes"))}</span></div>
    <div class="ev-outcomes">${rowHtml}</div>
    ${suggestedRow
    ? `<p class="rk-suggestion"><i class="fa-solid fa-dice-d20"></i>
        <span>${escapeHtml(t("RecallKnowledge.Suggested", "Suggested:"))} <b class="rk-degree-${suggestedRow.outcome}">${escapeHtml(suggestedRow.label)}</b>
        — ${escapeHtml(t("ExploitVulnerability.SuggestLine", "Esoteric Lore {total} vs DC {dc}", { total: total ?? "?", dc: dc ?? "?" }))}</span></p>`
    : ""}
    <p class="rk-gm-hint">${escapeHtml(t("ExploitVulnerability.GmHint", "The GM decides the outcome; the suggestion only compares the total with the DC."))}</p>
  </div>`;
}

function promptExploitVulnerabilityOutcome(details) {
  const { suggested } = details;
  return buttonChoice({
    title: t("ExploitVulnerability.OutcomeTitle", "Exploit Vulnerability Outcome"),
    icon: "fa-solid fa-book-skull",
    width: 640,
    content: exploitVulnerabilityOutcomeContent(details),
    contentIsHtml: true,
    classes: ["pf2e-combater-rk-outcome-dialog", "pf2e-combater-ev-outcome-dialog"],
    choices: [...OUTCOMES].reverse().map((id) => ({
      id,
      label: OUTCOME_LABELS[id](),
      class: `rk-outcome rk-degree-${id}${id === suggested ? " is-suggested" : ""}`,
      ...(id === suggested ? { icon: "fa-solid fa-dice-d20", default: true } : {}),
    })),
  });
}

// Writes the update (ledger facts and/or revealed Details) and returns the notice saying what the
// party learned.
// With a knower (the roller), the facts are filed under that character alone, as Recall Knowledge does.
async function saveLedgerUpdate(target, update, { details = null, knowerId = "" } = {}) {
  const values = {};
  let described = values;
  let knowerIds;
  if (update && knowerId) {
    const party = readIntelLedger(target);
    const known = readKnownIntelLedger(target, [knowerId]);
    const characters = readCharacterIntelLedgers(target);
    const own = subtractIntelLedger({ ...known, ...update }, party);
    values.characterLedgers = { ...characters, [knowerId]: { name: characters[knowerId]?.name ?? "", ledger: own } };
    described = { ledger: mergeIntelLedgers(party, own) };
    knowerIds = [knowerId];
  } else if (update) {
    const base = intelActor(target);
    const raw = base?.getFlag?.(MODULE_ID, INTEL_LEDGER_FLAG) ?? {};
    values.ledger = { ...raw, ...readIntelLedger(target), ...update };
  }
  if (details) {
    values.details = details;
    described = { ...described, details };
  }
  const notice = intelChangeNotice(target?.name, describeIntelChanges(target, described, { knowerIds }));
  await writeIntelFlags(target, values);
  return notice;
}

// The roller learns it too: the GM's client tells them over the socket (the GM sees the notice
// already when they rolled themselves).
async function informRollerOfReveal(message, payload) {
  const rollerId = authorId(message);
  if (!rollerId || rollerId === String(globalThis.game?.user?.id ?? "")) return false;
  return Boolean(await requestShowKnowledgeReveal(rollerId, payload));
}

const THAUM_VULN_DIALOG_ID = "ev-dialog";

// Runs once PF2e Exploit Vulnerability's picker is closed (or right away when it isn't open), so the
// player isn't handed two windows at once.
export function afterThaumVulnPicker(callback, {
  instances = globalThis.foundry?.applications?.instances,
  hooks = globalThis.Hooks,
} = {}) {
  if (!instances?.get?.(THAUM_VULN_DIALOG_ID) || typeof hooks?.on !== "function") return callback();
  const id = hooks.on("closeApplicationV2", (app) => {
    if (app?.id !== THAUM_VULN_DIALOG_ID) return;
    hooks.off("closeApplicationV2", id);
    callback();
  });
  return null;
}

async function openKnownIntel(targetActorUuid, tokenUuid, { fromUuid = documentFromUuid } = {}) {
  const actor = await fromUuid(targetActorUuid);
  if (!actor) return false;
  const token = tokenUuid ? await fromUuid(tokenUuid) : null;
  const viewProvider = () => intelLedgerView({ isGM: false, intelTargets: [{ actor, token, name: token?.name }] });
  const view = viewProvider();
  if (!view.visible) return false;
  const { openIntelWindow } = await import("../ui/intel-window.js");
  await openIntelWindow(view, { mode: "view", viewProvider });
  return true;
}

// The roller's client: what Exploit Vulnerability revealed, then Combater's Known Intel for it.
export async function showKnowledgeReveal(payload = {}, {
  accessAllowed = playerAccessAllowed,
  whenPickerCloses = afterThaumVulnPicker,
  openIntel = openKnownIntel,
} = {}) {
  if (payload.notice) notify("info", payload.notice);
  if (!payload.targetActorUuid || !accessAllowed()) return false;
  whenPickerCloses(() => {
    openIntel(payload.targetActorUuid, payload.tokenUuid).catch((error) => {
      globalThis.console?.warn?.(`${MODULE_ID} | Could not open Known Intel`, error);
    });
  });
  return true;
}

// The active GM's side of an Exploit Vulnerability check.
export async function adjudicateExploitVulnerability(message, {
  isActiveGM = globalThis.game?.user?.isActiveGM === true,
  fromUuid = documentFromUuid,
  promptOutcome = promptExploitVulnerabilityOutcome,
  saveUpdate = saveLedgerUpdate,
  informRoller = informRollerOfReveal,
  thaumVuln = thaumVulnActive(),
} = {}) {
  if (!isActiveGM || !isExploitVulnerabilityCheckMessage(message)) return null;
  const stamped = knowledgeTargetFromMessage(message);
  const target = stamped ? await fromUuid(stamped.actorUuid) : null;
  if (!target || !isNpcIntelTarget({ actor: target })) return null;
  // What the roller already knows (the party's intel plus their own); what they learn stays theirs.
  const knowerId = intelKnowerId(speakerActor(message));
  const ledger = knowerId ? readKnownIntelLedger(target, [knowerId]) : readIntelLedger(target);
  // Nothing either success could add: don't interrupt the GM.
  if (!exploitVulnerabilityLedgerUpdate(ledger, "success", target)
    && !exploitVulnerabilityLedgerUpdate(ledger, "criticalsuccess", target)
    && !exploitVulnerabilityDetailsReveal(target, "success")) {
    return { completed: true, revealed: 0 };
  }
  const settled = thaumVuln && isThaumVulnCheckMessage(message) ? structuredOutcome(message) : null;
  const dc = numeric(systemFlags(message)?.context?.dc?.value) ?? standardDcForLevel(actorLevel(target));
  const suggested = exploitVulnerabilitySuggestedOutcome(message, dc);
  const choice = settled ? { id: settled } : await promptOutcome({
    actor: speakerActor(message),
    target,
    ledger,
    total: numeric(message?.rolls?.[0]?.total),
    die: naturalD20(message?.rolls?.[0]),
    dc,
    suggested,
  });
  const outcome = OUTCOMES.includes(choice?.id) ? choice.id : null;
  if (!outcome) return { completed: false, reason: "cancelled" };
  const update = exploitVulnerabilityLedgerUpdate(ledger, outcome, target);
  const details = exploitVulnerabilityDetailsReveal(target, outcome);
  if (!update && !details) return { completed: true, outcome, revealed: 0 };
  let notice;
  try {
    notice = await saveUpdate(target, update, { details, knowerId });
  } catch (error) {
    globalThis.console?.warn?.(`${MODULE_ID} | Failed to record Exploit Vulnerability intel`, error);
    notify("warn", t("Intel.SaveFailed", "Could not update intel ledger."));
    return { completed: false, reason: "save-failed" };
  }
  // The tracker Intel refreshes from the updateActor hook in main.js.
  notify("info", notice || t("Intel.Saved", "Intel ledger updated."));
  try {
    await informRoller(message, { notice, targetActorUuid: target.uuid ?? stamped.actorUuid, tokenUuid: stamped.tokenUuid ?? null });
  } catch (error) {
    globalThis.console?.warn?.(`${MODULE_ID} | Could not tell the roller what Exploit Vulnerability revealed`, error);
  }
  const revealed = Object.keys(update ?? {}).length + (details ? 1 : 0);
  return { completed: true, outcome, notice, revealed, update, details };
}

let hooksRegistered = false;

// Active with PF2e HUD or PF2e Exploit Vulnerability: either can make these checks.
// Always on: each handler only answers its own message (PF2e HUD's flagged Recall Knowledge card, or
// an Exploit Vulnerability check rolled from anywhere: PF2e HUD, the sheet, or pf2e-thaum-vuln).
export function registerPf2eHudKnowledgeHooks({ hooks = globalThis.Hooks, active = true } = {}) {
  if (hooksRegistered || !active || typeof hooks?.on !== "function") return false;
  hooks.on("preCreateChatMessage", (message, _data, _options, userId) => {
    if (!componentEnabled("intel")) return;
    if (userId && userId !== globalThis.game?.user?.id) return;
    stampKnowledgeTarget(message);
  });
  hooks.on("createChatMessage", (message) => {
    if (!componentEnabled("intel")) return;
    if (isPf2eHudRecallKnowledgeMessage(message)) {
      handlePf2eHudRecallKnowledge(message).catch((error) => {
        globalThis.console?.warn?.(`${MODULE_ID} | PF2e HUD Recall Knowledge failed`, error);
      });
    } else if (isExploitVulnerabilityCheckMessage(message)) {
      adjudicateExploitVulnerability(message).catch((error) => {
        globalThis.console?.warn?.(`${MODULE_ID} | Exploit Vulnerability intel failed`, error);
      });
    }
  });
  hooksRegistered = true;
  return true;
}
