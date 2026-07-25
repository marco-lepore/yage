/**
 * Entity pooling example — the same fountain of physics sparks run two ways,
 * through an `EntityPool` or by spawning and destroying one entity per shot,
 * with live counters on a screen-space layer so the difference is visible.
 */
import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { PhysicsPlugin } from "@yagejs/physics";
import { InputPlugin } from "@yagejs/input";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import { PoolingScene, WIDTH, HEIGHT } from "./scene.js";

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  const container = setupGameContainer(WIDTH, HEIGHT);

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0f172a,
      container,
    }),
  );
  engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 900 } }));
  engine.use(
    new InputPlugin({
      actions: {
        toggleMode: ["KeyP"],
        toggleCap: ["KeyC"],
        rateUp: ["ArrowUp", "KeyW"],
        rateDown: ["ArrowDown", "KeyS"],
      },
      preventDefaultKeys: ["ArrowUp", "ArrowDown"],
    }),
  );
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new PoolingScene());
}

main().catch(console.error);
