/**
 * Loot tables example: a chest rolls seeded rewards from the scene's random
 * generator and explains every selection. The adventurer's stats feed the
 * chest rules, a two-slot backpack accepts what fits, and refused rewards
 * wait beside the chest.
 *
 * - `tables.ts` — item catalog, chest context and loot tables.
 * - `adventurer.ts`, `chest.ts`, `hud.ts` — one `Entity` subclass per entity
 *   type, and the components that hold the rules.
 * - `scene.ts` — the `Scene` subclass; `onEnter` only spawns.
 * - `main.ts` — engine and plugins.
 */
import { Engine, InspectorPlugin } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { InputPlugin } from "@yagejs/input";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import { HEIGHT, WIDTH } from "./constants.js";
import { LootScene } from "./scene.js";

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(new InspectorPlugin());
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      container: setupGameContainer(WIDTH, HEIGHT),
      backgroundColor: 0x101722,
    }),
  );
  engine.use(
    new InputPlugin({
      actions: { open: ["Space"], bank: ["KeyB"], level: ["KeyL"] },
      preventDefaultKeys: ["Space"],
    }),
  );
  await installDebugFromUrl(engine);
  await engine.start();
  await engine.scenes.push(new LootScene());
}
main().catch(console.error);
