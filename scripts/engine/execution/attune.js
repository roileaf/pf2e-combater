import { t } from "../../i18n.js";
import { executionPatch } from "./results.js";
import { aspectLabel, ATTUNEMENT_OPTION, currentAttunement } from "../../readers/solarian-reader.js";

function attunementFeat(actor, action) {
  return action?.attuneFeat
    ?? [...(actor?.items ?? [])].find((item) => (item?.slug ?? item?.system?.slug) === "stellar-attunement")
    ?? null;
}

async function setAttunement(actor, featId, aspect) {
  await actor.toggleRollOption("all", ATTUNEMENT_OPTION, featId, true, aspect);
}

// SF2e Attune: post the action, switch the Stellar Attunement roll option to the chosen aspect, and
// spend its once-per-round use. Undo restores the previous aspect and the use.
export async function executeAttune({ actor, action, patch = {} }) {
  const aspect = action?.attuneAspect ?? action?.activityProfile?.attuneAspect;
  const feat = attunementFeat(actor, action);
  if (!aspect || !feat?.id || typeof actor?.toggleRollOption !== "function") {
    const error = t("Exec.NoAttuneApi", "Stellar Attunement could not be changed on this actor.");
    return { status: "failed", patch: executionPatch(patch, "failed", { error }), error };
  }
  const previous = currentAttunement(actor);
  const item = action?.item ?? null;
  if (typeof item?.toMessage === "function") {
    await Promise.resolve(item.toMessage({}, { rollMode: globalThis.game?.settings?.get?.("core", "rollMode") })).catch(() => null);
  }
  await setAttunement(actor, feat.id, aspect);
  const ops = [{ kind: "attunement", actorUuid: actor.uuid, itemId: feat.id, previous }];
  const frequency = Number(item?.system?.frequency?.value);
  if (Number.isFinite(frequency) && frequency > 0 && typeof item?.update === "function") {
    await item.update({ "system.frequency.value": frequency - 1 });
    ops.push({ kind: "frequency", itemUuid: item.uuid, valueBefore: frequency, expectedAfter: { value: frequency - 1 } });
  }
  return {
    status: "done",
    patch: executionPatch(patch, "done", {
      result: t("Exec.Attuned", "Attuned to {aspect}.", { aspect: aspectLabel(aspect) }),
      revert: { ops, manualWarnings: [] },
    }),
  };
}

export async function revertAttunement(op) {
  if (!op?.actorUuid || !op?.itemId || !op?.previous) return;
  const actor = await globalThis.fromUuid?.(op.actorUuid);
  if (typeof actor?.toggleRollOption !== "function") return;
  await setAttunement(actor, op.itemId, op.previous);
}
