import { MODULE_ID } from "./constants.js";

const SETTINGS = {
  autoOpen: "autoOpen",
  autoOpenNpcTurnsOnly: "autoOpenNpcTurnsOnly",
  showReactionMarker: "showReactionMarker",
  compactDefault: "compactDefault",
  panelMode: "panelMode",
  playerPanelMode: "playerPanelMode",
  minimalParts: "minimalParts",
  rememberPanelPosition: "rememberPanelPosition",
  showTurnNavigation: "showTurnNavigation",
  enableSpellRecommendations: "enableSpellRecommendations",
  hideUntrainedSkillActions: "hideUntrainedSkillActions",
  includeUnknownCustomActions: "includeUnknownCustomActions",
  hideAutoFillFromPlayers: "hideAutoFillFromPlayers",
  playerAutoFillWhen: "playerAutoFillWhen",
  nativeRollContextPreflight: "nativeRollContextPreflight",
  showDebugTab: "showDebugTab",
  disableForPlayers: "disableForPlayers",
  flankingSizeRule: "flankingSizeRule",
  raisePcShieldsWhenDefending: "raisePcShieldsWhenDefending",
  enrageBarbariansAtCombatStart: "enrageBarbariansAtCombatStart",
  learnObservedIntel: "learnObservedIntel",
  learnAppliedDefenses: "learnAppliedDefenses",
  unmystifyOnIdentity: "unmystifyOnIdentity",
  falseIntelSteersPlans: "falseIntelSteersPlans",
  defaultIntelRevealMode: "defaultIntelRevealMode",
  componentTracker: "componentTracker",
  componentPlanner: "componentPlanner",
  componentIntel: "componentIntel",
  reactionsBeforeFirstTurn: "reactionsBeforeFirstTurn",
  combatTrackerActions: "combatTrackerActions",
  autoFillOnTurnStart: "autoFillOnTurnStart",
  runBrowserPicks: "runBrowserPicks",
};

// On your own turn, an action picked from the browser runs at once when nothing else is needed.
export function runBrowserPicks() {
  return settingOrDefault(SETTINGS.runBrowserPicks, true) !== false;
}

// Show each creature's actions and reaction in Foundry's and PF2e HUD's combat trackers.
export function combatTrackerActions() {
  return componentEnabled("tracker") && settingOrDefault(SETTINGS.combatTrackerActions, false) === true;
}

// Off: a creature gets its reaction only once its first turn of the encounter starts.
export function reactionsBeforeFirstTurn() {
  return settingOrDefault(SETTINGS.reactionsBeforeFirstTurn, true) !== false;
}

// The reveal style of a creature whose Intel the GM hasn't set one for: "exact" or "band".
export function defaultIntelRevealMode() {
  return settingOrDefault(SETTINGS.defaultIntelRevealMode, "exact") === "band" ? "band" : "exact";
}

// On: a false fact a character believes steers that player's Auto-fill as if it were true. Off: it
// is only shown to them, and plans use real facts alone.
export function falseIntelSteersPlans() {
  return settingOrDefault(SETTINGS.falseIntelSteersPlans, true) !== false;
}

// Parts of the minimal bar a user can switch off (Customize minimal bar).
export const MINIMAL_PARTS = ["autofill", "browse", "setup", "intel", "cycle", "plan", "tracker", "readied", "delay", "upcoming", "turn"];
// Opt-in parts: off until the user turns them on (the Intel shortcut also sits in Plan setup).
const MINIMAL_PARTS_OFF_BY_DEFAULT = new Set(["intel"]);

export function minimalHiddenParts() {
  const shown = settingOrDefault(SETTINGS.minimalParts, {}) ?? {};
  const componentOff = new Set([
    ...(componentEnabled("tracker") ? [] : ["tracker", "readied", "delay", "upcoming", "turn"]),
    ...(componentEnabled("intel") ? [] : ["intel"]),
  ]);
  return MINIMAL_PARTS.filter((part) => componentOff.has(part) || shown[part] === false
    // Opt-in parts stay off until chosen, except Intel on the tracker-only bar: with no planner
    // there is no Plan setup menu to reach it from, so it shows unless the user turned it off.
    || (shown[part] === undefined && MINIMAL_PARTS_OFF_BY_DEFAULT.has(part) && !(part === "intel" && trackerOnlyMode())));
}

// Combater's three parts, each a world setting the GM can switch off:
// tracker (action and reaction glyphs, turn controls, token markers), planner (Auto-fill, Browse,
// plans, canvas previews) and intel (brain buttons, Known creatures, Recall Knowledge, what the
// planner may know about enemies).
const COMPONENT_SETTINGS = { tracker: SETTINGS.componentTracker, planner: SETTINGS.componentPlanner, intel: SETTINGS.componentIntel };

export function componentEnabled(name) {
  const key = COMPONENT_SETTINGS[name];
  return key ? settingOrDefault(key, true) !== false : true;
}

// The Combater window has something to show: the tracker, the planner, or both.
export function panelComponentsEnabled() {
  return componentEnabled("tracker") || componentEnabled("planner");
}

export function registerSettings({ decorateFlankingFormGroup, minimalPartsMenu } = {}) {
  for (const [name, key] of Object.entries(COMPONENT_SETTINGS)) {
    const label = name[0].toUpperCase() + name.slice(1);
    game.settings.register(MODULE_ID, key, {
      name: `PF2E_COMBATER.Settings.Component${label}.Name`,
      hint: `PF2E_COMBATER.Settings.Component${label}.Hint`,
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => Hooks.callAll("pf2e-combater.componentsChanged"),
    });
  }

  game.settings.register(MODULE_ID, SETTINGS.autoOpen, {
    name: "PF2E_COMBATER.Settings.AutoOpen.Name",
    hint: "PF2E_COMBATER.Settings.AutoOpen.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  // GM only: open the window by itself on NPC turns, and put it away on player-owned turns.
  game.settings.register(MODULE_ID, SETTINGS.autoOpenNpcTurnsOnly, {
    name: "PF2E_COMBATER.Settings.AutoOpenNpcTurnsOnly.Name",
    hint: "PF2E_COMBATER.Settings.AutoOpenNpcTurnsOnly.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, SETTINGS.showReactionMarker, {
    name: "PF2E_COMBATER.Settings.ShowReactionMarker.Name",
    hint: "PF2E_COMBATER.Settings.ShowReactionMarker.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => Hooks.callAll("pf2e-combater.reactionMarkerChanged"),
  });

  game.settings.register(MODULE_ID, SETTINGS.compactDefault, {
    name: "PF2E_COMBATER.Settings.CompactDefault.Name",
    hint: "PF2E_COMBATER.Settings.CompactDefault.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });

  // Tracker only: the minimal bar (action tracker, End turn, Delay/Ready) with the planner
  // switched off. The GM picks what players get by default; each user can override it.
  game.settings.register(MODULE_ID, SETTINGS.panelMode, {
    name: "PF2E_COMBATER.Settings.PanelMode.Name",
    hint: "PF2E_COMBATER.Settings.PanelMode.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      default: "PF2E_COMBATER.Settings.PanelMode.Choices.Default",
      tracker: "PF2E_COMBATER.Settings.PanelMode.Choices.Tracker",
      full: "PF2E_COMBATER.Settings.PanelMode.Choices.Full",
    },
    default: "default",
    onChange: () => Hooks.callAll("pf2e-combater.panelModeChanged"),
  });

  game.settings.register(MODULE_ID, SETTINGS.playerPanelMode, {
    name: "PF2E_COMBATER.Settings.PlayerPanelMode.Name",
    hint: "PF2E_COMBATER.Settings.PlayerPanelMode.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      full: "PF2E_COMBATER.Settings.PanelMode.Choices.Full",
      tracker: "PF2E_COMBATER.Settings.PanelMode.Choices.Tracker",
    },
    default: "full",
    onChange: () => Hooks.callAll("pf2e-combater.panelModeChanged"),
  });

  game.settings.register(MODULE_ID, SETTINGS.minimalParts, {
    scope: "client",
    config: false,
    type: Object,
    default: {},
    onChange: () => Hooks.callAll("pf2e-combater.minimalPartsChanged"),
  });

  if (minimalPartsMenu) {
    game.settings.registerMenu(MODULE_ID, "minimalPartsMenu", {
      name: "PF2E_COMBATER.Settings.MinimalParts.Name",
      label: "PF2E_COMBATER.Settings.MinimalParts.Label",
      hint: "PF2E_COMBATER.Settings.MinimalParts.Hint",
      icon: "fa-solid fa-sliders",
      type: minimalPartsMenu,
      restricted: false,
    });
  }

  game.settings.register(MODULE_ID, SETTINGS.rememberPanelPosition, {
    name: "PF2E_COMBATER.Settings.RememberPanelPosition.Name",
    hint: "PF2E_COMBATER.Settings.RememberPanelPosition.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.showTurnNavigation, {
    name: "PF2E_COMBATER.Settings.ShowTurnNavigation.Name",
    hint: "PF2E_COMBATER.Settings.ShowTurnNavigation.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => Hooks.callAll("pf2e-combater.turnNavigationChanged"),
  });

  game.settings.register(MODULE_ID, SETTINGS.runBrowserPicks, {
    name: "PF2E_COMBATER.Settings.RunBrowserPicks.Name",
    hint: "PF2E_COMBATER.Settings.RunBrowserPicks.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.enableSpellRecommendations, {
    name: "PF2E_COMBATER.Settings.EnableSpellRecommendations.Name",
    hint: "PF2E_COMBATER.Settings.EnableSpellRecommendations.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.hideUntrainedSkillActions, {
    name: "PF2E_COMBATER.Settings.HideUntrainedSkillActions.Name",
    hint: "PF2E_COMBATER.Settings.HideUntrainedSkillActions.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.includeUnknownCustomActions, {
    name: "PF2E_COMBATER.Settings.IncludeUnknownCustomActions.Name",
    hint: "PF2E_COMBATER.Settings.IncludeUnknownCustomActions.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, SETTINGS.hideAutoFillFromPlayers, {
    name: "PF2E_COMBATER.Settings.HideAutoFillFromPlayers.Name",
    hint: "PF2E_COMBATER.Settings.HideAutoFillFromPlayers.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, SETTINGS.playerAutoFillWhen, {
    name: "PF2E_COMBATER.Settings.PlayerAutoFillWhen.Name",
    hint: "PF2E_COMBATER.Settings.PlayerAutoFillWhen.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      always: "PF2E_COMBATER.Settings.PlayerAutoFillWhen.Always",
      "last-two": "PF2E_COMBATER.Settings.PlayerAutoFillWhen.LastTwo",
      last: "PF2E_COMBATER.Settings.PlayerAutoFillWhen.Last",
    },
    default: "always",
    // Open panels redraw, so the Auto-fill button appears or goes at once.
    onChange: () => Hooks.callAll("pf2e-combater.minimalPartsChanged"),
  });

  game.settings.register(MODULE_ID, SETTINGS.nativeRollContextPreflight, {
    name: "PF2E_COMBATER.Settings.NativeRollContextPreflight.Name",
    hint: "PF2E_COMBATER.Settings.NativeRollContextPreflight.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => Hooks.callAll("pf2e-combater.preflightSettingChanged"),
  });

  game.settings.register(MODULE_ID, SETTINGS.showDebugTab, {
    name: "PF2E_COMBATER.Settings.ShowDebugTab.Name",
    hint: "PF2E_COMBATER.Settings.ShowDebugTab.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, SETTINGS.disableForPlayers, {
    name: "PF2E_COMBATER.Settings.DisableForPlayers.Name",
    hint: "PF2E_COMBATER.Settings.DisableForPlayers.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => Hooks.callAll("pf2e-combater.playerAccessChanged"),
  });

  const flankingChoices = {
    raw: "PF2E_COMBATER.Settings.FlankingSizeRule.Choices.Raw",
    anySquare: "PF2E_COMBATER.Settings.FlankingSizeRule.Choices.AnySquare",
    anyCorner: "PF2E_COMBATER.Settings.FlankingSizeRule.Choices.AnyCorner",
    lineThrough: "PF2E_COMBATER.Settings.FlankingSizeRule.Choices.LineThrough",
  };
  const StringField = globalThis.foundry?.data?.fields?.StringField;
  const flankingType = StringField && decorateFlankingFormGroup
    ? new (class extends StringField {
      toFormGroup(groupConfig, inputConfig) {
        const group = super.toFormGroup(groupConfig, inputConfig);
        decorateFlankingFormGroup(group);
        return group;
      }
    })({ required: true, choices: flankingChoices, initial: "raw" })
    : String;
  game.settings.register(MODULE_ID, SETTINGS.flankingSizeRule, {
    name: "PF2E_COMBATER.Settings.FlankingSizeRule.Name",
    hint: "PF2E_COMBATER.Settings.FlankingSizeRule.Hint",
    scope: "world",
    config: true,
    type: flankingType,
    choices: flankingChoices,
    default: "raw",
  });
  game.settings.register(MODULE_ID, SETTINGS.raisePcShieldsWhenDefending, {
    name: "PF2E_COMBATER.Settings.RaisePcShieldsWhenDefending.Name",
    hint: "PF2E_COMBATER.Settings.RaisePcShieldsWhenDefending.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, SETTINGS.enrageBarbariansAtCombatStart, {
    name: "PF2E_COMBATER.Settings.EnrageBarbariansAtCombatStart.Name",
    hint: "PF2E_COMBATER.Settings.EnrageBarbariansAtCombatStart.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, SETTINGS.defaultIntelRevealMode, {
    name: "PF2E_COMBATER.Settings.DefaultIntelRevealMode.Name",
    hint: "PF2E_COMBATER.Settings.DefaultIntelRevealMode.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      exact: "PF2E_COMBATER.Settings.DefaultIntelRevealMode.Exact",
      band: "PF2E_COMBATER.Settings.DefaultIntelRevealMode.Band",
    },
    default: "exact",
  });

  game.settings.register(MODULE_ID, SETTINGS.falseIntelSteersPlans, {
    name: "PF2E_COMBATER.Settings.FalseIntelSteersPlans.Name",
    hint: "PF2E_COMBATER.Settings.FalseIntelSteersPlans.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.learnObservedIntel, {
    name: "PF2E_COMBATER.Settings.LearnObservedIntel.Name",
    hint: "PF2E_COMBATER.Settings.LearnObservedIntel.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, SETTINGS.learnAppliedDefenses, {
    name: "PF2E_COMBATER.Settings.LearnAppliedDefenses.Name",
    hint: "PF2E_COMBATER.Settings.LearnAppliedDefenses.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, SETTINGS.unmystifyOnIdentity, {
    name: "PF2E_COMBATER.Settings.UnmystifyOnIdentity.Name",
    hint: "PF2E_COMBATER.Settings.UnmystifyOnIdentity.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, SETTINGS.reactionsBeforeFirstTurn, {
    name: "PF2E_COMBATER.Settings.ReactionsBeforeFirstTurn.Name",
    hint: "PF2E_COMBATER.Settings.ReactionsBeforeFirstTurn.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, SETTINGS.combatTrackerActions, {
    name: "PF2E_COMBATER.Settings.CombatTrackerActions.Name",
    hint: "PF2E_COMBATER.Settings.CombatTrackerActions.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      globalThis.ui?.combat?.render?.();
      globalThis.foundry?.applications?.instances?.get?.("pf2e-hud-tracker")?.render?.();
    },
  });
  game.settings.register(MODULE_ID, SETTINGS.autoFillOnTurnStart, {
    name: "PF2E_COMBATER.Settings.AutoFillOnTurnStart.Name",
    hint: "PF2E_COMBATER.Settings.AutoFillOnTurnStart.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, "visionerCombatSettingsMigrated", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });
}

export async function migrateVisionerCombatSettings() {
  if (!game.user?.isActiveGM || !game.modules?.get?.("pf2e-visioner")?.active) return;
  if (setting("visionerCombatSettingsMigrated")) return;
  for (const key of [SETTINGS.flankingSizeRule, SETTINGS.raisePcShieldsWhenDefending, SETTINGS.enrageBarbariansAtCombatStart]) {
    try {
      const legacy = game.settings.get("pf2e-visioner", key);
      const current = setting(key);
      const defaultValue = key === SETTINGS.flankingSizeRule ? "raw" : false;
      if (legacy === undefined || legacy === defaultValue) continue;
      if (current === defaultValue && legacy !== "oppositeArcs") {
        await game.settings.set(MODULE_ID, key, legacy);
      }
      await game.settings.set("pf2e-visioner", key, defaultValue);
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not migrate Visioner combat setting ${key}:`, error);
      return;
    }
  }
  await game.settings.set(MODULE_ID, "visionerCombatSettingsMigrated", true);
}

export async function migrateDeprecatedFlankingRule() {
  if (!game.user?.isActiveGM) return;
  if (setting(SETTINGS.flankingSizeRule) === "oppositeArcs") {
    await game.settings.set(MODULE_ID, SETTINGS.flankingSizeRule, "raw");
  }
}

// GM can lock players out of the panel entirely; the GM's own access is never affected.
export function playerAccessAllowed() {
  if (game.user?.isGM === true) return true;
  try {
    return !game.settings.get(MODULE_ID, SETTINGS.disableForPlayers);
  } catch (_error) {
    return true;
  }
}

// The user's own choice wins; otherwise players get the GM's default and the GM gets the planner.
export function trackerOnlyMode() {
  // The planner component is off for the whole world: only the tracker bar is left.
  if (!componentEnabled("planner")) return true;
  const own = settingOrDefault(SETTINGS.panelMode, "default");
  if (own === "tracker" || own === "full") return own === "tracker";
  return game.user?.isGM !== true && settingOrDefault(SETTINGS.playerPanelMode, "full") === "tracker";
}

export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function settingOrDefault(key, fallback) {
  try {
    const value = setting(key);
    return value === undefined ? fallback : value;
  } catch (_error) {
    return fallback;
  }
}

export { SETTINGS };
