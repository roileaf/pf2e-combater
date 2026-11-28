import { t } from "../i18n.js";
import { requiresTargetForAction } from "../engine/action/requirements.js";
import { currentTargetSelection, plannedTargetSelection } from "../engine/execution/targets.js";
import { actionArt } from "./action-art.js";

const NOT_ENOUGH_ACTIONS = () => t("Disabled.NotEnoughActions", "Not enough actions remaining.");

function bestTargetName(action) {
  const target = action?.suggestedTarget ?? action?.preferredTarget ?? action?.target ?? null;
  if (target?.type === "self") return "";
  return String(target?.name ?? target?.actor?.name ?? "").trim();
}

function oddsLabel(chip) {
  return String(chip?.label ?? "").match(/(\d+(?:\.\d+)?)\s*%/)?.[0]?.replace(/\s+/g, "") ?? "";
}

function mostCommon(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = "";
  let bestCount = 0;
  for (const [value, count] of counts) if (count > bestCount) { best = value; bestCount = count; }
  return { value: best, count: bestCount };
}

function byName(left, right) {
  return String(left?.name ?? "").localeCompare(String(right?.name ?? ""));
}

// Turns one decorated action into a compact one-line row: the success chance
// becomes a column, the shared best target and the shared budget warning are
// lifted out, and everything else waits in the expanded details.
// The creatures you've targeted in Foundry. An action you add runs on them, not on the Best target.
function yourTarget() {
  const selection = currentTargetSelection();
  const names = selection.targets
    .map((token) => token?.name ?? token?.document?.name ?? token?.actor?.name ?? "")
    .filter(Boolean);
  return { ids: new Set(selection.targetTokenIds.map(String)), name: [...new Set(names)].join(", ") };
}

function browserRow(action, { sharedTarget, expanded, targeted }) {
  const chips = Array.isArray(action?.detailChips) ? action.detailChips : [];
  const extraChips = chips.filter((chip) => chip?.class !== "is-preflight" && chip?.class !== "is-best-target");
  // With your own target, an action that needs one goes at it: the header names it, and odds
  // worked out against some other creature are left out.
  const onYourTarget = Boolean(targeted) && requiresTargetForAction(action);
  const oddsForYourTarget = !onYourTarget
    || plannedTargetSelection(action).targetTokenIds.some((id) => targeted.ids.has(String(id)));
  const preflight = oddsForYourTarget ? chips.find((chip) => chip?.class === "is-preflight") : null;
  const target = onYourTarget ? "" : bestTargetName(action);
  // The planner's reason names the creature it would pick ("Fear can control Kimerus Federys"):
  // name yours instead.
  const bestName = onYourTarget && !oddsForYourTarget ? bestTargetName(action) : "";
  const reason = bestName && typeof action?.reason === "string"
    ? action.reason.split(bestName).join(targeted.name)
    : action?.reason;
  const budgetOnly = action?.overBudget === true && action?.disabledReason === NOT_ENOUGH_ACTIONS();
  return {
    ...action,
    reason,
    odds: oddsLabel(preflight),
    oddsTooltip: preflight?.tooltip ?? "",
    oddsTooltipHtml: preflight?.tooltipHtml ?? "",
    rowTarget: target && target !== sharedTarget ? t("Browser.RowTarget", "vs {name}", { name: target }) : "",
    rowWarning: budgetOnly ? "" : action?.disabledReason ?? "",
    recharge: Number(action?.rechargeRoundsLeft) > 0 ? {
      rounds: Number(action.rechargeRoundsLeft),
      tooltip: t("Browser.RechargeTooltip", "Usable again on round {round}.", { round: action.rechargeReadyRound }),
    } : null,
    extraChips,
    hasExtraChips: extraChips.length > 0,
    expanded: expanded?.has?.(action?.key) === true,
    addTooltip: action?.overBudget ? action.disabledReason : t("Browser.AddToPlan", "Add to plan"),
  };
}

// Compact mode's tile: everything the row says, in its tooltip.
function tileTooltip(row) {
  const what = [row.name, row.rowTarget].filter(Boolean).join(" ");
  const why = row.rowWarning || row.reason || "";
  const odds = row.odds ? `(${row.odds})` : "";
  const how = row.readonly ? "" : row.overBudget
    ? [row.disabledReason, row.hideUncounted ? "" : t("Browser.TileHintOver", "Shift-click to add as uncounted.")].filter(Boolean).join(" ")
    : row.hideUncounted ? t("Browser.TileHintNoUncounted", "Click to add. Right-click to star.")
      : t("Browser.TileHint", "Click to add, Shift-click as uncounted. Right-click to star.");
  return [[what, odds].filter(Boolean).join(" "), why, how].filter(Boolean).join(" · ");
}

// The compact tile's ⓘ under a click, found from the event target or, when the browser reports a
// click inside a <button> on the button itself, from the elements at the pointer.
export function tileInfoAt(tile, event, root = globalThis.document) {
  const fromTarget = event?.target?.closest?.("[data-tile-info]");
  if (fromTarget && tile.contains(fromTarget)) return fromTarget;
  const x = Number(event?.clientX);
  const y = Number(event?.clientY);
  if (!(x || y)) return null;
  const hits = root?.elementsFromPoint?.(x, y) ?? [];
  return hits.map((node) => node?.closest?.("[data-tile-info]")).find((node) => node && tile.contains(node)) ?? null;
}

// Rejections that say nothing about the situation on the map: bookkeeping, or the user's own choice.
function internalRejection(reason) {
  return [
    t("Reject.Duplicate", "Duplicate detected action replaced by preferred source."),
    t("Reject.UserExcluded", "Hidden from Browse and Auto-fill for this actor."),
    t("Reject.SpellNotCurated", "Spell is not in curated catalog."),
    t("Reject.UnknownHidden", "Unknown custom action hidden by setting."),
  ].includes(reason);
}

// What the planner left out and why ("No target in range."), for the browser's Unavailable list.
export function unavailableActionRows(rejected, { query = "" } = {}) {
  const needle = String(query ?? "").trim().toLowerCase();
  const seen = new Set();
  return (Array.isArray(rejected) ? rejected : []).flatMap((entry) => {
    const name = String(entry?.action?.name ?? "").trim();
    const reason = String(entry?.reason ?? "").trim();
    if (!name || !reason || internalRejection(reason)) return [];
    if (needle && !name.toLowerCase().includes(needle)) return [];
    const key = `${name}|${reason}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ name, reason, costLabel: entry.action.costLabel ?? "" }];
  }).sort(byName);
}

export function browserViewContext(base, { expanded = null, sort = "best", compact = false, showUnavailable = false } = {}) {
  const builder = base?.builder;
  if (!builder) return base;
  const tabs = builder.tabsList ?? [];
  const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
  const visibleSections = builder.searchQuery ? builder.mergedSearchResults ?? [] : activeTab?.sections ?? [];
  const visibleActions = visibleSections.flatMap((section) => section.actions ?? []);
  const own = yourTarget();
  const targeted = own.ids.size ? own : null;
  const shared = mostCommon(visibleActions.map(bestTargetName));
  const sharedTarget = targeted ? own.name : shared.count >= 2 ? shared.value : "";
  const decorateSection = (section) => {
    const actions = (section.actions ?? []).map((action) => browserRow(action, { sharedTarget, expanded, targeted }))
      .map((row) => (compact ? {
        ...row,
        tileTooltip: tileTooltip({ ...row, readonly: base.readonly }),
        tileImg: actionArt(row.slug, row.img, { item: row.item }),
      } : row));
    if (sort === "name" && !section.isFavoritesSection) actions.sort(byName);
    return { ...section, actions, hasActions: actions.length > 0 };
  };
  const tabsList = tabs.map((tab) => ({
    ...tab,
    count: new Set((tab.sections ?? []).flatMap((section) => (section.actions ?? []).map((action) => action.key))).size,
    sections: (tab.sections ?? []).map(decorateSection),
  }));
  const remaining = Number(builder.remainingTotalActions) || 0;
  const overBudget = visibleActions.some((action) => action?.overBudget && action.disabledReason === NOT_ENOUGH_ACTIONS());
  return {
    ...base,
    builder: { ...builder, tabsList, mergedSearchResults: (builder.mergedSearchResults ?? []).map(decorateSection) },
    browserBar: {
      over: overBudget,
      pips: Array.from({ length: Math.min(6, remaining) }, () => ({})),
      remainingLabel: t(remaining === 1 ? "Browser.ActionLeft" : "Browser.ActionsLeft", remaining === 1 ? "{count} action left" : "{count} actions left", { count: remaining }),
      overLabel: overBudget ? t("Browser.OverBudget", "too few for these actions · add them as uncounted instead") : "",
      sharedTargetLabel: targeted
        ? t("Browser.YourTargetPrefix", "Your target")
        : sharedTarget ? t("Browser.SharedTargetPrefix", "Best target") : "",
      sharedTarget,
    },
    showUnavailable,
    unavailable: showUnavailable ? unavailableActionRows(base?.debug?.rejected, { query: builder.searchQuery }) : [],
    unavailableLabel: t("Browser.UnavailableToggle", "Unavailable"),
    unavailableTooltip: t("Browser.UnavailableTooltip", "Also list actions you can't use right now, with the reason."),
    unavailableTitle: t("Browser.UnavailableTitle", "Unavailable right now"),
    unavailableEmpty: t("Browser.UnavailableEmpty", "Nothing is ruled out right now."),
    compact,
    compactTooltip: compact
      ? t("Browser.CompactOff", "Show the full list")
      : t("Browser.CompactOn", "Compact: icon tiles"),
    sortLabel: sort === "name" ? t("Browser.SortName", "A–Z") : t("Browser.SortBest", "Best"),
    sortTooltip: t("Browser.SortTooltip", "Sort actions by planner score or by name."),
    hiddenLabel: t("Browser.HiddenToggle", "Hidden"),
    labels: {
      favoritesHint: t("Browser.FavoritesHint", "Star an action to pin it here."),
      addUncounted: t("Browser.AddUncountedLabel", "Add as uncounted"),
      hide: t("Browser.HideLabel", "Hide from Auto-fill"),
      restore: t("Browser.RestoreLabel", "Show in Auto-fill"),
      openSheet: t("Browser.OpenSheet", "Open sheet"),
      expand: t("Browser.ExpandRow", "Show details"),
    },
  };
}
