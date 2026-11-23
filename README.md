# PF2e Combater

[![Latest Version](https://img.shields.io/github/v/release/roileaf/pf2e-combater?display_name=tag&sort=semver&label=Latest%20Version)](https://github.com/roileaf/pf2e-combater/releases/latest)
[![GitHub all releases](https://img.shields.io/github/downloads/roileaf/pf2e-combater/total)](https://github.com/roileaf/pf2e-combater/releases)

PF2e Combater is three tools for Pathfinder 2e combat in Foundry VTT, in one small window:

- **🎯 Action tracker.** Counts the actions and reactions each creature spends, from chat cards, rolls and token movement. Handles Slowed, Stunned and Quickened, and runs **End turn**, **Delay** and **Ready**.
- **🧭 Turn planner.** Reads the creature's real options and the battlefield, builds a turn that fits its actions, previews it on the canvas, and runs it step by step with undo.
- **🧠 Intel tracker.** Records what each character knows about each creature, runs Recall Knowledge through the GM, and keeps player suggestions limited to what their character has learned.

Use any one without the others: a table that only wants the tracker can switch the planner off, and the GM decides how much planning help players get.

**📖 Everything is documented in the [wiki](https://github.com/roileaf/pf2e-combater/wiki).**

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/roileaf)
[![Patreon](https://c5.patreon.com/external/logo/become_a_patron_button.png)](https://www.patreon.com/roileaf)

<p align="center"><img src="https://raw.githubusercontent.com/wiki/roileaf/pf2e-combater/images/panel-plan.png" alt="The Combater planner with a planned turn" width="460"></p>
<p align="center"><img src="https://raw.githubusercontent.com/wiki/roileaf/pf2e-combater/images/minimal-bar.png" alt="The minimal bar" width="700"></p>

> **No AI, no cloud.** Suggestions come from deterministic, rules-based scoring that runs in your browser. Nothing is sent anywhere, and the same board always produces the same plan.

## Install

1. In Foundry, open **Add-on Modules → Install Module**.
2. Search for **PF2e Combater**, or paste the manifest URL:
   `https://github.com/roileaf/pf2e-combater/releases/latest/download/module.json`
3. Enable **PF2e Combater** and **socketlib** in your world.

**Requires** Foundry VTT v14, the Pathfinder 2e system and socketlib. See [Installation and Requirements](https://github.com/roileaf/pf2e-combater/wiki/Installation-and-Requirements).

## Quick start

1. Open the panel with the crosshairs tool in **Token Controls**, or **Alt+Shift+C**. It also opens when a turn starts.
2. Click **Auto-fill** for a suggested turn, or **Browse** to pick actions yourself.
3. Run steps with **▶** or **Run next**, then **End turn**.
4. The brain tool in Token Controls (**Alt+Shift+K**) opens what your characters know about creatures.

More in [Getting Started](https://github.com/roileaf/pf2e-combater/wiki/Getting-Started).

## Documentation

| | |
|---|---|
| **Action tracker** | [Action Tracker](https://github.com/roileaf/pf2e-combater/wiki/Action-Tracker) · [Turn Controls](https://github.com/roileaf/pf2e-combater/wiki/Turn-Controls) · [Minimal Bar and Tracker Only Mode](https://github.com/roileaf/pf2e-combater/wiki/Minimal-Bar-and-Tracker-Only-Mode) |
| **Turn planner** | [Planner Panel](https://github.com/roileaf/pf2e-combater/wiki/Planner-Panel) · [Action Browser](https://github.com/roileaf/pf2e-combater/wiki/Action-Browser) · [Auto-fill](https://github.com/roileaf/pf2e-combater/wiki/Auto-fill) · [What the Planner Can Plan](https://github.com/roileaf/pf2e-combater/wiki/What-the-Planner-Can-Plan) · [How Auto-fill Decides](https://github.com/roileaf/pf2e-combater/wiki/How-Auto-fill-Decides) · [Canvas, Execution and Undo](https://github.com/roileaf/pf2e-combater/wiki/Canvas-Execution-and-Undo) |
| **Intel tracker** | [Intel Tracker](https://github.com/roileaf/pf2e-combater/wiki/Intel-Tracker) · [Recall Knowledge](https://github.com/roileaf/pf2e-combater/wiki/Recall-Knowledge) |
| **By role** | [GM Guide](https://github.com/roileaf/pf2e-combater/wiki/GM-Guide) · [Player Guide](https://github.com/roileaf/pf2e-combater/wiki/Player-Guide) |
| **Reference** | [Integrations](https://github.com/roileaf/pf2e-combater/wiki/Integrations) · [Settings](https://github.com/roileaf/pf2e-combater/wiki/Settings) · [FAQ and Troubleshooting](https://github.com/roileaf/pf2e-combater/wiki/FAQ-and-Troubleshooting) |

What changed in each release: [CHANGELOG.md](CHANGELOG.md).

## Works with

PF2e HUD, PF2e Hazarder, PF2e Commanderer, PF2e Summons Assistant, Bestiary Tracking, PF2e Exploit Vulnerability, PF2e Reaction Checker, Sundry, PF2e Guarder, Animater, PF2e Avoid Notice and PF2e Visioner. All optional. Details in [Integrations](https://github.com/roileaf/pf2e-combater/wiki/Integrations).

## Feedback

Found a bug, or did Auto-fill pick a strange turn? [Open an issue](https://github.com/roileaf/pf2e-combater/issues). For a bad plan, GMs can attach the file saved by the **flask** button in the plan footer.

## Development

- Lint and tests: `npx eslint scripts` and `node scripts/engine/self-test.js`.
- Planner quality scenarios: `npm run planner:quality` (`npm run planner:quality:json` for JSON).
- Live browser suite against a disposable Foundry world: `npm run test:live`, `npm run test:live:full`. Setup in [`tests/live/README.md`](tests/live/README.md).
- Read-only integration check from the Foundry console: `await game.modules.get('pf2e-combater').api.runLiveEngineMatrix()`.

## License and credits

- GPL-3.0. See `LICENSE`.
- Built for the community-maintained PF2e system for Foundry VTT.
- Thanks to everyone who tested and gave feedback.
