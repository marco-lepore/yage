import type { EngineContext, ServiceKey } from "./EngineContext.js";
import type { Phase } from "./types.js";

/**
 * Base class for systems. Systems run in a specific game loop phase,
 * query for entities matching a component signature, and operate on them.
 *
 * Systems are primarily for engine plugins (physics, rendering, audio).
 * Game developers typically write Components instead.
 */
export abstract class System {
  /** The phase this system runs in. */
  abstract readonly phase: Phase;

  /** Execution priority within the phase. Lower = earlier. Default: 0. */
  readonly priority: number = 0;

  /** Whether this system is active. */
  enabled = true;

  /** Reference to the engine context, set on registration. */
  protected context!: EngineContext;

  private _serviceCache: Map<string, unknown> | undefined;

  /**
   * Set the engine context. Called by Engine during startup.
   * @internal
   */
  _setContext(context: EngineContext): void {
    this.context = context;
  }

  /** Resolve a service by key, cached after first lookup. */
  protected use<T>(key: ServiceKey<T>): T {
    this._serviceCache ??= new Map();
    let value = this._serviceCache.get(key.id);
    if (value === undefined) {
      value = this.context.resolve(key);
      this._serviceCache.set(key.id, value);
    }
    return value as T;
  }

  /** Called once when the system is registered with the engine. */
  onRegister?(context: EngineContext): void;

  /** Called every frame (or every fixed step for FixedUpdate). */
  abstract update(dt: number): void;

  /** Called when the system is removed. */
  onUnregister?(): void;
}
