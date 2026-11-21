import { MODULE_ID } from "../constants.js";
import { collectionValues } from "../foundry-data.js";
import { t } from "../i18n.js";
import { intelLedgerView, isNpcIntelTarget } from "../rules/intel-ledger.js";
import { playerAccessAllowed } from "../settings.js";
import { openIntelWindow } from "./intel-window.js";
import { openRecallKnowledgeIntelWindow } from "./recall-knowledge.js";

const BUTTON_CLASS = `${MODULE_ID}-combatant-intel`;
const HUD_BUTTON_CLASS = `${MODULE_ID}-combatant-intel-hud`;
// The GM's quick edit button: its own class, so the player button logic never touches it.
const GM_BUTTON_CLASS = `${MODULE_ID}-combatant-intel-gm`;
const GM_HUD_BUTTON_CLASS = `${MODULE_ID}-combatant-intel-gm-hud`;
// PF2e HUD swaps in `.controls.alt` (and hides the normal row) while its modifier key is held, via
// `#pf2e-hud-tracker.alternate-controls`; the GM button lives there so HUD shows it at that moment.
const HUD_ALT_CONTROL_SELECTORS = [".details .controls.alt", ".details"];
const PF2E_HUD_MODULE_ID = "pf2e-hud";
const PF2E_HUD_TRACKER_ID = "pf2e-hud-tracker";
const CORE_CONTROL_SELECTORS = [".combatant-controls, .combatant-name, .token-name, .token-initiative"];
// PF2e HUD rows: `.details > .controls` holds target/ping/pan; `.controls.alt` only shows while alt is held.
// Tried in order: a selector list would match the `.details` ancestor first (document order).
const HUD_CONTROL_SELECTORS = [".details .controls:not(.alt)", ".details"];

function rootElement(html) {
  const HTMLElementCtor = globalThis.HTMLElement;
  if (typeof HTMLElementCtor !== "function") return null;
  if (html instanceof HTMLElementCtor) return html;
  if (html?.[0] instanceof HTMLElementCtor) return html[0];
  if (html?.element instanceof HTMLElementCtor) return html.element;
  return null;
}

function combatantList(combat) {
  return collectionValues(combat?.combatants);
}

function combatantById(combat, id) {
  if (!id) return null;
  return combat?.combatants?.get?.(id)
    ?? combatantList(combat).find((combatant) => String(combatant?.id) === String(id))
    ?? null;
}

function combatantToken(combatant) {
  return combatant?.token?.object
    ?? combatant?.token
    ?? combatant?.tokenDocument
    ?? combatant?.document?.token
    ?? null;
}

function combatantActor(combatant) {
  return combatant?.actor
    ?? combatant?.token?.actor
    ?? combatant?.token?.object?.actor
    ?? combatant?.tokenDocument?.actor
    ?? combatant?.document?.actor
    ?? null;
}

function tokenHidden(token) {
  const document = token?.document ?? token;
  return token?.hidden === true
    || document?.hidden === true
    || token?.visible === false
    || token?.isVisible === false;
}

function combatantHidden(combatant) {
  const document = combatant?.document ?? combatant;
  return combatant?.hidden === true || document?.hidden === true;
}

function playerCanSeeCombatant(combatant) {
  if (globalThis.game?.user?.isGM === true) return true;
  const token = combatantToken(combatant);
  const visible = typeof combatant?.visible === "boolean"
    ? combatant.visible
    : !combatantHidden(combatant);
  return visible && !tokenHidden(token);
}

function unknownCombatantName() {
  return globalThis.game?.i18n?.localize?.("COMBATANT.Unknown") || "Unknown";
}

function combatantNameIsHidden(combatant) {
  if (globalThis.game?.user?.isGM === true) return false;
  if (!globalThis.game?.pf2e?.settings?.tokens?.nameVisibility) return false;
  if (combatant?.playersCanSeeName === false) return true;
  const token = combatantToken(combatant);
  const document = token?.document ?? token;
  return document?.playersCanSeeName === false;
}

function rowCombatantName(row) {
  return String(row?.querySelector?.(".token-name .name, .combatant-name .name, .name")?.textContent ?? "")
    .trim();
}

function combatantDisplayName(combatant, row = null) {
  const visibleRowName = rowCombatantName(row);
  if (visibleRowName) return visibleRowName;
  if (combatantNameIsHidden(combatant)) return unknownCombatantName();
  const token = combatantToken(combatant);
  const document = token?.document ?? token;
  return combatant?.name ?? token?.name ?? document?.name ?? combatantActor(combatant)?.name ?? unknownCombatantName();
}

function intelTargetForCombatant(combatant, row = null) {
  const actor = combatantActor(combatant);
  const token = combatantToken(combatant);
  if (!actor) return null;
  return {
    id: combatant?.id ?? token?.id ?? actor.id,
    displayName: combatantDisplayName(combatant, row),
    name: combatantDisplayName(combatant, row),
    actor,
    token: {
      id: token?.id ?? token?.document?.id ?? null,
      img: combatant?.img ?? token?.document?.texture?.src ?? token?.texture?.src ?? actor.img ?? "",
    },
  };
}

function combatantIntelView(combatant, row = null) {
  const target = intelTargetForCombatant(combatant, row);
  if (!target || !isNpcIntelTarget(target) || !playerCanSeeCombatant(combatant)) return null;
  const view = intelLedgerView({
    isGM: globalThis.game?.user?.isGM === true,
    intelTargets: [target],
  });
  return view.visible && view.editable !== true && view.entries.some((entry) => entry.hasRevealed)
    ? view
    : null;
}

function rowCombatantId(row) {
  return row?.dataset?.combatantId
    ?? row?.getAttribute?.("data-combatant-id")
    ?? row?.querySelector?.("[data-combatant-id]")?.getAttribute?.("data-combatant-id")
    ?? null;
}

function activeCombatTrackerCombat() {
  return globalThis.ui?.combat?.viewed ?? globalThis.ui?.combat?.combat ?? globalThis.game?.combat ?? null;
}

function trackerRoots() {
  const doc = globalThis.document;
  return [
    rootElement(globalThis.ui?.combat?.element) ?? doc?.querySelector?.("#combat-tracker, #combat"),
    doc?.getElementById?.(PF2E_HUD_TRACKER_ID) ?? null,
  ].filter(Boolean);
}

function currentCombatTrackerRow(combatantId) {
  for (const root of trackerRoots()) {
    const row = Array.from(root.querySelectorAll("[data-combatant-id], li.combatant"))
      .find((candidate) => String(rowCombatantId(candidate)) === String(combatantId));
    if (row) return row;
  }
  return null;
}

function combatantIntelViewById(combatantId) {
  const combat = activeCombatTrackerCombat();
  return combatantIntelView(combatantById(combat, combatantId), currentCombatTrackerRow(combatantId));
}

function insertButton(row, view, combatantId, { controlSelectors = CORE_CONTROL_SELECTORS, extraClass = "" } = {}) {
  row.querySelector(`.${BUTTON_CLASS}`)?.remove();
  const button = document.createElement("button");
  button.type = "button";
  button.className = extraClass ? `${BUTTON_CLASS} ${extraClass}` : BUTTON_CLASS;
  button.dataset.tooltip = view.tooltip;
  button.setAttribute("aria-label", t("Intel.PlayerTooltip", "View Recall Knowledge facts the GM has revealed."));
  button.innerHTML = `<i class="fa-solid fa-brain"></i>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openIntelWindow(view, { mode: "view", viewProvider: () => combatantIntelViewById(combatantId) });
  });

  const target = controlSelectors.map((selector) => row.querySelector(selector)).find(Boolean) ?? row;
  target.append(button);
}

function decorateTrackerRows(root, combat, buttonOptions = {}) {
  const seen = new Set();
  for (const row of root.querySelectorAll("[data-combatant-id], li.combatant")) {
    const id = rowCombatantId(row);
    if (!id || seen.has(String(id))) continue;
    seen.add(String(id));
    const combatant = combatantById(combat, id);
    const view = combatantIntelView(combatant, row);
    if (view) insertButton(row, view, id, buttonOptions);
    else row.querySelector(`.${BUTTON_CLASS}`)?.remove();
  }
}

// The GM's quick Intel editor for an NPC row (the same window Recall Knowledge opens).
function insertGmButton(row, actor, { controlSelectors = CORE_CONTROL_SELECTORS, extraClass = "", openIntel = openRecallKnowledgeIntelWindow } = {}) {
  row.querySelector(`.${GM_BUTTON_CLASS}`)?.remove();
  const button = document.createElement("button");
  button.type = "button";
  button.className = extraClass ? `${GM_BUTTON_CLASS} ${extraClass}` : GM_BUTTON_CLASS;
  const label = t("Intel.GmQuickEdit", "Edit Intel for this creature");
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = `<i class="fa-solid fa-brain"></i>`;
  // PF2e HUD leaves its alternate-controls mode on mouse-down, hiding this button before the
  // release, so the click would land behind it. Open on pointerdown while it's still there; `click`
  // stays for keyboard activation (detail 0).
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    openIntel(actor, { preselectIdentity: false });
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.detail === 0) openIntel(actor, { preselectIdentity: false });
  });
  const target = controlSelectors.map((selector) => row.querySelector(selector)).find(Boolean) ?? row;
  target.append(button);
}

function decorateGmTrackerRows(root, combat, buttonOptions = {}) {
  const seen = new Set();
  for (const row of root.querySelectorAll("[data-combatant-id], li.combatant")) {
    const id = rowCombatantId(row);
    if (!id || seen.has(String(id))) continue;
    seen.add(String(id));
    const actor = combatantActor(combatantById(combat, id));
    if (actor && isNpcIntelTarget({ actor })) insertGmButton(row, actor, buttonOptions);
    else row.querySelector(`.${GM_BUTTON_CLASS}`)?.remove();
  }
}

function decorateCombatTracker(app, html) {
  if (globalThis.game?.user?.isGM === true) {
    const root = rootElement(html) ?? rootElement(app?.element);
    if (root) decorateGmTrackerRows(root, app?.viewed ?? app?.combat ?? globalThis.game?.combat ?? null);
    return;
  }
  if (!playerAccessAllowed()) return;
  const root = rootElement(html) ?? rootElement(app?.element);
  if (!root) return;
  const combat = app?.viewed ?? app?.combat ?? globalThis.game?.combat ?? null;
  decorateTrackerRows(root, combat);
}

// PF2e HUD's TrackerPF2eHUD (ApplicationV2, id "pf2e-hud-tracker") mirrors ui.combat.viewed in its own DOM.
function decoratePf2eHudTracker(app, html) {
  if (globalThis.game?.user?.isGM === true) {
    const root = rootElement(html) ?? rootElement(app?.element);
    if (!root) return;
    const combat = app?.viewed ?? globalThis.ui?.combat?.viewed ?? globalThis.game?.combat ?? null;
    decorateGmTrackerRows(root, combat, { controlSelectors: HUD_ALT_CONTROL_SELECTORS, extraClass: GM_HUD_BUTTON_CLASS });
    return;
  }
  if (!playerAccessAllowed()) return;
  const root = rootElement(html) ?? rootElement(app?.element);
  if (!root) return;
  const combat = app?.viewed ?? globalThis.ui?.combat?.viewed ?? globalThis.game?.combat ?? null;
  decorateTrackerRows(root, combat, { controlSelectors: HUD_CONTROL_SELECTORS, extraClass: HUD_BUTTON_CLASS });
}

export function pf2eHudActive() {
  return globalThis.game?.modules?.get?.(PF2E_HUD_MODULE_ID)?.active === true;
}

/** Re-render every tracker that shows Intel buttons (core + PF2e HUD) after revealed intel changes. */
export function refreshCombatTrackerIntel() {
  globalThis.ui?.combat?.render?.(true);
  if (!pf2eHudActive()) return;
  // Re-decorate PF2e HUD's rows in place; a full HUD render would also redraw its own state.
  const hudTracker = globalThis.foundry?.applications?.instances?.get?.(PF2E_HUD_TRACKER_ID);
  if (hudTracker?.element) decoratePf2eHudTracker(hudTracker, hudTracker.element);
}

export function registerCombatTrackerIntel() {
  Hooks.on("renderCombatTracker", decorateCombatTracker);
  if (pf2eHudActive()) Hooks.on("renderTrackerPF2eHUD", decoratePf2eHudTracker);
}
