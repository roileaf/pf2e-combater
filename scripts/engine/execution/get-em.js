import { t } from "../../i18n.js";
import { compendiumUuid, systemFlags } from "../../system.js";
import { MODULE_ID } from "../../constants.js";
import { contextAllies } from "../target-pool.js";
import { executionPatch } from "./results.js";
import { canvasTokenById, setTarget } from "./targets.js";
import { strikeVariantIndex } from "./strike.js";

// SF2e Effect: Get 'Em! — TokenMark "get-em", +1 status to attacks against the mark, and with Lead by
// Example +1 status damage (the envoy's own Lead by Example Strike gets its Charisma instead).
export const getEmEffectUuid = () => compendiumUuid("feat-effects", "ey2zSEnprAGgvrij");
export const LEAD_BY_EXAMPLE_STRIKE_OPTION = "get-em:lead-by-example-strike";

function tokenDocument(token) {
  return token?.document ?? token ?? null;
}

// The envoy and every ally whose actor this user can change (a player usually only their own).
function beneficiaries(actor, context) {
  // The context's ally entries are summaries; the real actor is on the token (or in the world).
  const allies = contextAllies(context)
    .map((ally) => canvasTokenById(ally?.token?.id ?? ally?.id)?.actor
      ?? globalThis.game?.actors?.get?.(ally?.actor?.id)
      ?? (typeof ally?.actor?.createEmbeddedDocuments === "function" ? ally.actor : null))
    .filter((ally) => ally && ally.uuid !== actor?.uuid);
  return [actor, ...allies].filter((entry, index, list) => entry && list.findIndex((other) => other?.uuid === entry.uuid) === index);
}

export function getEmEffectData(source, { actor, item, target, leadByExample }) {
  const data = source.toObject();
  data._id = null;
  for (const rule of data.system?.rules ?? []) {
    // Answer Lead by Example's prompt up front, so nobody gets a dialog.
    if (rule?.key === "ChoiceSet" && rule?.rollOption === "get-em") rule.selection = leadByExample ? "lead-by-example" : "not-lead-by-example";
  }
  const ownToken = actor?.getActiveTokens?.(true, true)?.[0] ?? null;
  const targetToken = tokenDocument(target?.token);
  data.system.context = {
    origin: {
      actor: actor?.uuid ?? null,
      token: ownToken?.uuid ?? null,
      item: item?.uuid ?? null,
      spellcasting: null,
      rollOptions: item?.getOriginData?.()?.rollOptions ?? [],
    },
    target: { actor: targetToken?.actor?.uuid ?? target?.actor?.uuid ?? null, token: targetToken?.uuid ?? null },
    roll: null,
  };
  return data;
}

// The Charisma bonus is for the Lead by Example Strike only. Its damage is rolled later from the card,
// so the toggle that gives it goes off after the envoy's next damage roll; later Strikes get the +1
// damage the effect gives everyone.
export function registerLeadByExampleHooks() {
  Hooks.on("createChatMessage", (message) => {
    if (message?.author?.id !== globalThis.game?.user?.id) return;
    if (systemFlags(message)?.context?.type !== "damage-roll") return;
    const actor = message?.actor;
    const effect = (actor?.itemTypes?.effect ?? []).find((entry) => entry.slug === "effect-get-em"
      && entry.system?.rules?.some?.((rule) => rule?.option === LEAD_BY_EXAMPLE_STRIKE_OPTION && rule?.value === true));
    if (!effect || typeof actor.toggleRollOption !== "function") return;
    Promise.resolve(actor.toggleRollOption("all", LEAD_BY_EXAMPLE_STRIKE_OPTION, effect.id, false))
      .catch((error) => console.warn(`${MODULE_ID} | Could not end Lead by Example:`, error));
  });
}

export async function executeGetEm({ actor, context, step, action, target, event = null, choices = {}, patch = {} }) {
  const item = action?.getEmItem ?? action?.item ?? null;
  const leadByExample = action?.activityProfile?.leadByExample === true;
  if (!target?.token) return { status: "needs-choice", choices: ["target"], patch };

  // The directive's own card, as using it from the sheet would post.
  if (typeof item?.toMessage === "function") await Promise.resolve(item.toMessage({}, { rollMode: globalThis.game?.settings?.get?.("core", "rollMode") })).catch(() => null);

  // SF2e's TokenMark marks the user's current target when the effect is created (and waits for a
  // pick when there is none), so target the creature first.
  setTarget(target.token);
  const source = await globalThis.fromUuid?.(getEmEffectUuid());
  const ops = [];
  const skipped = [];
  let envoyEffect = null;
  if (typeof source?.toObject === "function") {
    for (const recipient of beneficiaries(actor, context)) {
      if (recipient !== actor && recipient.isOwner !== true) {
        skipped.push(recipient.name);
        continue;
      }
      // One Get 'Em! at a time: a new directive replaces the last one.
      const previous = (recipient.itemTypes?.effect ?? []).filter((effect) => effect.slug === source.slug);
      if (previous.length) await recipient.deleteEmbeddedDocuments("Item", previous.map((effect) => effect.id));
      const [effect] = await recipient.createEmbeddedDocuments("Item", [getEmEffectData(source, { actor, item, target, leadByExample })]);
      if (effect?.uuid) ops.push({ kind: "effect", effectUuid: effect.uuid });
      if (recipient === actor) envoyEffect = effect ?? null;
    }
  }

  const notes = [t("Exec.GetEmApplied", "Get 'Em! on {name}: +1 to attacks against it until your next turn.", { name: target.label ?? target.token?.name ?? "" })];
  if (skipped.length) notes.push(t("Exec.GetEmSkipped", "Drag Effect: Get 'Em! onto {names} (no permission to add it).", { names: skipped.join(", ") }));

  if (leadByExample) {
    // Re-read the Strike: the one planned was prepared before Get 'Em!'s modifiers existed.
    const weaponId = action?.item?.id ?? action?.strike?.item?.id ?? null;
    const fresh = (actor?.system?.actions ?? []).find((entry) => entry?.type === "strike" && weaponId && entry?.item?.id === weaponId
      && (entry.slug ?? null) === (action?.strike?.slug ?? entry.slug ?? null));
    const variants = fresh?.variants ?? action?.variants ?? action?.strike?.variants ?? [];
    const variant = variants[strikeVariantIndex(step, action, choices)] ?? variants[0];
    if (typeof variant?.roll === "function") {
      setTarget(target.token);
      const before = globalThis.game?.messages?.contents?.length ?? 0;
      await variant.roll({ event });
      const rolled = (globalThis.game?.messages?.contents ?? []).slice(before).some((message) => systemFlags(message)?.context?.type === "attack-roll");
      notes.push(rolled
        ? t("Exec.LeadByExampleStruck", "Lead by Example: Strike rolled; its damage adds your Charisma.")
        : t("Exec.LeadByExampleNoStrike", "Lead by Example: the Strike didn't roll (check the weapon's ammunition)."));
    }
  }

  return {
    status: "done",
    patch: executionPatch(patch, "done", {
      result: notes.join(" "),
      revert: ops.length ? { ops, manualWarnings: [] } : undefined,
    }),
  };
}
