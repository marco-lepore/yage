import { Phase, System } from "@yagejs/core";

/**
 * Runs work after the entities destroyed before it was queued have left their
 * scene.
 *
 * `entity.destroy()` marks an entity and queues it; the engine flushes that
 * queue at the end of the frame, after the render phase, and only then does a
 * component's `onDestroy` take its render object out of the tree. So a
 * placement removed between frames is still drawn once. Anything that frees
 * what those objects draw with has to wait for that flush.
 *
 * Waiting is two frames, not one: work queued now is held through the next
 * frame — whose end-of-frame flush is the one it is waiting for — and run at
 * the start of the frame after it.
 *
 * Nothing runs while the engine is not ticking, which a hidden tab causes by
 * suspending `requestAnimationFrame`. That is the safe direction here: the
 * work released an asset, and holding one longer costs memory rather than
 * correctness.
 */
export class DestroyFlushQueue extends System {
  readonly phase = Phase.EarlyUpdate;
  private due: Array<() => void> = [];
  private waiting: Array<() => void> = [];

  /** Run `work` once the flush has taken the destroyed entities out. */
  add(work: () => void): void {
    this.waiting.push(work);
  }

  update(): void {
    if (this.due.length === 0 && this.waiting.length === 0) return;
    const due = this.due;
    this.due = this.waiting;
    this.waiting = [];
    for (const work of due) work();
  }
}
