import { t } from "../i18n.js";
import { requestRecoveryDc } from "../socket.js";
import { RECOVERY_DC, fittingRecoveryDc } from "../engine/execution/assisted-recovery.js";

const escapeHtml = (value) => globalThis.foundry.utils.escapeHTML(String(value ?? ""));

function dialogClasses() {
  return ["pf2e-combater-delay-dialog", "pf2e-combater-ready-dialog"];
}

// PF2e's metagame setting decides whether players see check DCs; the GM always does.
function dcsVisible() {
  return globalThis.game?.user?.isGM === true || globalThis.game?.pf2e?.settings?.metagame?.dcs !== false;
}

function damageOptionLabel(damage) {
  if (!dcsVisible()) return damage.label ?? "";
  return t("AssistedRecovery.DamageOption", "{damage} (DC {dc})", { damage: damage.label, dc: damage.dc ?? RECOVERY_DC });
}

// The helper says which persistent damage they help with (when there are several); how they help
// is said at the table. The DC is the damage's own; a GM helping also rules here: the help counts,
// is especially fitting (DC 10), or ends the damage outright.
async function promptRecoveryHelp(recovery, { asGm = false } = {}) {
  const damages = recovery?.damages ?? [];
  const options = damages.map((damage) => `<option value="${escapeHtml(damage.id)}"${damage.id === recovery.persistentId ? " selected" : ""}>${escapeHtml(damageOptionLabel(damage))}</option>`).join("");
  const rulings = [
    ["counts", t("AssistedRecovery.RulingCounts", "Counts: the damage's DC")],
    ["fitting", t("AssistedRecovery.RulingFitting", "Especially fitting help: DC {dc}, like dousing a fire with water", { dc: fittingRecoveryDc(RECOVERY_DC) })],
    ["ends", t("AssistedRecovery.RulingEnds", "Ends it outright, like jumping into a lake")],
  ].map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("");
  const fitting = `<label class="combater-ready-field"><span>${escapeHtml(t("AssistedRecovery.Ruling", "Your ruling"))}</span><select name="ruling">${rulings}</select></label>`;
  const content = `<div class="combater-ready-form">
    <p class="combater-ready-rule">${escapeHtml(asGm
      ? t("AssistedRecovery.RuleGm", "{ally} gets an extra flat check against the persistent damage's DC to end it.", { ally: recovery?.allyName ?? "" })
      : t("AssistedRecovery.Rule", "{ally} gets an extra flat check against the persistent damage's DC to end it. Say how you help; the GM rules whether it counts.", { ally: recovery?.allyName ?? "" }))}</p>
    ${damages.length > 1
      ? `<label class="combater-ready-field"><span>${escapeHtml(t("AssistedRecovery.Damage", "Persistent damage"))}</span><select name="persistent">${options}</select></label>`
      : `<p class="combater-ready-hint">${escapeHtml(damageOptionLabel(damages[0] ?? {}))}</p>`}
    ${asGm ? fitting : ""}
  </div>`;
  const result = await globalThis.foundry.applications.api.DialogV2.prompt({
    classes: dialogClasses(),
    position: { width: 380, height: "auto" },
    window: { title: t("AssistedRecovery.Title", "Assisted Recovery for {ally}", { ally: recovery?.allyName ?? "" }), icon: "fa-solid fa-fire-extinguisher" },
    content,
    ok: {
      label: asGm ? t("AssistedRecovery.Resolve", "Resolve") : t("AssistedRecovery.Roll", "Roll flat check"),
      icon: asGm ? "fa-solid fa-check" : "fa-solid fa-dice-d20",
      callback: (_event, button) => ({
        persistentId: button.form.elements.persistent?.value ?? damages[0]?.id ?? null,
        ruling: button.form.elements.ruling?.value ?? "counts",
      }),
    },
    rejectClose: false,
  });
  return result?.persistentId ? result : null;
}

// GM: rule on a player's assisted recovery. Resolves to { dc } (the damage's own DC, or the fitting
// one), { autoEnd: true } when the help ends it outright, or { cancelled: true } when it doesn't
// count. Registered as the socketlib "promptRecoveryDc" handler.
export async function promptRecoveryDc({ actorName = "", allyName = "", damage = "", dc = RECOVERY_DC } = {}) {
  const base = Number(dc) || RECOVERY_DC;
  const fitting = fittingRecoveryDc(base);
  const message = t("AssistedRecovery.DcMessage", "{actor} helps {ally} recover from persistent {damage}.", { actor: actorName, ally: allyName, damage });
  const buttons = [
    { action: "ok", label: t("AssistedRecovery.Counts", "Counts (DC {dc})", { dc: base }), icon: "fa-solid fa-check", default: true, callback: () => ({ dc: base }) },
    ...(fitting < base ? [{ action: "fitting", label: t("AssistedRecovery.FittingButton", "Fitting help (DC {dc})", { dc: fitting }), icon: "fa-solid fa-droplet", callback: () => ({ dc: fitting }) }] : []),
    { action: "ends", label: t("AssistedRecovery.EndsButton", "Ends it"), icon: "fa-solid fa-fire-extinguisher", callback: () => ({ autoEnd: true }) },
    { action: "cancel", label: t("TurnControls.AidRefuse", "Not allowed"), icon: "fa-solid fa-xmark", callback: () => ({ cancelled: true }) },
  ];
  const result = await globalThis.foundry.applications.api.DialogV2.wait({
    classes: [...dialogClasses(), "pf2e-combater-recovery-dialog"],
    position: { width: 600, height: "auto" },
    window: { title: t("AssistedRecovery.DcTitle", "Assisted Recovery"), icon: "fa-solid fa-fire-extinguisher" },
    content: `<div class="combater-ready-form"><p class="combater-ready-rule">${escapeHtml(message)}</p></div>`,
    buttons,
    rejectClose: false,
  }).catch(() => null);
  return result ?? { cancelled: true };
}

// The helper's choices for an assisted recovery step: which damage, then the GM's ruling (or the
// damage's own DC when no GM is connected). Resolves to { persistentId, dc } or
// { persistentId, autoEnd: true }, or null when abandoned. onWaiting(true/false) brackets the wait
// for the GM, so the step shows "Waiting for the GM" only then, not while the helper still chooses.
export async function chooseRecovery({ actorName, recovery, onWaiting = null }) {
  const isGM = globalThis.game?.user?.isGM === true;
  const help = await promptRecoveryHelp(recovery, { asGm: isGM });
  if (!help) return null;
  const damage = recovery.damages.find((entry) => entry.id === help.persistentId);
  const base = Number(damage?.dc) || RECOVERY_DC;
  if (isGM) {
    if (help.ruling === "ends") return { persistentId: help.persistentId, autoEnd: true };
    return { persistentId: help.persistentId, dc: help.ruling === "fitting" ? fittingRecoveryDc(base) : base };
  }
  const notifications = globalThis.ui?.notifications;
  notifications?.info?.(t("Notify.RecoveryWaitingDc", "Waiting for the GM to rule on your help."));
  await onWaiting?.(true);
  let answer;
  try {
    answer = await requestRecoveryDc({ actorName, allyName: recovery.allyName, damage: damage?.label ?? "", dc: base });
  } finally {
    await onWaiting?.(false);
  }
  if (answer?.cancelled) {
    notifications?.warn?.(t("Notify.RecoveryRefused", "The GM didn't allow this help."));
    return null;
  }
  if (answer?.autoEnd === true) return { persistentId: help.persistentId, autoEnd: true };
  if (Number.isFinite(answer?.dc)) return { persistentId: help.persistentId, dc: answer.dc };
  notifications?.info?.(dcsVisible()
    ? t("Notify.RecoveryNoGm", "No GM to rule on it; rolling against DC {dc}.", { dc: base })
    : t("Notify.RecoveryNoGmHidden", "No GM to rule on it; rolling against the damage's own DC."));
  return { persistentId: help.persistentId, dc: base };
}

// GM: end persistent damage after a player's successful assisted recovery. Only ever deletes a
// persistent damage condition. Registered as the socketlib "endPersistentDamage" handler.
export async function endPersistentDamageRequest({ conditionUuid } = {}) {
  const condition = conditionUuid ? await globalThis.fromUuid?.(conditionUuid) : null;
  if ((condition?.slug ?? condition?.system?.slug) !== "persistent-damage" || typeof condition.delete !== "function") return false;
  await condition.delete();
  return true;
}
