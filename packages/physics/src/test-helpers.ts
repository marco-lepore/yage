import {
  EngineContext,
  QueryCache,
  QueryCacheKey,
  EventBus,
  EventBusKey,
  ErrorBoundary,
  ErrorBoundaryKey,
  Logger,
  LogLevel,
  GameLoop,
  GameLoopKey,
  SystemScheduler,
  SystemSchedulerKey,
  SceneManager,
  SceneManagerKey,
  SceneHookRegistry,
  SceneHookRegistryKey,
  Scene,
  Entity,
  _resetEntityIdCounter,
} from "@yagejs/core";
import type { EngineEvents } from "@yagejs/core";
import { PhysicsWorld } from "./PhysicsWorld.js";
import { PhysicsWorldManager } from "./PhysicsWorldManager.js";
import { PhysicsWorldKey, PhysicsWorldManagerKey } from "./types.js";
import type { PhysicsConfig } from "./types.js";

// ---- Test Scene ----

class _TestScene extends Scene {
  readonly name: string;
  override readonly pauseBelow: boolean;
  constructor(name: string, pauseBelow = true) {
    super();
    this.name = name;
    this.pauseBelow = pauseBelow;
  }
}

// ---- Physics Test Context ----

export interface PhysicsTestContext {
  context: EngineContext;
  scene: Scene;
  queryCache: QueryCache;
  gameLoop: GameLoop;
  scheduler: SystemScheduler;
  sceneManager: SceneManager;
  manager: PhysicsWorldManager;
  physicsWorld: PhysicsWorld;
}

export async function createPhysicsTestContext(
  config?: PhysicsConfig,
): Promise<PhysicsTestContext> {
  _resetEntityIdCounter();

  const ctx = new EngineContext();
  const queryCache = new QueryCache();
  const bus = new EventBus<EngineEvents>();
  const logger = new Logger({ level: LogLevel.Debug });
  const boundary = new ErrorBoundary(logger);
  const gameLoop = new GameLoop();
  const scheduler = new SystemScheduler();
  scheduler.setErrorBoundary(boundary);
  const sceneManager = new SceneManager();

  ctx.register(QueryCacheKey, queryCache);
  ctx.register(EventBusKey, bus);
  ctx.register(ErrorBoundaryKey, boundary);
  ctx.register(GameLoopKey, gameLoop);
  ctx.register(SystemSchedulerKey, scheduler);
  ctx.register(SceneManagerKey, sceneManager);

  // Wire a hook registry that mirrors the physics plugin's behavior, so
  // `sceneManager.push` materializes per-scene worlds the same way the
  // real plugin would.
  const hookRegistry = new SceneHookRegistry();
  ctx.register(SceneHookRegistryKey, hookRegistry);

  const manager = new PhysicsWorldManager(config);
  ctx.register(PhysicsWorldManagerKey, manager);
  hookRegistry.register({
    beforeEnter: (s) => {
      const world = manager.getOrCreateWorld(s);
      s._registerScoped(PhysicsWorldKey, world);
    },
    afterExit: (s) => {
      manager.destroyWorld(s);
    },
  });

  sceneManager._setContext(ctx);
  const scene = new _TestScene("test-scene");
  await sceneManager.push(scene);

  const physicsWorld = manager.getOrCreateWorld(scene);

  return {
    context: ctx,
    scene,
    queryCache,
    gameLoop,
    scheduler,
    sceneManager,
    manager,
    physicsWorld,
  };
}

/** Create an additional test scene and push it onto the scene manager. */
export async function createTestScene(
  sceneManager: SceneManager,
  name: string,
  opts?: { pauseBelow?: boolean },
): Promise<Scene> {
  const scene = new _TestScene(name, opts?.pauseBelow ?? true);
  await sceneManager.push(scene);
  return scene;
}

export function spawnEntityInScene(scene: Scene, name = "entity"): Entity {
  return scene.spawn(name);
}
