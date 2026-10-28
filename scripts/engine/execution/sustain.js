import { collectionValues } from "../../foundry-data.js";
import { t } from "../../i18n.js";
import { slugify } from "../action/text.js";
import { chatMessageIdFromResult } from "./chat-revert.js";
import { createGuidance } from "./guidance.js";
import { executionPatch, revertEnvelope } from "./results.js";

export async function resolveSustainedSpell(actor, sustained) {
  const uuid = sustained?.spellUuid;
  if (uuid && typeof globalThis.fromUuid === "function") {
    try {
      const document = await globalThis.fromUuid(uuid);
      if (document) return document;
    } catch (_error) {
      // Fall through to a slug match on the actor.
    }
  }
  const target = slugify(sustained?.id ?? sustained?.spellSlug ?? sustained?.name);
  if (!target) return null;
  return collectionValues(actor?.itemTypes?.spell).find(
    (spell) => slugify(spell?.slug ?? spell?.system?.slug ?? spell?.name) === target,
  ) ?? null;
}

// Re-posts the spell card flagged as a sustain (flags.pf2e-combater.sustain), so other modules can tell it
// from a new cast: Animater keeps the spell's lasting animation instead of replaying the cast.
async function postSustainCard(spell, sustained) {
  const flag = { name: spell.name ?? sustained?.name ?? null, spellUuid: spell.uuid ?? sustained?.spellUuid ?? null };
  const draft = await spell.toMessage(undefined, {
    create: false,
    rollMode: globalThis.game?.settings?.get?.("core", "rollMode"),
  });
  // A spell that ignored create: false already posted its card.
  if (typeof draft?.updateSource !== "function" || draft.id) return draft;
  draft.updateSource({ flags: { "pf2e-combater": { sustain: flag } } });
  return draft.constructor.create(draft.toObject(), { renderSheet: false });
}

export async function executeSustainSpell({ actor, step, action }) {
  const sustained = step?.sustainedSpell ?? {};
  const spell = await resolveSustainedSpell(actor, sustained);
  let messageId = null;
  if (typeof spell?.toMessage === "function") {
    const message = await postSustainCard(spell, sustained);
    messageId = chatMessageIdFromResult({ message }) ?? message?.id ?? message?._id ?? null;
  } else {
    await createGuidance({ ...action, reason: sustained?.name ? t("Exec.SustainReason", "Sustain {name}.", { name: sustained.name }) : action?.reason }, actor);
  }
  return {
    status: "done",
    patch: executionPatch({}, "done", {
      result: spell ? t("Exec.RePosted", "Re-posted {name}.", { name: spell.name ?? sustained?.name ?? t("Exec.Spell", "spell") }) : t("Exec.PostedSustainReminder", "Posted sustain reminder."),
      revert: revertEnvelope(messageId ? [{ kind: "chat", messageId }] : []),
    }),
  };
}
