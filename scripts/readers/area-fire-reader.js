// Starfinder 2e area weapon attacks. SF2e lists them in actor.system.actions: a weapon with an
// area-* trait (or a grenade) is an "area-fire" entry, and an automatic weapon's Strike carries an
// "auto-fire" alternate usage. Both are a basic Reflex save against the class DC (+ tracking) for
// every creature in a burst, cone or line, with no attack roll: they have the attack trait, so they
// count toward the multiple attack penalty without taking it. PF2e has neither, so this reads nothing
// there.
import { t } from "../i18n.js";
import { slugify } from "../engine/action/text.js";

export const AREA_FIRE_TYPES = new Set(["area-fire", "auto-fire"]);

const numeric = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function weaponTraits(item) {
  const traits = item?.system?.traits?.value;
  return Array.isArray(traits) ? traits.map((trait) => String(trait).toLowerCase()) : [];
}

function weaponRange(item) {
  return numeric(item?.system?.range) ?? numeric(item?.range?.increment) ?? null;
}

// Mirrors SF2e's prepareAreaAttack: automatic → cone of half the range increment (min 5 ft, whole
// squares); area-cone / area-line → the range increment; area-burst-N → an N-ft burst centred
// anywhere within the first range increment; a grenade → its @Template burst (default 5 ft).
export function areaFireShape(item, type) {
  const range = weaponRange(item);
  const traits = weaponTraits(item);
  if (type === "auto-fire") {
    const half = Math.floor((range ?? 10) / 2);
    return { type: "cone", distance: Math.max(5, half - (half % 5)), maxRange: 0 };
  }
  const configured = item?.system?.traits?.config?.area;
  if (configured?.type) {
    const value = numeric(configured.value);
    if (configured.type === "burst") return { type: "burst", distance: value || 5, maxRange: range ?? 0 };
    return { type: configured.type, distance: value || range || 5, maxRange: 0, ...(configured.type === "line" ? { width: 5 } : {}) };
  }
  const burst = traits.map((trait) => /^area-burst-(\d+)$/.exec(trait)).find(Boolean);
  if (burst) return { type: "burst", distance: Number(burst[1]) || 5, maxRange: range ?? 0 };
  if (traits.includes("area-cone")) return { type: "cone", distance: range || 15, maxRange: 0 };
  if (traits.includes("area-line")) return { type: "line", distance: range || 30, width: 5, maxRange: 0 };
  const grenade = String(item?.system?.description?.value ?? "").match(/Template\[burst\|distance:(\d+)\]/);
  if (item?.baseType === "grenade" || item?.system?.baseItem === "grenade" || grenade) {
    return { type: "burst", distance: Number(grenade?.[1]) || 5, maxRange: range ?? 0 };
  }
  return null;
}

// The rounds loaded in the weapon, when the system tracks it: SF2e's getAttackAmmo lists what is
// loaded (a magazine's uses, or loose rounds' quantity); its "remaining" is the free capacity, not
// rounds left. Null when the weapon tracks no ammunition.
function loadedRounds(action) {
  const ammo = action?.ammunition;
  if (!ammo || !Array.isArray(ammo.loaded)) return null;
  return ammo.loaded.reduce((total, entry) => total + (numeric(entry?.quantity) ?? 0), 0);
}

export function areaFireExpend(item, type) {
  // Auto-Fire spends 2 rounds per creature in the cone; at least one creature means 2.
  if (type === "auto-fire") return 2;
  return Math.max(1, numeric(item?.system?.expend) ?? 1);
}

function actionCostFor(action, item) {
  const glyph = String(action?.glyph ?? "");
  if (glyph === "1" || glyph === "A") return 1;
  if (glyph === "2" || glyph === "D") return 2;
  return item?.baseType === "grenade" ? 1 : 2;
}

// SF2e soldier class features that change area attacks (feat-type items on the actor).
function hasFeature(actor, slug) {
  const items = [...(actor?.itemTypes?.feat ?? []), ...(actor?.items ?? [])];
  return items.some((item) => (item?.slug ?? item?.system?.slug) === slug);
}

// The weapon's own ranged Strike, for Primary Target: an area weapon lists it as Area Fire's
// alternate usage; an automatic weapon's Strike is the entry Auto-Fire hangs off.
function weaponStrike(actions, entry) {
  const itemId = entry?.item?.id;
  const alt = (entry?.altUsages ?? []).find((usage) => usage?.type === "strike");
  if (alt) return alt;
  return (Array.isArray(actions) ? actions : []).find((action) => action?.type === "strike" && itemId && action?.item?.id === itemId) ?? null;
}

function areaFireEntries(actions) {
  return (Array.isArray(actions) ? actions : []).flatMap((action) => [
    action,
    ...(Array.isArray(action?.altUsages) ? action.altUsages : []),
  ]).filter((entry) => AREA_FIRE_TYPES.has(entry?.type));
}

export function readAreaFireActions(actions, { damageProfile = () => null, actor = null } = {}) {
  const suppressingFire = hasFeature(actor, "suppressing-fire");
  const primaryTarget = hasFeature(actor, "primary-target");
  return areaFireEntries(actions)
    .filter((entry) => entry?.visible !== false && entry?.ready !== false && entry?.canAttack !== false)
    .flatMap((entry) => {
      const item = entry.item ?? null;
      const type = entry.type;
      const shape = areaFireShape(item, type);
      const dc = numeric(entry?.statistic?.dc?.value);
      if (!shape || dc === null) return [];
      const weaponName = entry.label ?? item?.name ?? "Weapon";
      const traits = weaponTraits(item);
      const expend = areaFireExpend(item, type);
      const rounds = loadedRounds(entry);
      const enoughAmmo = rounds === null || rounds >= expend;
      const damage = damageProfile(entry);
      const range = weaponRange(item);
      const primaryStrike = primaryTarget ? weaponStrike(actions, entry) : null;
      const name = type === "auto-fire"
        ? t("Action.AutoFire", "Auto-Fire ({weapon})", { weapon: weaponName })
        : t("Action.AreaFire", "Area Fire ({weapon})", { weapon: weaponName });
      return [{
        id: `${type}-${slugify(item?.id ?? entry.slug ?? weaponName)}`,
        name,
        slug: type,
        tacticSlug: type,
        actionCost: actionCostFor(entry, item),
        actionType: "action",
        // "system-inferred" lets the area-damage role tactic score it like other area saves.
        source: "system-inferred",
        confidence: "medium",
        executable: "area-fire",
        detected: true,
        available: enoughAmmo,
        unavailableReason: enoughAmmo ? "" : t("Avail.NotEnoughAmmo", "Not enough ammunition loaded ({rounds} of {expend}).", { rounds, expend }),
        role: "area-damage",
        attackTrait: true,
        traits: ["attack", ...traits],
        weaponTraits: entry.weaponTraits ?? [],
        isRanged: true,
        range: range ? { increment: range, max: shape.type === "burst" ? range : shape.distance } : { max: shape.distance },
        item,
        weaponItem: item,
        strike: entry,
        variants: entry.variants ?? [],
        damage: entry.damage ?? null,
        critical: entry.critical ?? null,
        expend,
        unwieldy: traits.includes("unwieldy"),
        primaryStrike,
        activityProfile: {
          includes: ["damage", "area"],
          areaFire: true,
          // Attack trait: it raises the MAP for later attacks but rolls no attack itself.
          noAttackRoll: true,
          ...(suppressingFire ? { suppressingFire: true } : {}),
          ...(primaryStrike ? { primaryTarget: true } : {}),
        },
        targetingProfile: {
          area: true,
          type: shape.type,
          distance: shape.distance,
          ...(shape.width ? { width: shape.width } : {}),
          maxRange: shape.maxRange,
        },
        saveProfile: { stat: "reflex", dc, basic: true },
        damageProfile: damage,
        averageDamage: damage?.average ?? null,
        reasons: [type === "auto-fire"
          ? t("Reason.AutoFire", "Sprays a {distance}-ft cone; basic Reflex DC {dc}.", { distance: shape.distance, dc })
          : t("Reason.AreaFire", "Hits a {distance}-ft {shape}; basic Reflex DC {dc}.", { distance: shape.distance, shape: shape.type, dc })],
      }];
    });
}
