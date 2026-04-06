import { Engine, Scene } from "@yage/core";
import type { EngineConfig } from "@yage/core";
import type { Plugin } from "@yage/core";
import { RendererPlugin } from "@yage/renderer";
import type { RendererConfig } from "@yage/renderer";
import type { Camera } from "@yage/renderer";
import { CameraKey } from "@yage/renderer";
import type { InputManager } from "@yage/input";
import { InputManagerKey } from "@yage/input";
import type { PhysicsWorldManager } from "@yage/physics";
import { PhysicsWorldManagerKey } from "@yage/physics";
import type { AudioManager } from "@yage/audio";
import { AudioManagerKey } from "@yage/audio";
import type { AssetManager } from "@yage/core";
import type { SaveService } from "@yage/save";
import { SaveServiceKey } from "@yage/save";

// ---- Types ----

/** Pre-resolved services passed to inline scene callbacks. */
export interface SceneServices {
  /** Camera (always present — renderer is always registered). */
  camera: Camera;
  /** Asset manager (always present — core). */
  assets: AssetManager;
  /** Input manager (only if input plugin registered). */
  input?: InputManager;
  /** Physics world manager (only if physics plugin registered). */
  physics?: PhysicsWorldManager;
  /** Audio manager (only if audio plugin registered). */
  audio?: AudioManager;
  /** Save service (only if save plugin registered). */
  saveService?: SaveService;
}

/** Callback for inline scene definition via `defineInlineScene()`. */
export type InlineSceneSetup = (scene: Scene, services: SceneServices) => void;

/** Options for `createGame()`. */
export interface CreateGameOptions {
  // Renderer shorthand (defaults: 800×600, black bg)
  width?: number;
  height?: number;
  virtualWidth?: number;
  virtualHeight?: number;
  backgroundColor?: number;
  container?: HTMLElement | string;
  canvas?: HTMLCanvasElement;
  renderer?: Partial<RendererConfig>;

  // Optional plugins — true for defaults or config object
  physics?: boolean | import("@yage/physics").PhysicsConfig;
  input?: boolean | import("@yage/input").InputConfig;
  audio?: boolean | import("@yage/audio").AudioConfig;
  particles?: boolean;
  tilemap?: boolean;
  ui?: boolean;
  debug?: boolean | import("@yage/debug").DebugConfig;
  save?: boolean | import("@yage/save").SavePluginOptions;

  // Escape hatches
  plugins?: Plugin[];
  engine?: Omit<EngineConfig, "debug">;

  // Initial scene
  scene?: Scene | InlineSceneSetup;
}

/** Handle returned by `createGame()`. */
export interface GameHandle {
  /** The underlying engine instance. Use `engine.context` to resolve services inside scenes. */
  engine: Engine;
  /** Push a scene (or inline setup) onto the scene stack. */
  pushScene(scene: Scene | InlineSceneSetup): Promise<void>;
  /** Destroy the engine and clean up all resources. */
  destroy(): void;
}

// ---- Inline scene ----

class InlineScene extends Scene {
  readonly name: string;
  private readonly _setup: InlineSceneSetup;

  constructor(name: string, setup: InlineSceneSetup) {
    super();
    this.name = name;
    this._setup = setup;
  }

  onEnter(): void {
    const services: SceneServices = {
      camera: this.context.resolve(CameraKey),
      assets: this.assets,
    };
    const input = this.context.tryResolve(InputManagerKey);
    if (input) services.input = input;
    const physics = this.context.tryResolve(PhysicsWorldManagerKey);
    if (physics) services.physics = physics;
    const audio = this.context.tryResolve(AudioManagerKey);
    if (audio) services.audio = audio;
    const saveService = this.context.tryResolve(SaveServiceKey);
    if (saveService) services.saveService = saveService;
    this._setup(this, services);
  }
}

/**
 * Create an inline scene without a class.
 *
 * ```ts
 * defineInlineScene("my-scene", (scene, { camera, input }) => {
 *   camera.follow(scene.spawn("player"));
 *   // ...
 * });
 * ```
 */
export function defineInlineScene(name: string, setup: InlineSceneSetup): Scene {
  return new InlineScene(name, setup);
}

// ---- Container resolution ----

function resolveContainer(
  opt: HTMLElement | string | undefined,
): HTMLElement {
  if (opt instanceof HTMLElement) return opt;
  if (typeof opt === "string") {
    const el = document.querySelector(opt);
    if (el instanceof HTMLElement) return el;
    throw new Error(`Container selector "${opt}" did not match any element.`);
  }
  // Default: look for #game-container, or create one
  const existing = document.getElementById("game-container");
  if (existing) return existing;
  const div = document.createElement("div");
  div.id = "game-container";
  document.body.appendChild(div);
  return div;
}

// ---- Scene from SceneSetup ----

function toScene(sceneOrSetup: Scene | InlineSceneSetup): Scene {
  if (sceneOrSetup instanceof Scene) return sceneOrSetup;
  return new InlineScene("inline", sceneOrSetup);
}

// ---- createGame ----

/**
 * One-call game bootstrap. Creates an engine, registers plugins based on
 * options, starts the engine, and optionally pushes an initial scene.
 *
 * ```ts
 * const game = await createGame({
 *   backgroundColor: 0x0a0a0a,
 *   physics: true,
 *   debug: true,
 *   scene: new MyScene(),
 * });
 * ```
 */
export async function createGame(
  options: CreateGameOptions = {},
): Promise<GameHandle> {
  const {
    width = 800,
    height = 600,
    virtualWidth,
    virtualHeight,
    backgroundColor = 0x000000,
    container,
    canvas,
    renderer: rendererOverrides,
    physics,
    input,
    audio,
    particles,
    tilemap,
    ui,
    debug,
    save,
    plugins: extraPlugins,
    engine: engineConfig,
    scene,
  } = options;

  // Determine debug mode
  const isDebug = debug === true || (typeof debug === "object" && !!debug);

  // Create engine
  const engine = new Engine({ ...engineConfig, debug: isDebug });

  // Renderer (always registered)
  const resolvedContainer = resolveContainer(container);
  const rendererConfig: RendererConfig = {
    width,
    height,
    virtualWidth: virtualWidth ?? width,
    virtualHeight: virtualHeight ?? height,
    backgroundColor,
    container: resolvedContainer,
    ...rendererOverrides,
  };
  if (canvas) rendererConfig.canvas = canvas;
  engine.use(new RendererPlugin(rendererConfig));

  // Physics
  if (physics) {
    const { PhysicsPlugin } = await import("@yage/physics");
    engine.use(
      new PhysicsPlugin(typeof physics === "object" ? physics : undefined),
    );
  }

  // Input
  if (input) {
    const { InputPlugin } = await import("@yage/input");
    engine.use(
      new InputPlugin(typeof input === "object" ? input : undefined),
    );
  }

  // Audio
  if (audio) {
    const { AudioPlugin } = await import("@yage/audio");
    engine.use(
      new AudioPlugin(typeof audio === "object" ? audio : undefined),
    );
  }

  // Particles
  if (particles) {
    const { ParticlesPlugin } = await import("@yage/particles");
    engine.use(new ParticlesPlugin());
  }

  // Tilemap
  if (tilemap) {
    const { TilemapPlugin } = await import("@yage/tilemap");
    engine.use(new TilemapPlugin());
  }

  // UI
  if (ui) {
    const { UIPlugin } = await import("@yage/ui");
    engine.use(new UIPlugin());
  }

  // Save
  if (save) {
    const { SavePlugin } = await import("@yage/save");
    engine.use(
      new SavePlugin(typeof save === "object" ? save : undefined),
    );
  }

  // Debug
  if (isDebug) {
    const { DebugPlugin } = await import("@yage/debug");
    engine.use(
      new DebugPlugin(typeof debug === "object" ? debug : undefined),
    );
  }

  // Extra plugins (escape hatch)
  if (extraPlugins) {
    for (const p of extraPlugins) engine.use(p);
  }

  // Start
  await engine.start();

  // Push initial scene
  if (scene) {
    engine.scenes.push(toScene(scene));
  }

  // Build handle
  const handle: GameHandle = {
    engine,
    async pushScene(s: Scene | InlineSceneSetup) {
      engine.scenes.push(toScene(s));
    },
    destroy() {
      engine.destroy();
    },
  };

  return handle;
}
