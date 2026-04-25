import type { Process, ProcessSystem, Scene } from "@yagejs/core";
import type { EffectProcessHost } from "../EffectHandle.js";

/**
 * Process host backing the screen scope. Routes fade tweens through the
 * engine-global pool of the engine's `ProcessSystem` — ticked under the
 * global timeScale only, NOT gated by per-scene pause/timeScale. Right for
 * `app.stage` filters that should keep playing during scene transitions
 * and across paused scenes.
 *
 * Each `EffectStack` constructs its own host instance so `cancelAll()` only
 * touches the processes that stack enqueued.
 *
 * Completed processes are pruned lazily on each `run()` so the tracking set
 * doesn't grow unbounded over the lifetime of a long-running app.
 *
 * @internal
 */
export function makeProcessSystemHost(
  processSystem: ProcessSystem,
): EffectProcessHost {
  const ours = new Set<Process>();
  return {
    run(p) {
      for (const old of ours) {
        if (old.completed) ours.delete(old);
      }
      processSystem.add(p);
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
 * Process host for layer- and scene-scope effects. Routes fade tweens
 * through `ProcessSystem.addForScene`, so the tween pauses with the scene
 * and is scaled by the scene's `timeScale` — matching the behavior of
 * component-scope fades that go through `ProcessComponent`.
 *
 * @internal
 */
export function makeSceneScopedProcessHost(
  processSystem: ProcessSystem,
  scene: Scene,
): EffectProcessHost {
  const ours = new Set<Process>();
  return {
    run(p) {
      for (const old of ours) {
        if (old.completed) ours.delete(old);
      }
      processSystem.addForScene(scene, p);
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
