import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { syncReadyMarker } from "../../ui/ready-marker.js";

const previousGame = globalThis.game;
let settingsReads = 0;
globalThis.game = {
  combat: null,
  user: { isGM: true },
  settings: { get() { settingsReads += 1; return true; } },
};

try {
  const token = { id: "token-a", w: 100, h: 100, actor: { hasPlayerOwner: true } };
  for (let index = 0; index < 25; index += 1) syncReadyMarker(token);
  assert.equal(settingsReads, 0, "token refreshes outside combat must not read Combater settings");
  assert.equal(token._combaterReadyMarker, undefined, "no ready marker is created outside combat");
  assert.equal(token._combaterReactionMarker, undefined, "no reaction marker is created outside combat");

  let destroyed = false;
  const staleMarker = { destroyed: false, destroy() { destroyed = true; } };
  const tokenWithStaleMarker = { id: "token-b", w: 100, h: 100, actor: { hasPlayerOwner: true } };
  staleMarker.parent = tokenWithStaleMarker;
  tokenWithStaleMarker._combaterReactionMarker = staleMarker;
  syncReadyMarker(tokenWithStaleMarker);
  assert.equal(destroyed, true, "a marker left from an ended combat is still removed");
  assert.equal(tokenWithStaleMarker._combaterReactionMarker, null);
} finally {
  globalThis.game = previousGame;
}

const mainSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");
const refreshTokenHook = mainSource.match(/Hooks\.on\("refreshToken", \(token\) => \{([\s\S]*?)\n\}\);/)?.[1] ?? "";
const panelGuard = refreshTokenHook.indexOf("if (!activePanel) return;");
const snapshotCall = refreshTokenHook.indexOf("consumeTokenRefreshChange(token)");
assert.ok(panelGuard >= 0, "the refreshToken hook bails out when no Combater panel is open");
assert.ok(snapshotCall > panelGuard, "token snapshots are only built while a Combater panel is open");
