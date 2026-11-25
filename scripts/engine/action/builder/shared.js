// Small utilities genuinely shared across the atomization, minion-row, and tab-assembly concerns
// split out of builder.js -- everything else in those three areas turned out to be single-concern
// once traced, so this file stays intentionally tiny.

export function actionBuilderKey(action) {
  return action?.id
    ?? action?.uuid
    ?? action?.item?.uuid
    ?? action?.slug
    ?? action?.name
    ?? "unknown-action";
}

export function resolveBuilderAction(key, lookup) {
  const exact = lookup(key);
  if (exact) return exact;
  // The planner gives repeated attacks unique IDs for plan search/MAP. They
  // still execute the original Strike. Older drafts saved these decorated IDs,
  // including the trailing strike atom from a repeated Reload -> Strike.
  const baseKey = String(key ?? "").replace(/-map-[1-9]\d*(?:-strike)?$/u, "");
  // SF2e: a Solar Flare planned for an aspect (strike-solar-flare-photon) is the plain Solar Flare
  // once the earlier Attune has switched to that aspect.
  if (/^strike-solar-flare-(?:photon|graviton)$/u.test(baseKey)) {
    const flare = (baseKey !== key ? lookup(baseKey) : null) ?? lookup("strike-solar-flare");
    if (flare?.source === "strike") return flare;
  }
  if (baseKey === key) return null;
  const strike = lookup(baseKey);
  return strike?.source === "strike" && !strike.activityProfile?.requiresDistinctTargets ? strike : null;
}

export function scoreValue(action) {
  const score = Number(action?.score);
  return Number.isFinite(score) ? score : 0;
}

export function actionName(action) {
  return String(action?.name ?? action?.label ?? actionBuilderKey(action));
}
