import { collectionValues } from "../../foundry-data.js";
import { canvasTokenById as canvasTokenByIdFromCanvas, contextTokenId } from "../../rules/canvas-geometry.js";
import { t } from "../../i18n.js";

export function tokenId(context) {
  return contextTokenId(context);
}

export function canvasTokenById(id) {
  return canvasTokenByIdFromCanvas(id);
}

export function targetTokenId(token) {
  const document = token?.document ?? token;
  return token?.id ?? token?.uuid ?? document?.id ?? document?.uuid ?? null;
}

function targetTokenName(token) {
  return token?.name ?? token?.document?.name ?? token?.actor?.name ?? token?.document?.actor?.name ?? "";
}

export function currentTargetSelection() {
  const targets = collectionValues(globalThis.game?.user?.targets).filter(Boolean);
  const targetTokenIds = targets.map((target) => targetTokenId(target)).filter(Boolean);
  const targetNames = targets.map((target) => targetTokenName(target)).filter(Boolean);
  return {
    targets,
    targetTokenIds,
    targetLabel: targetNames.length ? t("Label.Target", "Target: {name}", { name: targetNames.join(", ") }) : "",
  };
}

export function plannedTargetSelection(action) {
  const nestedAction = action?.action ?? null;
  const target = action?.suggestedTarget
    ?? action?.preferredTarget
    ?? action?.target
    ?? nestedAction?.suggestedTarget
    ?? nestedAction?.preferredTarget
    ?? nestedAction?.target
    ?? null;
  const ids = Array.from(new Set([
    action?.targetingProfile?.preferredTargetId,
    nestedAction?.targetingProfile?.preferredTargetId,
    target?.id,
    target?.uuid,
    target?.token?.id,
    target?.token?.uuid,
  ].filter(Boolean)));
  // A spell for several creatures (Electric Arc) also plans the others it can reach.
  const extras = target ? [action?.extraTargets, nestedAction?.extraTargets].find(Array.isArray) ?? [] : [];
  const extraIds = extras.map((extra) => extra?.token?.id ?? extra?.id).filter(Boolean);
  const names = [target, ...extras].map((entry) => entry?.name ?? entry?.label ?? entry?.token?.name).filter(Boolean);
  return {
    targets: target ? [target, ...extras] : [],
    targetTokenIds: [...new Set([...ids, ...extraIds])],
    targetLabel: names.length ? t("Label.Target", "Target: {name}", { name: names.join(", ") }) : "",
  };
}

function normalizedIds(ids) {
  return Array.isArray(ids) ? ids.filter(Boolean) : [ids].filter(Boolean);
}

function storedTargetSelection(step, action) {
  const source = { targetTokenIds: normalizedIds(step?.targetTokenIds), targetLabel: step?.targetLabel ?? "" };
  if (!source.targetTokenIds.length) return null;
  // Picked by hand, or "Use best target" (Shift-click): the user chose it, so it stands. Best target
  // ids are the planner's, aliases included, so they resolve like a planned target.
  if (step?.targetSelection === "manual") return source;
  if (step?.targetSelection === "recommended") return { ...source, planned: true };

  const recommendedIds = new Set(plannedTargetSelection(action).targetTokenIds);
  const matchesRecommendation = recommendedIds.size > 0
    && source.targetTokenIds.every((id) => recommendedIds.has(id));
  return matchesRecommendation ? null : source;
}

function targetSelectionSources(step, action, choices = {}) {
  if (Object.prototype.hasOwnProperty.call(choices, "targetTokenIds")) {
    return [{ targetTokenIds: normalizedIds(choices.targetTokenIds), targetLabel: choices.targetLabel ?? "" }];
  }

  // With no target of its own, a step runs at the one the planner aimed it at (Electric Arc -> the
  // adjacent creature); only a step with neither asks for a target.
  // The planned target lives on the step (auto-fill) or its action (a recommendation).
  const stored = storedTargetSelection(step, action);
  // An action the player added themselves never runs on the planner's pick.
  if (step?.ownTarget) return [stored].filter((source) => source?.targetTokenIds?.length);
  const fromStep = plannedTargetSelection(step);
  const planned = { ...(fromStep.targetTokenIds.length ? fromStep : plannedTargetSelection(action)), planned: true };
  return [stored, planned].filter((source) => source?.targetTokenIds?.length);
}

function targetTokenById(id) {
  const token = canvasTokenById(id);
  if (token) return token;
  return collectionValues(globalThis.game?.user?.targets).find((target) => targetTokenId(target) === id) ?? null;
}

export function targetActor(token) {
  return token?.actor ?? token?.document?.actor ?? token?.object?.actor ?? null;
}

export function targetTokenUuid(token) {
  const document = token?.document ?? token;
  return document?.uuid ?? token?.uuid ?? null;
}

function targetLabelFor(token) {
  const name = targetTokenName(token);
  return name ? t("Label.Target", "Target: {name}", { name }) : "";
}

function clearTokenTargets() {
  try {
    globalThis.canvas?.tokens?.setTargets?.([]);
  } catch (_error) {
    // Optional in Foundry test harnesses and older canvas mocks.
  }
}

function applyTokenTarget(token) {
  if (typeof token?.setTarget === "function") {
    token.setTarget(true, { releaseOthers: false });
    return true;
  }
  if (typeof token?.object?.setTarget === "function") {
    token.object.setTarget(true, { releaseOthers: false });
    return true;
  }
  if (typeof token?.document?.object?.setTarget === "function") {
    token.document.object.setTarget(true, { releaseOthers: false });
    return true;
  }
  return false;
}

export function setTarget(token) {
  clearTokenTargets();
  return applyTokenTarget(token);
}

// Replace the user's targets with the given tokens (used to target everyone in an area).
export function setTokenTargets(tokens) {
  clearTokenTargets();
  let count = 0;
  for (const token of Array.isArray(tokens) ? tokens : []) {
    if (applyTokenTarget(token)) count += 1;
  }
  return count;
}

export function resolveTarget(step, action, choices) {
  for (const source of targetSelectionSources(step, action, choices)) {
    const maxTargets = Number(action?.targetingProfile?.maxTargets ?? action?.action?.targetingProfile?.maxTargets);
    const multi = Number.isInteger(maxTargets) && maxTargets > 1;
    // Planned ids include aliases of one creature (token id, uuid): resolve each, keep distinct
    // tokens, and take as many as the action allows. An unresolvable alias is not a missing target.
    if (source.planned) {
      const tokens = [];
      for (const found of source.targetTokenIds.map((id) => targetTokenById(id)).filter(Boolean)) {
        if (!tokens.some((token) => targetTokenId(token) === targetTokenId(found))) tokens.push(found);
      }
      if (!tokens.length) continue;
      if (!multi || tokens.length === 1) {
        return { token: tokens[0], id: targetTokenId(tokens[0]), label: targetLabelFor(tokens[0]) || source.targetLabel };
      }
      const chosen = tokens.slice(0, maxTargets);
      return {
        token: chosen[0], id: targetTokenId(chosen[0]), tokens: chosen,
        ids: chosen.map(targetTokenId),
        label: t("Label.Target", "Target: {name}", { name: chosen.map(targetTokenName).join(", ") }),
      };
    }
    if (multi) {
      // Every id must still be on the canvas (a deleted target asks again). Several ids can name
      // one creature (token id and uuid, as auto-fill stores them), so count distinct tokens.
      const selectedIds = [...new Set(source.targetTokenIds)];
      const resolved = selectedIds.map((id) => targetTokenById(id));
      const tokens = [...new Set(resolved.filter(Boolean))];
      if (resolved.some((token) => !token) || tokens.length > maxTargets) return null;
      if (tokens.length) return {
        token: tokens[0], id: targetTokenId(tokens[0]), tokens,
        ids: tokens.map(targetTokenId),
        label: t("Label.Target", "Target: {name}", { name: tokens.map(targetTokenName).join(", ") }),
      };
    }
    const token = source.targetTokenIds.map((id) => targetTokenById(id)).find(Boolean) ?? null;
    if (token) return { token, id: targetTokenId(token), label: targetLabelFor(token) || source.targetLabel };
  }
  return null;
}
