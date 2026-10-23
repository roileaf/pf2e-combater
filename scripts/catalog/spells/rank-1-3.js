export const RANK_1_TO_3_SPELL_TACTICS = [
  {
    slug: "heal",
    role: "healing",
    targetModel: "single-ally",
    executable: "open-item",
    confidence: "high",
    // Heal mends the living and harms undead: two modes, like Harm. Casting picks PF2e's matching
    // variant ("Heal (vs. Living)" / "Heal (vs. Undead)") by healing or damage.
    tacticalVariants: [{
      key: "healing",
      role: "healing",
      activityProfile: { includes: ["healing"], dualUse: "heal" },
    }, {
      key: "damage-undead",
      nameSuffix: "vs. Undead",
      role: "save-damage",
      targetingProfile: { self: false, ally: false, enemy: true, requiresAnyTrait: ["undead"] },
      activityProfile: { includes: ["damage"], dualUse: "heal" },
      reasons: ["Heal deals vitality damage to an undead enemy."],
    }],
  },
  {
    slug: "fear",
    role: "debuff",
    save: "will",
    targetModel: "single-enemy",
    executable: "open-item",
    confidence: "high",
  },
  {
    slug: "magic-missile",
    role: "damage",
    variableActionCost: true,
    targetModel: "single-enemy",
    executable: "open-item",
    confidence: "high",
  },
  {
    slug: "fireball",
    role: "area-damage",
    save: "reflex",
    targetModel: "area",
    damageTypes: ["fire"],
    friendlyFireRisk: true,
    executable: "open-item",
    confidence: "medium",
  },
];

export const RANK_1_TO_3_SPELLS = RANK_1_TO_3_SPELL_TACTICS;
