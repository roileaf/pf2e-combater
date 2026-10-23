import { collectionValues } from "../foundry-data.js";

// Conditions that stop a creature from using reactions (PF2e: "can't act", or confused's
// "can't ... use reactions"). Dying always brings unconscious, but a token can carry it alone.
const BLOCKING_CONDITIONS = ["confused", "dying", "paralyzed", "petrified", "stunned", "unconscious"];

// PF2e ships no effect items for most of these spells, so a GM-made effect is matched by its
// slug or name: "Spell Effect: Laughing Fit", "Effect: Hideous Laughter (Failure)", and so on.
const BLOCKING_EFFECTS = [
  "laughing-fit", "hideous-laughter", "infectious-comedy", "roaring-applause",
  "uncontrollable-dance", "irresistible-dance", "overwhelming-memory", "wave-of-despair",
  "spirit-song", "phantasmagoria", "faerie-dust", "airburst",
];

const slugify = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const itemSlug = (item) => slugify(item?.slug ?? item?.system?.slug);
const expired = (item) => item?.isExpired === true || item?.system?.expired === true;

// With "Reactions before first turn" off, a creature has no reaction until its first turn of the
// encounter starts: round 1, before the order reaches it. PF2e's flags.pf2e.roundOfLastTurn is not
// used, since it survives resetting or re-running an encounter. A creature that started its turn
// and Delayed (it now sits later in the order) has had its turn.
export function awaitingFirstTurn(combatant, combat = globalThis.game?.combat, { reactionsBeforeFirstTurn = true } = {}) {
  if (reactionsBeforeFirstTurn !== false || !combat?.started || !combatant) return false;
  if ((Number(combat.round) || 0) > 1) return false;
  if (combatant.flags?.["pf2e-combater"]?.delayedTurn) return false;
  const index = Array.from(combat.turns ?? []).findIndex((entry) => entry?.id === combatant.id);
  return index < 0 || index > Number(combat.turn);
}

// What keeps this actor from reacting ({ slug, name }), or null when it can react.
export function reactionBlock(actor) {
  const condition = collectionValues(actor?.itemTypes?.condition).find((item) => !expired(item)
    && item.active !== false && BLOCKING_CONDITIONS.includes(itemSlug(item)));
  if (condition) return { slug: itemSlug(condition), name: condition.name ?? itemSlug(condition) };
  const effect = collectionValues(actor?.itemTypes?.effect).find((item) => {
    if (expired(item)) return false;
    const keys = [itemSlug(item), slugify(item.name)];
    return BLOCKING_EFFECTS.some((slug) => keys.some((key) => key.includes(slug)));
  });
  return effect ? { slug: itemSlug(effect) || slugify(effect.name), name: effect.name } : null;
}
