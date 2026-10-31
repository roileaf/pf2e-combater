import { t } from "../i18n.js";
import { requestAidDc, requestApplyAidEffect } from "../socket.js";
import {
  AID_DC, aidCheckOptions, aidedCheckOptions, applyAidEffect, defaultAidedCheck, rollAid,
} from "../engine/execution/prepare-to-aid.js";

const escapeHtml = (value) => globalThis.foundry.utils.escapeHTML(String(value ?? ""));

function signed(value) {
  return value >= 0 ? `+${value}` : `−${Math.abs(value)}`;
}

// The player says how they help (a Strike when helping an attack, otherwise a skill, Lore or
// Perception) and which of the ally's checks they help with. The GM then sets the DC (see aidDc).
// A GM aiding sets all three here.
async function promptAid(actor, ally, { withDc = false } = {}) {
  const options = aidCheckOptions(actor);
  const aidedOptions = aidedCheckOptions(ally);
  const firstAided = defaultAidedCheck(options[0]?.slug, aidedOptions);
  const aidedHtml = aidedOptions.map((option) => `<option value="${escapeHtml(option.slug)}"${option.slug === firstAided ? " selected" : ""}>${escapeHtml(checkLabel(option))}</option>`).join("");
  const allyName = ally?.name;
  const optionHtml = (kind) => options.filter((option) => option.kind === kind)
    .map((option) => `<option value="${escapeHtml(option.slug)}">${escapeHtml(checkLabel(option))} (${signed(option.modifier)})</option>`).join("");
  const strikes = optionHtml("strike");
  const content = `<div class="combater-ready-form">
    <p class="combater-ready-rule">${escapeHtml(withDc
      ? t("TurnControls.AidRuleGm", "Roll the check that fits how they help, against the DC you set.")
      : t("TurnControls.AidRule", "Choose the check that fits how you help. The GM sets the DC."))}</p>
    <label class="combater-ready-field"><span>${escapeHtml(t("TurnControls.AidCheck", "Check"))}</span><select name="check">
      <optgroup label="${escapeHtml(t("TurnControls.AidSkills", "Skills"))}">${optionHtml("skill")}</optgroup>
      ${strikes ? `<optgroup label="${escapeHtml(t("TurnControls.AidAttacks", "Attacks"))}">${strikes}</optgroup>` : ""}
    </select></label>
    <label class="combater-ready-field"><span>${escapeHtml(t("TurnControls.AidAided", "Helping with"))}</span><select name="aided">${aidedHtml}</select></label>
    ${withDc ? dcFieldHtml() : ""}
  </div>`;
  const title = allyName
    ? t("TurnControls.AidTitleAlly", "Aid {ally}", { ally: allyName })
    : t("TurnControls.AidTitle", "Aid for {name}", { name: actor?.name ?? "" });
  const result = await globalThis.foundry.applications.api.DialogV2.prompt({
    classes: ["pf2e-combater-delay-dialog", "pf2e-combater-ready-dialog"],
    position: { width: 360, height: "auto" },
    window: { title, icon: "fa-solid fa-handshake-angle" },
    content,
    render: (_event, dialog) => {
      const form = (dialog.element ?? dialog).querySelector?.("form");
      const check = form?.elements?.check;
      const aided = form?.elements?.aided;
      if (!check || !aided) return;
      // Follows the chosen check until the player picks the aided check themselves.
      let touched = false;
      aided.addEventListener("change", () => { touched = true; });
      check.addEventListener("change", () => {
        if (!touched) aided.value = defaultAidedCheck(check.value, aidedOptions);
      });
    },
    ok: {
      label: t("TurnControls.AidRoll", "Roll Aid"),
      icon: "fa-solid fa-dice-d20",
      callback: (_event, button) => ({
        check: button.form.elements.check.value, aided: button.form.elements.aided.value, dc: readDc(button),
      }),
    },
    rejectClose: false,
  });
  if (!result?.check) return null;
  const aided = aidedOptions.find((option) => option.slug === result.aided) ?? aidedOptions[0];
  return { ...result, aided };
}

function checkLabel(option) {
  if (!option?.gmRuling) return option?.label ?? "";
  return t("TurnControls.AidGmCall", "{check} (GM's call)", { check: option.label });
}

function dcFieldHtml() {
  return `<label class="combater-ready-field"><span>${escapeHtml(t("TurnControls.AidDc", "DC"))}</span><input type="number" name="dc" value="${AID_DC}" min="0" max="60" autofocus></label>`;
}

function readDc(button) {
  const value = Number(button?.form?.elements?.dc?.value);
  return Number.isFinite(value) ? value : AID_DC;
}

// GM: set the DC for the check a player chose. Resolves to { dc }, or { cancelled: true } when the
// GM refuses the help. Registered as the socketlib "promptAidDc" handler.
export async function promptAidDc({ actorName = "", allyName = "", checkLabel = "", aidedLabel = "" } = {}) {
  const message = allyName
    ? t("TurnControls.AidDcMessageAlly", "{actor} Aids {ally}'s {aided} with {check}.", { actor: actorName, ally: allyName, aided: aidedLabel, check: checkLabel })
    : t("TurnControls.AidDcMessage", "{actor} Aids a {aided} with {check}.", { actor: actorName, aided: aidedLabel, check: checkLabel });
  const result = await globalThis.foundry.applications.api.DialogV2.wait({
    classes: ["pf2e-combater-delay-dialog", "pf2e-combater-ready-dialog"],
    position: { width: 340, height: "auto" },
    window: { title: t("TurnControls.AidDcTitle", "Aid DC"), icon: "fa-solid fa-handshake-angle" },
    content: `<div class="combater-ready-form"><p class="combater-ready-rule">${escapeHtml(message)}</p>${dcFieldHtml()}</div>`,
    buttons: [
      { action: "ok", label: t("TurnControls.AidSetDc", "Set DC"), icon: "fa-solid fa-check", default: true, callback: (_event, button) => ({ dc: readDc(button) }) },
      { action: "cancel", label: t("TurnControls.AidRefuse", "Not allowed"), icon: "fa-solid fa-xmark", callback: () => ({ cancelled: true }) },
    ],
    rejectClose: false,
  }).catch(() => null);
  return result ?? { cancelled: true };
}

// The GM sets the DC. Without a connected GM the player rolls against the usual DC 15.
async function aidDc({ actor, ally, option, aided }) {
  const args = { actorName: actor?.name ?? "", allyName: ally?.name ?? "", checkLabel: checkLabel(option), aidedLabel: aided ? checkLabel(aided) : "" };
  const notifications = globalThis.ui?.notifications;
  notifications?.info?.(t("Notify.AidWaitingDc", "Waiting for the GM to set the Aid DC."));
  const answer = await requestAidDc(args);
  if (answer?.cancelled) {
    notifications?.warn?.(t("Notify.AidRefused", "The GM didn't allow this Aid."));
    return null;
  }
  if (Number.isFinite(answer?.dc)) return answer.dc;
  notifications?.info?.(t("Notify.AidNoGm", "No GM to set the DC; rolling against DC {dc}.", { dc: AID_DC }));
  return AID_DC;
}

async function giveAidEffect(ally, bonus, originUuid, aided) {
  const args = { allyUuid: ally.uuid, bonus, originUuid, aided };
  if (ally.isOwner) return applyAidEffect(args);
  return (await requestApplyAidEffect(args)) === true;
}

// Rolls Aid and puts PF2e's Effect: Aid, at the bonus the roll earned, on the ally. Resolves true
// once the check is rolled, false when the player backs out.
export async function performAid({ actor, ally = null, event = null }) {
  const options = aidCheckOptions(actor);
  if (!options.length) return false;
  const isGM = globalThis.game?.user?.isGM === true;
  const choice = await promptAid(actor, ally, { withDc: isGM });
  if (!choice) return false;
  const option = options.find((entry) => entry.slug === choice.check);
  const dc = isGM ? choice.dc : await aidDc({ actor, ally, option, aided: choice.aided });
  if (dc === null) return false;
  const result = await rollAid({ actor, check: choice.check, dc, event });
  if (!result) return false;
  const notifications = globalThis.ui?.notifications;
  if (!ally) {
    notifications?.info?.(t("Notify.AidNoAlly", "Target the ally you aided to give them the Aid effect."));
  } else if (result.bonus) {
    const applied = await giveAidEffect(ally, result.bonus, actor?.uuid ?? null, choice.aided);
    if (applied) notifications?.info?.(t("Notify.AidApplied", "{ally} gets {bonus} on their {aided} from Aid.", { ally: ally.name, bonus: signed(result.bonus), aided: choice.aided.label }));
    else notifications?.warn?.(t("Notify.AidNotApplied", "Could not give {ally} the Aid effect; an active GM is needed.", { ally: ally.name }));
  }
  return true;
}
