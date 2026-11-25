import { attachRevertOp } from "./results.js";
import { setTarget } from "./targets.js";

// An action whose self-effect marks a creature (SF2e Aim: Effect: Aim carries a TokenMark and the
// precision dice). Posting the action only shows an "apply effect" button; apply it here with the
// planned target in its context, which is what the TokenMark reads.
export async function applyTargetMarkSelfEffect({ actor, action, target, result }) {
  if (result?.status !== "done") return result;
  const item = action?.item ?? null;
  const uuid = item?.system?.selfEffect?.uuid;
  const targetToken = target?.token?.document ?? target?.token ?? null;
  if (!uuid || !targetToken?.uuid || typeof actor?.createEmbeddedDocuments !== "function") return result;
  // SF2e's TokenMark marks the user's current target on creation (and waits for a pick without one).
  setTarget(target?.token);
  const source = await globalThis.fromUuid?.(uuid);
  if (typeof source?.toObject !== "function") return result;
  // Aim again moves the mark: drop the previous copy of this effect first.
  const previous = (actor.itemTypes?.effect ?? []).filter((effect) => effect.slug === source.slug);
  if (previous.length) await actor.deleteEmbeddedDocuments("Item", previous.map((effect) => effect.id));
  const ownToken = actor.getActiveTokens?.(true, true)?.[0] ?? null;
  const data = source.toObject();
  data._id = null;
  data.system.context = {
    origin: {
      actor: actor.uuid,
      token: ownToken?.uuid ?? null,
      item: item.uuid ?? null,
      spellcasting: null,
      rollOptions: item.getOriginData?.()?.rollOptions ?? [],
    },
    target: { actor: targetToken.actor?.uuid ?? target?.actor?.uuid ?? null, token: targetToken.uuid },
    roll: null,
  };
  const [effect] = await actor.createEmbeddedDocuments("Item", [data]);
  return attachRevertOp(result, effect?.uuid ? { kind: "effect", effectUuid: effect.uuid } : null);
}
