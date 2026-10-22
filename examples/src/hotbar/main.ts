/**
 * Hotbar addon example — one bar over an ability owner, an inventory and a
 * plain game action:
 *
 *  • **Abilities** — `hotbarAbility()` reads availability and cooldown from
 *    `Abilities`. Zap is a tap with a cooldown. Beam is a hold: the slot's key
 *    charges it, and letting go fires it.
 *  • **Items** — `hotbarItem()` shows the potion count and icon from the
 *    inventory and invokes the bag's "drink" action, which only exists while
 *    the player is hurt. The dummy hits back every few seconds.
 *  • **Plain actions** — Restock is a hand-written binding.
 *  • **Assignment and saving** — P, S and L call the model from a game
 *    component. E switches edit mode, where dragging swaps slots. Outside
 *    it, a mouse or touch press holds a slot like its key.
 *  • **A moving owner** — the player walks with A/D while the bar stays put.
 *
 * Files:
 * - `constants.ts` — sizes, layers, keys, events and the item catalog.
 * - `player.ts` — the player, its abilities, bag and hotbar.
 * - `target.ts` — the training dummy.
 * - `hud.ts` — the status panel, which reports activation outcomes.
 * - `scene.ts` — the `Scene` subclass; `onEnter` only spawns.
 * - `main.ts` — engine and plugins.
 */
import { Engine, InspectorPlugin } from "@yagejs/core";
import { RendererPlugin, registerTexture } from "@yagejs/renderer";
import { InputPlugin } from "@yagejs/input";
import { HOTBAR_ACTION_MAP } from "@yagejs-addons/hotbar";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import {
  HEIGHT,
  ICON_POTION,
  ICON_SIZE,
  WIDTH,
  drawPotionIcon,
} from "./constants.js";
import { HotbarScene } from "./scene.js";

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(new InspectorPlugin());
  const renderer = new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0c1422,
    container: setupGameContainer(WIDTH, HEIGHT),
  });
  engine.use(renderer);
  engine.use(
    new InputPlugin({
      actions: {
        ...HOTBAR_ACTION_MAP,
        "walk-left": ["KeyA"],
        "walk-right": ["KeyD"],
        "next-action": ["KeyP"],
        "edit-mode": ["KeyE"],
        "save-layout": ["KeyS"],
        "load-layout": ["KeyL"],
      },
      preventDefaultKeys: ["ArrowLeft", "ArrowRight"],
    }),
  );
  await installDebugFromUrl(engine);
  await engine.start();
  // The item catalog names the potion icon by key. Register the texture
  // under that key before the hotbar view draws it.
  registerTexture(
    ICON_POTION,
    renderer.createTexture(drawPotionIcon, {
      width: ICON_SIZE,
      height: ICON_SIZE,
    }),
  );
  await engine.scenes.push(new HotbarScene());
}

main().catch(console.error);
