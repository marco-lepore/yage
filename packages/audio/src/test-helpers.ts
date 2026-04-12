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
  Scene,
  Entity,
  _resetEntityIdCounter,
} from "@yagejs/core";
import type { EngineEvents } from "@yagejs/core";
import { AudioManagerKey } from "./types.js";
import type { AudioManager } from "./AudioManager.js";

class _TestScene extends Scene {
  readonly name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }
}

export interface AudioTestContext {
  context: EngineContext;
  scene: Scene;
}

export function createAudioTestContext(
  audioManager: AudioManager,
): AudioTestContext {
  _resetEntityIdCounter();

  const ctx = new EngineContext();
  const queryCache = new QueryCache();
  const bus = new EventBus<EngineEvents>();
  const logger = new Logger({ level: LogLevel.Debug });
  const boundary = new ErrorBoundary(logger);
  const gameLoop = new GameLoop();
  const scheduler = new SystemScheduler();
  scheduler.setErrorBoundary(boundary);

  ctx.register(QueryCacheKey, queryCache);
  ctx.register(EventBusKey, bus);
  ctx.register(ErrorBoundaryKey, boundary);
  ctx.register(GameLoopKey, gameLoop);
  ctx.register(SystemSchedulerKey, scheduler);
  ctx.register(AudioManagerKey, audioManager);

  const scene = new _TestScene("test-scene");
  scene._setContext(ctx);

  return { context: ctx, scene };
}

export function spawnEntityInScene(scene: Scene, name = "entity"): Entity {
  return scene.spawn(name);
}
