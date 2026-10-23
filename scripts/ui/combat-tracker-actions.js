import { MODULE_ID } from "../constants.js";
import { collectionValues } from "../foundry-data.js";
import { t } from "../i18n.js";
import { combatTrackerActions } from "../settings.js";
import { adjustTrackedActions, trackedActionContext } from "../state/action-tracker.js";
import { turnIdentity } from "../state/turn-controls.js";
import { actionTrackerView, trackerReactionView } from "./panel/action-tracker.js";
import { sendTurnControl } from "./panel/turn-controls.js";
import { adjustGuarderReaction } from "../integrations/guarder.js";

// Foundry's combat tracker and PF2e HUD's tracker (ApplicationV2 "pf2e-hud-tracker") both list
// combatants as li.combatant[data-combatant-id]. Each row gets the creature's action glyphs on its
// turn and its reaction glyph, read from the same tracker the Combater panel shows, and clickable
// like the panel's: click spends, right-click gives back.
const CONTAINER_CLASS = "pf2e-combater-tracker-actions";
const HUD_TRACKER_ID = "pf2e-hud-tracker";

function rootElement(value) {
  if (!value) return null;
  if (value instanceof HTMLElement) return value;
  return value[0] instanceof HTMLElement ? value[0] : null;
}

function rowCombatantId(row) {
  return row?.dataset?.combatantId ?? row?.getAttribute?.("data-combatant-id") ?? null;
}

function combatantContext(combat, combatant) {
  return { combat, combatant, actor: { document: combatant?.actor ?? null }, token: combatant?.token ?? null };
}

// What a row shows, or null: the action glyphs on the creature's turn, its reaction, and whether
// this user may click them (the GM, as on the panel).
export function combatTrackerActionsView(combat, combatant) {
  if (!combat?.started || !combatant?.actor) return null;
  const context = combatantContext(combat, combatant);
  const reaction = trackerReactionView(context);
  // On its turn: what's left. Otherwise: the forecast for its next turn (Slowed, Stunned, a resumed
  // Delay...), as the panel's "Next turn" tracker shows it.
  const tracked = trackedActionContext(context, { combat });
  const view = tracked?.actionTracker ? actionTrackerView(tracked) : null;
  if (!reaction && !view?.visible) return null;
  const isGM = globalThis.game?.user?.isGM === true;
  const forecast = view?.forecast === true;
  const why = [view?.conditions, view?.pendingConditions].filter(Boolean).join(" · ");
  // The count is normal actions; a quickened one is its own gold diamond, so say it too.
  const quickenedPips = (view?.pips ?? []).filter((pip) => pip.quickened);
  const quickenedCount = quickenedPips.length
    ? ` · ${t("ActionTracker.QuickenedCount", "Quickened {left}/{total}", { left: quickenedPips.filter((pip) => !pip.spent).length, total: quickenedPips.length })}`
    : "";
  return {
    tracked,
    forecast,
    pips: view?.visible ? view.pips : [],
    conditionIcons: view?.visible ? view.conditionIcons ?? [] : [],
    countLabel: view?.visible ? `${view.label}: ${view.countLabel}${quickenedCount}${why ? ` · ${why}` : ""}` : "",
    tipTitle: view?.visible ? `${view.label}: ${view.countLabel}${quickenedCount}` : "",
    pipsHint: forecast ? view?.hint ?? "" : view?.pipsHint ?? "",
    pipControls: Boolean(view?.glyphControls),
    canSpend: Boolean(view?.canSpend), canRefund: Boolean(view?.canRefund),
    canSpendQuickened: Boolean(view?.canSpendQuickened), canRefundQuickened: Boolean(view?.canRefundQuickened),
    reaction,
    reactionControls: isGM && Boolean(reaction) && !reaction.blocked,
  };
}

function glyph(text, className, pip = null) {
  const span = document.createElement("span");
  span.className = className;
  if (pip?.quickened) span.classList.add("is-quickened");
  if (pip?.spent) span.classList.add("is-spent");
  span.innerHTML = `<span class="action-glyph" aria-hidden="true">${text}</span>`;
  return span;
}

// Clicks on a tracker row activate that combatant: keep these glyphs' clicks to themselves.
function onGlyph(element, handler) {
  for (const type of ["click", "contextmenu"]) {
    element.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (element.dataset.busy) return;
      element.dataset.busy = "1";
      Promise.resolve(handler(type === "click" ? 1 : -1, event))
        .catch((error) => globalThis.ui?.notifications?.warn?.(error?.message ?? String(error)))
        .finally(() => { delete element.dataset.busy; });
    });
  }
  // PF2e HUD's rows act on these too.
  for (const type of ["pointerdown", "mousedown", "mouseup", "dblclick"]) element.addEventListener(type, (event) => event.stopPropagation());
}

function pipsElement(view) {
  const pips = document.createElement("span");
  pips.className = `combater-tracker-pips${view.pipControls ? " is-editable" : ""}${view.forecast ? " is-forecast" : ""}`;
  const tip = view.pipControls || view.forecast ? `${view.countLabel}. ${view.pipsHint}` : view.countLabel;
  // The conditions behind the count (Slowed, Stunned) ride in the tooltip, not the narrow row.
  pips.dataset.tooltipHtml = pipsTooltipHtml(view);
  pips.setAttribute("aria-label", tip);
  for (const pip of view.pips) pips.append(glyph("1", "combater-tracker-pip", pip));
  if (view.pipControls) {
    onGlyph(pips, async (amount, event) => {
      const quickened = Boolean(event.target.closest?.(".combater-tracker-pip.is-quickened"));
      const allowed = quickened
        ? (amount > 0 ? view.canSpendQuickened : view.canRefundQuickened)
        : (amount > 0 ? view.canSpend : view.canRefund);
      if (allowed) await adjustTrackedActions(view.tracked, quickened ? "quickened" : "normal", amount);
    });
  }
  return pips;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}

// "Next turn: 2 actions", the Slowed / Stunned icons behind it (as the panel's tracker shows
// them), then what clicking does or what the forecast means.
function pipsTooltipHtml(view) {
  const title = escapeHtml(view.tipTitle);
  const conditions = view.conditionIcons.map((entry) => `<div class="combater-tracker-tip-condition${entry.pending ? " is-pending" : ""}">`
    + `<span class="combater-tracker-tip-icon"><img src="${escapeHtml(entry.img)}" alt="">`
    + `${entry.value ? `<span class="combater-tracker-tip-value">${escapeHtml(entry.value)}</span>` : ""}</span>`
    + `<span>${escapeHtml(entry.tooltip)}</span></div>`).join("");
  const hint = view.pipControls || view.forecast ? `<div class="combater-tracker-tip-hint">${escapeHtml(view.pipsHint)}</div>` : "";
  return `<div class="combater-tracker-tip"><strong>${title}</strong>${conditions}${hint}</div>`;
}

function reactionElement(view, combat, combatantId) {
  const { reaction } = view;
  const tip = view.reactionControls ? `${reaction.label}. ${reaction.hint}` : reaction.label;
  const editable = view.reactionControls ? " is-editable" : "";
  // A guardian (PF2e Guarder): its general reaction, then a gold glyph per guardian-only one.
  if (reaction.guarder) {
    const group = document.createElement("span");
    group.className = `combater-tracker-reactions${editable}`;
    group.dataset.tooltip = tip;
    group.setAttribute("aria-label", tip);
    // One glyph per slot that exists now: lit while available, dimmed once spent.
    const { general, guardianOnly, generalSlots, guardianSlots } = reaction.guarder;
    const state = (available) => (reaction.blocked ? "is-blocked" : available ? "is-ready" : "is-used");
    for (let index = 0; index < generalSlots; index += 1) {
      group.append(glyph("R", `combater-tracker-reaction ${state(index < general)}`));
    }
    for (let index = 0; index < guardianSlots; index += 1) {
      group.append(glyph("R", `combater-tracker-reaction is-guardian ${state(index < guardianOnly)}`));
    }
    if (view.reactionControls) {
      const actor = combat?.combatants?.get?.(combatantId)?.actor ?? null;
      onGlyph(group, (amount) => adjustGuarderReaction(actor, amount));
    }
    return group;
  }
  const state = reaction.blocked ? "is-blocked" : reaction.used ? "is-used" : "is-ready";
  const span = glyph("R", `combater-tracker-reaction ${state}${editable}`);
  span.dataset.tooltip = tip;
  span.setAttribute("aria-label", tip);
  if (view.reactionControls) {
    onGlyph(span, async (amount) => {
      const used = amount > 0;
      if (reaction.used === used) return;
      await sendTurnControl({ ...turnIdentity(combat), action: "reaction", reactionId: combatantId, used });
    });
  }
  return span;
}

function rowSlot(row) {
  // Beside the row's own controls: Foundry's .combatant-controls, PF2e HUD's .controls.
  return row.querySelector(".combatant-controls") ?? row.querySelector(".details .controls")
    ?? row.querySelector(".token-name") ?? row.querySelector(".details") ?? row;
}

export function decorateTrackerRows(root, combat) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  for (const row of root.querySelectorAll("li.combatant[data-combatant-id], li[data-combatant-id]")) {
    row.querySelector(`.${CONTAINER_CLASS}`)?.remove();
    if (!combatTrackerActions()) continue;
    const id = rowCombatantId(row);
    const combatant = combat?.combatants?.get?.(id) ?? collectionValues(combat?.combatants).find((entry) => entry?.id === id);
    const view = combatTrackerActionsView(combat, combatant);
    if (!view) continue;
    const container = document.createElement("span");
    container.className = CONTAINER_CLASS;
    // A creature waiting for its turn shows its next-turn forecast (blue).
    if (view.forecast) container.classList.add("has-forecast");
    if (view.pips.length) container.append(pipsElement(view));
    if (view.reaction) container.append(reactionElement(view, combat, id));
    rowSlot(row).append(container);
  }
}

function trackerCombat(app) {
  return app?.viewed ?? app?.combat ?? globalThis.game?.combat ?? null;
}

function hudTrackerElement() {
  return rootElement(globalThis.foundry?.applications?.instances?.get?.(HUD_TRACKER_ID)?.element);
}

// Spent actions live in actor flags and chat cards, which redraw neither tracker: re-decorate both.
export function refreshCombatTrackerActions() {
  const combat = globalThis.game?.combat ?? null;
  decorateTrackerRows(rootElement(globalThis.ui?.combat?.element), trackerCombat(globalThis.ui?.combat) ?? combat);
  decorateTrackerRows(hudTrackerElement(), combat);
}

export function registerCombatTrackerActions() {
  Hooks.on("renderCombatTracker", (app, html) => decorateTrackerRows(rootElement(html) ?? rootElement(app?.element), trackerCombat(app)));
  Hooks.on("renderTrackerPF2eHUD", (app, html) => decorateTrackerRows(rootElement(html) ?? rootElement(app?.element), globalThis.game?.combat ?? null));
  let pending = null;
  const refreshSoon = () => {
    if (pending) return;
    pending = globalThis.setTimeout?.(() => { pending = null; refreshCombatTrackerActions(); }, 50) ?? null;
    if (pending === null) refreshCombatTrackerActions();
  };
  Hooks.on("updateActor", (_actor, changed) => { if (changed?.flags?.[MODULE_ID] || changed?.[`flags.${MODULE_ID}`]) refreshSoon(); });
  Hooks.on("updateCombatant", refreshSoon);
  for (const event of ["createChatMessage", "deleteChatMessage"]) {
    Hooks.on(event, (message) => { if (message?.flags?.[MODULE_ID]?.actionSpend || message?.flags?.pf2e) refreshSoon(); });
  }
  for (const event of ["createItem", "deleteItem", "updateItem"]) {
    Hooks.on(event, (item) => { if (["condition", "effect"].includes(item?.type)) refreshSoon(); });
  }
  Hooks.on("updateToken", (_token, changed) => { if (changed?._movementHistory || "x" in (changed ?? {}) || "y" in (changed ?? {})) refreshSoon(); });
}
