import { actionSlug } from "../action/requirements.js";
import { slugify } from "../action/text.js";
import { targetActor, targetTokenUuid } from "./targets.js";

function numeric(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function actionContextSlug(action) {
  return slugify(actionSlug(action))
    || slugify(action?.item?.slug)
    || slugify(action?.item?.name)
    || slugify(action?.name);
}

function pf2eDamageRollClass() {
  return globalThis.game?.pf2e?.DamageRoll
    ?? globalThis.CONFIG?.Dice?.rolls?.find?.((cls) => cls?.name === "DamageRoll")
    ?? null;
}

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function actionDisplayName(action) {
  return action?.item?.name ?? action?.name ?? "Damage";
}

function damageContextOptions(action) {
  const slug = actionContextSlug(action);
  const options = [];
  if (slug) {
    options.push(`item:slug:${slug}`, `self:action:slug:${slug}`);
  }
  const cost = numeric(action?.actionCost ?? action?.cost);
  if (cost) options.push(`self:action:cost:${cost}`);
  return options;
}

function damageTargetFlag(target) {
  const token = target?.token ?? target;
  const actor = targetActor(token);
  const tokenUuid = targetTokenUuid(token);
  return actor?.uuid && tokenUuid ? { actor: actor.uuid, token: tokenUuid } : null;
}

function damageOriginFlag(action) {
  if (typeof action?.item?.getOriginData === "function") return action.item.getOriginData();
  const uuid = action?.item?.uuid ?? action?.uuid ?? action?.sourceId ?? null;
  if (!uuid) return null;
  return { uuid };
}

function damageMessageFlags({ actor, action, target }) {
  const slug = actionContextSlug(action);
  const targetFlag = damageTargetFlag(target);
  const origin = damageOriginFlag(action);
  const traits = Array.isArray(action?.traits)
    ? action.traits
    : Array.isArray(action?.item?.system?.traits?.value)
      ? action.item.system.traits.value
      : [];
  return {
    pf2e: {
      context: {
        type: "damage-roll",
        sourceType: action?.attackTrait ? "attack" : "save",
        actor: actor?.id ?? null,
        token: actor?.token?.id ?? null,
        target: targetFlag,
        domains: slug ? [`${slug}-damage`, "damage-roll"] : ["damage-roll"],
        options: damageContextOptions(action),
        contextualOptions: {},
        traits,
        notes: [],
        secret: false,
        outcome: null,
        unadjustedOutcome: null,
      },
      target: targetFlag,
      ...(origin ? { origin } : {}),
      modifiers: [],
      dice: [],
    },
  };
}

function damageFlavor(action) {
  return `<h4 class="action">${htmlEscape(actionDisplayName(action))}</h4>`;
}

// Prefer parsed profile, but fall back to @Damage[...] in action/item description when reader shape
// carries only an average.
function actionDamageFormula(action) {
  const profileFormula = action?.damageProfile?.formula;
  if (profileFormula) {
    return {
      formula: String(profileFormula).trim(),
      type: action.damageProfile.type ?? null,
      kinds: Array.isArray(action.damageProfile.kinds) ? action.damageProfile.kinds : [],
    };
  }
  const raw = [
    action?.description?.value ?? action?.description,
    action?.system?.description?.value ?? action?.system?.description,
    action?.item?.system?.description?.value ?? action?.item?.system?.description,
    action?.item?.description?.value ?? action?.item?.description,
  ].filter((value) => typeof value === "string").join(" ");
  const match = raw.match(/@Damage\[([^\][]+)(?:\[([^\]]+)\])?/i);
  if (!match) return null;
  return { formula: String(match[1]).trim(), type: match[2] ? String(match[2]).trim() : null };
}

// PF2e adds this to an elite/weak NPC's inline damage: +/-2, or +/-4 for a limited-use ability.
export function npcAdjustmentModifier(actor, action) {
  const isNpc = actor?.type === "npc" || actor?.isOfType?.("npc") === true;
  if (!isNpc || (!actor.isElite && !actor.isWeak)) return 0;
  const frequency = action?.item?.system?.frequency ?? action?.system?.frequency ?? action?.item?.frequency ?? null;
  const amount = frequency ? 4 : 2;
  return actor.isElite ? amount : -amount;
}

function adjustedFormula(formula, modifier) {
  if (!modifier) return formula;
  return `${formula}${modifier > 0 ? "+" : "-"}${Math.abs(modifier)}`;
}

// PF2e reads a roll's kind from its flavor: "vitality,healing" posts a healing card (Heal buttons),
// plain "vitality" a damage card.
function damageFlavorTags(type, kinds = []) {
  if (!kinds.includes("healing")) return type;
  return kinds.includes("damage") ? `${type},damage,healing` : `${type},healing`;
}

async function rollActionDamage({ actor, action, target = null, timestamp = null }) {
  const parsed = actionDamageFormula(action);
  if (!parsed?.formula) return null;
  const DamageRoll = pf2eDamageRollClass();
  if (typeof DamageRoll !== "function") return null;

  // An already-typed formula ("2d6[fire]") is left as is; a plain one takes the adjustment inside
  // its type, so "2d6" for a weak NPC rolls "(2d6-2)[bludgeoning]" like PF2e's own link.
  const preTyped = /\[[^\]]+\]/.test(parsed.formula);
  const formula = preTyped ? parsed.formula : adjustedFormula(parsed.formula, npcAdjustmentModifier(actor, action));
  const type = parsed.type ? String(parsed.type).toLowerCase() : null;
  const typed = !type || preTyped ? formula : `(${formula})[${damageFlavorTags(type, parsed.kinds)}]`;
  try {
    const rollData = typeof actor?.getRollData === "function" ? actor.getRollData() : {};
    const showBreakdown = globalThis.game?.pf2e?.settings?.metagame?.breakdowns || Boolean(actor?.hasPlayerOwner);
    const roll = new DamageRoll(typed, rollData, { showBreakdown });
    if (typeof roll.evaluate === "function") await roll.evaluate();
    if (typeof roll.toMessage !== "function") return null;
    const message = await roll.toMessage({
      speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }) ?? {},
      flavor: damageFlavor(action),
      flags: damageMessageFlags({ actor, action, target }),
      ...(Number.isFinite(timestamp) ? { timestamp } : {}),
    });
    return message?.id ?? message?._id ?? null;
  } catch (error) {
    globalThis.console?.warn?.("pf2e-combater | Auto damage roll failed", error);
    return null;
  }
}

function damageRollCount(action) {
  if (action?.activityProfile?.damageScalesWithActions !== true) return 1;
  const cost = numeric(action?.actionCost ?? action?.cost, 1);
  return Math.max(1, Math.min(3, cost || 1));
}

export async function flushPendingChat() {
  const schedule = globalThis.setTimeout;
  if (typeof schedule !== "function") return;
  await new Promise((resolve) => { schedule(resolve, 0); });
}

// A spell with no target and no area (Glass Shield, Fire Shield) deals its damage later, on a
// trigger (the shield breaking, a creature touching you). Its card keeps a Roll Damage button for
// that moment; rolling now would put damage in chat that never happened.
export function damageWaitsForTrigger(action) {
  const item = action?.item ?? null;
  const type = item?.type ?? action?.type ?? null;
  if (type !== "spell") return false;
  const system = item?.system ?? action?.system ?? {};
  const target = String(system.target?.value ?? "").trim();
  const area = system.area && (system.area.value || system.area.type);
  return !target && !area;
}

function wait(ms) {
  const schedule = globalThis.setTimeout;
  return typeof schedule === "function" ? new Promise((resolve) => { schedule(resolve, ms); }) : Promise.resolve();
}

// The first inline damage link on the posted card, once the chat log has rendered it.
async function cardDamageLink(messageId, { attempts = 20, interval = 50 } = {}) {
  const documentRoot = globalThis.document;
  if (!messageId || typeof documentRoot?.querySelectorAll !== "function") return null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const card of documentRoot.querySelectorAll(`[data-message-id="${messageId}"]`)) {
      const link = card.querySelector?.(".inline-roll[data-damage-roll]");
      if (link) return link;
    }
    await wait(interval);
  }
  return null;
}

function isActorDamageMessage(message, actor) {
  const rolls = Array.isArray(message?.rolls) ? message.rolls : [];
  const damage = message?.isDamageRoll === true || rolls.some((roll) => roll?.constructor?.name === "DamageRoll");
  const speakerActor = message?.speaker?.actor ?? message?.actor?.id ?? null;
  return damage && (!actor?.id || !speakerActor || speakerActor === actor.id);
}

// An NPC ability's damage is rolled from its own card's inline link, as a GM clicking it would: PF2e
// adds elite/weak and the creature's damage bonuses, and PF2e Toolbelt's Target Helper carries the
// card's saves onto the damage. Not clicked when the card or link isn't there, so the caller rolls
// instead; once clicked, PF2e owns it (its damage dialog may be cancelled) and nothing else is rolled.
async function clickCardDamageLink({ actor, cardMessage, timeout = 15000 }) {
  const notClicked = { clicked: false, messageId: null };
  const hooks = globalThis.Hooks;
  if (!cardMessage?.id || typeof hooks?.on !== "function" || typeof hooks?.off !== "function") return notClicked;
  const link = await cardDamageLink(cardMessage.id);
  if (typeof link?.click !== "function") return notClicked;
  let hookId = null;
  const created = new Promise((resolve) => {
    hookId = hooks.on("createChatMessage", (message) => {
      if (message?.id !== cardMessage.id && isActorDamageMessage(message, actor)) resolve(message);
    });
  });
  try {
    link.click();
    const message = await Promise.race([created, wait(timeout).then(() => null)]);
    return { clicked: true, messageId: message?.id ?? null };
  } finally {
    hooks.off("createChatMessage", hookId);
  }
}

function rollsFromCardLink(action, count, cardMessage) {
  const type = action?.item?.type ?? action?.type ?? null;
  return count === 1 && Boolean(cardMessage?.id) && type !== "spell";
}

export async function rollActionDamageMessages({ actor, action, target = null, after = null, cardMessage = null }) {
  if (damageWaitsForTrigger(action)) return [];
  const count = damageRollCount(action);
  if (rollsFromCardLink(action, count, cardMessage)) {
    const clicked = await clickCardDamageLink({ actor, cardMessage }).catch(() => null);
    if (clicked?.clicked) return clicked.messageId ? [clicked.messageId] : [];
  }
  const base = Number.isFinite(after) ? after : null;
  const messageIds = [];
  for (let index = 0; index < count; index += 1) {
    const timestamp = base != null ? base + 1 + index : null;
    const messageId = await rollActionDamage({ actor, action, target, timestamp });
    if (messageId) messageIds.push(messageId);
  }
  return messageIds;
}
