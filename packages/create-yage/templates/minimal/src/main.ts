import { Engine, InspectorPlugin } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { MainScene } from "./scenes/MainScene";

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  // Puts the inspector on window.__yage__ for the browser console under
  // `npm run dev`; `npm run build` leaves it out of the bundle.
  // DebugPlugin (below) installs one as well; keeping both is harmless.
  if (import.meta.env.DEV) {
    engine.use(new InspectorPlugin());
  }

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
  // Debug overlay (it also installs the runtime inspector):
  //   npm install @yagejs/debug
  //
  // import { DebugPlugin } from "@yagejs/debug";
  // engine.use(new DebugPlugin());
  //
  // ---------------------------------------------------------------------

  await engine.start();
  await engine.scenes.push(new MainScene());
}

main().catch((err) => {
  console.error(err);
});
