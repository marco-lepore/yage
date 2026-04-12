import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { PhysicsPlugin } from "@yagejs/physics";
import { InputPlugin } from "@yagejs/input";
import { AudioPlugin } from "@yagejs/audio";
import { DebugPlugin } from "@yagejs/debug";
import { GameScene } from "./scenes/GameScene";

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: 800,
      height: 600,
      backgroundColor: 0x0f172a,
      container: document.getElementById("game")!,
    }),
  );
  engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 980 } }));
  engine.use(
    new InputPlugin({
      actions: {
        left: ["KeyA", "ArrowLeft"],
        right: ["KeyD", "ArrowRight"],
        jump: ["Space", "KeyW", "ArrowUp"],
      },
      preventDefaultKeys: ["Space", "ArrowUp", "ArrowDown"],
    }),
  );
  engine.use(new AudioPlugin());
  engine.use(new DebugPlugin());

  await engine.start();
  engine.scenes.push(new GameScene());
}

main().catch((err) => {
  console.error(err);
});
