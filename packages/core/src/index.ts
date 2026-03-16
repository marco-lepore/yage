export const VERSION = "0.0.0";

export { Phase } from "./types.js";
export type {
  ComponentClass,
  Plugin,
  EasingFunction,
} from "./types.js";

export { Vec2 } from "./Vec2.js";
export type { Vec2Like } from "./Vec2.js";

export { MathUtils } from "./MathUtils.js";

export { EventBus } from "./EventBus.js";
export type { EventMap, EngineEvents } from "./EventBus.js";

export { Logger, LogLevel } from "./Logger.js";
export type { LoggerConfig, LogEntry } from "./Logger.js";

export {
  EngineContext,
  ServiceKey,
  EngineKey,
  EventBusKey,
  SceneManagerKey,
  LoggerKey,
  InspectorKey,
  QueryCacheKey,
  ErrorBoundaryKey,
  GameLoopKey,
  SystemSchedulerKey,
  ProcessSystemKey,
  AssetManagerKey,
} from "./EngineContext.js";

export { EventToken, defineEvent } from "./EventToken.js";

export { AssetHandle } from "./AssetHandle.js";
export type { AssetLoader } from "./AssetHandle.js";

export { AssetManager } from "./AssetManager.js";

export { defineBlueprint } from "./Blueprint.js";
export type { Blueprint } from "./Blueprint.js";

export { TraitToken, defineTrait, trait } from "./Trait.js";

export { Component } from "./Component.js";

export { Transform } from "./Transform.js";

export { Entity, _resetEntityIdCounter } from "./Entity.js";
export type { EntityCallbacks } from "./Entity.js";

export { QueryCache, QueryResult } from "./QueryCache.js";

export { System } from "./System.js";

export { SystemScheduler } from "./SystemScheduler.js";

export {
  ComponentUpdateSystem,
  ComponentFixedUpdateSystem,
} from "./ComponentUpdateSystem.js";

export { ErrorBoundary } from "./ErrorBoundary.js";

export { GameLoop } from "./GameLoop.js";
export type { GameLoopCallbacks, GameLoopConfig } from "./GameLoop.js";

export { Scene } from "./Scene.js";

export { SceneManager } from "./SceneManager.js";

export { Process } from "./Process.js";
export type { ProcessOptions } from "./Process.js";
export {
  easeLinear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeOutBounce,
} from "./Process.js";

export { Tween } from "./Tween.js";

export { Sequence } from "./Sequence.js";

export { ProcessComponent } from "./ProcessComponent.js";

export { ProcessSystem } from "./ProcessSystem.js";

export { Inspector } from "./Inspector.js";
export type {
  EngineSnapshot,
  EntitySnapshot,
  SceneSnapshot,
  SystemSnapshot,
  ErrorSnapshot,
} from "./Inspector.js";

export { Engine } from "./Engine.js";
export type { EngineConfig } from "./Engine.js";

export {
  createTestEngine,
  createMockScene,
  createMockEntity,
  advanceFrames,
} from "./test-utils.js";
