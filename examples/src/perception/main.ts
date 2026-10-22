/**
 * Perception example — a guard with sight and last-seen memory. The sensor
 * reports what the guard sees and remembers; awareness, the search, and the
 * HUD are game components built on those facts.
 *
 * Layout follows the platformer reference:
 * - `constants.ts` — sizes, keys, spots, and the shadow rectangle.
 * - `level.ts`, `player.ts`, `guard.ts` — one `Entity` subclass per entity
 *   type, and the components that hold the rules.
 * - `overlays.ts`, `hud.ts` — world labels and the screen-space HUD.
 * - `scene.ts` — the `Scene` subclass; `onEnter` only spawns.
 * - `main.ts` — engine and plugins.
 */
import { Engine, InspectorPlugin } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { PhysicsPlugin } from "@yagejs/physics";
import { InputPlugin } from "@yagejs/input";
import { setupGameContainer } from "../shared/bootstrap.js";
import { HEIGHT, WIDTH } from "./constants.js";
import { PerceptionScene } from "./scene.js";

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(new InspectorPlugin());
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x121923,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 0 } }));
  engine.use(
    new InputPlugin({
      actions: {
        left: ["KeyA", "ArrowLeft"],
        right: ["KeyD", "ArrowRight"],
        up: ["KeyW", "ArrowUp"],
        down: ["KeyS", "ArrowDown"],
        // One action per entry in SPOTS (constants.ts).
        open: ["Digit1"],
        cover: ["Digit2"],
        far: ["Digit3"],
        behind: ["Digit4"],
        shadow: ["Digit5"],
      },
      preventDefaultKeys: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"],
    }),
  );
  await engine.start();
  await engine.scenes.push(new PerceptionScene());
}

main().catch(console.error);
