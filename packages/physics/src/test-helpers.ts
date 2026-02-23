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
import { PhysicsWorldKey } from "./types.js";
import type { PhysicsConfig } from "./types.js";

// ---- Test Scene ----

class _TestScene extends Scene {
  readonly name: string;
  constructor(name: string) {
    super();
    this.name = name;
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

  const physicsWorld = new PhysicsWorld(config);
  ctx.register(PhysicsWorldKey, physicsWorld);

  sceneManager._setContext(ctx);
  const scene = new _TestScene("test-scene");
  sceneManager.push(scene);

  return {
    context: ctx,
    scene,
    queryCache,
    gameLoop,
    scheduler,
    sceneManager,
    physicsWorld,
  };
}

export function spawnEntityInScene(scene: Scene, name = "entity"): Entity {
  return scene.spawn(name);
}
