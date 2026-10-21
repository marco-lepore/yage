/**
 * Behavior tree example — two guards share one tree definition. Each guard
 * walks to its gate, waits a random reaction time, picks a normal or heavy
 * attack, and recovers. Low health interrupts whatever it is doing: it runs
 * home while calling for help, rests, and heals.
 *
 * Layout, after the platformer reference:
 * - `constants.ts` — sizes, lane positions, events.
 * - `behavior.ts` — the shared tree definition and the context it reads.
 * - `guard.ts`, `level.ts`, `hud.ts`, `demonstration.ts` — one `Entity`
 *   subclass per entity type, and the components that hold the rules.
 * - `scene.ts` — the `Scene` subclass; `onEnter` only spawns.
 * - `main.ts` — engine and plugins.
 */
import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { InputPlugin } from "@yagejs/input";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import { HEIGHT, WIDTH } from "./constants.js";
import { BehaviorScene } from "./scene.js";

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0f172a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        "hurt-first": ["Digit1"],
        "hurt-second": ["Digit2"],
        "toggle-first": ["Space"],
      },
      preventDefaultKeys: ["Space"],
    }),
  );
  await installDebugFromUrl(engine);
  await engine.start();
  await engine.scenes.push(new BehaviorScene());
}

main().catch(console.error);
