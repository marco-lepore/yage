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
  Scene,
  Entity,
  _resetEntityIdCounter,
} from "@yage/core";
import type { EngineEvents } from "@yage/core";
import { PhysicsWorld } from "./PhysicsWorld.js";
import { PhysicsWorldManager } from "./PhysicsWorldManager.js";
import { PhysicsWorldManagerKey } from "./types.js";
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

export function createPhysicsTestContext(
  config?: PhysicsConfig,
): PhysicsTestContext {
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

  const manager = new PhysicsWorldManager(config);
  ctx.register(PhysicsWorldManagerKey, manager);

  sceneManager._setContext(ctx);
  const scene = new _TestScene("test-scene");
  sceneManager.push(scene);

  // Pre-create a world for the default test scene so tests that
  // add entities to `scene` immediately get a PhysicsWorld.
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
export function createTestScene(
  sceneManager: SceneManager,
  name: string,
  opts?: { pauseBelow?: boolean },
): Scene {
  const scene = new _TestScene(name, opts?.pauseBelow ?? true);
  sceneManager.push(scene);
  return scene;
}

export function spawnEntityInScene(scene: Scene, name = "entity"): Entity {
  return scene.spawn(name);
}
