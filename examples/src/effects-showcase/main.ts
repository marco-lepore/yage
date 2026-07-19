/**
 * Effects showcase — exercises every preset in `@yagejs/effects` at each
 * scope (component, layer, scene, screen) and demonstrates that the state
 * survives a save/load round-trip.
 *
 * The toggle UI lives on its own screen-space `"ui"` layer, ABOVE the
 * `"world"` layer that gets bloomed/pixelated/halftoned/etc. Layer-scope
 * effects on `"world"` paint only that layer, so the UI stays crisp through
 * every world-level toggle. Scene-scope (`tree.fx`) and screen-scope
 * (`renderer.fx`) effects DO cover the UI — that's what those scopes mean,
 * and toggling crt or vignette puts the UI under the same treatment.
 *
 * Geometry is procedural (`GraphicsComponent.draw`) and the engine doesn't
 * persist drawing commands across save/load, so each shape lives on its
 * own `@serializable` entity that re-runs its draw in `afterRestore()`.
 */

import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { SnapshotPlugin } from "@yagejs/save";
import { UIPlugin } from "@yagejs/ui";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import { VIRTUAL_WIDTH, VIRTUAL_HEIGHT } from "./constants.js";
import { ShowcaseScene } from "./scene.js";
import { installSidebarWheel } from "./sidebar-scroll.js";

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
  engine.use(new SnapshotPlugin());
  engine.use(new UIPlugin());
  await installDebugFromUrl(engine);

  installSidebarWheel(container);

  // Hotkeys — bare S/L only, so Cmd/Ctrl+S (browser save) and Cmd/Ctrl+L
  // (focus address bar) keep their default behavior.
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const scene = engine.scenes.active as ShowcaseScene | null;
    if (!scene) return;
    if (e.key.toLowerCase() === "s") scene.doSave();
    if (e.key.toLowerCase() === "l") void scene.doLoad();
  });

  await engine.start();
  await engine.scenes.push(new ShowcaseScene());
}

void main();
