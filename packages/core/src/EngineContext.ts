import type { AssetManager } from "./AssetManager.js";
import type { Engine } from "./Engine.js";
import type { ErrorBoundary } from "./ErrorBoundary.js";
import type { EngineEvents, EventBus } from "./EventBus.js";
import type { GameLoop } from "./GameLoop.js";
import type { Inspector } from "./Inspector.js";
import type { Logger } from "./Logger.js";
import type { ProcessSystem } from "./ProcessSystem.js";
import type { QueryCache } from "./QueryCache.js";
import type { SceneManager } from "./SceneManager.js";
import type { SystemScheduler } from "./SystemScheduler.js";

/** The resolution scope for a service. */
export type ServiceScope = "engine" | "scene";

/** Options passed to `new ServiceKey(id, options)`. */
export interface ServiceKeyOptions {
  /**
   * Declared scope. `"scene"` keys are expected to be registered per-scene
   * via a `beforeEnter` hook; `Component.use` will check scene scope first
   * and warn if it falls back to engine scope.
   * Default: `"engine"`.
   */
  scope?: ServiceScope;
}

/** A typed key for service registration and resolution. */
export class ServiceKey<T> {
  /** Declared scope (engine or scene). Defaults to `"engine"`. */
  readonly scope: ServiceScope;

  constructor(
    /** Unique string identifier for this service. */
    public readonly id: string,
    options?: ServiceKeyOptions,
  ) {
    this.scope = options?.scope ?? "engine";
  }

  /** Phantom field to preserve the generic type. */
  declare readonly _type: T;
}

/** Dependency injection container for engine services. */
export class EngineContext {
  private services = new Map<string, unknown>();

  /** Register a service. Throws if the key is already registered. */
  register<T>(key: ServiceKey<T>, service: T): void {
    if (this.services.has(key.id)) {
      throw new Error(`Service "${key.id}" is already registered.`);
    }
    this.services.set(key.id, service);
  }

  /** Resolve a service. Throws if not registered. */
  resolve<T>(key: ServiceKey<T>): T {
    if (!this.services.has(key.id)) {
      throw new Error(`Service "${key.id}" is not registered.`);
    }
    return this.services.get(key.id) as T;
  }

  /** Resolve a service, returning undefined if not registered. */
  tryResolve<T>(key: ServiceKey<T>): T | undefined {
    return this.services.get(key.id) as T | undefined;
  }

  /** Remove a registered service. No-op if not registered. */
  unregister<T>(key: ServiceKey<T>): void {
    this.services.delete(key.id);
  }

  /** Check if a service is registered. */
  has<T>(key: ServiceKey<T>): boolean {
    return this.services.has(key.id);
  }
}

// ---- Well-known service keys ----
// We use type-only imports to avoid circular imports. The generic parameter
// documents the expected service type. Consumers import both the key and the
// type.

/** Key for the Engine instance. */
export const EngineKey = new ServiceKey<Engine>("engine");

/** Key for the EventBus instance. */
export const EventBusKey = new ServiceKey<EventBus<EngineEvents>>("eventBus");

/** Key for the SceneManager instance. */
export const SceneManagerKey = new ServiceKey<SceneManager>("sceneManager");

/** Key for the Logger instance. */
export const LoggerKey = new ServiceKey<Logger>("logger");

/** Key for the Inspector instance. */
export const InspectorKey = new ServiceKey<Inspector>("inspector");

/** Key for the QueryCache instance. */
export const QueryCacheKey = new ServiceKey<QueryCache>("queryCache");

/** Key for the ErrorBoundary instance. */
export const ErrorBoundaryKey = new ServiceKey<ErrorBoundary>("errorBoundary");

/** Key for the GameLoop instance. */
export const GameLoopKey = new ServiceKey<GameLoop>("gameLoop");

/** Key for the SystemScheduler instance. */
export const SystemSchedulerKey = new ServiceKey<SystemScheduler>(
  "systemScheduler",
);

/** Key for the ProcessSystem instance. */
export const ProcessSystemKey = new ServiceKey<ProcessSystem>("processSystem");

/** Key for the AssetManager instance. */
export const AssetManagerKey = new ServiceKey<AssetManager>("assetManager");
