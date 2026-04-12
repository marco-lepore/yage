import { Component } from "./Component.js";
import type { Process } from "./Process.js";
import { ProcessSlot } from "./ProcessSlot.js";
import type { ProcessSlotConfig } from "./ProcessSlot.js";

/**
 * A component that holds a set of processes on an entity.
 * Processes are ticked automatically by ProcessSystem each frame.
 * All processes are cancelled when the entity is destroyed.
 */
export class ProcessComponent extends Component {
  private processes = new Set<Process>();
  private slots = new Set<ProcessSlot>();

  /**
   * Run a one-off process (tween, sequence, delay).
   * Optionally apply tags for cancel-by-tag.
   */
  run(process: Process, options?: { tags?: string[] }): Process {
    if (options?.tags?.length) {
      (process as { tags: readonly string[] }).tags = [
        ...process.tags,
        ...options.tags,
      ];
    }
    this.processes.add(process);
    return process;
  }

  /** Create a reusable, restartable process slot. */
  slot(config?: ProcessSlotConfig): ProcessSlot {
    const s = new ProcessSlot(config);
    this.slots.add(s);
    return s;
  }

  /** Cancel all processes and slots, or only those matching a tag. */
  cancel(tag?: string): void {
    // Cancel one-off processes
    for (const p of this.processes) {
      if (tag === undefined || p.tags.includes(tag)) {
        p.cancel();
        this.processes.delete(p);
      }
    }

    // Cancel slots
    for (const s of this.slots) {
      if (tag === undefined || s.tags.includes(tag)) {
        s.cancel();
      }
    }
  }

  /** Number of active (non-completed) processes and slots. */
  get count(): number {
    let n = 0;
    for (const p of this.processes) {
      if (!p.completed) n++;
    }
    for (const s of this.slots) {
      if (!s.completed) n++;
    }
    return n;
  }

  /**
   * Advance all processes and slots by dt milliseconds and remove completed one-offs.
   * @internal — called by ProcessSystem
   */
  _tick(dt: number): void {
    for (const p of this.processes) {
      p._update(dt);
      if (p.completed) {
        this.processes.delete(p);
      }
    }
    for (const s of this.slots) {
      s._tick(dt);
    }
  }

  /** Cancel all processes and slots on entity destroy. */
  override onDestroy(): void {
    this.cancel();
  }
}
