import { SETTINGS, settingOrDefault } from "../../settings.js";
import { actionBudget } from "../../engine/action/budget.js";

// "Auto-fill for players" (world setting): the GM can keep Auto-fill from players until they are
// down to their last action or two, so it suggests a third action instead of planning the turn.
export const PLAYER_AUTO_FILL_MODES = { always: Infinity, "last-two": 2, last: 1 };

/** Whether this user may Auto-fill for the panel's creature right now. The GM always may. */
export function autoFillAllowed(context, user = globalThis.game?.user) {
  if (user?.isGM === true) return true;
  if (settingOrDefault(SETTINGS.hideAutoFillFromPlayers, false)) return false;
  const limit = PLAYER_AUTO_FILL_MODES[settingOrDefault(SETTINGS.playerAutoFillWhen, "always")] ?? Infinity;
  if (limit === Infinity) return true;
  if (!context) return false;
  // Actions actually left this turn (spent ones tracked by Combater), not counting planned steps.
  return actionBudget(context).totalActions <= limit;
}
