// PF2e's generic action art (the cost diamonds, Passive, default icons) looks the same for
// every basic action, so compact views swap it for something recognizable.
export const GENERIC_ACTION_ART = /default-icons|icons\/actions\//;

// Core Foundry icons for basic actions the system gives no art of its own.
const FALLBACK_ART = {
  stride: "icons/skills/movement/feet-winged-boots-brown.webp",
  step: "icons/skills/movement/feet-spurred-boots-brown.webp",
  "recall-knowledge": "icons/skills/wounds/anatomy-organ-brain-pink-red.webp",
  "learn-a-spell": "icons/sundries/books/book-open-purple.webp",
  "treat-wounds": "icons/magic/nature/root-vine-caduceus-healing.webp",
  "drop-prone": "icons/magic/control/silhouette-fall-slip-prone.webp",
  "raise-a-shield": "icons/equipment/shield/heater-steel-worn.webp",
  interact: "icons/skills/melee/hand-grip-staff-yellow-brown.webp",
  delay: "icons/magic/time/hourglass-tilted-gray.webp",
  // PF2e's Aid action only has the Reaction glyph; its Effect: Aid icon is the one players know.
  "prepare-to-aid": "systems/pf2e/icons/spells/efficient-apport.webp",
};

function baseSlug(slug) {
  return String(slug ?? "").toLowerCase().replace(/^generic-/, "");
}

function realArt(img) {
  return img && !GENERIC_ACTION_ART.test(String(img)) ? img : "";
}

// An NPC's Strike comes from a PF2e "melee" item, usually with the generic default icon. Its linked
// weapon, or the creature's weapon of the same name, has the real art; failing that, keep the
// generic Strike icon so the tile isn't blank.
function strikeArt(item, img) {
  const linked = realArt(item?.linkedWeapon?.img);
  if (linked) return linked;
  const actor = item?.actor ?? item?.parent ?? null;
  const name = String(item?.name ?? "").trim().toLowerCase();
  const slug = item?.slug ?? item?.system?.slug ?? null;
  const weapons = Array.from(actor?.itemTypes?.weapon ?? []);
  const weapon = weapons.find((entry) => (slug && (entry.slug ?? entry.system?.slug) === slug)
    || (name && String(entry.name ?? "").trim().toLowerCase() === name));
  return realArt(weapon?.img) || img || item?.img || "";
}

// The action's own art when it has some; otherwise PF2e's art for that action, then ours.
export function actionArt(slug, img, { item = null } = {}) {
  if (realArt(img)) return img;
  if (baseSlug(slug) === "strike" || ["melee", "weapon"].includes(item?.type)) return strikeArt(item, img);
  const key = baseSlug(slug);
  if (!key) return "";
  const system = globalThis.game?.pf2e?.actions?.get?.(key)?.img;
  if (system && !GENERIC_ACTION_ART.test(String(system))) return system;
  return FALLBACK_ART[key] ?? "";
}
