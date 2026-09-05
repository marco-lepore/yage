/**
 * Effects showcase — exercises every preset in `@yagejs/effects` at each
 * scope (component, layer, scene, screen).
 *
 * The toggle UI lives on its own screen-space `"ui"` layer, ABOVE the
 * `"world"` layer that gets bloomed/pixelated/halftoned/etc. Layer-scope
 * effects on `"world"` paint only that layer, so the UI stays crisp through
 * every world-level toggle. Scene-scope (`tree.fx`) and screen-scope
 * (`renderer.fx`) effects DO cover the UI — that's what those scopes mean,
 * and toggling crt or vignette puts the UI under the same treatment.
 */

import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { UIPlugin } from "@yagejs/ui";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import { VIRTUAL_WIDTH, VIRTUAL_HEIGHT } from "./constants.js";
import { ShowcaseScene } from "./scene.js";

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });

  const container = setupGameContainer(VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
  engine.use(
    new RendererPlugin({
      width: VIRTUAL_WIDTH,
      height: VIRTUAL_HEIGHT,
      backgroundColor: 0x000000,
      container,
    }),
  );
  engine.use(new UIPlugin());
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new ShowcaseScene());
}

main().catch(console.error);
