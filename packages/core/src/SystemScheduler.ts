import type { System } from "./System.js";
import type { ErrorBoundary } from "./ErrorBoundary.js";
import type { Phase } from "./types.js";

/** Manages ordered execution of systems within each phase. */
export class SystemScheduler {
  private phases = new Map<Phase, System[]>();
  private errorBoundary: ErrorBoundary | null = null;

  /** Set the error boundary for wrapping system execution. */
  setErrorBoundary(boundary: ErrorBoundary): void {
    this.errorBoundary = boundary;
  }

  /** Register a system. Sorted by priority within its phase. */
  add(system: System): void {
    let list = this.phases.get(system.phase);
    if (!list) {
      list = [];
      this.phases.set(system.phase, list);
    }
    list.push(system);
    list.sort((a, b) => a.priority - b.priority);
  }

  /** Remove a system. */
  remove(system: System): void {
    const list = this.phases.get(system.phase);
    if (!list) return;
    const idx = list.indexOf(system);
    if (idx !== -1) list.splice(idx, 1);
  }

  /** Run all enabled systems in a given phase. Wraps each in ErrorBoundary if available. */
  run(phase: Phase, dt: number): void {
    const list = this.phases.get(phase);
    if (!list) return;
    for (const system of list) {
      if (!system.enabled) continue;
      if (this.errorBoundary) {
        this.errorBoundary.wrapSystem(system, () => system.update(dt));
      } else {
        system.update(dt);
      }
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
}
