import assert from "node:assert/strict";

// Roi: PF2e HUD replaces Foundry's tracker with its own (TrackerPF2eHUD, "pf2e-hud-tracker"), so the
// player's Intel brain button has to appear in its rows too, beside target/ping/pan.
class FakeElement {
  constructor(tag = "div", { className = "", dataset = {}, text = "" } = {}) {
    this.tagName = tag.toUpperCase();
    this.className = className;
    this.dataset = { ...dataset };
    this.textContent = text;
    this.children = [];
    this.parent = null;
    this.attributes = {};
    this.listeners = {};
  }
  get classList() { return { contains: (name) => this.className.split(/\s+/).includes(name) }; }
  append(child) { child.parent = this; this.children.push(child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) {
    if (name === "data-combatant-id") return this.dataset.combatantId ?? null;
    return this.attributes[name] ?? null;
  }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  set innerHTML(_html) { this.children = []; }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  matchesOne(selector) {
    // Supports what the tracker code uses: ".a", ".a .b", ".a:not(.b)", "li.a", "[data-combatant-id]".
    const parts = selector.trim().split(/\s+/);
    const self = (part, el) => {
      if (part === "[data-combatant-id]") return el.dataset.combatantId != null;
      const notMatch = part.match(/^(.*):not\(\.([\w-]+)\)$/);
      if (notMatch) return self(notMatch[1], el) && !el.classList.contains(notMatch[2]);
      const [tag, ...classes] = part.split(".");
      if (tag && el.tagName !== tag.toUpperCase()) return false;
      return classes.every((name) => el.classList.contains(name));
    };
    if (!self(parts.at(-1), this)) return false;
    let el = this.parent;
    for (let i = parts.length - 2; i >= 0; i -= 1) {
      while (el && !self(parts[i], el)) el = el.parent;
      if (!el) return false;
      el = el.parent;
    }
    return true;
  }
  querySelectorAll(selector) {
    const selectors = selector.split(",");
    return this.descendants().filter((el) => selectors.some((part) => el.matchesOne(part)));
  }
  querySelector(selector) {
    // Like the DOM: first match in document order across the whole selector list.
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

const hudRow = (id, name) => {
  const row = new FakeElement("li", { className: "combatant", dataset: { combatantId: id } });
  const details = new FakeElement("div", { className: "details" });
  details.append(new FakeElement("div", { className: "name", text: name }));
  const controls = new FakeElement("div", { className: "controls" });
  controls.append(new FakeElement("a", { className: "combatant-control", dataset: { action: "toggleTarget" } }));
  details.append(controls);
  details.append(new FakeElement("div", { className: "controls alt" }));
  row.append(details);
  return row;
};

const saved = Object.fromEntries(["game", "ui", "Hooks", "document", "HTMLElement", "foundry"].map((key) => [key, globalThis[key]]));
try {
  // intel-window.js extends ApplicationV2 at import time.
  globalThis.foundry ??= {};
  globalThis.foundry.applications ??= {};
  globalThis.foundry.applications.api ??= { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {} };
  const { refreshCombatTrackerIntel, registerCombatTrackerIntel } = await import("../../ui/combat-tracker-intel.js");
  globalThis.HTMLElement = FakeElement;
  globalThis.document = { createElement: (tag) => new FakeElement(tag), getElementById: () => null, querySelector: () => null };
  const hooks = {};
  globalThis.Hooks = { on: (name, fn) => { hooks[name] = fn; } };

  const npc = { id: "goblin", type: "npc", img: "goblin.webp", system: { saves: { fortitude: { dc: 18 } } }, flags: { "pf2e-combater": { intelLedger: { saves: ["fortitude"] } } } };
  npc.getFlag = (scope, key) => npc.flags[scope]?.[key];
  const hero = { id: "hero", type: "character", img: "hero.webp", flags: {} };
  const combatant = (id, actor, extra = {}) => ({ id, actor, name: actor.id, visible: true, token: { id: `${id}-token` }, ...extra });
  const combatants = [combatant("c-goblin", npc), combatant("c-hero", hero), combatant("c-hidden", npc, { visible: false })];
  const combat = { id: "combat", combatants: { get: (id) => combatants.find((entry) => entry.id === id), contents: combatants } };
  const moduleActive = { "pf2e-hud": false };
  globalThis.game = {
    combat,
    user: { id: "player", isGM: false },
    modules: { get: (id) => (id in moduleActive ? { active: moduleActive[id] } : undefined) },
    settings: { get: () => false },
    i18n: { localize: (key) => key, has: () => false, format: (key) => key },
  };
  globalThis.ui = { combat: { viewed: combat, render: () => {} } };

  registerCombatTrackerIntel();
  assert.ok(hooks.renderCombatTracker, "the core tracker hook stays registered");
  assert.equal(hooks.renderTrackerPF2eHUD, undefined, "no PF2e HUD hook when PF2e HUD isn't active");

  moduleActive["pf2e-hud"] = true;
  registerCombatTrackerIntel();
  assert.ok(hooks.renderTrackerPF2eHUD, "PF2e HUD's tracker render is hooked when it's active");

  const root = new FakeElement("section", { dataset: {} });
  for (const row of [hudRow("c-goblin", "Goblin"), hudRow("c-hero", "Hero"), hudRow("c-hidden", "Lurker")]) root.append(row);
  const app = { id: "pf2e-hud-tracker", viewed: combat, element: root };
  hooks.renderTrackerPF2eHUD(app, root);

  const buttonsIn = (id) => root.querySelectorAll(".pf2e-combater-combatant-intel")
    .filter((button) => button.parent?.parent?.parent?.dataset.combatantId === id);
  const goblinButtons = buttonsIn("c-goblin");
  assert.equal(goblinButtons.length, 1, "an NPC with revealed intel gets one brain button");
  assert.ok(goblinButtons[0].parent.classList.contains("controls") && !goblinButtons[0].parent.classList.contains("alt"),
    "beside the row's target/ping/pan controls, not the alt-only row");
  assert.ok(goblinButtons[0].classList.contains("pf2e-combater-combatant-intel-hud"), "with the HUD-sized style hook");
  assert.equal(typeof goblinButtons[0].listeners.click, "function", "and it opens the Intel window on click");
  assert.equal(buttonsIn("c-hero").length, 0, "player characters get no Intel button");
  assert.equal(buttonsIn("c-hidden").length, 0, "nor do combatants the player can't see");

  hooks.renderTrackerPF2eHUD(app, root);
  assert.equal(buttonsIn("c-goblin").length, 1, "re-rendering doesn't duplicate the button");

  // The GM's view has no player Intel button, as in the core tracker.
  globalThis.game.user = { id: "gm", isGM: true };
  const gmRoot = new FakeElement("section");
  gmRoot.append(hudRow("c-goblin", "Goblin"));
  hooks.renderTrackerPF2eHUD({ viewed: combat, element: gmRoot }, gmRoot);
  assert.equal(gmRoot.querySelectorAll(".pf2e-combater-combatant-intel").length, 0, "the GM gets no player Intel button");

  // Revealed intel changing re-decorates PF2e HUD's rows in place.
  globalThis.game.user = { id: "player", isGM: false };
  npc.flags["pf2e-combater"].intelLedger = {};
  globalThis.foundry.applications.instances = new Map([["pf2e-hud-tracker", app]]);
  refreshCombatTrackerIntel();
  assert.equal(buttonsIn("c-goblin").length, 0, "once nothing is revealed, the button goes away");
} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
}
console.log("PF2e HUD tracker Intel tests passed.");
