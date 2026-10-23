// PF2e Guarder tracks a guardian's reactions itself: a general one plus guardian-only ones (Reaction
// Time, Ever Ready, Boundless Reprisals). For guardians, Combater shows and spends Guarder's pool
// instead of its own marker, so the two never disagree.
const GUARDER_ID = "pf2e-guarder";

function guarderApi() {
  const module = globalThis.game?.modules?.get?.(GUARDER_ID);
  return module?.active ? module.api ?? null : null;
}

// Guarder's own test for a guardian: the actor has Intercept Attack. Its API answers for any
// combatant, so Combater must not take every creature's reactions from it.
export function isGuarderGuardian(actor) {
  if (typeof guarderApi()?.isGuardian === "function") {
    try { return guarderApi().isGuardian(actor) === true; } catch (_error) { /* fall through */ }
  }
  const items = actor?.items?.contents ?? (Array.isArray(actor?.items) ? actor.items : Array.from(actor?.items?.values?.() ?? []));
  return items.some((item) => (item?.slug ?? item?.system?.slug) === "intercept-attack");
}

// { general, guardian, boundless } while Guarder tracks this guardian's reactions, else null.
export function guarderReactionPool(actor) {
  const api = guarderApi();
  if (!actor || typeof api?.reactions !== "function" || !isGuarderGuardian(actor)) return null;
  try {
    const pool = api.reactions(actor);
    return pool && typeof pool === "object" ? pool : null;
  } catch (_error) {
    return null;
  }
}

// The reaction slots that exist right now ({ general, guardian, boundless }): Ever Ready at
// initiative is one guardian-only slot, not a general one too. Null on older Guarder.
export function guarderReactionLimit(actor) {
  const api = guarderApi();
  if (!actor || typeof api?.reactionLimit !== "function" || !isGuarderGuardian(actor)) return null;
  try {
    const limit = api.reactionLimit(actor);
    return limit && typeof limit === "object" ? limit : null;
  } catch (_error) {
    return null;
  }
}

export function guarderReactionsLeft(pool) {
  if (!pool) return 0;
  return (Number(pool.general) || 0) + (Number(pool.guardian) || 0) + (Number(pool.boundless) || 0);
}

// Spend one (guardian-only first, as Guarder's own badge does) or give one back.
export async function adjustGuarderReaction(actor, delta) {
  const api = guarderApi();
  if (!api) return false;
  if (delta > 0 && typeof api.spendReaction === "function") return api.spendReaction(actor);
  if (delta < 0 && typeof api.restoreReaction === "function") return api.restoreReaction(actor);
  const pool = guarderReactionPool(actor);
  if (!pool || typeof api.setReactions !== "function") return false;
  const next = { ...pool };
  if (delta > 0) {
    if (next.boundless > 0) next.boundless -= 1;
    else if (next.guardian > 0) next.guardian -= 1;
    else if (next.general > 0) next.general -= 1;
    else return false;
  } else {
    next.general = (Number(next.general) || 0) + 1;
  }
  await api.setReactions(actor, next);
  return true;
}
