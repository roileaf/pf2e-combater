import { MODULE_ID } from "../../constants.js";
import { SETTINGS, settingOrDefault } from "../../settings.js";

// A creature a player at the table controls: its player plans its turn, not the GM.
function hasActivePlayerOwner(actor) {
  const users = Array.from(globalThis.game?.users ?? []);
  return users.some((user) => user?.active && !user.isGM && actor?.testUserPermission?.(user, "OWNER"));
}

// "Auto-fill at turn start" (client setting): when the turn that just started is this user's to
// plan and the panel shows it with an empty plan, fill it as the Auto-fill button would. A plan
// already made is never replaced; the GM leaves player characters to their players.
export function shouldAutoFillOnTurnStart(panel, combat = globalThis.game?.combat, user = globalThis.game?.user) {
  if (settingOrDefault(SETTINGS.autoFillOnTurnStart, false) !== true) return false;
  if (!panel || !combat?.started || !combat.combatant) return false;
  const context = panel._context;
  if (!context || context.combatant?.id !== combat.combatant.id) return false;
  const builder = panel._builder;
  if (!builder || builder.readonly === true || (builder.draft?.steps?.length ?? 0) > 0) return false;
  if (!user?.isGM && settingOrDefault(SETTINGS.hideAutoFillFromPlayers, false)) return false;
  const actor = combat.combatant.actor;
  if (!actor) return false;
  if (user?.isGM) return !hasActivePlayerOwner(actor);
  return actor.testUserPermission?.(user, "OWNER") === true;
}

function turnKey(combat) {
  return combat?.started && combat.combatant ? `${combat.id}:${combat.round}:${combat.turn}:${combat.combatant.id}` : null;
}

// Once per turn, after the panel renders: the turn hook can run before the panel shows the new
// creature (a refresh still settling, the panel opened later, or switched to it afterwards).
export function autoFillAfterRender(panel, combat = globalThis.game?.combat) {
  const key = turnKey(combat);
  if (!key || panel?._turnStartAutoFillKey === key || !shouldAutoFillOnTurnStart(panel, combat)) return false;
  panel._turnStartAutoFillKey = key;
  globalThis.setTimeout?.(() => { void autoFillOnTurnStart(panel, combat, { keyed: true }); }, 0);
  return true;
}

export async function autoFillOnTurnStart(panel, combat = globalThis.game?.combat, { keyed = false } = {}) {
  if (!shouldAutoFillOnTurnStart(panel, combat)) return false;
  const key = turnKey(combat);
  if (!keyed && panel._turnStartAutoFillKey === key) return false;
  panel._turnStartAutoFillKey = key;
  try {
    await panel._autoFillDraft({});
    return true;
  } catch (error) {
    console.warn(`${MODULE_ID} | Turn-start Auto-fill failed`, error);
    return false;
  }
}
