import assert from "node:assert/strict";
import { browserViewContext } from "../../ui/browser-view.js";

const action = (key, extra = {}) => ({ key, name: key, reason: `${key} helps`, detailChips: [], ...extra });
const base = {
  readonly: false,
  builder: {
    remainingTotalActions: 2,
    tabsList: [{ id: "one", active: true, sections: [{ label: "Attacks", actions: [
      action("Strike", { img: "icons/weapons/sword.webp", detailChips: [{ class: "is-preflight", label: "65 %" }] }),
      action("Step", { img: "systems/pf2e/icons/actions/OneAction.webp" }),
      action("Stride", { slug: "stride", img: "systems/pf2e/icons/actions/Passive.webp" }),
      action("Haste", { overBudget: true, disabledReason: "Not enough actions remaining." }),
    ] }] }],
  },
};

const full = browserViewContext(base);
assert.equal(full.compact, false);
assert.equal(full.builder.tabsList[0].sections[0].actions[0].tileTooltip, undefined, "the list layout builds no tile tooltips");

const compact = browserViewContext(base, { compact: true });
const [strike, step, stride, haste] = compact.builder.tabsList[0].sections[0].actions;
assert.equal(stride.tileImg, "icons/skills/movement/feet-winged-boots-brown.webp", "basic actions get recognizable art");
assert.equal(strike.tileImg, "icons/weapons/sword.webp");
assert.equal(step.tileImg, "", "generic action art shows the name instead");
assert.equal(compact.compact, true);
assert.equal(strike.tileTooltip, "Strike (65%) · Strike helps · Click to add, Shift-click as uncounted. Right-click to star.", "a tile's tooltip carries the row's name, odds and reason");
assert.match(haste.tileTooltip, /Not enough actions remaining\. Shift-click to add as uncounted\.$/, "an over-budget tile says why, and how to add it anyway");
assert.doesNotMatch(browserViewContext({ ...base, readonly: true }, { compact: true }).builder.tabsList[0].sections[0].actions[0].tileTooltip, /Click to add/, "read-only tiles don't offer to add");

// NPC Strikes come from "melee" items with the generic default icon: use the weapon's art.
const generic = "systems/pf2e/icons/default-icons/melee.svg";
const hobgoblin = { itemTypes: { weapon: [{ name: "Longsword", img: "icons/weapons/swords/longsword.webp" }] } };
const npcBase = { readonly: false, builder: { remainingTotalActions: 3, tabsList: [{ id: "one", active: true, sections: [{ label: "Attacks", actions: [
  action("Longsword", { slug: "strike", img: generic, item: { type: "melee", name: "Longsword", img: generic, actor: hobgoblin } }),
  action("Shortbow", { slug: "strike", img: generic, item: { type: "melee", name: "Shortbow", img: generic, actor: hobgoblin } }),
] }] }] } };
const [longsword, shortbow] = browserViewContext(npcBase, { compact: true }).builder.tabsList[0].sections[0].actions;
assert.equal(longsword.tileImg, "icons/weapons/swords/longsword.webp", "an NPC Strike shows its weapon's art");
assert.equal(shortbow.tileImg, generic, "with no matching weapon the Strike keeps the generic icon instead of a blank tile");

// Kimerus (Discord): Fear read "vs Kimerus Federys" while he had Serena targeted. With your own
// Foundry target, the browser names it, and odds worked out for another creature are left out.
{
  const kimerus = { type: "enemy", id: "kimerus", name: "Kimerus Federys" };
  const serena = { type: "enemy", id: "serena", name: "Serena Valcrest" };
  const spell = (key, target) => action(key, { reason: `${key} can control ${target.name}.`, targetingProfile: { enemy: true }, suggestedTarget: target, detailChips: [{ class: "is-preflight", label: "55 %" }] });
  const spells = { readonly: false, builder: { remainingTotalActions: 3, tabsList: [{ id: "two", active: true, sections: [{ label: "Spells", actions: [
    spell("Fear", kimerus), spell("Frostbite", kimerus), spell("Hydraulic Push", serena), action("Light"),
  ] }] }] } };
  const savedGame = globalThis.game;
  try {
    globalThis.game = { ...savedGame, user: { ...savedGame?.user, targets: new Set() } };
    const suggested = browserViewContext(spells);
    assert.equal(suggested.browserBar.sharedTargetLabel, "Best target");
    assert.equal(suggested.browserBar.sharedTarget, "Kimerus Federys");

    globalThis.game.user.targets = new Set([{ id: "serena", name: "Serena Valcrest" }]);
    const view = browserViewContext(spells);
    const [fear, , push, light] = view.builder.tabsList[0].sections[0].actions;
    assert.equal(view.browserBar.sharedTargetLabel, "Your target");
    assert.equal(view.browserBar.sharedTarget, "Serena Valcrest");
    assert.equal(fear.rowTarget, "", "Fear no longer names the Best target");
    assert.equal(fear.odds, "", "its odds were for Kimerus, so they're left out");
    assert.equal(push.odds, "55%", "odds against your own target stay");
    assert.equal(fear.reason, "Fear can control Serena Valcrest.", "its reason names your target, not Kimerus");
    assert.equal(push.reason, "Hydraulic Push can control Serena Valcrest.");
    assert.equal(suggested.builder.tabsList[0].sections[0].actions[0].reason, "Fear can control Kimerus Federys.", "without a target the reason is unchanged");
    assert.equal(light.rowTarget, "");
  } finally {
    globalThis.game = savedGame;
  }
}

console.log("Browser view tests passed.");
