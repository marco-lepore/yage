import { Engine, Scene } from "@yage/core";
import type { EngineConfig } from "@yage/core";
import type { Plugin } from "@yage/core";
import { RendererPlugin, CameraKey } from "@yage/renderer";
import type { RendererConfig } from "@yage/renderer";
import type { Camera } from "@yage/renderer";

// ---- Types ----

/** Callback for inline scene definition via `defineScene()`. */
export type SceneSetup = (scene: Scene) => void;

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

  // Escape hatches
  plugins?: Plugin[];
  engine?: Omit<EngineConfig, "debug">;

  // Initial scene
  scene?: Scene | SceneSetup;
}

/** Handle returned by `createGame()`. */
export interface GameHandle {
  engine: Engine;
  camera: Camera;
  input?: import("@yage/input").InputManager | undefined;
  physics?: import("@yage/physics").PhysicsWorld | undefined;
  audio?: import("@yage/audio").AudioManager | undefined;
  pushScene(scene: Scene | SceneSetup): Promise<void>;
  destroy(): void;
}

// ---- Inline scene ----

class InlineScene extends Scene {
  readonly name: string;
  private readonly _setup: SceneSetup;

  constructor(name: string, setup: SceneSetup) {
    super();
    this.name = name;
    this._setup = setup;
  }

  onEnter(): void {
    this._setup(this);
  }
}

/**
 * Create an inline scene without a class.
 *
 * ```ts
 * defineScene("my-scene", (scene) => {
 *   const e = scene.spawn("player");
 *   // ...
 * });
 * ```
 */
export function defineScene(name: string, setup: SceneSetup): Scene {
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

function toScene(sceneOrSetup: Scene | SceneSetup): Scene {
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

  // Resolve optional services
  const camera = engine.context.resolve(CameraKey);

  let inputManager: import("@yage/input").InputManager | undefined;
  if (input) {
    const { InputManagerKey } = await import("@yage/input");
    inputManager = engine.context.tryResolve(InputManagerKey) as
      | import("@yage/input").InputManager
      | undefined;
  }

  let physicsWorld: import("@yage/physics").PhysicsWorld | undefined;
  if (physics) {
    const { PhysicsWorldKey } = await import("@yage/physics");
    physicsWorld = engine.context.tryResolve(PhysicsWorldKey) as
      | import("@yage/physics").PhysicsWorld
      | undefined;
  }

  let audioManager: import("@yage/audio").AudioManager | undefined;
  if (audio) {
    const { AudioManagerKey } = await import("@yage/audio");
    audioManager = engine.context.tryResolve(AudioManagerKey) as
      | import("@yage/audio").AudioManager
      | undefined;
  }

  // Push initial scene
  if (scene) {
    engine.scenes.push(toScene(scene));
  }

  // Build handle
  const handle: GameHandle = {
    engine,
    camera,
    input: inputManager,
    physics: physicsWorld,
    audio: audioManager,
    async pushScene(s: Scene | SceneSetup) {
      engine.scenes.push(toScene(s));
    },
    destroy() {
      engine.destroy();
    },
  };

  return handle;
}
