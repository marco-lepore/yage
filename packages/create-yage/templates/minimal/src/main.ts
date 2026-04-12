import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { MainScene } from "./scenes/MainScene";

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

  // ---------------------------------------------------------------------
  // Add more plugins here as you need them. Each block is copy-paste ready
  // — uncomment and run the install command above it.
  // ---------------------------------------------------------------------
  //
  // Physics (requires vite-plugin-wasm in vite.config.ts):
  //   npm install @yagejs/physics vite-plugin-wasm
  //
  // import { PhysicsPlugin } from "@yagejs/physics";
  // engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 980 } }));
  //
  // ---------------------------------------------------------------------
  //
  // Input (keyboard/mouse/gamepad action maps):
  //   npm install @yagejs/input
  //
  // import { InputPlugin } from "@yagejs/input";
  // engine.use(new InputPlugin({
  //   actions: {
  //     left: ["KeyA", "ArrowLeft"],
  //     right: ["KeyD", "ArrowRight"],
  //     jump: ["Space"],
  //   },
  //   preventDefaultKeys: ["Space"],
  // }));
  //
  // ---------------------------------------------------------------------
  //
  // Audio:
  //   npm install @yagejs/audio
  //
  // import { AudioPlugin } from "@yagejs/audio";
  // engine.use(new AudioPlugin());
  //
  // ---------------------------------------------------------------------
  //
  // Debug overlay + runtime inspector (window.__yage__):
  //   npm install @yagejs/debug
  //
  // import { DebugPlugin } from "@yagejs/debug";
  // engine.use(new DebugPlugin());
  //
  // ---------------------------------------------------------------------

  await engine.start();
  engine.scenes.push(new MainScene());
}

main().catch((err) => {
  console.error(err);
});
