import { Component } from "./Component.js";
import type { Process } from "./Process.js";

/**
 * A component that holds a set of processes on an entity.
 * Processes are ticked automatically by ProcessSystem each frame.
 * All processes are cancelled when the entity is destroyed.
 */
export class ProcessComponent extends Component {
  private processes = new Set<Process>();

  /** Add a process. Returns it for chaining (e.g. toPromise). */
  add(process: Process): Process {
    this.processes.add(process);
    return process;
  }

  /** Cancel all processes, or only those matching a tag. */
  cancel(tag?: string): void {
    for (const p of this.processes) {
      if (tag === undefined || p.tags.includes(tag)) {
        p.cancel();
      }
    }
    if (tag === undefined) {
      this.processes.clear();
    }
  }

  /** Number of active (non-completed) processes. */
  get count(): number {
    let n = 0;
    for (const p of this.processes) {
      if (!p.completed) n++;
    }
    return n;
  }

  /**
   * Advance all processes by dt milliseconds and remove completed ones.
   * @internal — called by ProcessSystem
   */
  _tick(dt: number): void {
    for (const p of this.processes) {
      p._update(dt);
      if (p.completed) {
        this.processes.delete(p);
      }
    }
  }

  /** Cancel all processes on entity destroy. */
  override onDestroy(): void {
    this.cancel();
  }
}
