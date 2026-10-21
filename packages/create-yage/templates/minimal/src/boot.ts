import { Engine, InspectorPlugin, type Plugin } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { SavePlugin, createSave, type SaveAdapter } from "@yagejs/save";
import { MainScene } from "./scenes/MainScene";

export interface BootOptions {
  /**
   * The host adapters this build runs with. The browser entry passes none;
   * a desktop or mobile entry passes its own.
   */
  readonly hostPlugins: readonly Plugin[];
  /**
   * Where saves are kept: browser storage for the browser entry, files in
   * the app's data directory for a desktop or mobile entry.
   */
  readonly saveAdapter: SaveAdapter;
}

/**
 * Create the engine, register the plugins and push the first scene. Every
 * target's entry file calls this; nothing here depends on where the game
 * runs.
 */
export async function boot(options: BootOptions): Promise<Engine> {
  const engine = new Engine({ debug: true });

  // First, so the rest of the engine can read what the host reports.
  for (const plugin of options.hostPlugins) engine.use(plugin);

  // Puts the inspector on window.__yage__ for the browser console under
  // `npm run dev`; a production build does not install it.
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

  // A component reads and writes saves through this.use(SaveServiceKey).
  engine.use(
    new SavePlugin({ save: createSave({ adapter: options.saveAdapter }) }),
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
  return engine;
}
