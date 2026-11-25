// Starfinder 2e envoy.
export const ENVOY_ACTIONS = [
  {
    // Get 'Em!: one enemy within 60 ft; you and your allies get +1 status to attacks against it until
    // your next turn. The 2-action Lead by Example version (a Strike with +Cha damage) is built by
    // readers/envoy-reader.js from the envoy's own Strikes.
    slug: 'get-em',
    role: 'setup',
    activityProfile: {
      includes: ['setup'],
      targetMark: 'get-em',
      getEm: true,
      attackBuff: true,
    },
    targetingProfile: {
      enemy: true,
      range: 60,
    },
    setupFor: ['strike', 'damage'],
    executable: 'get-em',
    confidence: 'high',
  },
];
