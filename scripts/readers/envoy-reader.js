// SF2e envoy Get 'Em! — Lead by Example: spend 2 actions, and Get 'Em! also Strikes the target with
// the envoy's Charisma modifier added to the damage. Built from the envoy's own ready Strikes.
import { t } from "../i18n.js";

export function getEmItem(actor) {
  const items = [...(actor?.itemTypes?.action ?? []), ...(actor?.items ?? [])];
  return items.find((item) => (item?.slug ?? item?.system?.slug) === "get-em") ?? null;
}

function charismaModifier(actor) {
  const value = Number(actor?.abilities?.cha?.mod ?? actor?.system?.abilities?.cha?.mod);
  return Number.isFinite(value) ? value : 0;
}

export function readLeadByExampleActions(actor, strikes = []) {
  const item = getEmItem(actor);
  if (!item) return [];
  const cha = charismaModifier(actor);
  return strikes
    // Not with an empty weapon: Lead by Example's Strike can't wait for a Reload.
    .filter((strike) => strike?.source === "strike" && strike?.available !== false && !strike?.requiresDrawnWeaponId && !strike?.altUsage
      && strike?.startsUnloaded !== true)
    .map((strike) => {
      const average = Number(strike.averageDamage);
      const averageDamage = Number.isFinite(average) ? average + Math.max(0, cha) : strike.averageDamage;
      return {
        ...strike,
        id: `get-em-lead-${strike.id}`,
        name: t("Action.GetEmLead", "Get 'Em! (Lead by Example: {weapon})", { weapon: strike.name }),
        tacticSlug: "get-em",
        actionCost: 2,
        executable: "get-em",
        getEmItem: item,
        averageDamage,
        damageProfile: strike.damageProfile ? { ...strike.damageProfile, average: averageDamage } : strike.damageProfile,
        activityProfile: {
          ...(strike.activityProfile ?? {}),
          includesStrike: true,
          getEm: true,
          leadByExample: true,
          attackBuff: true,
          targetMark: "get-em",
        },
        reasons: [
          t("Reason.LeadByExample", "Get 'Em! and Strike: +{cha} damage, then +1 to attacks and damage for you and your allies against the target.", { cha: Math.max(0, cha) }),
        ],
      };
    });
}
