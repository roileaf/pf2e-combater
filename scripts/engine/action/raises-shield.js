// Actions that Raise a Shield as part of what they do (Shields of the Spirit: "You Raise your
// Shield, causing ephemeral spirit shields..."). A plain Raise a Shield after one is wasted.

const RAISE_SHIELD_SLUG = "raise-a-shield";
// Sentence-initial so conditionals ("if you Raise a Shield") don't count.
const RAISES_SHIELD_TEXT = /(?:^|[.:;!]\s+)you raise (?:your|a) shield\b/;

function textOf(value) {
  if (typeof value === "string") return value;
  if (typeof value?.value === "string") return value.value;
  return "";
}

function descriptionText(step) {
  const action = step?.action ?? step ?? {};
  return [
    textOf(step?.description),
    textOf(action?.description),
    textOf(action?.system?.description),
    textOf(action?.item?.system?.description),
    textOf(step?.item?.system?.description),
  ].filter(Boolean).join(" ")
    // "@UUID[...]{Raise a Shield}" reads as its label.
    .replace(/@\w+\[[^\]]*\](?:\{([^}]*)\})?/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isRaiseAShieldStep(step) {
  const action = step?.action ?? step ?? {};
  return [step?.slug, step?.actionKey, action?.slug, action?.id].includes(RAISE_SHIELD_SLUG);
}

export function raisesShield(step) {
  if (isRaiseAShieldStep(step)) return true;
  const action = step?.action ?? step ?? {};
  if (step?.activityProfile?.raisesShield === true || action?.activityProfile?.raisesShield === true) return true;
  return RAISES_SHIELD_TEXT.test(descriptionText(step));
}
