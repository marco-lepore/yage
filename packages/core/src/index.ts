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
export type { SmoothDampResult } from "./MathUtils.js";

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
export type { ServiceScope, ServiceKeyOptions } from "./EngineContext.js";

export type { SceneHooks } from "./SceneHooks.js";
export { SceneHookRegistry, SceneHookRegistryKey } from "./SceneHooks.js";

export { EventToken, defineEvent } from "./EventToken.js";

export { AssetHandle } from "./AssetHandle.js";
export type { AssetLoader } from "./AssetHandle.js";

export { AssetManager } from "./AssetManager.js";

export { defineBlueprint } from "./Blueprint.js";
export type { Blueprint } from "./Blueprint.js";

export { TraitToken, defineTrait, trait } from "./Trait.js";
export {
  serializable,
  SERIALIZABLE_KEY,
  SerializableRegistry,
  isSerializable,
  getSerializableType,
} from "./Serializable.js";
export type { SnapshotResolver } from "./Serializable.js";

export { filterEntities } from "./EntityFilter.js";
export type { EntityFilter } from "./EntityFilter.js";

export { Component } from "./Component.js";

export { Transform } from "./Transform.js";
export type { TransformData } from "./Transform.js";

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

export { LoadingScene } from "./LoadingScene.js";

export { SceneManager } from "./SceneManager.js";

export type {
  SceneTransition,
  SceneTransitionContext,
  SceneTransitionKind,
  SceneTransitionOptions,
} from "./SceneTransition.js";
export { resolveTransition } from "./SceneTransition.js";

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

export { interpolate } from "./interpolate.js";
export type { Interpolatable } from "./interpolate.js";

export { createKeyframeTrack } from "./KeyframeTrack.js";
export type { Keyframe, KeyframeTrackOptions } from "./KeyframeTrack.js";

export { KeyframeAnimator } from "./KeyframeAnimator.js";
export type { KeyframeAnimationDef } from "./KeyframeAnimator.js";

export { Sequence } from "./Sequence.js";

export { ProcessComponent } from "./ProcessComponent.js";

export { ProcessSlot } from "./ProcessSlot.js";
export type { ProcessSlotConfig } from "./ProcessSlot.js";

export { TimerEntity } from "./TimerEntity.js";

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

export { RendererAdapterKey } from "./RendererAdapter.js";
export type { RendererAdapter } from "./RendererAdapter.js";

export {
  createTestEngine,
  createMockScene,
  createMockEntity,
  advanceFrames,
} from "./test-utils.js";
