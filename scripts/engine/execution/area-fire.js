import { t } from "../../i18n.js";
import { executionPatch } from "./results.js";
import { canvasTokenById, setTokenTargets, targetTokenId } from "./targets.js";
import { contextEnemies } from "../target-pool.js";
import { strikeVariantIndex } from "./strike.js";
import { MODULE_ID } from "../../constants.js";
import { systemFlags } from "../../system.js";
import { PRIMARY_TARGET_FLAG } from "../../rules/suppressing-fire.js";

function center(token) {
  const point = token?.center ?? token?.object?.center;
  const x = Number(point?.x);
  const y = Number(point?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

const distance = (left, right) => (left && right ? Math.hypot(left.x - right.x, left.y - right.y) : Infinity);

// SF2e Primary Target: the creature in the area closest to the burst's center, or to the shooter for
// a cone or line. Only enemies: the soldier picks a foe, not an ally caught in the blast.
export function primaryTargetToken({ context, action, tokens, marker }) {
  const enemyIds = new Set(contextEnemies(context).flatMap((enemy) => [enemy?.id, enemy?.token?.id, enemy?.token?.uuid]).filter(Boolean).map(String));
  const enemies = tokens.filter((token) => [token?.id, token?.document?.id, token?.uuid, token?.document?.uuid]
    .filter(Boolean).some((id) => enemyIds.has(String(id))));
  if (!enemies.length) return null;
  const type = String(action?.targetingProfile?.type ?? "").toLowerCase();
  const anchor = type === "burst"
    ? (marker?.center ?? null)
    : (context?.token?.center ?? null);
  if (!anchor) return enemies[0];
  return enemies.toSorted((left, right) => distance(center(left), anchor) - distance(center(right), anchor))[0];
}

function strikeOutcome(message) {
  const outcome = String(systemFlags(message)?.context?.outcome ?? "");
  if (outcome === "success" || outcome === "criticalSuccess") return "hit";
  if (outcome === "failure" || outcome === "criticalFailure") return "miss";
  const degree = Number(message?.rolls?.[0]?.options?.degreeOfSuccess);
  return Number.isFinite(degree) ? (degree >= 2 ? "hit" : "miss") : null;
}

// The attack-roll card the Primary Target Strike just posted (SF2e's roll resolves to nothing).
function newAttackCard(before) {
  const messages = globalThis.game?.messages?.contents ?? [];
  return messages.slice(before).findLast((message) => systemFlags(message)?.context?.type === "attack-roll") ?? null;
}

// SF2e Area Fire / Auto-Fire: the area is already placed and its creatures targeted (prepareAreaExecution).
// The system's own variant posts the attack card with the Reflex save, damage and template buttons.
export async function executeAreaFire({ context = null, action, step = null, choices = {}, event = null, patch = {} }) {
  const variant = action?.strike?.variants?.[0] ?? action?.variants?.[0] ?? null;
  if (typeof variant?.roll !== "function") {
    const error = t("Exec.NoAreaFireApi", "The system's Area Fire roll is not available.");
    return { status: "failed", patch: executionPatch(patch, "failed", { error }), error };
  }

  const notes = [];
  const areaTokens = (patch.targetTokenIds ?? []).map((id) => canvasTokenById(id)).filter(Boolean);
  // Primary Target: a free ranged Strike with the same weapon first. It doesn't add to the MAP.
  const primaryVariants = action?.primaryStrike?.variants ?? [];
  if (action?.activityProfile?.primaryTarget === true && primaryVariants.length && areaTokens.length) {
    const primary = primaryTargetToken({ context, action, tokens: areaTokens, marker: patch.areaMarker });
    const strikeVariant = primaryVariants[strikeVariantIndex(step, action, choices)] ?? primaryVariants[0];
    if (primary && typeof strikeVariant?.roll === "function") {
      setTokenTargets([primary]);
      const before = globalThis.game?.messages?.contents?.length ?? 0;
      await strikeVariant.roll({ event });
      const card = newAttackCard(before);
      // Marks the card so Suppressing Fire knows a hit turns this creature's success into a failure.
      if (card && typeof card.setFlag === "function") await card.setFlag(MODULE_ID, PRIMARY_TARGET_FLAG, true).catch(() => null);
      const outcome = card ? strikeOutcome(card) : null;
      const name = primary.name ?? primary.document?.name ?? "";
      notes.push(outcome === "hit"
        ? t("Exec.PrimaryTargetHit", "Primary Target {name} was hit: its success on the save counts as a failure.", { name })
        : outcome === "miss"
          ? t("Exec.PrimaryTargetMiss", "Primary Target {name} was missed.", { name })
          : t("Exec.PrimaryTargetRolled", "Primary Target Strike rolled against {name}.", { name }));
      setTokenTargets(areaTokens);
    }
  }

  const nativeResult = await variant.roll({ event });
  if (action?.activityProfile?.suppressingFire === true && areaTokens.length) {
    notes.push(t("Exec.SuppressingFireReminder", "Suppressing Fire: enemies who fail the save become Suppressed until your next turn (applied when they roll)."));
  }
  const result = [
    t("Exec.AreaFirePosted", "{name} posted: targets roll basic Reflex saves from the card.", { name: action?.name ?? "" }),
    ...notes,
  ].join(" ");
  return {
    status: "done",
    patch: executionPatch({ ...patch, targetTokenIds: areaTokens.map((token) => targetTokenId(token)).filter(Boolean) }, "done", { result }),
    nativeResult,
  };
}
