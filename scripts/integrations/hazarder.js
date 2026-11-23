// PF2e Hazarder integration: on a character's turn, offer "Disable <hazard>" steps for the hazards
// Hazarder tracks, and roll them through Hazarder so it applies the result to the hazard. Hazarder
// plans the hazard's own turn; Combater never does (hazards are not plannable actors).
import { t } from "../i18n.js";
import { footprintPathDistanceFeet } from "../rules/token-geometry.js";

const HAZARDER_ID = "pf2e-hazarder";
export const HAZARD_DISABLE_SLUG = "disable-hazard";
export const HAZARD_DISABLE_EXECUTABLE = "hazard-disable";

// Disable a Device (and Thievery) is hands-on; other disables (Religion to banish a haunt, Arcana
// to unravel a rune) work from nearby.
const HANDS_ON_REACH_FEET = 5;
const NEARBY_FEET = 30;

export function hazarderApi() {
  const module = globalThis.game?.modules?.get?.(HAZARDER_ID);
  const api = module?.active ? module.api ?? null : null;
  return typeof api?.hazards === "function" ? api : null;
}

export function hazarderHazards(api = hazarderApi()) {
  if (!api) return [];
  try {
    const hazards = api.hazards();
    return Array.isArray(hazards) ? hazards : [];
  } catch (_error) {
    return [];
  }
}

export function hazarderCanAttempt(api, actor, option) {
  if (typeof api?.canAttempt !== "function") return { ok: true, reason: null, rank: null };
  try {
    const result = api.canAttempt(actor, option);
    return result && typeof result === "object" ? result : { ok: false, reason: null, rank: null };
  } catch (_error) {
    return { ok: false, reason: null, rank: null };
  }
}

// The actor's modifier for the option's statistic (a skill, lore, Perception or a save), or null.
function statisticModifier(actor, skill) {
  try {
    const statistic = typeof actor?.getStatistic === "function" ? actor.getStatistic(skill) : null;
    const mod = Number(statistic?.check?.mod ?? statistic?.mod);
    return Number.isFinite(mod) ? mod : null;
  } catch (_error) {
    return null;
  }
}

function handsOn(option) {
  const traits = (option?.traits ?? []).map((trait) => String(trait).toLowerCase());
  return traits.includes("action:disable-a-device") || traits.includes("manipulate")
    || String(option?.skill ?? "").toLowerCase() === "thievery";
}

export function hazardOptionReach(option) {
  return handsOn(option) ? HANDS_ON_REACH_FEET : NEARBY_FEET;
}

function defaultResolveToken(uuid) {
  try {
    const document = globalThis.fromUuidSync?.(uuid);
    return document?.object ?? null;
  } catch (_error) {
    return null;
  }
}

// Edge-to-edge distance from the acting token to the hazard token, or null without a canvas.
function hazardDistance(context, hazardToken) {
  const origin = context?.token;
  const center = hazardToken?.center;
  if (!origin?.center || !center) return null;
  const document = hazardToken.document ?? hazardToken;
  const value = { width: Number(document?.width ?? 1) || 1, height: Number(document?.height ?? 1) || 1 };
  const distance = footprintPathDistanceFeet(origin.center, origin, center, value);
  return Number.isFinite(distance) ? distance : null;
}

// How good this actor is at an option: the modifier over the DC when the DC is known, else the bare
// modifier. Used only to pick one option per hazard part.
function optionEdge(option, modifier) {
  const mod = modifier ?? -Infinity;
  return knownDc(option?.dc) !== null ? mod - knownDc(option.dc) : mod - 20;
}

// A DC players may see, or null (PF2e hides DCs from players by default).
function knownDc(value) {
  if (value === null || value === undefined || value === "") return null;
  const dc = Number(value);
  return Number.isFinite(dc) ? dc : null;
}

function stepName(hazard, option) {
  const what = option.instanceLabel ? `${hazard.name} (${option.instanceLabel})` : hazard.name;
  return t("Hazard.DisableName", "Disable {hazard}: {option}", { hazard: what, option: option.label ?? option.skill });
}

/**
 * One "Disable <hazard>" candidate per tracked hazard part this actor can work on: the open option
 * it is best at. Nothing when Hazarder is absent.
 */
export function readHazardDisableActions(actor, context, { api = hazarderApi(), resolveToken = defaultResolveToken } = {}) {
  if (!api || !actor || actor.type === "hazard") return [];
  const actions = [];
  for (const hazard of hazarderHazards(api)) {
    if (!hazard || hazard.disabled === true || hazard.status === "disabled") continue;
    const parts = new Map();
    for (const option of hazard.options ?? []) {
      if (!option || !(Number(option.successesLeft) > 0)) continue;
      const attempt = hazarderCanAttempt(api, actor, option);
      if (attempt?.ok !== true) continue;
      const modifier = statisticModifier(actor, option.skill);
      const best = parts.get(option.instanceKey);
      if (!best || optionEdge(option, modifier) > optionEdge(best.option, best.modifier)) {
        parts.set(option.instanceKey, { option, modifier, rank: attempt.rank ?? null });
      }
    }
    if (!parts.size) continue;
    const hazardToken = resolveToken(hazard.tokenUuid);
    const distance = hazardDistance(context, hazardToken);
    for (const { option, modifier, rank } of parts.values()) {
      const reach = hazardOptionReach(option);
      const inReach = distance === null || distance <= reach;
      actions.push({
        id: `${HAZARD_DISABLE_SLUG}:${hazard.tokenId}:${option.instanceKey}:${option.disableId}`,
        name: stepName(hazard, option),
        slug: HAZARD_DISABLE_SLUG,
        actionCost: 1,
        actionType: "action",
        source: "generic",
        confidence: "high",
        executable: HAZARD_DISABLE_EXECUTABLE,
        detected: true,
        available: inReach,
        unavailableReason: inReach ? "" : t("Hazard.OutOfReach", "{hazard} is {distance} ft away; move within {reach} ft to disable it.", {
          hazard: hazard.name, distance: Math.round(distance), reach,
        }),
        item: null,
        role: "hazard-disable",
        // No top-level `skill`: Combater's trained-skill gate would hide untrained-legal disables and
        // every Perception, save or lore option. Hazarder's canAttempt already enforced the rank.
        traits: [...(option.traits ?? [])],
        targetingProfile: { self: false, enemy: false, ally: false },
        hazardDisable: {
          tokenUuid: hazard.tokenUuid,
          tokenId: hazard.tokenId,
          hazardName: hazard.name,
          status: hazard.status,
          instanceKey: option.instanceKey,
          instanceLabel: option.instanceLabel ?? null,
          disableId: option.disableId,
          label: option.label ?? option.skill,
          skill: option.skill,
          dc: knownDc(option.dc),
          modifier,
          rank,
          successesLeft: Number(option.successesLeft) || 0,
          distance,
          reach,
        },
      });
    }
  }
  return actions;
}

/** Rolls a planned disable through Hazarder, which applies the result to the hazard. */
export async function rollHazardDisable(action, actor, { event = null, api = hazarderApi() } = {}) {
  const plan = action?.hazardDisable;
  if (!plan || typeof api?.rollDisable !== "function") return null;
  try {
    return await api.rollDisable({
      tokenUuid: plan.tokenUuid,
      instanceKey: plan.instanceKey,
      disableId: plan.disableId,
      actor,
      rollParams: event ? { event } : {},
    });
  } catch (error) {
    console.warn("pf2e-combater | Hazarder disable roll failed:", error);
    return null;
  }
}

// An updateToken change that moves a tracked hazard's state (progress, status, triggered).
export function tokenUpdateChangesHazarderState(changed) {
  const flags = changed?.flags?.[HAZARDER_ID];
  return Boolean(flags && ("state" in flags || "-=state" in flags));
}
