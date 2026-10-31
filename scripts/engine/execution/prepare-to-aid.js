import { t } from "../../i18n.js";
import { attachRevertOp, executionPatch } from "./results.js";
import { sendTurnControlRequest, turnIdentity } from "../../state/turn-controls.js";

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "");
}

// In an encounter the prepared Aid waits on the combatant, like a readied action: the turn controls
// show an Aid button until it is used or the creature's next turn starts. Resolves true once stored.
async function storePreparedAid(context, allyUuid, allyName) {
  // context.combat is a snapshot ({ id, round, turn, started }); the turn identity needs the Combat.
  const combat = globalThis.game?.combats?.get?.(context?.combat?.id) ?? context?.combat;
  const combatant = context?.combatant;
  if (!combat?.started || !combatant?.id) return false;
  try {
    const stored = await sendTurnControlRequest({
      ...turnIdentity(combat), action: "prepare-aid", readiedId: combatant.id, allyUuid, allyName,
    });
    return Boolean(stored);
  } catch (_error) {
    return false;
  }
}

// Preparing to help is the action spent on your turn; Aid itself is the reaction that follows,
// used from the turn controls. The card tells the table whom you're ready to help.
export async function executePrepareToAid({ context = null, actor, target, patch = {} }) {
  const ally = target?.token?.name ?? target?.token?.document?.name ?? target?.token?.actor?.name ?? "";
  const allyUuid = target?.token?.actor?.uuid ?? target?.token?.document?.actor?.uuid ?? "";
  const result = t("Exec.PreparedToAid", "Ready to Aid {ally}.", { ally });
  const stored = await storePreparedAid(context, allyUuid, ally);
  if (!stored) {
    globalThis.ui?.notifications?.warn?.(t("Notify.AidNotStored", "No GM is connected to hold the Aid in the turn controls; roll Aid by hand when {ally} acts.", { ally }));
  }
  const content = `<div class="pf2e-combater-aid-card">
    <div class="combater-aid-head"><i class="fa-solid fa-handshake-angle" aria-hidden="true"></i>
      <div><strong>${escapeHtml(t("Action.PrepareToAid", "Prepare to Aid"))}</strong><span>${escapeHtml(result)}</span></div></div>
  </div>`;
  const message = typeof globalThis.ChatMessage?.create === "function"
    ? await globalThis.ChatMessage.create({ speaker: globalThis.ChatMessage.getSpeaker?.({ actor }) ?? {}, content })
    : null;
  let done = { status: "done", patch: executionPatch(patch, "done", { result }) };
  const messageId = message?.id ?? message?._id ?? null;
  if (messageId) done = attachRevertOp(done, { kind: "chat", messageId });
  if (stored) done = attachRevertOp(done, { kind: "prepared-aid", combatId: context.combat.id, combatantId: context.combatant.id });
  return done;
}

// Undoing Prepare to Aid takes the waiting Aid away again; discarding it spends no reaction.
export async function revertPreparedAid(op) {
  const combat = globalThis.game?.combats?.get?.(op?.combatId);
  if (!combat || !op?.combatantId) return;
  await sendTurnControlRequest({ ...turnIdentity(combat), action: "ready-clear", readiedId: op.combatantId, used: false });
}

// PF2e: the Aid check is usually DC 15; the GM may set another one.
export const AID_DC = 15;
// PF2e's own Effect: Aid. Its ChoiceSet holds the bonus; its modifier applies to the next attack roll or skill check.
export const AID_EFFECT_UUID = "Compendium.pf2e.other-effects.Item.AHMUpMbaVkZ5A1KX";

function strikeRank(actor, strike) {
  const category = strike?.item?.category ?? strike?.item?.system?.category;
  return Number(actor?.system?.proficiencies?.attacks?.[category]?.rank) || 0;
}

// An attack Aid rolls the Strike's attack modifier against the Aid DC, not the ally's AC.
function rollStrikeCheck(actor, strike, dc, event) {
  const pf2e = globalThis.game?.pf2e;
  if (typeof pf2e?.Check?.roll !== "function" || typeof pf2e?.CheckModifier !== "function") return null;
  const label = t("Action.Aid", "Aid");
  const check = new pf2e.CheckModifier(label, strike);
  const options = new Set([...(actor?.getRollOptions?.(["all", "attack-roll"]) ?? []), "action:aid"]);
  return pf2e.Check.roll(check, {
    actor, type: "attack-roll", dc: { value: dc }, options, domains: ["all", "attack-roll"],
    title: `${label}: ${strike.label ?? strike.name ?? ""}`,
  }, event);
}

// Aid uses whatever check the GM agrees fits the help: a Strike when helping an attack, any skill,
// a Lore, or Perception. Skills and Perception come best-first; Strikes follow.
export function aidCheckOptions(actor) {
  const statistics = [
    ...Object.entries(actor?.skills ?? {}).map(([slug, statistic]) => ({ slug, statistic })),
    ...(actor?.perception ? [{ slug: "perception", statistic: actor.perception }] : []),
  ].filter(({ statistic }) => typeof statistic?.roll === "function")
    .map(({ slug, statistic }) => ({
      slug, kind: "skill", label: String(statistic.label ?? slug),
      modifier: Number(statistic.mod ?? statistic.check?.mod) || 0,
      rank: Number(statistic.rank) || 0,
      // RAW, Aid is a skill check or attack roll; Perception is only allowed if the GM says so.
      gmRuling: slug === "perception",
      roll: (dc, event) => statistic.roll({ dc: { value: dc }, label: t("Action.Aid", "Aid"), extraRollOptions: ["action:aid"], event }),
    }))
    .sort((a, b) => b.modifier - a.modifier || a.label.localeCompare(b.label));
  const strikes = (actor?.system?.actions ?? [])
    .filter((action) => action?.type === "strike" && action.visible !== false && action.ready !== false && action.slug)
    .map((strike) => ({
      slug: `strike:${strike.slug}`, kind: "strike",
      label: t("TurnControls.ReadyStrike", "Strike: {weapon}", { weapon: strike.label ?? strike.name ?? strike.slug }),
      modifier: Number(strike.totalModifier) || 0,
      rank: strikeRank(actor, strike),
      roll: (dc, event) => rollStrikeCheck(actor, strike, dc, event),
    }));
  return [...statistics, ...strikes];
}

// PF2e Aid: critical success +2 (+3 at master, +4 at legendary), success +1, failure nothing,
// critical failure −1.
export function aidBonus(degree, rank = 0) {
  if (degree === 3) return rank >= 4 ? 4 : rank >= 3 ? 3 : 2;
  if (degree === 2) return 1;
  if (degree === 0) return -1;
  return 0;
}

export async function rollAid({ actor, check, dc = AID_DC, event = null }) {
  const option = aidCheckOptions(actor).find((entry) => entry.slug === check);
  if (!option) return null;
  const roll = await option.roll(Number(dc) || AID_DC, event);
  if (!roll) return null;
  const degree = Number(roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess);
  return { roll, degree, bonus: Number.isInteger(degree) ? aidBonus(degree, option.rank) : 0 };
}

const ATTACK_ROLL = "attack-roll";

// Aid's trigger is the ally's skill check or attack roll, and only that check gets the bonus. It
// needn't match the aider's own check (Athletics can help a Strike), so it is chosen separately.
// Each slug is also the PF2e modifier selector for that check.
export function aidedCheckOptions(ally) {
  const attack = { slug: ATTACK_ROLL, label: t("TurnControls.AidAttackRoll", "Attack roll") };
  const config = globalThis.CONFIG?.PF2E?.skills ?? {};
  const skills = Object.keys(ally?.skills ?? {}).length
    ? Object.entries(ally.skills).map(([slug, statistic]) => ({ slug, label: String(statistic?.label ?? slug) }))
    : Object.entries(config).map(([slug, entry]) => ({ slug, label: globalThis.game?.i18n?.localize?.(entry?.label ?? entry) ?? slug }));
  // A Perception check isn't a skill check, so helping one is the GM's call, as for the aider's own roll.
  const perception = {
    slug: "perception", gmRuling: true,
    label: String(ally?.perception?.label ?? t("TurnControls.AidPerception", "Perception")),
  };
  return [attack, ...skills.sort((a, b) => a.label.localeCompare(b.label)), perception];
}

// Helping with a Strike usually means helping an attack; helping with a skill usually means the
// same skill. The player can change it.
export function defaultAidedCheck(check, aidedOptions) {
  const slug = String(check ?? "");
  if (aidedOptions.some((option) => option.slug === slug)) return slug;
  return ATTACK_ROLL;
}

// The ChoiceSet's selection is filled in, so the ally isn't asked to pick their own bonus. With an
// aided check, the bonus applies only to that check and the effect is named after it.
export function aidEffectSource(effect, bonus, originUuid = null, aided = null) {
  const source = typeof effect?.toObject === "function" ? effect.toObject() : structuredClone(effect ?? {});
  delete source._id;
  source.system ??= {};
  source.system.rules = (source.system.rules ?? []).map((rule) => {
    if (rule?.key === "ChoiceSet" && rule.flag === "aidBonus") return { ...rule, selection: bonus };
    if (rule?.key === "FlatModifier" && aided?.slug) return { ...rule, selector: [aided.slug] };
    return rule;
  });
  if (aided?.label) source.name = `${source.name}: ${aided.label}`;
  if (originUuid) source.system.context = { ...(source.system.context ?? {}), origin: { ...(source.system.context?.origin ?? {}), actor: originUuid } };
  source.flags ??= {};
  source.flags.system = { ...(source.flags.system ?? {}), rulesSelections: { ...(source.flags.system?.rulesSelections ?? {}), aidBonus: bonus } };
  return source;
}

// Runs on a client that can edit the ally: the ally's owner, or the GM through the socket.
export async function applyAidEffect({ allyUuid, bonus, originUuid = null, aided = null }) {
  if (!bonus) return false;
  const ally = await globalThis.fromUuid?.(allyUuid);
  const effect = await globalThis.fromUuid?.(AID_EFFECT_UUID);
  if (typeof ally?.createEmbeddedDocuments !== "function" || !effect) return false;
  const created = await ally.createEmbeddedDocuments("Item", [aidEffectSource(effect, bonus, originUuid, aided)]);
  return created.length > 0;
}
