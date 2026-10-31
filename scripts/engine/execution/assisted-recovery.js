import { MODULE_ID } from "../../constants.js";
import { t } from "../../i18n.js";
import { requestEndPersistentDamage } from "../../socket.js";
import { attachRevertOp, executionPatch } from "./results.js";

// PF2e: each persistent damage carries its own recovery DC (usually 15); especially fitting help
// lowers it to 10 (GM's call), never raises it.
export const RECOVERY_DC = 15;
export const FITTING_RECOVERY_DC = 10;

export function fittingRecoveryDc(dc) {
  return Math.min(Number(dc) || RECOVERY_DC, FITTING_RECOVERY_DC);
}

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "");
}

function allyActor(target) {
  return target?.token?.actor ?? target?.token?.document?.actor ?? target?.actor ?? null;
}

// An ally's persistent damage conditions, each with what the help would be for ("1d6 fire").
export function persistentDamages(actor) {
  const conditions = actor?.itemTypes?.condition ?? actor?.items?.filter?.((item) => item.type === "condition") ?? [];
  return [...conditions]
    .filter((condition) => (condition?.slug ?? condition?.system?.slug) === "persistent-damage")
    .map((condition) => {
      const persistent = condition.system?.persistent ?? {};
      const detail = [persistent.formula, persistent.damageType].filter(Boolean).join(" ");
      const dc = Number(persistent.dc) || RECOVERY_DC;
      return { id: condition.id, uuid: condition.uuid, label: detail || String(condition.name ?? ""), dc, condition };
    });
}

function failed(error, patch) {
  return { status: "failed", error, patch: executionPatch(patch, "failed", { error }) };
}

// Ends the condition: the ally's owner deletes it, anyone else asks the GM.
async function endPersistentDamage(damage) {
  if (damage.condition?.isOwner && typeof damage.condition.delete === "function") {
    await damage.condition.delete();
    return true;
  }
  return (await requestEndPersistentDamage({ conditionUuid: damage.uuid })) === true;
}

const RECOVERY_FLAG = "assistedRecovery";

// Player Core: a creature benefits from assisted recovery once per round. Each attempt's chat card
// records whose it was and when, so undoing the step (which deletes the card) gives the chance back.
function recoveredThisRound(actor, combat) {
  if (!combat?.started || !actor?.uuid) return false;
  return (globalThis.game?.messages?.contents ?? []).some((message) => {
    const mark = message?.flags?.[MODULE_ID]?.[RECOVERY_FLAG];
    return mark?.actorUuid === actor.uuid && mark.combatId === combat.id && mark.round === combat.round;
  });
}

function recoveryFlags(actor, combat) {
  return combat?.started ? { [MODULE_ID]: { [RECOVERY_FLAG]: { actorUuid: actor?.uuid ?? null, combatId: combat.id, round: combat.round } } } : {};
}

// The flat check as PF2e rolls its own persistent damage recovery: a flat-check with the DC, so the
// card shows the DC and "Result: Success by N" like PF2e's. Its message then gets the round mark.
async function rollPf2eFlatCheck({ ally, damage, dc, title, flags }) {
  const pf2e = globalThis.game?.pf2e;
  if (typeof pf2e?.Check?.roll !== "function" || typeof pf2e?.CheckModifier !== "function") return null;
  const label = `${title}: ${damage.condition?.name ?? damage.label}`;
  const before = new Set((globalThis.game?.messages?.contents ?? []).map((message) => message.id));
  const roll = await pf2e.Check.roll(new pf2e.CheckModifier(label, { modifiers: [] }), {
    actor: ally, type: "flat-check", dc: { value: dc }, title: label, skipDialog: true,
    options: new Set(["assisted-recovery", ...(damage.condition?.getRollOptions?.("item") ?? [])]),
    domains: ["flat-check"],
  }, null);
  if (!roll) return { success: false, message: null };
  const message = (globalThis.game?.messages?.contents ?? []).findLast?.((entry) => !before.has(entry.id) && entry.isRoll) ?? null;
  if (message && flags?.[MODULE_ID]) await message.update?.({ flags });
  return { success: Number(roll.degreeOfSuccess) >= 2, message };
}

// Without PF2e's check API (tests, or a future API change): a plain d20 against the DC.
async function rollPlainFlatCheck({ damage, dc, title, speaker, flags }) {
  const roll = await new globalThis.Roll("1d20").evaluate();
  const success = roll.total >= dc;
  const outcome = success ? t("Exec.RecoverySuccess", "Success: the persistent {damage} ends.", { damage: damage.label })
    : t("Exec.RecoveryFailure", "Failure: the persistent {damage} continues.", { damage: damage.label });
  const message = await roll.toMessage({
    speaker, flags,
    flavor: `<strong>${escapeHtml(title)}</strong><br>${escapeHtml(t("Exec.RecoveryFlavor", "Flat check DC {dc} to end persistent {damage}.", { dc, damage: damage.label }))}<br>${escapeHtml(outcome)}`,
  });
  return { success, message };
}

// Rolls the extra flat check to end one persistent damage, on an ally or yourself (whoever the step
// targets). Until it knows which damage (when there are several) and the GM's ruling (the damage's
// own DC, 10 for especially fitting help, or ending it outright), it asks as a "recovery-dc" choice.
export async function executeAssistedRecovery({ context = null, target, choices = {}, patch = {} }) {
  const ally = allyActor(target);
  const allyName = target?.token?.name ?? ally?.name ?? "";
  const damages = persistentDamages(ally);
  if (!damages.length) {
    return failed(t("Exec.NoPersistentDamage", "{ally} has no persistent damage to recover from.", { ally: allyName }), patch);
  }
  const combat = context?.combat ?? globalThis.game?.combat ?? null;
  if (recoveredThisRound(ally, combat)) {
    return failed(t("Exec.RecoveryOncePerRound", "{ally} already had assisted recovery this round.", { ally: allyName }), patch);
  }
  const damage = damages.find((entry) => entry.id === choices.persistentId) ?? (damages.length === 1 ? damages[0] : null);
  const dc = Number(choices.dc);
  const title = t("Action.AssistedRecovery", "Assisted Recovery");
  const speaker = globalThis.ChatMessage?.getSpeaker?.({ actor: ally }) ?? {};
  // The GM can rule that suitable help (a dunk in a lake for fire) ends it outright: no roll.
  if (damage && choices.autoEnd === true) {
    const ended = await endPersistentDamage(damage);
    const result = ended
      ? t("Exec.RecoveryEndedOutright", "The persistent {damage} ends (GM's ruling).", { damage: damage.label })
      : t("Exec.RecoveryNotRemovedOutright", "The persistent {damage} couldn't be removed; an active GM is needed.", { damage: damage.label });
    const message = await globalThis.ChatMessage?.create?.({ speaker, content: `<strong>${escapeHtml(title)}</strong><br>${escapeHtml(result)}`, flags: recoveryFlags(ally, combat) });
    const done = { status: "done", patch: executionPatch(patch, "done", { result }) };
    const messageId = message?.id ?? message?._id ?? null;
    return messageId ? attachRevertOp(done, { kind: "chat", messageId }) : done;
  }
  if (!damage || !Number.isFinite(dc)) {
    return {
      status: "needs-choice",
      choices: ["recovery-dc"],
      patch: {},
      recovery: { allyName, damages: damages.map(({ id, label, dc: damageDc }) => ({ id, label, dc: damageDc })), persistentId: damage?.id ?? null },
    };
  }

  const pf2eCheck = await rollPf2eFlatCheck({ ally, damage, dc, title, flags: recoveryFlags(ally, combat) });
  const { success, message } = pf2eCheck ?? await rollPlainFlatCheck({ damage, dc, title, speaker, flags: recoveryFlags(ally, combat) });
  const outcome = success ? t("Exec.RecoverySuccess", "Success: the persistent {damage} ends.", { damage: damage.label })
    : t("Exec.RecoveryFailure", "Failure: the persistent {damage} continues.", { damage: damage.label });
  const ended = success ? await endPersistentDamage(damage) : false;
  const result = success && !ended
    ? t("Exec.RecoveryNotRemoved", "The flat check succeeded, but the persistent {damage} couldn't be removed; an active GM is needed.", { damage: damage.label })
    : outcome;
  const done = { status: "done", patch: executionPatch(patch, "done", { result }) };
  const messageId = message?.id ?? message?._id ?? null;
  return messageId ? attachRevertOp(done, { kind: "chat", messageId }) : done;
}
