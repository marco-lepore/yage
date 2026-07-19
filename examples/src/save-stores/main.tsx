/**
 * Save Stores example
 *
 * A small "real" game with menu / gameplay / settings / pause scenes, where
 * every persistence call goes through the engine's DI: the React UI binds to
 * leaves via `useStore`, and the scenes' own Components resolve the
 * registered Save instance through `SaveServiceKey`.
 *
 * This example showcases the **compound** store pattern: a single
 * `createStore((s) => …)` bundles every run-state leaf (counters,
 * a record, a value), and a separate compound stores settings. Two
 * `save.autoPersist(id, store)` registrations cover the whole game state —
 * one storage key per compound — with atomic serialize/hydrate.
 */

import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { UIPlugin } from "@yagejs/ui";
import { UIReactPlugin } from "@yagejs/ui-react";
import { InputPlugin } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import { SavePlugin } from "@yagejs/save";
import { loadFonts } from "../shared/ui-theme.js";
import { setupGameContainer } from "../shared/bootstrap.js";
import { save, game, settings, GAME_ID, SETTINGS_ID } from "./stores.js";
import { MenuScene } from "./scenes.js";

// ---------------------------------------------------------------------------
// 8. Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Pre-engine: restore stored data so the menu reflects last-saved state.
  await Promise.all([
    save.restore(GAME_ID, game),
    save.restore(SETTINGS_ID, settings),
  ]);

  // Stream both compounds to disk (microtask-coalesced). Mutations to any
  // leaf trigger one debounced write per compound — not per leaf.
  save.autoPersist(GAME_ID, game);
  save.autoPersist(SETTINGS_ID, settings);

  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: 800,
      height: 600,
      virtualWidth: 800,
      virtualHeight: 600,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(800, 600),
    }),
  );
  engine.use(new UIPlugin());
  engine.use(new UIReactPlugin());
  engine.use(
    new InputPlugin({
      actions: { Escape: ["Escape"] },
    }),
  );
  engine.use(new SavePlugin({ save }));
  engine.use(new DebugPlugin());

  await loadFonts();
  await engine.start();
  await engine.scenes.push(new MenuScene());
}

main().catch(console.error);
