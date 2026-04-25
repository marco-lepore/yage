import { ProcessComponent } from "@yagejs/core";
import type { Entity, Process } from "@yagejs/core";
import type { EffectProcessHost } from "../EffectHandle.js";

/**
 * Process host for component-scope effects. Routes fade tweens through the
 * entity's `ProcessComponent`, auto-adding one if the entity doesn't already
 * have it. `cancelAll()` only cancels the processes this host enqueued, so
 * sharing an existing `ProcessComponent` with user code stays safe.
 *
 * Completed processes are pruned lazily on each `run()` so the tracking set
 * doesn't grow unbounded on long-lived entities with many fades.
 *
 * @internal
 */
export function makeEntityProcessHost(entity: Entity): EffectProcessHost {
  const ours = new Set<Process>();

  return {
    run(p) {
      // Prune completed processes from previous runs. Cheap O(n) sweep —
      // bounded by how many fades a single entity has accumulated.
      for (const old of ours) {
        if (old.completed) ours.delete(old);
      }

      let pc = entity.tryGet(ProcessComponent);
      if (!pc) {
        pc = entity.add(new ProcessComponent());
      }
      pc.run(p);
      ours.add(p);
      return p;
    },
    cancelAll() {
      for (const p of ours) {
        if (!p.completed) p.cancel();
      }
      ours.clear();
    },
  };
}
