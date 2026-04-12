import { System } from "./System.js";
import { Phase } from "./types.js";
import type { EngineContext } from "./EngineContext.js";
import type { SceneManager } from "./SceneManager.js";
import type { Process } from "./Process.js";
import { ProcessComponent } from "./ProcessComponent.js";
import { SceneManagerKey } from "./EngineContext.js";

/**
 * Built-in system that ticks all ProcessComponents on entities in non-paused
 * scenes, plus a scene-level set of global processes.
 *
 * Runs at Phase.Update with priority 500, ensuring tweened values are fresh
 * before ComponentUpdateSystem (priority 1000) reads them.
 */
export class ProcessSystem extends System {
  override readonly phase = Phase.Update;
  override readonly priority = 500;

  /** Global time scale multiplier. Stacks multiplicatively with per-scene timeScale. */
  timeScale = 1;

  private sceneManager!: SceneManager;
  private sceneProcesses = new Set<Process>();

  override onRegister(context: EngineContext): void {
    this.sceneManager = context.resolve(SceneManagerKey);
  }

  /** Add a scene-level process (not tied to any entity). */
  add(process: Process): Process {
    this.sceneProcesses.add(process);
    return process;
  }

  /** Cancel scene-level processes, optionally by tag. */
  cancel(tag?: string): void {
    for (const p of this.sceneProcesses) {
      if (tag === undefined || p.tags.includes(tag)) {
        p.cancel();
      }
    }
    if (tag === undefined) {
      this.sceneProcesses.clear();
    }
  }

  update(dt: number): void {
    const globalScaledDt = dt * this.timeScale;

    // Tick scene-level processes (global timeScale only, not scene-bound)
    for (const p of this.sceneProcesses) {
      p._update(globalScaledDt);
      if (p.completed) {
        this.sceneProcesses.delete(p);
      }
    }

    // Tick entity ProcessComponents in all non-paused scenes
    for (const scene of this.sceneManager.activeScenes) {
      const effectiveDt = globalScaledDt * scene.timeScale;
      for (const entity of scene.getEntities()) {
        if (entity.isDestroyed) continue;
        const pc = entity.tryGet(ProcessComponent);
        if (!pc) continue;
        pc._tick(effectiveDt);
      }
    }
  }
}
