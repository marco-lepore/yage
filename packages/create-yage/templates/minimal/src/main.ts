import { Engine } from "@yage/core";
import { RendererPlugin } from "@yage/renderer";
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
  //   npm install @yage/physics vite-plugin-wasm
  //
  // import { PhysicsPlugin } from "@yage/physics";
  // engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 980 } }));
  //
  // ---------------------------------------------------------------------
  //
  // Input (keyboard/mouse/gamepad action maps):
  //   npm install @yage/input
  //
  // import { InputPlugin } from "@yage/input";
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
  //   npm install @yage/audio
  //
  // import { AudioPlugin } from "@yage/audio";
  // engine.use(new AudioPlugin());
  //
  // ---------------------------------------------------------------------
  //
  // Debug overlay + runtime inspector (window.__yage__):
  //   npm install @yage/debug
  //
  // import { DebugPlugin } from "@yage/debug";
  // engine.use(new DebugPlugin());
  //
  // ---------------------------------------------------------------------

  await engine.start();
  engine.scenes.push(new MainScene());
}

main().catch((err) => {
  console.error(err);
});
