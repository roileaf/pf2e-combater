// Starfinder 2e operative.
export const OPERATIVE_ACTIONS = [
  {
    // Aim: mark one creature until your next turn; your ranged Strikes against it (non-area weapon,
    // first range increment) add precision damage. It only pays off with a ranged Strike after it.
    slug: 'aim',
    role: 'setup',
    activityProfile: {
      includes: ['setup'],
      targetMark: 'aim',
      aimMark: true,
      precisionDamageSetup: true,
    },
    targetingProfile: {
      enemy: true,
    },
    setupFor: ['strike', 'damage'],
    executable: 'open-item',
    confidence: 'high',
  },
];
