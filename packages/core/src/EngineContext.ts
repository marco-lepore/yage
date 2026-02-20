/** A typed key for service registration and resolution. */
export class ServiceKey<T> {
  constructor(
    /** Unique string identifier for this service. */
    public readonly id: string,
  ) {}

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

  /** Check if a service is registered. */
  has<T>(key: ServiceKey<T>): boolean {
    return this.services.has(key.id);
  }
}

// ---- Well-known service keys ----
// We use lazy types to avoid circular imports. The generic parameter documents
// the expected service type. Consumers import both the key and the type.

/** Key for the Engine instance. */
export const EngineKey = new ServiceKey<
  import("./Engine.js").Engine
>("engine");

/** Key for the EventBus instance. */
export const EventBusKey = new ServiceKey<
  import("./EventBus.js").EventBus<import("./EventBus.js").EngineEvents>
>("eventBus");

/** Key for the SceneManager instance. */
export const SceneManagerKey = new ServiceKey<
  import("./SceneManager.js").SceneManager
>("sceneManager");

/** Key for the Logger instance. */
export const LoggerKey = new ServiceKey<import("./Logger.js").Logger>("logger");

/** Key for the Inspector instance. */
export const InspectorKey = new ServiceKey<
  import("./Inspector.js").Inspector
>("inspector");

/** Key for the QueryCache instance. */
export const QueryCacheKey = new ServiceKey<
  import("./QueryCache.js").QueryCache
>("queryCache");

/** Key for the ErrorBoundary instance. */
export const ErrorBoundaryKey = new ServiceKey<
  import("./ErrorBoundary.js").ErrorBoundary
>("errorBoundary");

/** Key for the GameLoop instance. */
export const GameLoopKey = new ServiceKey<
  import("./GameLoop.js").GameLoop
>("gameLoop");
