import { Engine, type Plugin } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { PhysicsPlugin } from "@yagejs/physics";
import { InputPlugin } from "@yagejs/input";
import { AudioPlugin } from "@yagejs/audio";
import { DebugPlugin } from "@yagejs/debug";
import { SavePlugin, createSave, type SaveAdapter } from "@yagejs/save";
import { setupFullscreenButton } from "./fullscreen";
import { GameScene } from "./scenes/GameScene";

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

  const renderer = new RendererPlugin({
    width: 800,
    height: 600,
    backgroundColor: 0x0f172a,
    // Crisp sprites: nearest sampling plus rounded positions. Drop this for
    // smooth-art games.
    pixelArtPreset: true,
    container: document.getElementById("game")!,
  });
  engine.use(renderer);
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
  // A component reads and writes saves through this.use(SaveServiceKey).
  engine.use(
    new SavePlugin({ save: createSave({ adapter: options.saveAdapter }) }),
  );
  engine.use(new DebugPlugin());

  await engine.start();
  setupFullscreenButton(engine, renderer);
  await engine.scenes.push(new GameScene());
  return engine;
}
