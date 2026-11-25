// SF2e solarian attunement. A solarian is graviton-attuned, photon-attuned or unattuned (the Stellar
// Attunement feature's "stellar-attunement" roll option). Attune (1 action, once per round) picks an
// aspect and brings back the manifestations; unattuned, the solar flare and solar weapon vanish.
// The solar flare changes with the aspect, so for each aspect the solarian isn't in, the planner also
// gets that aspect's Solar Flare, usable after an Attune to it in the same plan.
import { t } from "../i18n.js";

export const ATTUNEMENT_OPTION = "stellar-attunement";
const ASPECTS = ["photon", "graviton"];
// Solar Manifestations: photon flare 1d6 fire, 30-ft increment; graviton flare 1d8 bludgeoning, 15 ft.
export const SOLAR_FLARE = {
  photon: { range: 30, faces: 6, damageType: "fire" },
  graviton: { range: 15, faces: 8, damageType: "bludgeoning" },
};

const itemBySlug = (actor, slug) => [...(actor?.items ?? [])].find((item) => (item?.slug ?? item?.system?.slug) === slug) ?? null;

export function aspectLabel(aspect) {
  return aspect === "photon" ? t("Solarian.Photon", "Photon") : aspect === "graviton" ? t("Solarian.Graviton", "Graviton") : t("Solarian.Unattuned", "Unattuned");
}

export function currentAttunement(actor) {
  const options = typeof actor?.getRollOptions === "function" ? [...actor.getRollOptions()] : [];
  for (const option of options) {
    const match = /^stellar-attunement:(photon|graviton|unattuned)$/.exec(String(option));
    if (match) return match[1];
  }
  const rule = (itemBySlug(actor, "stellar-attunement")?.system?.rules ?? []).find((entry) => entry?.option === ATTUNEMENT_OPTION);
  return rule?.selection ?? "graviton";
}

export function solarianState(actor) {
  const feat = itemBySlug(actor, "stellar-attunement");
  const attune = itemBySlug(actor, "attune");
  if (!feat || !attune) return null;
  return { feat, attune, aspect: currentAttunement(actor) };
}

function strengthModifier(actor) {
  const value = Number(actor?.abilities?.str?.mod ?? actor?.system?.abilities?.str?.mod);
  return Number.isFinite(value) ? value : 0;
}

function attuneAvailability(item) {
  const frequency = item?.system?.frequency;
  const value = Number(frequency?.value);
  if (frequency && Number.isFinite(value) && value <= 0) {
    return { available: false, reason: t("Avail.AttuneUsed", "Already Attuned this round.") };
  }
  return { available: true, reason: "" };
}

export function readSolarianActions(actor, strikes = []) {
  const state = solarianState(actor);
  if (!state) return [];
  const { feat, attune, aspect } = state;
  const availability = attuneAvailability(attune);
  // A Solar Flare in another aspect is the current flare (or, unattuned, an unarmed Strike: same
  // proficiency) with that aspect's range and damage; it's re-read from the sheet when it runs.
  const base = strikes.find((strike) => strike?.strike?.slug === "solar-flare")
    ?? strikes.find((strike) => strike?.item?.slug === "basic-unarmed" || (strike?.traits ?? []).includes("unarmed"))
    ?? null;
  const strength = strengthModifier(actor);
  return ASPECTS.filter((next) => next !== aspect).flatMap((next) => {
    const label = aspectLabel(next);
    const attuneId = `attune-${next}`;
    const attuneAction = {
      id: attuneId,
      name: t("Action.AttuneAspect", "Attune ({aspect})", { aspect: label }),
      slug: "attune",
      tacticSlug: "attune",
      actionCost: 1,
      actionType: "action",
      source: "custom-curated",
      confidence: "high",
      executable: "attune",
      detected: true,
      available: availability.available,
      unavailableReason: availability.reason,
      item: attune,
      attuneFeat: feat,
      attuneAspect: next,
      role: "setup",
      traits: ["concentrate", "solarian"],
      activityProfile: { includes: ["setup"], attune: true, attuneAspect: next, fromUnattuned: aspect === "unattuned" },
      targetingProfile: { self: true },
      reasons: [aspect === "unattuned"
        ? t("Reason.AttuneRestores", "Attune to {aspect}: your solar manifestations return.", { aspect: label })
        : t("Reason.AttuneSwitch", "Switch to {aspect}: its solar flare and weapon benefits.", { aspect: label })],
    };
    if (!base) return [attuneAction];
    const flare = SOLAR_FLARE[next];
    const average = (flare.faces + 1) / 2 + strength;
    // Built from the fist when unattuned: keep its proficiency, not its identity (a fist fallback).
    const fromFist = base?.strike?.slug !== "solar-flare";
    const flareAction = {
      ...base,
      ...(fromFist ? { item: null, strike: null, variants: [], weaponTraits: [] } : {}),
      id: `strike-solar-flare-${next}`,
      name: t("Action.SolarFlareAspect", "Solar Flare ({aspect})", { aspect: label }),
      tacticSlug: `solar-flare-${next}`,
      altUsage: null,
      isRanged: true,
      range: { increment: flare.range, max: flare.range * 6 },
      traits: [...new Set(["attack", "attuned", "solarian", ...(base.traits ?? []).filter((trait) => !["unarmed", "agile", "finesse", "nonlethal"].includes(trait))])],
      damageProfile: { average, type: flare.damageType, types: [flare.damageType] },
      averageDamage: average,
      requiresAttunement: next,
      refreshStrikeSlug: "solar-flare",
      available: true,
      unavailableReason: "",
      activityProfile: { ...(base.activityProfile ?? {}), orderAfterKey: attuneId },
      reasons: [t("Reason.SolarFlareAspect", "Solar Flare after Attuning to {aspect}: {faces}-sided {type}, {range}-ft range increment.", { aspect: label, faces: flare.faces, type: flare.damageType, range: flare.range })],
    };
    return [attuneAction, flareAction];
  });
}
