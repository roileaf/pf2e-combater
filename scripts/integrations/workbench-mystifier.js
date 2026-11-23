import { MODULE_ID } from "../constants.js";
import { SETTINGS, componentEnabled, settingOrDefault } from "../settings.js";
import { readIntelLedger } from "../rules/intel-ledger.js";

// PF2e Workbench's NPC Mystifier renames a token ("Unknown Humanoid") until the GM un-mystifies it.
// Once the party's Intel names the creature, the token saying otherwise contradicts it, so the
// GM's client un-mystifies that creature's tokens through Workbench's own API.

const WORKBENCH_ID = "xdy-pf2e-workbench";

function workbenchApi() {
  if (globalThis.game?.modules?.get?.(WORKBENCH_ID)?.active !== true) return null;
  const api = globalThis.game?.PF2eWorkbench;
  return typeof api?.doMystificationFromToken === "function" ? api : null;
}

// The party knows who the creature is (the Identity category is revealed).
export function intelIdentityKnown(ledger) {
  const value = ledger?.identity;
  return value === true || (Array.isArray(value) && value.length > 0);
}

// Workbench's own test: a mystified token's name no longer contains the actor's prototype name.
export function isTokenMystified(token) {
  const prototypeName = String(token?.actor?.prototypeToken?.name ?? "");
  return !String(token?.name ?? "").includes(prototypeName);
}

// Un-mystifies every mystified token of the actor on the scene; returns how many it asked for.
export async function unmystifyIdentifiedTokens(actor, { api = workbenchApi(), scene = globalThis.canvas?.scene, currentScene = globalThis.game?.scenes?.current } = {}) {
  // Workbench looks the token up on game.scenes.current and writes to canvas.scene (both the viewed
  // scene); a scene nobody on this client is viewing is out of its reach.
  if (!api || !actor?.id || !scene || scene.id !== currentScene?.id) return 0;
  const tokens = Array.from(scene.tokens ?? []).filter((token) => (token.actorId ?? token.actor?.id) === actor.id);
  let count = 0;
  for (const token of tokens) {
    // Re-checked each time: Workbench may un-mystify every token of the actor in one call.
    if (!isTokenMystified(token)) continue;
    await api.doMystificationFromToken(token.id, true);
    count += 1;
  }
  return count;
}

export function registerWorkbenchMystifierHooks() {
  const knownBefore = new Map();
  const enabled = () => globalThis.game?.user?.isGM === true && componentEnabled("intel") && settingOrDefault(SETTINGS.unmystifyOnIdentity, false);
  // Both hooks run on the client that made the change; Intel is written by a GM's client.
  Hooks.on("preUpdateActor", (actor, changes) => {
    if (changes?.flags?.[MODULE_ID] === undefined || !enabled()) return;
    knownBefore.set(actor.id, intelIdentityKnown(readIntelLedger(actor)));
  });
  Hooks.on("updateActor", (actor, changes, _options, userId) => {
    if (changes?.flags?.[MODULE_ID] === undefined || userId !== globalThis.game?.user?.id) return;
    const before = knownBefore.get(actor.id);
    knownBefore.delete(actor.id);
    // Only on the reveal itself, so a token the GM mystifies again afterwards stays that way.
    if (before !== false || !enabled() || !intelIdentityKnown(readIntelLedger(actor))) return;
    unmystifyIdentifiedTokens(actor).catch((error) => {
      console.warn(`${MODULE_ID} | Could not un-mystify tokens:`, error);
    });
  });
}
