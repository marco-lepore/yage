import { Engine } from "./Engine.js";
import type { EngineConfig } from "./Engine.js";
import { Scene } from "./Scene.js";
import { Entity, _resetEntityIdCounter } from "./Entity.js";
import { EngineContext, QueryCacheKey, EventBusKey, ErrorBoundaryKey } from "./EngineContext.js";
import { QueryCache } from "./QueryCache.js";
import { EventBus } from "./EventBus.js";
import type { EngineEvents } from "./EventBus.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import type { ErrorPolicy } from "./ErrorBoundary.js";
import { GameLoop } from "./GameLoop.js";
import { Logger, LogLevel } from "./Logger.js";
import { RandomKey, createRandomService } from "./Random.js";
import { SceneTime, SceneTimeKey } from "./SceneTime.js";

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

/**
 * Create a lightweight mock scene with EngineContext for unit tests.
 *
 * The error boundary defaults to `"fatal"`, matching a real `Engine`'s
 * default — a component/callback throw propagates out of whatever `update`/
 * `emit`/`_tick` call triggered it instead of being isolated. Pass
 * `"isolate"` for a test that specifically exercises the opt-in recovery
 * behavior (a component disabled, a handler removed, and so on).
 */
export function createMockScene(
  name = "mock-scene",
  errorPolicy: ErrorPolicy = "fatal",
): {
  scene: Scene;
  context: EngineContext;
} {
  _resetEntityIdCounter();
  const ctx = new EngineContext();
  const queryCache = new QueryCache();
  const bus = new EventBus<EngineEvents>();
  const logger = new Logger({ level: LogLevel.Debug });
  const loop = new GameLoop();
  const boundary = new ErrorBoundary(logger, errorPolicy, loop);
  // Engine wires the bus to the boundary; a test context that skips it runs
  // bus handlers unguarded, which no production engine does.
  bus._setErrorBoundary(boundary);

  ctx.register(QueryCacheKey, queryCache);
  ctx.register(EventBusKey, bus);
  ctx.register(ErrorBoundaryKey, boundary);

  const scene = new _TestScene(name);
  scene._setContext(ctx);
  scene._registerScoped(RandomKey, createRandomService(1234));
  scene._registerScoped(SceneTimeKey, new SceneTime(scene));

  return { scene, context: ctx };
}

/** Create a mock entity spawned in a mock scene with full EngineContext access. */
export function createMockEntity(
  name = "mock-entity",
  errorPolicy: ErrorPolicy = "fatal",
): {
  entity: Entity;
  scene: Scene;
  context: EngineContext;
} {
  const { scene, context } = createMockScene(undefined, errorPolicy);
  const entity = scene.spawn(name);
  return { entity, scene, context };
}

/**
 * Advance the game loop by N frames (manual tick).
 *
 * `dtMs` is the per-frame wall-clock delta in milliseconds, matching what a
 * PixiJS ticker reports. The loop converts it to seconds internally, so a
 * component's `update(dt)` sees `dtMs / 1000` seconds. The default `1000 / 60`
 * is one 60fps frame (≈16.67ms → ≈0.0167s).
 */
export function advanceFrames(
  engine: Engine,
  n: number,
  dtMs = 1000 / 60,
): void {
  for (let i = 0; i < n; i++) {
    engine.loop.tick(dtMs);
  }
}
