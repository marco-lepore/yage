export const VERSION = "0.0.0";

export { Phase } from "./types.js";
export type { ComponentClass, Plugin, EasingFunction } from "./types.js";

export { Vec2 } from "./Vec2.js";
export type { Vec2Like } from "./Vec2.js";

export { MathUtils } from "./MathUtils.js";
export type { SmoothDampResult } from "./MathUtils.js";

export {
  RandomKey,
  createRandomService,
  createDefaultRandomSeed,
  globalRandom,
  normalizeSeed,
} from "./Random.js";
export type { RandomService } from "./Random.js";

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

export {
  TraitToken,
  defineTrait,
  entityClassHasTrait,
  trait,
} from "./Trait.js";
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
export type { EntityHandle } from "./EntityHandle.js";

export { QueryCache, QueryResult } from "./QueryCache.js";

export { System } from "./System.js";

export { SystemScheduler } from "./SystemScheduler.js";

export {
  ComponentUpdateSystem,
  ComponentFixedUpdateSystem,
} from "./ComponentUpdateSystem.js";

export { ErrorBoundary } from "./ErrorBoundary.js";
export type {
  CallbackErrorInfo,
  CallbackErrorRecord,
} from "./ErrorBoundary.js";

export { GameLoop } from "./GameLoop.js";
export type { GameLoopCallbacks, GameLoopConfig } from "./GameLoop.js";

export { Inspector } from "./Inspector.js";
export type {
  EntitySnapshot,
  SceneSnapshot,
  SystemSnapshot,
  ErrorSnapshot,
  ComponentStateSnapshot,
  InspectorFacets,
  InspectorFacetContributor,
  WorldEntitySnapshot,
  UINodeSnapshot,
  UITreeSnapshot,
  PhysicsSnapshot,
  EventLogEntry,
  WorldSceneSnapshot,
  CameraSnapshot,
  InputStateSnapshot,
  PointerSnapshot,
  EngineSnapshot,
  InspectorTimeController,
  InspectorPointerOpts,
  InspectorGamepadAxisKey,
  InspectorDriveContext,
  InspectorDriveInput,
  InspectorDriveStepOptions,
  InspectorDriveUntilOptions,
  InspectorDriveCapture,
  InspectorDriveOptions,
  InspectorDriveOutcome,
  InspectorDriveResult,
  DriveState,
} from "./Inspector.js";

export { Scene } from "./Scene.js";
export type {
  SpawnOptions,
  SetupParams,
  SetupParamTuple,
  ClassSpawnArgs,
} from "./Scene.js";

export { EntityPool } from "./EntityPool.js";
export type { PoolableEntity, EntityPoolOptions } from "./EntityPool.js";

export { SceneTime, SceneTimeKey } from "./SceneTime.js";
export type {
  TimeEffectHandle,
  EntityTimeScaleOptions,
  SceneTimeScaleOptions,
  SceneTimeFreezeOptions,
} from "./SceneTime.js";

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
export type { ProcessOptions, ProcessClock } from "./Process.js";
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

export { ProcessSystem, ProcessFixedUpdateSystem } from "./ProcessSystem.js";

export {
  makeEntityScopedQueue,
  makeGlobalScopedQueue,
  makeSceneScopedQueue,
} from "./ProcessQueue.js";
export type { ScopedProcessQueue } from "./ProcessQueue.js";

export { Engine } from "./Engine.js";
export type { EngineConfig } from "./Engine.js";

export { RendererAdapterKey } from "./RendererAdapter.js";
export type { RendererAdapter } from "./RendererAdapter.js";

export {
  markPointerConsumeContainer,
  unmarkPointerConsumeContainer,
  isPointerConsumeContainer,
} from "./ui-consume-registry.js";

export {
  createTestEngine,
  createMockScene,
  createMockEntity,
  advanceFrames,
} from "./test-utils.js";

/** @internal - exposed for sibling @yagejs packages, not for public consumption. */
export { isDev, devWarn } from "./internal/dev.js";

/** @internal - exposed for sibling @yagejs packages, not for public consumption. */
export {
  assertDriveMaxFrames,
  DEFAULT_DRIVE_MAX_FRAMES,
  driveFramesUsed,
  driveWhileHolding,
} from "./internal/driveSupport.js";

export {
  STATE_KIND,
  createValue,
  createCounter,
  createRecord,
  createMap,
  createSet,
  createList,
  createStore,
  jsonCodec,
  setCodec,
  mapCodec,
  dateCodec,
} from "./state/index.js";
export type {
  Codec,
  Reactive,
  Serializable,
  Resettable,
  ReactiveValue,
  ReactiveCounter,
  ReactiveRecord,
  DeletableRecordKey,
  ReactiveMap,
  ReactiveSet,
  ReactiveList,
  ReactiveStore,
  ListEncoded,
  ListKey,
  CreateValueOptions,
  CreateCounterOptions,
  CreateRecordOptions,
  CreateMapOptions,
  CreateSetOptions,
  CreateListOptions,
  LeafBuilder,
  StoreLeaves,
  EncodedForLeaf,
  EncodedStore,
} from "./state/index.js";
