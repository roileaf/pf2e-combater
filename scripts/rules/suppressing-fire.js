// SF2e soldier Suppressing Fire: enemies who fail their save against the soldier's area attack
// (Area Fire, Auto-Fire) are Suppressed until the start of the soldier's next turn. The system only
// shows a note; Combater applies the condition on the save and removes it when that turn starts.
import { MODULE_ID } from "../constants.js";
import { systemFlags } from "../system.js";

export const SUPPRESSED_BY_FLAG = "suppressedBy";
export const PRIMARY_TARGET_FLAG = "primaryTarget";
const FAILED = new Set(["failure", "criticalFailure", "criticalfailure"]);

function hasSuppressingFire(actor) {
  const items = [...(actor?.itemTypes?.feat ?? []), ...(actor?.items ?? [])];
  return items.some((item) => (item?.slug ?? item?.system?.slug) === "suppressing-fire");
}

function contextOptions(context) {
  const options = context?.options;
  return Array.isArray(options) ? options.map(String) : options instanceof Set ? [...options].map(String) : [];
}

// Is this save answering an area weapon attack? SF2e's Area Fire / Auto-Fire card rolls a basic Reflex
// save whose origin is the weapon itself (no action slug in its options), and nothing else in SF2e asks
// for a save from a weapon. An action slug, when present, also counts.
function answersAreaAttack(context, flags) {
  const options = contextOptions(context);
  if (options.some((option) => /(?:^|:)(area-fire|auto-fire)$/.test(option))) return true;
  const reflex = (context?.domains ?? []).includes("reflex") || options.includes("check:statistic:reflex");
  const fromWeapon = flags?.origin?.type === "weapon" || options.includes("item:type:weapon");
  return reflex && fromWeapon;
}

function originActorUuid(flags) {
  return flags?.context?.origin?.actor ?? flags?.origin?.actor ?? null;
}

// { soldierUuid, target } when this chat message is a failed save against a Suppressing Fire area attack.
// A recent Primary Target Strike by this soldier that hit this creature.
function primaryTargetHit(soldierUuid, targetToken, messages) {
  const tokenId = String(targetToken ?? "").split(".").at(-1);
  if (!tokenId) return false;
  return messages.slice(-30).some((message) => {
    if (message?.flags?.[MODULE_ID]?.[PRIMARY_TARGET_FLAG] !== true) return false;
    const context = systemFlags(message)?.context ?? {};
    const by = context.origin?.actor ?? systemFlags(message)?.origin?.actor ?? null;
    const at = String(context.target?.token ?? "").split(".").at(-1);
    return by === soldierUuid && at === tokenId && ["success", "criticalSuccess"].includes(String(context.outcome ?? ""));
  });
}

export function suppressingFireFailure(message, {
  resolveActor = (uuid) => globalThis.fromUuidSync?.(uuid) ?? null,
  messages = globalThis.game?.messages?.contents ?? [],
} = {}) {
  const flags = systemFlags(message);
  const context = flags?.context;
  if (context?.type !== "saving-throw") return null;
  const outcome = String(context.outcome ?? "");
  if (!FAILED.has(outcome) && outcome !== "success") return null;
  if (!answersAreaAttack(context, flags)) return null;
  const soldierUuid = originActorUuid(flags);
  const soldier = soldierUuid ? resolveActor(soldierUuid) : null;
  if (!soldier || !hasSuppressingFire(soldier)) return null;
  const target = message?.actor ?? null;
  if (!target || target.uuid === soldier.uuid) return null;
  // Enemies only.
  if (typeof target.isAllyOf === "function" && target.isAllyOf(soldier)) return null;
  // Primary Target: after its Strike hit, this creature's success counts as a failure.
  if (outcome === "success" && !primaryTargetHit(soldier.uuid, context?.token ?? message?.speaker?.token, messages)) return null;
  return { soldierUuid: soldier.uuid, target, primaryTarget: outcome === "success" };

}

export async function applySuppressed({ soldierUuid, target }) {
  if (typeof target?.increaseCondition !== "function") return null;
  const existing = (target.itemTypes?.condition ?? []).find((condition) => condition.slug === "suppressed");
  const condition = existing ?? await target.increaseCondition("suppressed");
  const created = condition ?? (target.itemTypes?.condition ?? []).find((entry) => entry.slug === "suppressed");
  // Remember who suppressed it, so it ends at that soldier's next turn (and a lasting one isn't touched).
  if (!existing && typeof created?.setFlag === "function") await created.setFlag(MODULE_ID, SUPPRESSED_BY_FLAG, soldierUuid);
  return created ?? null;
}

// At the start of the soldier's turn: the Suppressed it applied ends.
export async function endSuppressionBy(soldierUuid, actors) {
  const removed = [];
  for (const actor of actors) {
    for (const condition of actor?.itemTypes?.condition ?? []) {
      if (condition.slug !== "suppressed") continue;
      if (condition.flags?.[MODULE_ID]?.[SUPPRESSED_BY_FLAG] !== soldierUuid) continue;
      await condition.delete();
      removed.push(actor);
    }
  }
  return removed;
}

export function registerSuppressingFireHooks() {
  Hooks.on("createChatMessage", (message) => {
    // One writer: the active GM's client.
    if (globalThis.game?.user?.isActiveGM !== true) return;
    const failure = suppressingFireFailure(message);
    if (!failure) return;
    applySuppressed(failure).catch((error) => console.warn(`${MODULE_ID} | Could not apply Suppressed:`, error));
  });
  Hooks.on("combatTurnChange", (combat) => {
    if (globalThis.game?.user?.isActiveGM !== true) return;
    const soldier = combat?.combatant?.actor;
    if (!soldier?.uuid) return;
    const actors = (combat.combatants?.contents ?? [...(combat.combatants ?? [])]).map((combatant) => combatant.actor).filter(Boolean);
    endSuppressionBy(soldier.uuid, actors).catch((error) => console.warn(`${MODULE_ID} | Could not end Suppressed:`, error));
  });
}
