import { Engine, InspectorPlugin } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { PhysicsPlugin } from "@yagejs/physics";
import { InputPlugin } from "@yagejs/input";
import { platformerControls } from "@yagejs-addons/character-controller/input";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import { WIDTH, HEIGHT } from "./constants.js";
import { CharacterControllerScene } from "./scene.js";

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(new InspectorPlugin());
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0f172a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(new PhysicsPlugin());
  engine.use(
    new InputPlugin({
      actions: {
        ...platformerControls(),
        default: ["Digit1"],
        nimble: ["Digit2"],
        policy: ["KeyF"],
        refill: ["KeyC"],
        reset: ["KeyR"],
        drop: ["KeyE"],
      },
      preventDefaultKeys: [
        "Space",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ],
    }),
  );
  await installDebugFromUrl(engine);
  await engine.start();
  await engine.scenes.push(new CharacterControllerScene());
}
main().catch(console.error);
