import { t } from "../../i18n.js";
import { executionPatch } from "./results.js";

// SF2e Area Fire / Auto-Fire: the area is already placed and its creatures targeted (prepareAreaExecution).
// The system's own variant posts the attack card with the Reflex save, damage and template buttons.
export async function executeAreaFire({ action, event = null, patch = {} }) {
  const variant = action?.strike?.variants?.[0] ?? action?.variants?.[0] ?? null;
  if (typeof variant?.roll !== "function") {
    const error = t("Exec.NoAreaFireApi", "The system's Area Fire roll is not available.");
    return { status: "failed", patch: executionPatch(patch, "failed", { error }), error };
  }
  const nativeResult = await variant.roll({ event });
  return {
    status: "done",
    patch: executionPatch(patch, "done", {
      result: t("Exec.AreaFirePosted", "{name} posted: targets roll basic Reflex saves from the card.", { name: action?.name ?? "" }),
    }),
    nativeResult,
  };
}
