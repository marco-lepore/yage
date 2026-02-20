export const VERSION = "0.0.0";

// --- Types ---
export { Phase } from "./types.js";
export type { ComponentClass, Plugin, PrefabOverrides, EasingFunction } from "./types.js";

// --- Vec2 ---
export { Vec2 } from "./Vec2.js";

// --- MathUtils ---
export { MathUtils } from "./MathUtils.js";

// --- EventBus ---
export { EventBus } from "./EventBus.js";
export type { EventMap, EngineEvents } from "./EventBus.js";

// --- Logger ---
export { Logger, LogLevel } from "./Logger.js";
export type { LoggerConfig, LogEntry } from "./Logger.js";

// --- EngineContext ---
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
} from "./EngineContext.js";

// --- Component ---
export { Component } from "./Component.js";

// --- Transform ---
export { Transform } from "./Transform.js";

// --- Entity ---
export { Entity, _resetEntityIdCounter } from "./Entity.js";
export type { EntityCallbacks } from "./Entity.js";

// --- QueryCache ---
export { QueryCache, QueryResult } from "./QueryCache.js";

// --- System ---
export { System } from "./System.js";

// --- SystemScheduler ---
export { SystemScheduler } from "./SystemScheduler.js";

// --- ComponentUpdateSystem ---
export {
  ComponentUpdateSystem,
  ComponentFixedUpdateSystem,
} from "./ComponentUpdateSystem.js";

// --- ErrorBoundary ---
export { ErrorBoundary } from "./ErrorBoundary.js";

// --- GameLoop ---
export { GameLoop } from "./GameLoop.js";
export type { GameLoopCallbacks, GameLoopConfig } from "./GameLoop.js";

// --- Scene ---
export { Scene } from "./Scene.js";

// --- SceneManager ---
export { SceneManager } from "./SceneManager.js";

// --- Process ---
export { Process } from "./Process.js";
export type { ProcessOptions } from "./Process.js";
export {
  easeLinear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeOutBounce,
} from "./Process.js";

// --- Tween ---
export { Tween } from "./Tween.js";

// --- Sequence ---
export { Sequence } from "./Sequence.js";

// --- Prefab ---
export { Prefab } from "./Prefab.js";

// --- Inspector ---
export { Inspector } from "./Inspector.js";
export type {
  EngineSnapshot,
  EntitySnapshot,
  SceneSnapshot,
  SystemSnapshot,
  ErrorSnapshot,
} from "./Inspector.js";

// --- Engine ---
export { Engine } from "./Engine.js";
export type { EngineConfig } from "./Engine.js";

// --- Test utilities ---
export {
  createTestEngine,
  createMockScene,
  createMockEntity,
  advanceFrames,
} from "./test-utils.js";
