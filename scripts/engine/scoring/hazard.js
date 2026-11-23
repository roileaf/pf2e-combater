import { t } from "../../i18n.js";

// How much stopping a hazard is worth this turn, by Hazarder's status: an active or triggered hazard
// is hurting the party now; an armed one hasn't gone off yet.
const THREAT_VALUE = { active: 28, triggered: 28, armed: 10 };
const FALLBACK_THREAT = 6;
// The last success disables the part: worth a little more than chipping at a long total.
const FINISHING_BONUS = 10;
// Kept below a good Strike: an even-odds disable on an active hazard lands around +10 over the
// generic base, a sure one around +30.
const OFFSET = -6;
const UNKNOWN_DC_CHANCE = 0.5;

// PF2e check odds (success or better) against a DC, with the natural 1 and 20 bounds.
export function hazardDisableSuccessChance(modifier, dc) {
  if (!Number.isFinite(Number(modifier)) || dc === null || dc === undefined || !Number.isFinite(Number(dc))) return null;
  return Math.min(0.95, Math.max(0.05, (Number(modifier) + 21 - Number(dc)) / 20));
}

/** SLUG_TACTICS entry for "disable-hazard" candidates from the Hazarder integration. */
export function hazardDisableTactic(acc, { action }) {
  const plan = action?.hazardDisable;
  if (!plan) return;
  const chance = hazardDisableSuccessChance(plan.modifier, plan.dc);
  const threat = THREAT_VALUE[plan.status] ?? FALLBACK_THREAT;
  const finishing = plan.successesLeft <= 1 ? FINISHING_BONUS : 0;
  const odds = chance ?? UNKNOWN_DC_CHANCE;
  acc.score += Math.round(odds * (threat + finishing)) + OFFSET;

  if (plan.status === "active" || plan.status === "triggered") {
    acc.reasons.push(t("ScoreReason.HazardActive", "{hazard} is active.", { hazard: plan.hazardName }));
  } else {
    acc.reasons.push(t("ScoreReason.HazardArmed", "{hazard} hasn't gone off yet.", { hazard: plan.hazardName }));
  }
  if (chance === null) {
    acc.reasons.push(t("ScoreReason.HazardDcUnknown", "Disable DC unknown; odds assumed even."));
  } else {
    acc.reasons.push(t("ScoreReason.HazardDisableChance", "About {percent}% to succeed.", { percent: Math.round(chance * 100) }));
  }
  acc.reasons.push(plan.successesLeft <= 1
    ? t("ScoreReason.HazardOneMore", "One more success disables it.")
    : t("ScoreReason.HazardSuccessesLeft", "{count} successes still needed.", { count: plan.successesLeft }));
}
