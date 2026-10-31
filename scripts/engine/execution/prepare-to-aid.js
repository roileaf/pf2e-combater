import { t } from "../../i18n.js";
import { attachRevertOp, executionPatch } from "./results.js";

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "");
}

// Preparing to help is the action spent on your turn; Aid itself is the reaction that follows,
// rolled from PF2e's own Aid when the ally acts. So this only announces who is ready to help.
export async function executePrepareToAid({ actor, target, patch = {} }) {
  const ally = target?.token?.name ?? target?.token?.document?.name ?? target?.token?.actor?.name ?? "";
  const result = t("Exec.PreparedToAid", "Ready to Aid {ally}.", { ally });
  const content = `<strong>${escapeHtml(t("Action.PrepareToAid", "Prepare to Aid"))}</strong><br>${escapeHtml(result)}`;
  const message = typeof globalThis.ChatMessage?.create === "function"
    ? await globalThis.ChatMessage.create({ speaker: globalThis.ChatMessage.getSpeaker?.({ actor }) ?? {}, content })
    : null;
  const done = { status: "done", patch: executionPatch(patch, "done", { result }) };
  const messageId = message?.id ?? message?._id ?? null;
  return messageId ? attachRevertOp(done, { kind: "chat", messageId }) : done;
}
