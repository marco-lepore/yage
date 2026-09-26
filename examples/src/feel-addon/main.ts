/**
 * Feel addon showcase. Four scenes group related cues into readable pages and
 * use the scene transition API for page navigation.
 *
 * - `constants.ts` — sizes, autoplay timing, panel layouts.
 * - `gallery.ts` — the demo base class, the HUD that holds the autoplay
 *   state, and the backdrop.
 * - `essentials.ts`, `more-effects.ts`, `advanced-effects.ts`,
 *   `practical-recipes.ts` — one `Entity` subclass per demo, page by page.
 * - `scenes.ts` — the four page scenes and page navigation.
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
import { createShowcaseScene } from "./scenes.js";

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
        cue1: ["Digit1"],
        cue2: ["Digit2"],
        cue3: ["Digit3"],
        cue4: ["Digit4"],
        cue5: ["Digit5"],
        cue6: ["Digit6"],
        autoplay: ["KeyA"],
        nextPage: ["KeyN", "ArrowRight"],
        previousPage: ["KeyP", "ArrowLeft"],
      },
    }),
  );
  await installDebugFromUrl(engine);
  await engine.start();
  await engine.scenes.push(createShowcaseScene(0, { autoplay: true }));
}

main().catch(console.error);
