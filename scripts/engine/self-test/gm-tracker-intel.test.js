import assert from "node:assert/strict";

// Roi: the GM gets a quick Intel button on combat tracker rows; in PF2e HUD's tracker it sits in
// HUD's alternate row, which HUD shows while its modifier key is held.
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
  get classList() {
    return {
      contains: (name) => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        if (force ?? !names.has(name)) names.add(name);
        else names.delete(name);
        this.className = [...names].join(" ");
      },
    };
  }
  append(child) { child.parent = this; this.children.push(child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name === "data-combatant-id" ? this.dataset.combatantId ?? null : this.attributes[name] ?? null; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  set innerHTML(_html) { this.children = []; }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  matchesOne(selector) {
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
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

const coreRow = (id) => {
  const row = new FakeElement("li", { className: "combatant", dataset: { combatantId: id } });
  row.append(new FakeElement("div", { className: "combatant-controls" }));
  return row;
};
const hudRow = (id) => {
  const row = new FakeElement("li", { className: "combatant", dataset: { combatantId: id } });
  const details = new FakeElement("div", { className: "details" });
  details.append(new FakeElement("div", { className: "controls" }));
  details.append(new FakeElement("div", { className: "controls alt" }));
  row.append(details);
  return row;
};

const saved = Object.fromEntries(["game", "ui", "Hooks", "document", "HTMLElement", "foundry"].map((key) => [key, globalThis[key]]));
try {
  globalThis.foundry ??= {};
  globalThis.foundry.applications ??= {};
  globalThis.foundry.applications.api ??= { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {} };
  const { registerCombatTrackerIntel } = await import("../../ui/combat-tracker-intel.js");
  globalThis.HTMLElement = FakeElement;
  globalThis.document = { createElement: (tag) => new FakeElement(tag), getElementById: () => null, querySelector: () => null };
  const hooks = {};
  globalThis.Hooks = { on: (name, fn) => { hooks[name] = fn; } };

  const npc = { id: "goblin", type: "npc", flags: {}, getFlag: () => undefined };
  const hero = { id: "hero", type: "character", flags: {} };
  const combatants = [
    { id: "c-goblin", actor: npc, name: "Goblin", visible: true, token: { id: "t1" } },
    { id: "c-hero", actor: hero, name: "Hero", visible: true, token: { id: "t2" } },
    { id: "c-hidden", actor: npc, name: "Lurker", visible: false, hidden: true, token: { id: "t3" } },
  ];
  const combat = { id: "combat", combatants: { get: (id) => combatants.find((entry) => entry.id === id), contents: combatants } };
  globalThis.game = {
    combat,
    user: { id: "gm", isGM: true },
    modules: { get: (id) => (id === "pf2e-hud" ? { active: true } : undefined) },
    settings: { get: () => false },
    i18n: { localize: (key) => key, has: () => false, format: (key) => key },
  };
  globalThis.ui = { combat: { viewed: combat, render: () => {} } };
  registerCombatTrackerIntel();

  // Core tracker: every NPC row, hidden ones included, gets the GM button.
  const core = new FakeElement("section");
  for (const id of ["c-goblin", "c-hero", "c-hidden"]) core.append(coreRow(id));
  hooks.renderCombatTracker({ viewed: combat, element: core }, core);
  const gmButtons = (root, id) => root.querySelectorAll(".pf2e-combater-combatant-intel-gm")
    .filter((button) => {
      let el = button.parent;
      while (el && !el.dataset.combatantId) el = el.parent;
      return el?.dataset.combatantId === id;
    });
  assert.equal(gmButtons(core, "c-goblin").length, 1, "an NPC row gets the GM Intel button");
  assert.equal(gmButtons(core, "c-hidden").length, 1, "hidden NPCs too: the GM sees them");
  assert.equal(gmButtons(core, "c-hero").length, 0, "player characters don't");
  assert.ok(gmButtons(core, "c-goblin")[0].parent.classList.contains("combatant-controls"), "beside the row's own controls");
  assert.equal(core.querySelectorAll(".pf2e-combater-combatant-intel").length, 0, "no player Intel button for the GM");
  hooks.renderCombatTracker({ viewed: combat, element: core }, core);
  assert.equal(gmButtons(core, "c-goblin").length, 1, "re-rendering doesn't duplicate it");

  // PF2e HUD tracker: same button, HUD-sized, in the alternate controls HUD shows with its modifier.
  const hud = new FakeElement("section");
  for (const id of ["c-goblin", "c-hero"]) hud.append(hudRow(id));
  hooks.renderTrackerPF2eHUD({ viewed: combat, element: hud }, hud);
  const [hudButton] = gmButtons(hud, "c-goblin");
  assert.ok(hudButton?.classList.contains("pf2e-combater-combatant-intel-gm-hud"), "the HUD-sized variant");
  assert.ok(hudButton.parent.classList.contains("controls") && hudButton.parent.classList.contains("alt"),
    "in HUD's alternate row, so it appears while the modifier is held");
  assert.equal(gmButtons(hud, "c-hero").length, 0);
  assert.equal(typeof hudButton.listeners.pointerdown, "function", "it opens the GM's Intel editor on press");
  assert.equal(typeof hudButton.listeners.click, "function", "and on keyboard activation");

  // Players never get the GM button.
  globalThis.game.user = { id: "player", isGM: false };
  const playerRoot = new FakeElement("section");
  playerRoot.append(coreRow("c-goblin"));
  hooks.renderCombatTracker({ viewed: combat, element: playerRoot }, playerRoot);
  assert.equal(gmButtons(playerRoot, "c-goblin").length, 0, "players never see the GM button");

} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
}

console.log("GM tracker Intel tests passed.");
