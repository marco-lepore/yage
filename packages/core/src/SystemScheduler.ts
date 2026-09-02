import type { System } from "./System.js";
import type { ErrorBoundary } from "./ErrorBoundary.js";
import type { EngineContext } from "./EngineContext.js";
import { Phase } from "./types.js";

/**
 * Manages ordered execution of systems within each phase, and owns the
 * registration lifecycle: once started, a system added here receives the
 * engine context and its `onRegister` immediately, and `remove` calls
 * `onUnregister`.
 *
 * Each phase list is replaced, never mutated in place, so a `run` in
 * progress iterates the array it started with: a system added while its own
 * phase is running first runs at that phase's next run, and a system removed
 * while its phase is running does not run again.
 */
export class SystemScheduler {
  private phases = new Map<Phase, System[]>();
  private errorBoundary: ErrorBoundary | null = null;
  private context: EngineContext | null = null;
  private registered = new Set<System>();
  private _currentPhase: Phase | null = null;
  private _fixedStepIndex = 0;

  /**
   * Phase whose systems are executing right now, or `null` outside any
   * phase. Lets code reachable from several phases (input queries, shared
   * helpers) resolve behavior against its calling context instead of
   * assuming one.
   */
  get currentPhase(): Phase | null {
    return this._currentPhase;
  }

  /**
   * Monotonic count of fixed steps started. During `Phase.FixedUpdate` it
   * identifies the running step — a frame can run several steps, or none —
   * and between steps it holds the last started step's number. 0 before
   * the first step.
   */
  get fixedStepIndex(): number {
    return this._fixedStepIndex;
  }

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
   * Add a system. Sorted by priority within its phase; ties keep add order.
   * On a started engine the system receives the context and its `onRegister`
   * before it enters the phase list, so a throwing `onRegister` leaves it
   * unscheduled and unregistered. Added during its own phase, the system
   * first runs at that phase's next run.
   */
  add(system: System): void {
    if (this.context) this.register(system, this.context);
    const list = this.phases.get(system.phase) ?? [];
    this.phases.set(
      system.phase,
      [...list, system].sort((a, b) => a.priority - b.priority),
    );
  }

  /**
   * Remove a system, calling its `onUnregister` if it was registered.
   * Removed during its own phase, the system does not run again.
   */
  remove(system: System): void {
    const list = this.phases.get(system.phase);
    if (!list?.includes(system)) return;
    this.phases.set(
      system.phase,
      list.filter((s) => s !== system),
    );
    if (this.registered.delete(system)) {
      this.dispatch(system, () => system.onUnregister?.());
    }
  }

  /**
   * Run all enabled systems in a given phase, in the order the phase had
   * when the run started. Wraps each in ErrorBoundary if available.
   */
  run(phase: Phase, dt: number): void {
    // A fixed step with no fixed systems is still a step — the index must
    // track the loop's real step count, not just observed work.
    if (phase === Phase.FixedUpdate) this._fixedStepIndex++;
    const list = this.phases.get(phase);
    if (!list) return;
    const previousPhase = this._currentPhase;
    this._currentPhase = phase;
    try {
      for (const system of list) {
        // A remove during this run replaced the list; skip what it dropped.
        const current = this.phases.get(phase);
        if (current !== list && !current?.includes(system)) continue;
        if (!system.enabled) continue;
        this.dispatch(system, () => system.update(dt));
      }
    } finally {
      this._currentPhase = previousPhase;
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
    system._setContext(context);
    this.dispatch(system, () => system.onRegister?.(context));
    // After the hook: a throwing `onRegister` leaves the system unregistered,
    // so `_destroy` does not call its `onUnregister`.
    this.registered.add(system);
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
