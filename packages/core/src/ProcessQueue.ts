import type { Entity } from "./Entity.js";
import type { Process } from "./Process.js";
import { ProcessComponent } from "./ProcessComponent.js";
import type { ProcessSystem } from "./ProcessSystem.js";
import type { Scene } from "./Scene.js";

/**
 * A scoped queue for `Process` instances. Tracks the processes it enqueued so
 * `cancelAll()` can tear them down without touching unrelated processes that
 * happen to share the same underlying pool (entity `ProcessComponent` or
 * engine-level `ProcessSystem`).
 *
 * Use one of the `make*ScopedQueue` factories to construct one — each picks
 * the right routing strategy and lifetime semantics for its scope.
 */
export interface ScopedProcessQueue {
  /** Enqueue a process. Returned for chaining. */
  run(p: Process): Process;
  /** Cancel every process this queue enqueued. Idempotent. */
  cancelAll(): void;
}

/**
 * Build a `ScopedProcessQueue` over a routing function. The three public
 * factories below differ only in WHERE they route the process (entity
 * ProcessComponent / scene-bound pool / engine-global pool); the tracking,
 * lazy-prune-on-run, and isolated-cancelAll behavior is identical.
 *
 * Lazy O(n) sweep on each `run()` is bounded by how many processes the
 * queue has accumulated; cheap and avoids holding refs to completed Process
 * instances for the queue's lifetime.
 */
function makeQueue(route: (p: Process) => void): ScopedProcessQueue {
  const ours = new Set<Process>();
  return {
    run(p) {
      for (const old of ours) {
        if (old.completed) ours.delete(old);
      }
      route(p);
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

/**
 * Scoped queue that routes through the entity's `ProcessComponent`. Auto-adds
 * one if the entity doesn't already have it. `cancelAll()` only cancels the
 * processes this queue enqueued, so sharing the underlying ProcessComponent
 * with user code stays safe.
 */
export function makeEntityScopedQueue(entity: Entity): ScopedProcessQueue {
  return makeQueue((p) => {
    let pc = entity.tryGet(ProcessComponent);
    if (!pc) {
      pc = entity.add(new ProcessComponent());
    }
    pc.run(p);
  });
}

/**
 * Scoped queue bound to a specific scene's lifecycle. Routes through
 * `ProcessSystem.addForScene`, so processes pause with the scene and are
 * scaled by its `timeScale` — matching the behaviour of entity-owned
 * `ProcessComponent` processes.
 */
export function makeSceneScopedQueue(
  processSystem: ProcessSystem,
  scene: Scene,
): ScopedProcessQueue {
  return makeQueue((p) => processSystem.addForScene(scene, p));
}

/**
 * Engine-global scoped queue. Routes through `ProcessSystem.add` — ticked
 * under the global timeScale only, NOT gated by per-scene pause or scaled
 * by per-scene timeScale. Right for cross-scene work that should keep
 * playing during scene transitions and across paused scenes.
 */
export function makeGlobalScopedQueue(
  processSystem: ProcessSystem,
): ScopedProcessQueue {
  return makeQueue((p) => processSystem.add(p));
}
