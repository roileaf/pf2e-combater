import { contextActorDocument } from "./actor-context.js";

function selfIds(context) {
  const actor = contextActorDocument(context);
  return new Set([actor?.uuid, actor?.id, context?.actor?.uuid, context?.actor?.id, context?.actorId].filter(Boolean));
}

// Maul, Constrict: the target must be grabbed by this creature. PF2e names the grabber as the
// condition's origin; with no origin recorded, a grab only holds while the grabber is within reach.
export function grabbedBySelf(context, target, reach = 5) {
  const origins = ["grabbed", "restrained"].flatMap((slug) => target?.conditions?.origins?.[slug] ?? []);
  if (origins.length) {
    const ids = selfIds(context);
    // A token actor's uuid names its token; only a world actor's ("Actor.<id>") is matched by id,
    // so two unlinked pumas of one base actor aren't each other's grabber.
    return origins.some((origin) => ids.has(origin) || (/^Actor\.[^.]+$/.test(origin) && ids.has(origin.slice(6))));
  }
  const distance = Number(target?.distance);
  return !Number.isFinite(distance) || distance <= Math.max(5, Number(reach) || 5);
}
