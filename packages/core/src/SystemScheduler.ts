import type { System } from "./System.js";
import type { ErrorBoundary } from "./ErrorBoundary.js";
import type { EngineContext } from "./EngineContext.js";
import type { Phase } from "./types.js";

/**
 * Manages ordered execution of systems within each phase, and owns the
 * registration lifecycle: once started, a system added here receives the
 * engine context and its `onRegister` immediately, and `remove` calls
 * `onUnregister`.
 */
export class SystemScheduler {
  private phases = new Map<Phase, System[]>();
  private errorBoundary: ErrorBoundary | null = null;
  private context: EngineContext | null = null;
  private registered = new Set<System>();

  /** Set the error boundary for wrapping system execution. */
  setErrorBoundary(boundary: ErrorBoundary): void {
    this.errorBoundary = boundary;
  }

  /**
   * Attach the engine context and register every system added so far.
   * Called by Engine at startup; systems added afterwards are registered
   * directly by `add`.
   * @internal
   */
  _start(context: EngineContext): void {
    this.context = context;
    for (const system of this.getAllSystems()) {
      this.register(system, context);
    }
  }

  /**
   * Unregister all registered systems (in reverse, for clean teardown) and
   * detach the context. Called by Engine on destroy. Owns only the
   * registration lifecycle — phase-list membership stays with whoever added
   * the system.
   * @internal
   */
  _destroy(): void {
    const all = this.getAllSystems();
    for (let i = all.length - 1; i >= 0; i--) {
      const system = all[i]!;
      if (this.registered.delete(system)) {
        this.dispatch(system, () => system.onUnregister?.());
      }
    }
    this.context = null;
  }

  /**
   * Add a system. Sorted by priority within its phase. On a started engine
   * the system receives the context and its `onRegister` immediately.
   */
  add(system: System): void {
    let list = this.phases.get(system.phase);
    if (!list) {
      list = [];
      this.phases.set(system.phase, list);
    }
    list.push(system);
    list.sort((a, b) => a.priority - b.priority);
    if (this.context) this.register(system, this.context);
  }

  /** Remove a system, calling its `onUnregister` if it was registered. */
  remove(system: System): void {
    const list = this.phases.get(system.phase);
    if (!list) return;
    const idx = list.indexOf(system);
    if (idx === -1) return;
    list.splice(idx, 1);
    if (this.registered.delete(system)) {
      this.dispatch(system, () => system.onUnregister?.());
    }
  }

  /** Run all enabled systems in a given phase. Wraps each in ErrorBoundary if available. */
  run(phase: Phase, dt: number): void {
    const list = this.phases.get(phase);
    if (!list) return;
    for (const system of list) {
      if (!system.enabled) continue;
      this.dispatch(system, () => system.update(dt));
    }
  }

  /** Get all systems registered for a phase. */
  getSystems(phase: Phase): readonly System[] {
    return this.phases.get(phase) ?? [];
  }

  /** Get all systems across all phases. */
  getAllSystems(): System[] {
    const all: System[] = [];
    for (const list of this.phases.values()) {
      all.push(...list);
    }
    return all;
  }

  private register(system: System, context: EngineContext): void {
    this.registered.add(system);
    system._setContext(context);
    this.dispatch(system, () => system.onRegister?.(context));
  }

  /** Run a system-owned callback through the ErrorBoundary when one is set. */
  private dispatch(system: System, fn: () => void): void {
    if (this.errorBoundary) {
      this.errorBoundary.wrapSystem(system, fn);
    } else {
      fn();
    }
  }
}
