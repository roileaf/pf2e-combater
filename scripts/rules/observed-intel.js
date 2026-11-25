import { systemFlags } from "../system.js";
import { MODULE_ID } from "../constants.js";
import { SETTINGS, componentEnabled, settingOrDefault } from "../settings.js";
import { INTEL_LEDGER_FLAG, intelAbilityFactId, intelActor, intelDefenseFactId, intelFactId, readIntelLedger, writeIntelFlags } from "./intel-ledger.js";

// What the party sees an enemy do, it knows: a Strike it makes, a reaction it takes (Reactive Strike),
// an ability it uses in the open. Recorded in that creature's Intel like a Recall Knowledge answer, so
// planning stops treating a Reactive Strike it already watched land as unknown.

// The Intel category and fact a chat message reveals, or null.
export function observedIntelFact(message) {
  const item = message?.item;
  const actor = message?.actor ?? item?.actor;
  if (!item || actor?.type !== "npc") return null;
  const contextType = String(systemFlags(message)?.context?.type ?? "");
  if (item.type === "melee" || contextType === "attack-roll") {
    return { actor, category: "strikes", factId: intelFactId(item.name) };
  }
  if (item.type !== "action") return null;
  const actionType = String(item.system?.actionType?.value ?? "").toLowerCase();
  if (actionType === "passive") return null;
  // A reaction happens in plain view (the ogre swings as you move past); other abilities only count
  // when the message wasn't kept to the GM.
  const visible = actionType === "reaction" || !(Array.isArray(message?.whisper) && message.whisper.length) && message?.blind !== true;
  return visible ? { actor, category: "actions", factId: intelAbilityFactId(item.name) } : null;
}

// PF2e's "damage taken" card lists what changed the damage (its info icon): each weakness, resistance
// and immunity that applied. Those the party just watched work.
const APPLIED_DEFENSE_CATEGORIES = { weakness: "weaknesses", resistance: "resistances", immunity: "immunities" };
const HTML_ENTITIES = { quot: '"', amp: "&", lt: "<", gt: ">", "#x27": "'", "#39": "'", "#x3D": "=", "#x60": "`" };

function damageApplications(message) {
  const encoded = /data-applications="([^"]*)"/.exec(String(message?.content ?? ""))?.[1];
  if (!encoded) return [];
  try {
    const parsed = JSON.parse(encoded.replace(/&(quot|amp|lt|gt|#x27|#39|#x3D|#x60);/g, (_match, name) => HTML_ENTITIES[name]));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function defenseList(actor, category) {
  const value = actor?.attributes?.[category] ?? actor?.system?.attributes?.[category];
  if (Array.isArray(value)) return value;
  return value && typeof value === "object" ? Object.values(value) : [];
}

const plain = (value) => String(value ?? "").toLowerCase().replace(/-/g, " ").trim();

// The card names a defense by its label ("Piercing", "Physical (except silver)"), not its slug.
function appliedDefenseEntry(entries, appliedType) {
  const wanted = plain(appliedType);
  if (!wanted) return null;
  const names = (entry) => [entry?.label, entry?.typeLabel, entry?.applicationLabel, entry?.type].map(plain).filter(Boolean);
  return entries.find((entry) => names(entry).includes(wanted))
    ?? entries.find((entry) => names(entry).some((name) => wanted.startsWith(name) || name.startsWith(wanted)))
    ?? null;
}

// The weaknesses, resistances and immunities a damage-taken card shows applying to an NPC.
export function observedDefenseFacts(message) {
  if (systemFlags(message)?.context?.type !== "damage-taken") return [];
  const actor = message?.actor;
  if (actor?.type !== "npc") return [];
  const seen = new Set();
  return damageApplications(message).flatMap((application) => {
    const category = APPLIED_DEFENSE_CATEGORIES[application?.category];
    // A resistance the attack ignored, or one that changed nothing, showed the party nothing.
    if (!category || application.ignored === true || !Number(application.adjustment)) return [];
    const entry = appliedDefenseEntry(defenseList(actor, category), application.type);
    if (!entry) return [];
    const factId = intelDefenseFactId(entry, { showValue: category !== "immunities" });
    const key = `${category}:${factId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ actor, category, factId }];
  });
}

export async function recordObservedIntel(actor, category, factId) {
  if (!actor || !factId || typeof intelActor(actor)?.setFlag !== "function") return false;
  const ledger = readIntelLedger(actor);
  const current = ledger[category];
  if (current === true || (Array.isArray(current) && current.includes(factId))) return false;
  const raw = intelActor(actor).getFlag?.(MODULE_ID, INTEL_LEDGER_FLAG) ?? {};
  // Every token of this creature learns it (see intelActor).
  await writeIntelFlags(actor, { ledger: { ...raw, ...ledger, [category]: [...(Array.isArray(current) ? current : []), factId] } });
  return true;
}

// The started combat the message happened in: the one on the speaker's scene, not whichever scene
// the GM happens to be viewing (game.combat follows the viewed scene).
export function combatForMessage(message, combats = globalThis.game?.combats?.contents ?? []) {
  const sceneId = message?.speaker?.scene ?? null;
  const tokenId = message?.speaker?.token ?? null;
  const started = combats.filter((combat) => combat?.started);
  const onScene = started.filter((combat) => !sceneId || !combat.scene || combat.scene.id === sceneId);
  return onScene.find((combat) => tokenId && combat.combatants?.some?.((combatant) => combatant.tokenId === tokenId))
    ?? onScene.find((combat) => combat.active)
    ?? onScene[0]
    ?? null;
}

export function registerObservedIntelHooks() {
  Hooks.on("createChatMessage", (message) => {
    // One writer: the active GM's client.
    if (game.user?.isActiveGM !== true) return;
    if (!componentEnabled("intel")) return;
    const combat = combatForMessage(message);
    if (!combat) return;
    const record = (facts) => (async () => {
      for (const fact of facts) await recordObservedIntel(fact.actor, fact.category, fact.factId);
    })().catch((error) => {
      console.warn(`${MODULE_ID} | Could not record observed Intel:`, error);
    });
    if (settingOrDefault(SETTINGS.learnAppliedDefenses, false)) {
      const defenses = observedDefenseFacts(message);
      if (defenses.length) record(defenses);
    }
    if (!settingOrDefault(SETTINGS.learnObservedIntel, true)) return;
    const observed = observedIntelFact(message);
    if (!observed) return;
    const facts = [observed];
    // A Strike rolled outside the creature's own turn is a reaction: if it has Reactive Strike (or
    // Attack of Opportunity), the party just watched it.
    if (observed.category === "strikes" && combat.combatant?.actor?.id !== observed.actor.id) {
      const reaction = observed.actor.itemTypes?.action?.find((item) => /^(reactive strike|attack of opportunity)$/i.test(String(item.name ?? "")));
      if (reaction) facts.push({ actor: observed.actor, category: "actions", factId: intelAbilityFactId(reaction.name) });
    }
    record(facts);
  });
}
