import { MODULE_ID } from "../../constants.js";
import { t } from "../../i18n.js";

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "");
}

export async function createGuidance(action, actor) {
  const content = `<strong>${escapeHtml(action?.name ?? t("Exec.ActionName", "Action"))}</strong><br>${escapeHtml(action?.reason ?? t("Exec.ReviewActionLong", "Review this action before resolving it."))}`;
  if (globalThis.ChatMessage?.create) {
    // A reaction resolved by hand still spends the creature's reaction; the tracker reads this flag.
    const reaction = [action?.actionCost, action?.actionType, action?.activationActionCost].includes("reaction");
    await globalThis.ChatMessage.create({
      speaker: globalThis.ChatMessage.getSpeaker?.({ actor }) ?? {},
      content,
      whisper: globalThis.game?.user?.id ? [globalThis.game.user.id] : undefined,
      ...(reaction ? { flags: { [MODULE_ID]: { reactionUse: true } } } : {}),
    });
    return true;
  }
  globalThis.ui?.notifications?.info?.(`${action?.name ?? t("Exec.ActionName", "Action")}: ${action?.reason ?? t("Exec.ReviewAction", "Review this action.")}`);
  return true;
}
