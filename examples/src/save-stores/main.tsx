/**
 * Save Stores example
 *
 * A small "real" game with menu / gameplay / settings / pause scenes. Its
 * state is two **compound** stores (`stores.ts`): `game` bundles every
 * run-state leaf (a record and a counter) and `settings` holds the options.
 * Two `save.autoPersist(id, store)` registrations cover the whole game
 * state: one storage key per compound, serialized and hydrated atomically.
 *
 * The Save instance is created in `main()`, and only the boot code there uses
 * it directly: it restores both stores and starts auto-persisting them before
 * the engine exists. Everything else reaches it through the engine's DI:
 * SavePlugin registers it under `SaveServiceKey`, and the `SaveSlots`
 * component resolves it to list, save, load and delete slots. The React UI
 * reads the stores with `useStore` and forwards clicks to the scene's menu
 * component, to `SaveSlots`, or to the rules in `stores.ts`.
 */

import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { UIPlugin } from "@yagejs/ui";
import { UIReactPlugin } from "@yagejs/ui-react";
import { InputPlugin } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import { SavePlugin, createSave, localStorageAdapter } from "@yagejs/save";
import { setupGameContainer } from "../shared/bootstrap.js";
import { game, settings, GAME_ID, SETTINGS_ID } from "./stores.js";
import { MenuScene } from "./scenes.js";

// ---------------------------------------------------------------------------
// 9. Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const save = createSave({
    adapter: localStorageAdapter({ namespace: "yage-save-stores-example" }),
  });

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

  await engine.start();
  await engine.scenes.push(new MenuScene());
}

main().catch(console.error);
