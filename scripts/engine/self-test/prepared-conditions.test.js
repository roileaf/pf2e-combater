import assert from "node:assert/strict";
import { readConditions } from "../../readers/actor-profile.js";
import { createTurnSnapshot, trackedActionContext } from "../../state/action-tracker.js";
import { actionTrackerView } from "../../ui/panel/action-tracker.js";
import { actionBudget } from "../action/budget.js";
import { buildActionBuilderModel } from "../action/builder/model.js";
import { bestTurnPlan } from "../planner.js";
import { fighterContext, fixtureCandidates } from "../fixtures.js";

const condition = (slug, value = 1, extra = {}) => ({
  id: `${slug}-${value}`, type: "condition", slug, value, active: true, inMemoryOnly: true,
  system: { slug, value: { value, isValued: true } }, ...extra,
});
const actor = { id: "zombie", flags: {}, itemTypes: { condition: [], effect: [] } };
const combatant = { id: "zombie-turn", actor };
const combat = { id: "combat", started: true, round: 2, turn: 0, combatant, turns: [combatant], flags: {} };
const prepared = (...conditions) => { actor.conditions = new Map(conditions.map((item, i) => [i, item])); };
const profile = () => ({ ...fighterContext.profile, conditions: readConditions(actor) });
const current = () => {
  combat.flags["pf2e-combater"] = { actionTurn: createTurnSnapshot(combat) };
  return trackedActionContext({ combat, combatant, actor: { document: actor } }, { combat, messages: [] });
};

// PF2e's Slow ability grants Slowed in memory: actor.conditions contains it, itemTypes does not.
prepared(condition("slowed"));
let tracked = current();
assert.equal(actionBudget(tracked).totalActions, 2, "native Slowed 1 must reduce the turn-start pool");
assert.equal(actionTrackerView(tracked).pips.length, 2);
assert.deepEqual(actionTrackerView(tracked).conditionIcons.map(({ slug, value }) => ({ slug, value })),
  [{ slug: "slowed", value: 1 }], "the HUD must display native Slowed");
assert.equal(actionBudget({ profile: profile() }).totalActions, 2, "the actor profile must see native Slowed");
const plannerContext = { ...fighterContext, profile: profile() };
assert.ok(bestTurnPlan(plannerContext, fixtureCandidates).totalCost <= 2, "Auto-fill respects native Slowed");
assert.equal(buildActionBuilderModel({ context: plannerContext, candidates: fixtureCandidates }).remainingNormalActions, 2);
const forecast = trackedActionContext({ combat, combatant: { id: "next", actor }, actor: { document: actor } }, { combat, messages: [] });
assert.equal(actionBudget(forecast).totalActions, 2, "off-turn forecasting reads the same native condition");

// A newly granted condition still changes the next turn, never retroactively changes this turn's pool.
prepared();
tracked = current();
prepared(condition("slowed"));
tracked = trackedActionContext(tracked, { combat, messages: [] });
assert.equal(actionBudget(tracked).totalActions, 3);
assert.equal(tracked.actionTracker.nextTurnPool.totalActions, 2);
assert.equal(actionTrackerView(tracked).conditionIcons[0].pending, true);

// Prepared state is authoritative, including when empty; stored-only actors remain supported.
actor.itemTypes.condition = [condition("slowed", 2, { inMemoryOnly: false })];
prepared();
assert.equal(actionBudget(current()).totalActions, 3);
assert.deepEqual(readConditions(actor).slugs, []);
delete actor.conditions;
assert.equal(actionBudget(current()).totalActions, 1);
assert.equal(actionBudget({ profile: profile() }).totalActions, 1);
actor.itemTypes.condition = [];

// Slowed can be suppressed by Stunned in PF2e, but still matters when determining lost actions.
prepared(condition("slowed", 2, { active: false }), condition("stunned", 1));
assert.equal(actionBudget(current()).totalActions, 1);
assert.equal(actionBudget({ profile: profile() }).totalActions, 1);

// Multiple grants must retain the strongest value regardless of collection ordering.
for (const conditions of [[condition("slowed", 2), condition("slowed", 1, { active: false })],
  [condition("slowed", 1, { active: false }), condition("slowed", 2)]]) {
  prepared(...conditions);
  assert.equal(actionBudget(current()).totalActions, 1);
  assert.equal(actionBudget({ profile: profile() }).totalActions, 1);
  assert.deepEqual(readConditions(actor).slugs, ["slowed"]);
}

prepared(condition("quickened"));
actor.itemTypes.effect = [{ slug: "spell-effect-haste" }];
tracked = current();
assert.equal(actionBudget(tracked).totalActions, 4);
assert.deepEqual(tracked.quickenedAllowed, ["strike", "stride"]);
assert.equal(actionBudget({ profile: profile() }).totalActions, 4);
prepared(condition("stunned", 1), condition("quickened"));
assert.equal(actionBudget(current()).normalActions, 3, "the restricted action is lost before normal actions");
prepared(condition("quickened", 1, { active: false }), condition("stunned", 2, { system: { expired: true } }));
assert.equal(actionBudget(current()).totalActions, 3);
assert.equal(actionBudget({ profile: profile() }).totalActions, 3, "inactive and expired conditions must not affect the profile");

console.log("PF2e Combater prepared-condition tests passed");
