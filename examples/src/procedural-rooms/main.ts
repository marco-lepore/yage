/**
 * Procedural maps — a fifteen-room dungeon generated from requirements, the
 * same catalog selected without placement, and a cellular cave. Each map is
 * generated across frames by a `GenerationController`.
 *
 * Layout, after `src/platformer/`:
 * - `constants.ts` — sizes, layers, colours, events.
 * - `rooms.ts` — the room catalog and the dungeon's requirements.
 * - `content.ts` — authored level content for each room template.
 * - `map.ts` — the map host: generation jobs, results, keys and visits.
 * - `explorer.ts` — the player marker that walks the map.
 * - `view.ts`, `hud.ts` — drawing and status text.
 * - `scene.ts` — the `Scene` subclass; `onEnter` only spawns.
 * - `main.ts` — engine and plugins.
 */
import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { InputPlugin } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import { setupGameContainer } from "../shared/bootstrap.js";
import { HEIGHT, WIDTH } from "./constants.js";
import { ProceduralRoomsScene } from "./scene.js";

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0b1220,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        left: ["ArrowLeft", "KeyA"],
        right: ["ArrowRight", "KeyD"],
        up: ["ArrowUp", "KeyW"],
        down: ["ArrowDown", "KeyS"],
        select: ["Tab"],
        walk: ["Space"],
        dungeon: ["Digit1"],
        catalog: ["Digit2"],
        cave: ["Digit3"],
        reseed: ["KeyR"],
        budget: ["KeyB"],
        impossible: ["KeyU"],
      },
      preventDefaultKeys: [
        "Tab",
        "Space",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
      ],
    }),
  );
  engine.use(new DebugPlugin({ startEnabled: false }));
  await engine.start();
  await engine.scenes.push(new ProceduralRoomsScene());
}

main().catch(console.error);
