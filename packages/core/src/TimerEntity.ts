import { Entity } from "./Entity.js";
import { ProcessComponent } from "./ProcessComponent.js";
import { ProcessSlot } from "./ProcessSlot.js";
import type { ProcessSlotConfig } from "./ProcessSlot.js";
import type { Process } from "./Process.js";

/**
 * A pre-built entity that exposes the ProcessComponent API directly.
 * Useful for scene-level timing without manual component wiring.
 *
 * ```ts
 * const timers = this.spawn(TimerEntity);
 * timers.run(Process.delay(500, () => { ... }));
 * const cd = timers.slot({ duration: 300 });
 * ```
 */
export class TimerEntity extends Entity {
  private pc!: ProcessComponent;

  setup() {
    this.pc = this.add(new ProcessComponent());
  }

  run(process: Process, options?: { tags?: string[] }): Process {
    return this.pc.run(process, options);
  }

  slot(config?: ProcessSlotConfig): ProcessSlot {
    return this.pc.slot(config);
  }

  cancel(tag?: string): void {
    this.pc.cancel(tag);
  }
}
