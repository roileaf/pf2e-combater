import { MODULE_ID } from "../constants.js";
import { entityKey } from "../foundry-data.js";
import { t } from "../i18n.js";
import { defaultIntelRevealMode } from "../settings.js";

export const INTEL_LEDGER_FLAG = "intelLedger";
export const INTEL_REVEAL_MODE_FLAG = "intelRevealMode";
export const INTEL_FALSE_INFORMATION_FLAG = "intelFalseInformation";
// GM-written notes about the creature; players read them once the GM reveals them.
export const INTEL_DETAILS_FLAG = "intelDetails";
// What single characters learned and didn't share: { [characterActorId]: { name, ledger } }. The
// ledger above is what the whole party knows; a character knows that plus its own entry.
export const INTEL_CHARACTER_LEDGERS_FLAG = "intelCharacterLedgers";
export const PARTY_INTEL_AUDIENCE = "party";
const INTEL_DETAILS_MAX_LENGTH = 4000;
export const INTEL_REVEAL_MODES = {
  exact: "exact",
  band: "band",
};

export const INTEL_LEDGER_CATEGORIES = [
  { id: "identity", label: "Identity" },
  { id: "traits", label: "Traits" },
  { id: "saves", label: "Saves" },
  { id: "perception", label: "Perception" },
  { id: "senses", label: "Senses" },
  { id: "skills", label: "Skills" },
  { id: "languages", label: "Languages" },
  { id: "weaknesses", label: "Weaknesses" },
  { id: "resistances", label: "Resistances" },
  { id: "immunities", label: "Immunities" },
  { id: "strikes", label: "Strikes" },
  { id: "actions", label: "Actions" },
  { id: "passives", label: "Passives" },
];

const CATEGORY_IDS = new Set(INTEL_LEDGER_CATEGORIES.map((entry) => entry.id));
export const NONE_FACT_ID = "__none";
const CREATURE_IDENTIFICATION_TRAITS = new Set([
  "aberration",
  "animal",
  "astral",
  "beast",
  "celestial",
  "construct",
  "dragon",
  "dream",
  "elemental",
  "ethereal",
  "fey",
  "fiend",
  "fungus",
  "humanoid",
  "monitor",
  "ooze",
  "plant",
  "shade",
  "spirit",
  "time",
  "undead",
]);

const SAVE_MODERATE_DCS_BY_LEVEL = new Map([
  [-1, 13],
  [0, 16],
  [1, 17],
  [2, 19],
  [3, 21],
  [4, 22],
  [5, 24],
  [6, 25],
  [7, 27],
  [8, 28],
  [9, 30],
  [10, 31],
  [11, 33],
  [12, 35],
  [13, 36],
  [14, 38],
  [15, 39],
  [16, 40],
  [17, 42],
  [18, 43],
  [19, 45],
  [20, 46],
  [21, 48],
  [22, 49],
  [23, 51],
  [24, 52],
  [25, 54],
]);

const INTEL_BAND_LABELS = {
  low: "Low",
  mid: "Mid",
  high: "High",
};

function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function intelFactId(value) {
  const id = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || "unknown";
}

function targetActor(target) {
  const actor = target?.actor?.document ?? target?.actor?.object ?? target?.actor;
  return actor && typeof actor === "object" ? actor : null;
}

function actorType(actor) {
  return String(actor?.type ?? actor?.document?.type ?? "").toLowerCase();
}

export function isNpcIntelTarget(target) {
  return actorType(targetActor(target)) === "npc";
}

function targetIdentityValues(target) {
  const actor = targetActor(target);
  const token = target?.token?.document ?? target?.token ?? target?.document ?? target;
  return [
    target?.id,
    target?.uuid,
    token?.id,
    token?.uuid,
    token?.object?.id,
    token?.object?.uuid,
    token?.document?.id,
    token?.document?.uuid,
    actor?.id,
    actor?.uuid,
  ].filter(Boolean).map(String);
}

export function intelTargetKey(target) {
  return targetIdentityValues(target)[0] ?? "";
}

export function intelTargetMatchesKey(target, key) {
  const value = String(key ?? "");
  return Boolean(value) && targetIdentityValues(target).includes(value);
}

function rawFlag(actor, key) {
  const direct = actor?.flags?.[MODULE_ID]?.[key];
  if (direct !== undefined) return direct;
  if (typeof actor?.getFlag === "function") return actor.getFlag(MODULE_ID, key) ?? null;
  return null;
}

// Intel is about the creature, not one copy of it. An unlinked token's actor is the token's own
// copy, so intel saved there stayed with that one token; it lives on the base actor instead, and
// every token of that actor shares it.
export function intelActor(actor) {
  if (actor?.isToken !== true) return actor;
  return actor.token?.baseActor ?? globalThis.game?.actors?.get?.(actor.id) ?? actor;
}

function readFlag(actor, key) {
  const base = intelActor(actor);
  const value = rawFlag(base, key);
  return value !== null || base === actor ? value : rawFlag(actor, key);
}

function mergeCategoryValues(a, b) {
  if (a === true || b === true) return true;
  const values = [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];
  return values.length ? values : false;
}

function readRevealModeFlag(actorOrTarget) {
  if (actorOrTarget?.intelRevealMode !== undefined) return actorOrTarget.intelRevealMode;
  const actor = targetActor(actorOrTarget) ?? actorOrTarget;
  if (actor?.intelRevealMode !== undefined) return actor.intelRevealMode;
  return readFlag(actor, INTEL_REVEAL_MODE_FLAG);
}

function readFalseInformationFlag(actorOrTarget) {
  const actor = targetActor(actorOrTarget) ?? actorOrTarget;
  if (actor?.intelFalseInformation !== undefined) return actor.intelFalseInformation;
  return readFlag(actor, INTEL_FALSE_INFORMATION_FLAG);
}

// Saves to the base actor, and clears a token's own older copy so it reads the shared one.
export async function writeIntelFlags(actor, values = {}) {
  const base = intelActor(actor);
  if (typeof base?.setFlag !== "function") throw new Error("Actor flags unavailable");
  const keys = {
    ledger: INTEL_LEDGER_FLAG,
    revealMode: INTEL_REVEAL_MODE_FLAG,
    falseInformation: INTEL_FALSE_INFORMATION_FLAG,
    details: INTEL_DETAILS_FLAG,
    characterLedgers: INTEL_CHARACTER_LEDGERS_FLAG,
  };
  for (const [name, key] of Object.entries(keys)) {
    if (values[name] !== undefined) await base.setFlag(MODULE_ID, key, values[name]);
  }
  if (base === actor) return base;
  const tokenFlags = actor.token?.delta?._source?.flags?.[MODULE_ID] ?? {};
  for (const key of Object.values(keys)) {
    if (tokenFlags[key] !== undefined && typeof actor.unsetFlag === "function") await actor.unsetFlag(MODULE_ID, key);
  }
  return base;
}

export function normalizeIntelFalseInformation(value) {
  return (Array.isArray(value) ? value : []).flatMap((entry, index) => {
    const text = String(entry?.text ?? (typeof entry === "string" ? entry : "")).trim();
    const factId = String(entry?.factId ?? "").trim();
    const factLabel = String(entry?.factLabel ?? "").trim();
    const numericValue = Number(entry?.value);
    const hasValue = entry?.value !== "" && entry?.value !== null && entry?.value !== undefined && Number.isFinite(numericValue);
    const valueNumber = hasValue && numericValue >= 0 ? numericValue : null;
    const category = CATEGORY_IDS.has(String(entry?.category ?? "")) ? String(entry.category) : "traits";
    if (!text && !factId) return [];
    let label = String(entry?.label ?? "").trim();
    if (factId) {
      if (category === "saves" || category === "perception") label = `${factLabel || titleCase(factId)}${valueNumber === null ? "" : ` DC ${valueNumber}`}`;
      else if (category === "weaknesses" || category === "resistances") label = `${factLabel || titleCase(factId)}${valueNumber === null ? "" : ` ${valueNumber}`}`;
      else if (category === "skills") label = `${factLabel || titleCase(factId)}${valueNumber === null ? "" : ` +${valueNumber}`}`;
      else label = factLabel || titleCase(factId) || text;
    } else if (!label) label = text;
    return [{
      id: String(entry?.id ?? `false-${index}`),
      text,
      factId,
      factLabel,
      value: valueNumber,
      label,
      sourceActorUuid: String(entry?.sourceActorUuid ?? ""),
      sourceActorName: String(entry?.sourceActorName ?? ""),
      category,
      question: String(entry?.question ?? ""),
      attempt: Math.max(1, Number(entry?.attempt) || 1),
      createdAt: String(entry?.createdAt ?? ""),
      revealed: entry?.revealed !== false,
      // Who believes it: empty is the whole party; a critical failure's falsehood is the roller's alone.
      knownBy: normalizeKnowerIds(entry?.knownBy),
    }];
  });
}

export function readIntelFalseInformation(actorOrTarget) {
  return normalizeIntelFalseInformation(readFalseInformationFlag(actorOrTarget));
}

function normalizeKnowerIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((id) => String(id ?? "").trim()).filter(Boolean))];
}

// The id a character's knowledge is filed under: its world actor (every token of a linked PC shares it).
export function intelKnowerId(actor) {
  const base = intelActor(actor);
  return base?.id ? String(base.id) : "";
}

// A false fact this audience believes: the party's are everyone's; a character's only theirs.
// knowerIds null means everyone (the GM's view).
export function falseInformationKnownBy(record, knowerIds) {
  if (knowerIds === null || knowerIds === undefined) return true;
  const knownBy = normalizeKnowerIds(record?.knownBy);
  return !knownBy.length || knownBy.some((id) => knowerIds.includes(id));
}

export function normalizeCharacterIntelLedgers(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(source).flatMap(([id, entry]) => {
    const key = String(id ?? "").trim();
    if (!key || !entry || typeof entry !== "object") return [];
    const ledger = normalizeIntelLedger(entry.ledger ?? entry);
    if (!Object.values(ledger).some((category) => category === true || (Array.isArray(category) && category.length))) return [];
    return [[key, { name: String(entry.name ?? ""), ledger }]];
  }));
}

export function readCharacterIntelLedgers(actorOrTarget) {
  if (actorOrTarget?.intelCharacterLedgers !== undefined) return normalizeCharacterIntelLedgers(actorOrTarget.intelCharacterLedgers);
  const actor = targetActor(actorOrTarget) ?? actorOrTarget;
  if (actor?.intelCharacterLedgers !== undefined) return normalizeCharacterIntelLedgers(actor.intelCharacterLedgers);
  return normalizeCharacterIntelLedgers(readFlag(actor, INTEL_CHARACTER_LEDGERS_FLAG));
}

export function mergeIntelLedgers(...ledgers) {
  const normalized = ledgers.map((ledger) => normalizeIntelLedger(ledger));
  return Object.fromEntries(INTEL_LEDGER_CATEGORIES.map(({ id }) => [
    id,
    normalized.reduce((value, ledger) => mergeCategoryValues(value, ledger[id]), false),
  ]));
}

// What these characters know about the creature: the party's ledger plus each one's own. With no
// characters (null), everything anyone learned (the GM's view).
export function readKnownIntelLedger(actorOrTarget, knowerIds = null) {
  const actor = targetActor(actorOrTarget) ?? actorOrTarget;
  const party = readIntelLedger(actor);
  const characters = readCharacterIntelLedgers(actorOrTarget);
  const ids = knowerIds === null || knowerIds === undefined ? Object.keys(characters) : knowerIds;
  return mergeIntelLedgers(party, ...ids.map((id) => characters[id]?.ledger).filter(Boolean));
}

// The facts in `ledger` that `base` doesn't already hold (a character's own share above the party's).
export function subtractIntelLedger(ledger, base) {
  const next = normalizeIntelLedger(ledger);
  const known = normalizeIntelLedger(base);
  return Object.fromEntries(INTEL_LEDGER_CATEGORIES.map(({ id }) => {
    if (known[id] === true) return [id, false];
    if (next[id] === true) return [id, true];
    const have = Array.isArray(known[id]) ? known[id] : [];
    const rest = (Array.isArray(next[id]) ? next[id] : []).filter((fact) => !have.includes(fact));
    return [id, rest.length ? rest : false];
  }));
}

function userOwnsActor(user, actor) {
  const owner = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  if (typeof actor?.testUserPermission === "function") return actor.testUserPermission(user, owner) === true;
  return Number(actor?.ownership?.[user?.id] ?? actor?.ownership?.default ?? 0) >= Number(owner);
}

// Whose knowledge this user sees: the characters they own (their assigned character first). Null
// for a GM, who sees everything.
export function viewerIntelKnowerIds(user = globalThis.game?.user) {
  if (!user || user.isGM === true) return null;
  const characters = (globalThis.game?.actors?.contents ?? Array.from(globalThis.game?.actors ?? []))
    .filter((actor) => actor?.type === "character" && userOwnsActor(user, actor));
  return normalizeKnowerIds([user.character?.id, ...characters.map((actor) => actor.id)]);
}

// The characters a GM can file intel under: each player's assigned character (the party), plus
// anyone already holding some and the roller. Without assigned characters, every player-owned one.
export function intelAudienceOptions(actorOrTarget, { extra = [] } = {}) {
  const characters = readCharacterIntelLedgers(actorOrTarget);
  const users = globalThis.game?.users?.contents ?? Array.from(globalThis.game?.users ?? []);
  const assigned = users.filter((user) => user?.isGM !== true).map((user) => user?.character).filter((actor) => actor?.type === "character");
  const allActors = globalThis.game?.actors?.contents ?? Array.from(globalThis.game?.actors ?? []);
  const actors = assigned.length
    ? [...new Set([...assigned, ...allActors.filter((actor) => characters[actor?.id])])]
    : allActors.filter((actor) => actor?.type === "character" && (actor.hasPlayerOwner === true || characters[actor.id]));
  const options = new Map([[PARTY_INTEL_AUDIENCE, { id: PARTY_INTEL_AUDIENCE, label: t("Intel.AudienceParty", "Whole party"), isParty: true }]]);
  for (const actor of actors) options.set(String(actor.id), { id: String(actor.id), label: actor.name, img: actor.img ?? "" });
  for (const [id, entry] of Object.entries(characters)) if (!options.has(id)) options.set(id, { id, label: entry.name || id });
  for (const entry of extra) {
    if (entry?.id && !options.has(entry.id)) options.set(entry.id, { id: entry.id, label: entry.label || entry.id, img: globalThis.game?.actors?.get?.(entry.id)?.img ?? "" });
  }
  return [...options.values()];
}

export function normalizeIntelDetails(value) {
  const source = typeof value === "string" ? { text: value, revealed: true } : (value ?? {});
  const text = String(source.text ?? "").replace(/\r\n?/g, "\n").trim().slice(0, INTEL_DETAILS_MAX_LENGTH);
  return { text, revealed: Boolean(text) && source.revealed === true };
}

export function readIntelDetails(actorOrTarget) {
  if (actorOrTarget?.intelDetails !== undefined) return normalizeIntelDetails(actorOrTarget.intelDetails);
  const actor = targetActor(actorOrTarget) ?? actorOrTarget;
  return normalizeIntelDetails(readFlag(actor, INTEL_DETAILS_FLAG));
}

// Shared by saveFactLabel/defenseLabel/falseInformationDisplayLabel below, which each used to
// format this same "{label}: {band}" string inline wherever a band was found.
function bandedFactLabel(label, band) {
  return band?.label ? t("Intel.BandedFact", "{label}: {band}", { label, band: band.label }) : null;
}

function falseInformationDisplayLabel(record, target, revealMode) {
  const label = record.factLabel || titleCase(record.factId) || record.label || record.text;
  if (record.value === null || revealMode !== INTEL_REVEAL_MODES.band) return record.label || record.text;
  if (record.category === "saves" || record.category === "perception") {
    return bandedFactLabel(label, intelSaveBand(record.value, target)) ?? (record.label || record.text);
  }
  if (record.category === "weaknesses" || record.category === "resistances") {
    return bandedFactLabel(label, intelDefenseValueBand(record.value, target)) ?? (record.label || record.text);
  }
  return record.label || record.text;
}

function normalizeFactIds(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean)
    .map((entry) => entry === NONE_FACT_ID ? NONE_FACT_ID : intelFactId(entry)))];
}

function normalizeCategoryValue(value) {
  if (value === true) return true;
  const factIds = Array.isArray(value) ? normalizeFactIds(value) : normalizeFactIds(value?.facts ?? value?.values ?? []);
  return factIds.length ? factIds : false;
}

export function normalizeIntelLedger(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = Object.fromEntries(
    INTEL_LEDGER_CATEGORIES.map((category) => [category.id, normalizeCategoryValue(source[category.id])]),
  );
  if (!source.perception && Array.isArray(normalized.saves) && normalized.saves.includes("perception")) {
    normalized.perception = ["perception"];
    normalized.saves = normalized.saves.filter((entry) => entry !== "perception");
    if (!normalized.saves.length) normalized.saves = false;
  }
  return normalized;
}

export function readIntelLedger(actor) {
  if (actor?.intelLedger !== undefined) return normalizeIntelLedger(actor.intelLedger);
  const base = intelActor(actor);
  const shared = normalizeIntelLedger(rawFlag(base, INTEL_LEDGER_FLAG));
  if (base === actor) return shared;
  // A token that learned something before intel was shared keeps it until the next save moves it.
  const own = normalizeIntelLedger(rawFlag(actor, INTEL_LEDGER_FLAG));
  return Object.fromEntries(Object.keys(shared).map((category) => [category, mergeCategoryValues(shared[category], own[category])]));
}

export function normalizeIntelRevealMode(value) {
  return value === INTEL_REVEAL_MODES.band ? INTEL_REVEAL_MODES.band : INTEL_REVEAL_MODES.exact;
}

// The creature's own reveal style, or the world default when the GM never chose one for it.
export function readIntelRevealMode(actorOrTarget) {
  const own = readRevealModeFlag(actorOrTarget);
  return normalizeIntelRevealMode(own === null || own === undefined || own === "" ? defaultIntelRevealMode() : own);
}

// False facts the planning character believes about this creature (a critical Recall Knowledge
// failure, or planted by the GM). They read as true to the player, so the planner treats them as
// true as well: a believed fire weakness makes fire attractive. Only the list a combat context put
// on the target counts: it is already filtered to what the acting character believes.
export function believedFalseFacts(target, category = null) {
  const list = Array.isArray(target?.intelFalseInformation) ? target.intelFalseInformation : [];
  return list.filter((record) => record?.revealed === true && record.factId && (!category || record.category === category));
}

// A believed false weakness, resistance or immunity, shaped like the creature's real entries.
export function believedDefenseEntry(record) {
  const value = Number(record?.value);
  return { type: String(record?.factId ?? ""), ...(Number.isFinite(value) && value > 0 ? { value } : {}), intelFalse: true };
}

// A category's entries as the character believes them: a false fact replaces the real entry of the
// same type and is added otherwise.
export function withBelievedDefenses(target, category, entries) {
  const believed = believedFalseFacts(target, category).map(believedDefenseEntry).filter((entry) => entry.type);
  if (!believed.length) return entries;
  const types = new Set(believed.map((entry) => intelFactId(entry.type)));
  const typeOf = (entry) => intelFactId(String(entry?.type?.value ?? entry?.type ?? entry?.slug ?? entry?.label ?? ""));
  return [...(Array.isArray(entries) ? entries : []).filter((entry) => !types.has(typeOf(entry))), ...believed];
}

function believedFactIds(target, category) {
  const records = believedFalseFacts(target, category);
  if (["weaknesses", "resistances", "immunities"].includes(category)) {
    return records.flatMap((record) => [true, false].map((showValue) => intelDefenseFactId(believedDefenseEntry(record), { showValue })));
  }
  return records.map((record) => intelFactId(record.factId));
}

export function canUseIntelCategory(context, target, category) {
  if (!CATEGORY_IDS.has(category)) return false;
  if (!isNpcIntelTarget(target)) return false;
  if (believedFalseFacts(target, category).length) return true;
  if (target?.intelLedger !== undefined) {
    const value = normalizeIntelLedger(target.intelLedger)[category];
    return value === true || (Array.isArray(value) && value.length > 0);
  }
  const actor = targetActor(target);
  if (!actor) return false;
  const value = readIntelLedger(actor)[category];
  return value === true || (Array.isArray(value) && value.length > 0);
}

export function canUseIntelFact(context, target, category, factId) {
  if (!CATEGORY_IDS.has(category)) return false;
  if (!isNpcIntelTarget(target)) return false;
  const ledger = target?.intelLedger !== undefined
    ? normalizeIntelLedger(target.intelLedger)
    : readIntelLedger(targetActor(target));
  const value = ledger[category];
  if (value === true) return true;
  const ids = normalizeFactIds(factId);
  const believed = believedFactIds(target, category);
  if (believed.length && ids.some((id) => believed.includes(id))) return true;
  if (!Array.isArray(value) || !value.length) return false;
  return ids.some((id) => value.includes(id));
}

export function intelCategoryLabel(category) {
  return INTEL_LEDGER_CATEGORIES.find((entry) => entry.id === category)?.label ?? category;
}

function defenseEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return Array.from(value.values());
  if (typeof value === "object") return Object.values(value);
  return [];
}

function actorTraitSlugs(actor) {
  const value = actor?.system?.traits?.value;
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return [];
}

export function intelIdentityTrait(target) {
  const actor = targetActor(target) ?? target;
  const traits = target?.traits ?? target?.traitSlugs ?? actorTraitSlugs(actor);
  return (Array.isArray(traits) ? traits : [])
    .map((trait) => String(trait ?? "").toLowerCase())
    .find((trait) => CREATURE_IDENTIFICATION_TRAITS.has(trait)) ?? null;
}

function actorSaves(actor) {
  const saves = actor?.system?.saves ?? {};
  return {
    fortitude: saves.fortitude?.dc ?? null,
    reflex: saves.reflex?.dc ?? null,
    will: saves.will?.dc ?? null,
  };
}

function actorPerception(actor) {
  const perception = actor?.system?.perception ?? {};
  return perception.dc?.value ?? perception.dc ?? null;
}

function actorDefense(actor, category) {
  return actor?.system?.attributes?.[category] ?? actor?.system?.[category] ?? null;
}

function targetLevel(target) {
  const actor = targetActor(target) ?? target?.actor ?? target;
  const value = Number(
    target?.level
      ?? actor?.level
      ?? actor?.system?.details?.level?.value
      ?? actor?.system?.details?.level,
  );
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function expectedSaveDc(level) {
  const rounded = Math.round(Number(level));
  if (SAVE_MODERATE_DCS_BY_LEVEL.has(rounded)) return SAVE_MODERATE_DCS_BY_LEVEL.get(rounded);
  if (rounded < -1) return SAVE_MODERATE_DCS_BY_LEVEL.get(-1);
  const highestLevel = 25;
  return SAVE_MODERATE_DCS_BY_LEVEL.get(highestLevel) + ((rounded - highestLevel) * 2);
}

function expectedDefenseValue(level) {
  const rounded = Math.round(Number(level));
  if (rounded <= 1) return 3;
  if (rounded <= 4) return 5;
  if (rounded <= 8) return 7;
  if (rounded <= 12) return 10;
  if (rounded <= 16) return 15;
  if (rounded <= 20) return 20;
  return 25;
}

function valueBand(value, expected) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number <= Math.max(1, Math.floor(expected * 0.67))) return "low";
  if (number >= Math.ceil(expected * 1.34)) return "high";
  return "mid";
}

function bandLabel(band) {
  return INTEL_BAND_LABELS[band] ?? INTEL_BAND_LABELS.mid;
}

export function intelSaveBand(value, target) {
  const dc = Number(value);
  if (!Number.isFinite(dc)) return null;
  const expected = expectedSaveDc(targetLevel(target));
  const band = dc <= expected - 3 ? "low" : dc >= expected + 3 ? "high" : "mid";
  return {
    id: band,
    label: bandLabel(band),
    approximateDc: band === "low" ? expected - 4 : band === "high" ? expected + 4 : expected,
  };
}

export function intelDefenseValueBand(value, target) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const expected = expectedDefenseValue(targetLevel(target));
  const band = valueBand(amount, expected) ?? "mid";
  return {
    id: band,
    label: bandLabel(band),
    approximateValue: band === "low"
      ? Math.max(1, Math.floor(expected * 0.67))
      : band === "high"
        ? Math.ceil(expected * 1.5)
        : expected,
  };
}

export function bandedIntelDefenseEntry(entry, target, { showValue = true } = {}) {
  if (!showValue) return entry;
  const band = intelDefenseValueBand(entry?.value ?? entry?.amount ?? entry?.total ?? entry?.modifier, target);
  if (!band) return entry;
  return {
    ...entry,
    value: band.approximateValue,
    intelBand: band.id,
    intelBandLabel: band.label,
    exactValueHidden: true,
  };
}

function exactDefenseLabel(entry, { showValue = true } = {}) {
  const type = entry?.type?.value ?? entry?.type ?? entry?.slug?.value ?? entry?.slug ?? entry?.label ?? entry?.name;
  const label = titleCase(type || t("Intel.UnknownType", "Unknown"));
  const value = Number(entry?.value ?? entry?.amount ?? entry?.total ?? entry?.modifier);
  return showValue && Number.isFinite(value) && value > 0 ? `${label} ${value}` : label;
}

function defenseLabel(entry, { showValue = true, revealMode = INTEL_REVEAL_MODES.exact, target = null } = {}) {
  const label = exactDefenseLabel(entry, { showValue: false });
  const value = Number(entry?.value ?? entry?.amount ?? entry?.total ?? entry?.modifier);
  if (showValue && revealMode === INTEL_REVEAL_MODES.band && Number.isFinite(value) && value > 0) {
    const knownBand = entry?.intelBandLabel ? { label: entry.intelBandLabel } : intelDefenseValueBand(value, target);
    return bandedFactLabel(label, knownBand) ?? label;
  }
  return exactDefenseLabel(entry, { showValue });
}

export function intelDefenseFactId(entry, { showValue = true } = {}) {
  return intelFactId(exactDefenseLabel(entry, { showValue }));
}

export function intelTraitFactId(trait) {
  return intelFactId(trait);
}

function fact(id, label, extra = {}) {
  return { id: id === NONE_FACT_ID ? NONE_FACT_ID : intelFactId(id), label, ...extra };
}

function saveFactLabel(label, value, enemy, revealMode, knownBand = null) {
  if (revealMode === INTEL_REVEAL_MODES.band) {
    const banded = bandedFactLabel(label, knownBand) ?? bandedFactLabel(label, intelSaveBand(value, enemy));
    if (banded) return banded;
  }
  return t("Intel.SaveDc", "{save} DC {dc}", { save: label, dc: value });
}

function saveFacts(enemy, { revealMode = INTEL_REVEAL_MODES.exact } = {}) {
  const actor = targetActor(enemy);
  const saves = enemy?.saves ?? actorSaves(actor);
  const entries = [];
  for (const [key, label] of [
    ["fortitude", "Fortitude"],
    ["reflex", "Reflex"],
    ["will", "Will"],
  ]) {
    const value = Number(saves?.[key]?.dc ?? saves?.[key]);
    const knownBand = enemy?.intelSaveBands?.[key] ?? null;
    if (Number.isFinite(value)) {
      entries.push(fact(key, saveFactLabel(label, value, enemy, revealMode, knownBand), {
        value,
        exactLabel: saveFactLabel(label, value, enemy, INTEL_REVEAL_MODES.exact),
        bandLabel: saveFactLabel(label, value, enemy, INTEL_REVEAL_MODES.band, knownBand),
      }));
    }
  }
  return entries;
}

function perceptionFacts(enemy, { revealMode = INTEL_REVEAL_MODES.exact } = {}) {
  const actor = targetActor(enemy);
  const perception = Number(enemy?.perceptionDC ?? enemy?.perception?.dc ?? actorPerception(actor));
  if (Number.isFinite(perception)) {
    const label = t("Intel.Perception", "Perception");
    const knownBand = enemy?.intelPerceptionBand ?? enemy?.perception?.intelBand ?? null;
    return [fact("perception", saveFactLabel(label, perception, enemy, revealMode, knownBand), {
      exactLabel: saveFactLabel(label, perception, enemy, INTEL_REVEAL_MODES.exact),
      bandLabel: saveFactLabel(label, perception, enemy, INTEL_REVEAL_MODES.band, knownBand),
    })];
  }
  return [];
}

function traitFacts(enemy) {
  const traits = enemy?.traits ?? enemy?.traitSlugs ?? actorTraitSlugs(targetActor(enemy));
  return (Array.isArray(traits) ? traits : [])
    .map((trait) => {
      const label = titleCase(trait);
      return fact(intelTraitFactId(trait), label, { exactLabel: label, bandLabel: label });
    })
    .filter((entry) => entry.label);
}

function identityFacts(enemy) {
  const actor = targetActor(enemy);
  const name = String(enemy?.identityName ?? actor?.name ?? "").trim();
  if (!name) return [];
  // Just the name. Knowing the identity still unlocks its creature category for planning
  // (combat-context reads intelIdentityTrait), but the label doesn't spell it out.
  return [fact("identity", name, { exactLabel: name, bandLabel: name })];
}

function defenseFacts(enemy, category, { showValue = true, revealMode = INTEL_REVEAL_MODES.exact } = {}) {
  return defenseEntries(enemy?.[category] ?? actorDefense(targetActor(enemy), category))
    .map((entry) => fact(intelDefenseFactId(entry, { showValue }), defenseLabel(entry, { showValue, revealMode, target: enemy }), {
      ...(showValue && Number(entry?.value ?? entry?.amount) > 0 ? { value: Number(entry?.value ?? entry?.amount) } : {}),
      exactLabel: defenseLabel(entry, { showValue, revealMode: INTEL_REVEAL_MODES.exact, target: enemy }),
      bandLabel: defenseLabel(entry, { showValue, revealMode: INTEL_REVEAL_MODES.band, target: enemy }),
    }));
}

// An action's name as its fact id, so a fact learned elsewhere (Bestiary Tracking, a planner check
// such as Reactive Strike) matches the same entry.
export function intelAbilityFactId(name) {
  return intelFactId(name);
}

const ABILITY_GLYPHS = { action: "", reaction: " (reaction)", free: " (free)" };

// Actions: the creature's activities and reactions (Reactive Strike, Grab, Breath Weapon);
// passives: always-on abilities (Ferocity, Regeneration, auras). Strikes stay out.
function abilityFacts(enemy, kind) {
  const actor = targetActor(enemy);
  const items = Array.isArray(enemy?.[kind]) ? enemy[kind]
    : (actor?.itemTypes?.action ?? (Array.isArray(actor?.items) ? actor.items : Array.from(actor?.items ?? [])).filter((item) => item?.type === "action"));
  const seen = new Set();
  return (items ?? []).flatMap((item) => {
    const name = String(item?.name ?? "").trim();
    const type = String(item?.system?.actionType?.value ?? item?.actionType ?? "").toLowerCase();
    const isPassive = type === "passive";
    if (!name || (kind === "passives") !== isPassive) return [];
    const id = intelAbilityFactId(name);
    if (seen.has(id)) return [];
    seen.add(id);
    const label = `${name}${ABILITY_GLYPHS[type] ?? ""}`;
    return [fact(id, label, { exactLabel: label, bandLabel: label, ...(item?.uuid ? { uuid: item.uuid } : {}) })];
  });
}

function signed(value) {
  return value >= 0 ? `+${value}` : `${value}`;
}

function localizedConfig(mapName, slug) {
  const raw = globalThis.CONFIG?.PF2E?.[mapName]?.[slug];
  const label = typeof raw === "string" ? raw : raw?.label;
  const localized = label ? globalThis.game?.i18n?.localize?.(label) ?? label : "";
  return localized && localized !== label ? localized : (label && !label.includes(".") ? label : titleCase(slug));
}

// Trained skills (and Lores) with their modifiers: "Athletics +15".
function skillFacts(enemy) {
  const actor = targetActor(enemy);
  return Object.entries(actor?.skills ?? {}).flatMap(([slug, skill]) => {
    if (skill?.proficient !== true && skill?.lore !== true) return [];
    const mod = Number(skill?.mod ?? skill?.totalModifier);
    const name = String(skill?.label ?? titleCase(slug));
    const label = Number.isFinite(mod) ? `${name} ${signed(mod)}` : name;
    return [fact(slug, label, { exactLabel: label, bandLabel: name, ...(Number.isFinite(mod) ? { value: mod } : {}) })];
  });
}

function languageFacts(enemy) {
  const languages = targetActor(enemy)?.system?.details?.languages ?? {};
  const slugs = Array.isArray(languages.value) ? languages.value : Array.from(languages.value ?? []);
  const extra = String(languages.details ?? "").split(/[,;]/).map((entry) => entry.trim()).filter(Boolean);
  return [
    ...slugs.map((slug) => fact(slug, localizedConfig("languages", slug))),
    ...extra.map((entry) => fact(entry, entry)),
  ].map((entry) => ({ ...entry, exactLabel: entry.label, bandLabel: entry.label }));
}

// Darkvision, Scent (imprecise) 30 ft...
function senseFacts(enemy) {
  const actor = targetActor(enemy);
  const senses = actor?.system?.perception?.senses ?? actor?.system?.traits?.senses ?? [];
  return (Array.isArray(senses) ? senses : []).flatMap((sense) => {
    const type = String(sense?.type ?? "").trim();
    if (!type) return [];
    const name = String(sense?.label ?? localizedConfig("senses", type));
    const acuity = sense?.acuity && sense.acuity !== "precise" ? ` (${sense.acuity})` : "";
    const range = Number(sense?.range) > 0 ? ` ${sense.range} ft` : "";
    const label = `${name}${acuity}${range}`;
    return [fact(type, label, { exactLabel: label, bandLabel: label })];
  });
}

// The creature's attacks with attack bonus and reach: "Glaive +17 (reach 10 ft)".
function strikeFacts(enemy) {
  const actor = targetActor(enemy);
  const items = actor?.itemTypes?.melee ?? [];
  return items.flatMap((item) => {
    const name = String(item?.name ?? "").trim();
    if (!name) return [];
    const traits = Array.isArray(item?.system?.traits?.value) ? item.system.traits.value : [];
    const reach = traits.map((trait) => /^reach-(\d+)$/.exec(trait)?.[1]).find(Boolean);
    const ranged = item?.isMelee === false || traits.some((trait) => /^(range|thrown|volley)/.test(trait));
    const note = reach ? ` (reach ${reach} ft)` : ranged ? ` (${t("Intel.Ranged", "ranged")})` : "";
    // Name only: the attack bonus isn't something a Strike in plain view gives away.
    const label = `${name}${note}`;
    return [fact(name, label, { exactLabel: label, bandLabel: label, ...(item?.uuid ? { uuid: item.uuid } : {}) })];
  });
}

function availableIntelFacts(enemy, { revealMode = readIntelRevealMode(enemy) } = {}) {
  return {
    identity: identityFacts(enemy),
    traits: traitFacts(enemy),
    saves: saveFacts(enemy, { revealMode }),
    perception: perceptionFacts(enemy, { revealMode }),
    weaknesses: defenseFacts(enemy, "weaknesses", { revealMode }),
    resistances: defenseFacts(enemy, "resistances", { revealMode }),
    immunities: defenseFacts(enemy, "immunities", { showValue: false, revealMode }),
    senses: senseFacts(enemy),
    skills: skillFacts(enemy),
    languages: languageFacts(enemy),
    strikes: strikeFacts(enemy),
    actions: abilityFacts(enemy, "actions"),
    passives: abilityFacts(enemy, "passives"),
  };
}

function availableIntelDetails(enemy, options) {
  const facts = availableIntelFacts(enemy, options);
  return Object.fromEntries(Object.entries(facts).map(([category, entries]) => [
    category,
    entries.map((entry) => entry.label),
  ]));
}

function selectedFacts(available, value) {
  const none = [t("Intel.None", "None")];
  if (value === true) return available.length ? available : [fact(NONE_FACT_ID, none[0])];
  if (!Array.isArray(value) || !value.length) return [];
  if (!available.length && value.includes(NONE_FACT_ID)) return [fact(NONE_FACT_ID, none[0])];
  return available.filter((entry) => value.includes(entry.id));
}

function revealedIntelFacts(availableFacts, values) {
  const known = (category) => selectedFacts(availableFacts[category] ?? [], values[category]);
  return Object.fromEntries(INTEL_LEDGER_CATEGORIES.map(({ id }) => [id, known(id)]));
}

function revealedIntelDetails(availableFacts, values) {
  const revealed = revealedIntelFacts(availableFacts, values);
  return Object.fromEntries(Object.entries(revealed).map(([category, entries]) => [
    category,
    entries.map((entry) => entry.label),
  ]));
}

function revealedCount(details) {
  return Object.values(details ?? {}).reduce((total, values) => total + (Array.isArray(values) && values.length ? 1 : 0), 0);
}

function ledgerCount(value) {
  if (value === true) return 1;
  return Array.isArray(value) ? value.length : 0;
}

function tokenName(target) {
  const token = target?.token;
  return target?.displayName
    ?? token?.displayName
    ?? token?.name
    ?? token?.object?.name
    ?? token?.document?.name
    ?? null;
}

function targetName(target, actor, isGM, values) {
  const identityKnown = values?.identity === true
    || (Array.isArray(values?.identity) && values.identity.length > 0);
  if (!isGM && identityKnown && actor?.name) return actor.name;
  return tokenName(target)
    ?? target?.name
    ?? (isGM ? actor?.name : null)
    ?? t("Intel.UnknownTarget", "Unknown target");
}

function factIdSet(facts) {
  return new Set(facts.map((entry) => entry.id));
}

// What a save changes, in words: facts newly revealed or hidden per category, and the GM's notes.
// `next` holds the values about to be written (any of ledger, details).
export function describeIntelChanges(actor, next = {}, { knowerIds = undefined } = {}) {
  const enemy = { actor };
  const availableFacts = availableIntelFacts(enemy, { revealMode: INTEL_REVEAL_MODES.exact });
  const changes = [];
  if (next.ledger !== undefined) {
    const before = revealedIntelFacts(availableFacts, knowerIds ? readKnownIntelLedger(actor, knowerIds) : readIntelLedger(actor));
    const after = revealedIntelFacts(availableFacts, normalizeIntelLedger(next.ledger));
    for (const { id, label } of INTEL_LEDGER_CATEGORIES) {
      const beforeIds = factIdSet(before[id]);
      const afterIds = factIdSet(after[id]);
      const added = after[id].filter((entry) => !beforeIds.has(entry.id)).map((entry) => entry.exactLabel ?? entry.label);
      const removed = before[id].filter((entry) => !afterIds.has(entry.id)).map((entry) => entry.exactLabel ?? entry.label);
      const category = label;
      if (added.length) changes.push({ kind: "revealed", category: id, text: `${category}: ${added.join(", ")}` });
      if (removed.length) changes.push({ kind: "hidden", category: id, text: `${category}: ${removed.join(", ")}` });
    }
  }
  if (next.details !== undefined) {
    const before = readIntelDetails(actor);
    const after = normalizeIntelDetails(next.details);
    if (after.revealed && (!before.revealed || before.text !== after.text)) {
      changes.push({ kind: "revealed", category: "details", text: t("Intel.DetailsLabel", "Details") });
    } else if (before.revealed && !after.revealed) {
      changes.push({ kind: "hidden", category: "details", text: t("Intel.DetailsLabel", "Details") });
    } else if (before.text !== after.text) {
      changes.push({ kind: "edited", category: "details", text: t("Intel.DetailsNotesEdited", "GM notes edited") });
    }
  }
  return changes;
}

// "Blue Dragon: revealed Weaknesses: None; Immunities: Electricity · hid Traits: Evil".
export function intelChangeNotice(name, changes) {
  const list = Array.isArray(changes) ? changes : [];
  const target = String(name ?? "") || t("Intel.UnknownTarget", "Unknown target");
  if (!list.length) return t("Intel.SavedNoChanges", "{name}: intel saved, nothing changed.", { name: target });
  const group = (kind) => list.filter((change) => change.kind === kind).map((change) => change.text).join("; ");
  const parts = [
    group("revealed") ? t("Intel.SavedRevealed", "revealed {facts}", { facts: group("revealed") }) : "",
    group("hidden") ? t("Intel.SavedHidden", "hid {facts}", { facts: group("hidden") }) : "",
    group("edited"),
  ].filter(Boolean);
  return t("Intel.SavedChanges", "{name}: {changes}", { name: target, changes: parts.join(" · ") });
}

// Writes the intel window's decision and returns one notice per creature saying what changed.
// A category's facts as ids: `true` (the whole category) becomes every fact the creature has.
function expandCategoryIds(value, availableIds) {
  if (value === true) return [...availableIds];
  return Array.isArray(value) ? [...value] : [];
}

// Several characters at once: each gains the facts ticked and loses the ones unticked; the facts
// the whole party knows stay the party's. `added` / `removed` are { category: [factId] }.
async function saveForCharacters(entry, audiences) {
  const actor = entry.actor;
  const party = readIntelLedger(actor);
  const characters = readCharacterIntelLedgers(actor);
  const available = availableIntelFacts({ actor }, { revealMode: INTEL_REVEAL_MODES.exact });
  const added = entry.added ?? {};
  const removed = entry.removed ?? {};
  const next = { ...characters };
  for (const id of audiences) {
    const known = mergeIntelLedgers(party, characters[id]?.ledger);
    const ledger = Object.fromEntries(INTEL_LEDGER_CATEGORIES.map(({ id: category }) => {
      const availableIds = (available[category] ?? []).map((fact) => fact.id);
      const ids = new Set(expandCategoryIds(known[category], availableIds));
      for (const fact of added[category] ?? []) ids.add(fact);
      for (const fact of removed[category] ?? []) ids.delete(fact);
      return [category, ids.size ? [...ids] : false];
    }));
    const names = entry.audienceNames ?? {};
    next[id] = { name: String(names[id] ?? characters[id]?.name ?? ""), ledger: subtractIntelLedger(ledger, party) };
  }
  const values = {
    revealMode: entry.revealMode,
    falseInformation: normalizeIntelFalseInformation(entry.falseInformation),
    ...(entry.details !== undefined ? { details: normalizeIntelDetails(entry.details) } : {}),
    characterLedgers: Object.fromEntries(Object.entries(next).map(([id, value]) => [id, { name: value.name, ledger: value.ledger }])),
  };
  await writeIntelFlags(actor, values);
  const label = (category, ids) => (available[category] ?? []).filter((fact) => ids.includes(fact.id)).map((fact) => fact.exactLabel ?? fact.label);
  const list = (changes) => INTEL_LEDGER_CATEGORIES.flatMap(({ id, label: categoryLabel }) => {
    const facts = label(id, changes[id] ?? []);
    return facts.length ? [`${categoryLabel}: ${facts.join(", ")}`] : [];
  }).join("; ");
  const who = audiences.map((id) => next[id]?.name || id).join(", ");
  const parts = [
    list(added) ? t("Intel.SavedLearned", "{characters} learned {facts}", { characters: who, facts: list(added) }) : "",
    list(removed) ? t("Intel.SavedForgot", "{characters} no longer know {facts}", { characters: who, facts: list(removed) }) : "",
  ].filter(Boolean);
  return parts.length
    ? t("Intel.SavedChanges", "{name}: {changes}", { name: actor?.name ?? "", changes: parts.join(" · ") })
    : t("Intel.SavedNoChanges", "{name}: intel saved, nothing changed.", { name: actor?.name ?? "" });
}

// A character audience files the ticked facts the party doesn't already know under that character;
// the party audience writes the party's ledger as before.
export async function saveIntelDecision(decision) {
  const notices = [];
  for (const entry of Array.isArray(decision) ? decision : []) {
    const audiences = Array.isArray(entry.audiences) ? entry.audiences.map(String).filter(Boolean) : null;
    if (audiences?.length && !audiences.includes(PARTY_INTEL_AUDIENCE)) {
      notices.push(await saveForCharacters(entry, audiences));
      continue;
    }
    const audience = String(entry.audience ?? PARTY_INTEL_AUDIENCE);
    const forCharacter = audience !== PARTY_INTEL_AUDIENCE;
    const values = {
      revealMode: entry.revealMode,
      falseInformation: normalizeIntelFalseInformation(entry.falseInformation),
      ...(entry.details !== undefined ? { details: normalizeIntelDetails(entry.details) } : {}),
    };
    let changes;
    if (forCharacter) {
      const party = readIntelLedger(entry.actor);
      const characters = readCharacterIntelLedgers(entry.actor);
      const own = subtractIntelLedger(entry.value, party);
      const next = { ...characters, [audience]: { name: String(entry.audienceName ?? characters[audience]?.name ?? ""), ledger: own } };
      values.characterLedgers = Object.fromEntries(Object.entries(next).map(([id, value]) => [id, { name: value.name, ledger: value.ledger }]));
      changes = describeIntelChanges(entry.actor, { ...values, ledger: mergeIntelLedgers(party, own) }, { knowerIds: [audience] });
    } else {
      values.ledger = entry.value;
      changes = describeIntelChanges(entry.actor, values);
    }
    await writeIntelFlags(entry.actor, values);
    const name = forCharacter
      ? t("Intel.SavedForCharacter", "{name} (known to {character})", { name: entry.actor?.name ?? "", character: entry.audienceName || audience })
      : entry.actor?.name;
    notices.push(intelChangeNotice(name, changes));
  }
  return notices;
}

export function intelLedgerView(context) {
  const enemies = (context?.intelTargets ?? context?.battlefield?.enemies ?? context?.enemies ?? [])
    .filter(isNpcIntelTarget);
  const isGM = typeof context?.isGM === "boolean" ? context.isGM : globalThis.game?.user?.isGM === true;
  const viewerIsGM = globalThis.game?.user?.isGM === true;
  const canSeeExactIntelLabels = isGM || viewerIsGM;
  // Players see the party's knowledge plus their own characters'; the GM edits one audience at a time.
  const knowerIds = context?.intelKnowerIds !== undefined ? context.intelKnowerIds : (isGM ? null : viewerIntelKnowerIds());
  const audience = isGM ? String(context?.intelAudience ?? PARTY_INTEL_AUDIENCE) : null;
  const entries = enemies.map((enemy) => {
    const actor = targetActor(enemy);
    const partyValues = readIntelLedger(actor);
    const characterLedgers = isGM ? readCharacterIntelLedgers(enemy?.intelCharacterLedgers !== undefined ? enemy : actor) : {};
    const values = normalizeIntelLedger(isGM
      ? (audience === PARTY_INTEL_AUDIENCE ? partyValues : mergeIntelLedgers(partyValues, characterLedgers[audience]?.ledger))
      : (enemy?.intelLedger ?? readKnownIntelLedger(actor, knowerIds)));
    const revealMode = readIntelRevealMode(enemy);
    const labelRevealMode = canSeeExactIntelLabels ? INTEL_REVEAL_MODES.exact : revealMode;
    const availableFacts = availableIntelFacts(enemy, { revealMode: labelRevealMode });
    const available = availableIntelDetails(enemy, { revealMode: labelRevealMode });
    const revealedFacts = revealedIntelFacts(availableFacts, values);
    const revealed = revealedIntelDetails(availableFacts, values);
    const falseInformation = readIntelFalseInformation(actor)
      .filter((record) => isGM || falseInformationKnownBy(record, knowerIds));
    const storedDetails = readIntelDetails(enemy?.intelDetails !== undefined ? enemy : actor);
    // Players never receive notes the GM hasn't revealed.
    const details = isGM || storedDetails.revealed ? storedDetails : normalizeIntelDetails(null);
    const playerRevealed = isGM ? revealed : Object.fromEntries(
      INTEL_LEDGER_CATEGORIES.map(({ id }) => [
        id,
        [
          ...(revealed[id] ?? []),
          ...falseInformation
            .filter((record) => record.revealed === true)
            .filter((record) => record.category === id)
            .map((record) => falseInformationDisplayLabel(record, enemy, labelRevealMode)),
        ],
      ]),
    );
    return {
      id: entityKey(enemy) ?? enemy?.id ?? enemy?.token?.id ?? enemy?.name,
      name: targetName(enemy, actor, isGM, values),
      actor,
      img: enemy?.token?.img ?? enemy?.actor?.img ?? actor?.img ?? "",
      values,
      ...(isGM ? { audience, partyValues, characterLedgers } : {}),
      revealMode,
      available,
      availableFacts,
      revealed: playerRevealed,
      revealedFacts,
      ...(viewerIsGM ? { falseInformation } : {}),
      details,
      hasRevealed: revealedCount(revealed) > 0
        || falseInformation.some((record) => record.revealed === true)
        || storedDetails.revealed,
    };
  }).filter((entry) => entry.actor || entry.hasRevealed);
  const learnedCount = entries.reduce((count, entry) => count
    + Object.values(entry.values).reduce((total, value) => total + ledgerCount(value), 0)
    + (entry.falseInformation?.length ?? 0), 0);
  const hasPlayerVisibleIntel = entries.some((entry) => entry.hasRevealed);

  return {
    visible: entries.length > 0 && (isGM || hasPlayerVisibleIntel),
    editable: isGM,
    entries,
    categories: INTEL_LEDGER_CATEGORIES,
    label: learnedCount > 0
      ? t("Intel.KnownCount", "Intel {count}", { count: learnedCount })
      : t("Intel.Label", "Intel"),
    tooltip: isGM
      ? t("Intel.Tooltip", "Mark Recall Knowledge facts learned before Auto-fill uses hidden defenses.")
      : t("Intel.PlayerTooltip", "View Recall Knowledge facts the GM has revealed."),
  };
}

function hasAnyIntelFlag(actor) {
  const flags = actor?.flags?.[MODULE_ID];
  if (flags) {
    return [INTEL_LEDGER_FLAG, INTEL_CHARACTER_LEDGERS_FLAG, INTEL_FALSE_INFORMATION_FLAG, INTEL_DETAILS_FLAG].some((key) => flags[key] != null);
  }
  return [INTEL_LEDGER_FLAG, INTEL_CHARACTER_LEDGERS_FLAG, INTEL_FALSE_INFORMATION_FLAG, INTEL_DETAILS_FLAG]
    .some((key) => rawFlag(actor, key) != null);
}

// Every creature the viewer knows something about, on any scene or none, in or out of combat: the
// "Known creatures" journal. A player sees the party's intel plus their own characters'; the GM
// sees everything anyone learned. Read-only.
export function knownCreaturesView({ actors = null, user = globalThis.game?.user } = {}) {
  const isGM = user?.isGM === true;
  const all = actors ?? globalThis.game?.actors?.contents ?? Array.from(globalThis.game?.actors ?? []);
  const intelTargets = all
    .filter((actor) => isNpcIntelTarget({ actor }) && hasAnyIntelFlag(actor))
    // A player sees the creature's name only once its identity is known (targetName falls back).
    .map((actor) => ({ actor, id: actor.id, uuid: actor.uuid, name: isGM ? actor.name : t("Intel.UnknownCreature", "Unknown creature") }));
  const view = intelLedgerView({ isGM: false, intelKnowerIds: isGM ? null : viewerIntelKnowerIds(user), intelTargets });
  const entries = view.entries
    .filter((entry) => entry.hasRevealed && (isGM || Object.values(entry.revealed ?? {}).some((values) => values.length) || entry.details?.revealed))
    .toSorted((left, right) => String(left.name).localeCompare(String(right.name)));
  return { ...view, entries, visible: true, editable: false, journal: true };
}
