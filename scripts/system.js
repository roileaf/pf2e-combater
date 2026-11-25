// Game-system scope. Combater runs on PF2e and on Starfinder 2e (sf2e), which is built from the same
// codebase: it keeps CONFIG.PF2E, game.pf2e and the pf2e.* hooks, but writes its document flags under
// flags.sf2e, registers settings under "sf2e", serves assets from systems/sf2e and names a few
// compendium packs differently (the item ids inside them are the same).

export const PF2E_SYSTEM_ID = "pf2e";
export const SUPPORTED_SYSTEM_IDS = ["pf2e", "sf2e"];

export function systemId() {
  return globalThis.game?.system?.id ?? PF2E_SYSTEM_ID;
}

export function isSupportedSystem(id = systemId()) {
  return SUPPORTED_SYSTEM_IDS.includes(id);
}

const EMPTY = Object.freeze({});

// The system's own flag scope on a document (flags.pf2e on PF2e, flags.sf2e on SF2e). On SF2e, keys
// still written under flags.pf2e (migrated or module-written data) fill in what flags.sf2e lacks.
export function systemFlags(doc) {
  const flags = doc?.flags;
  if (!flags) return EMPTY;
  const id = systemId();
  const own = flags[id];
  if (id === PF2E_SYSTEM_ID) return own ?? EMPTY;
  const legacy = flags[PF2E_SYSTEM_ID];
  if (!legacy) return own ?? EMPTY;
  if (!own) return legacy;
  return { ...legacy, ...own };
}

// "<system>.<key>" — the system's client/world setting key as passed in updateSetting hooks.
export function systemSettingKey(key) {
  return `${systemId()}.${key}`;
}

export function systemAsset(path) {
  return `systems/${systemId()}/${String(path).replace(/^\/+/, "")}`;
}

// PF2e pack name → the SF2e pack holding the same entries under the same ids.
const SF2E_PACKS = {
  actionspf2e: "actions",
  conditionitems: "conditions",
  "spells-srd": "spells",
};

export function compendiumPack(pf2ePack) {
  const id = systemId();
  if (id === "sf2e") return SF2E_PACKS[pf2ePack] ?? pf2ePack;
  return pf2ePack;
}

// Compendium UUID for an entry identified by its PF2e pack name and item id.
export function compendiumUuid(pf2ePack, itemId, documentName = "Item") {
  return `Compendium.${systemId()}.${compendiumPack(pf2ePack)}.${documentName}.${itemId}`;
}
