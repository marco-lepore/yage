import { Engine } from "./Engine.js";
import type { EngineConfig } from "./Engine.js";
import { Scene } from "./Scene.js";
import { Entity, _resetEntityIdCounter } from "./Entity.js";
import { EngineContext, QueryCacheKey, EventBusKey, ErrorBoundaryKey } from "./EngineContext.js";
import { QueryCache } from "./QueryCache.js";
import { EventBus } from "./EventBus.js";
import type { EngineEvents } from "./EventBus.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { Logger, LogLevel } from "./Logger.js";

class _TestScene extends Scene {
  readonly name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }
}

/** Create a fully wired Engine for integration tests. */
export async function createTestEngine(
  config?: EngineConfig,
): Promise<Engine> {
  _resetEntityIdCounter();
  const engine = new Engine(config);
  await engine.start();
  return engine;
}

/** Create a lightweight mock scene with EngineContext for unit tests. */
export function createMockScene(name = "mock-scene"): {
  scene: Scene;
  context: EngineContext;
} {
  _resetEntityIdCounter();
  const ctx = new EngineContext();
  const queryCache = new QueryCache();
  const bus = new EventBus<EngineEvents>();
  const logger = new Logger({ level: LogLevel.Debug });
  const boundary = new ErrorBoundary(logger);

  ctx.register(QueryCacheKey, queryCache);
  ctx.register(EventBusKey, bus);
  ctx.register(ErrorBoundaryKey, boundary);

  const scene = new _TestScene(name);
  scene._setContext(ctx);

  return { scene, context: ctx };
}

/** Create a mock entity spawned in a mock scene with full EngineContext access. */
export function createMockEntity(name = "mock-entity"): {
  entity: Entity;
  scene: Scene;
  context: EngineContext;
} {
  const { scene, context } = createMockScene();
  const entity = scene.spawn(name);
  return { entity, scene, context };
}

/** Advance the game loop by N frames (manual tick). */
export function advanceFrames(
  engine: Engine,
  n: number,
  dtMs = 1000 / 60,
): void {
  for (let i = 0; i < n; i++) {
    engine.loop.tick(dtMs);
  }
}
