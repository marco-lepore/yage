import { System } from "./System.js";
import { Phase } from "./types.js";
import type { EngineContext } from "./EngineContext.js";
import type { Scene } from "./Scene.js";
import type { SceneManager } from "./SceneManager.js";
import type { Process } from "./Process.js";
import { ProcessComponent } from "./ProcessComponent.js";
import { SceneManagerKey } from "./EngineContext.js";
import { SceneHookRegistryKey } from "./SceneHooks.js";

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
  private globalProcesses = new Set<Process>();
  private scenePools = new Map<Scene, Set<Process>>();
  private _unregisterSceneHook: (() => void) | null = null;

  override onRegister(context: EngineContext): void {
    this.sceneManager = context.resolve(SceneManagerKey);
    // Drop the scene's pool on exit so cancelled processes (e.g. effect
    // fades torn down with the scene) don't keep the dead Scene key
    // alive in the pool map. Hold onto the unregister callback so engine
    // teardown releases the hook — without this, a re-created Engine
    // sharing a SceneHookRegistry would accumulate dead callbacks.
    const hooks = context.tryResolve(SceneHookRegistryKey);
    this._unregisterSceneHook =
      hooks?.register({
        afterExit: (scene) => this.cancelForScene(scene),
      }) ?? null;
  }

  override onUnregister(): void {
    this._unregisterSceneHook?.();
    this._unregisterSceneHook = null;
    // Drain pools so cancelled processes don't keep Scene refs alive.
    for (const p of this.globalProcesses) {
      if (!p.completed) p.cancel();
    }
    this.globalProcesses.clear();
    for (const pool of this.scenePools.values()) {
      for (const p of pool) {
        if (!p.completed) p.cancel();
      }
    }
    this.scenePools.clear();
  }

  /**
   * Add an engine-global process. Ticked under the global timeScale only;
   * NOT gated by per-scene pause or scaled by per-scene timeScale. Use this
   * for cross-scene effects (e.g. screen-scope filter fades on `app.stage`)
   * or processes that have no owning scene.
   */
  add(process: Process): Process {
    this.globalProcesses.add(process);
    return process;
  }

  /**
   * Add a process bound to a specific scene's lifecycle. Ticked only while
   * the scene is active (not paused) and scaled by the scene's `timeScale`,
   * exactly like an entity-owned `ProcessComponent`. Use this for layer or
   * scene-scope effect fades that should pause with the scene.
   */
  addForScene(scene: Scene, process: Process): Process {
    let pool = this.scenePools.get(scene);
    if (!pool) {
      pool = new Set();
      this.scenePools.set(scene, pool);
    }
    pool.add(process);
    return process;
  }

  /** Cancel engine-global processes, optionally by tag. */
  cancel(tag?: string): void {
    for (const p of this.globalProcesses) {
      if (tag === undefined || p.tags.includes(tag)) {
        p.cancel();
        this.globalProcesses.delete(p);
      }
    }
  }

  /** Cancel every scene-bound process for `scene`, optionally by tag. */
  cancelForScene(scene: Scene, tag?: string): void {
    const pool = this.scenePools.get(scene);
    if (!pool) return;
    for (const p of pool) {
      if (tag === undefined || p.tags.includes(tag)) {
        p.cancel();
        pool.delete(p);
      }
    }
    if (pool.size === 0) this.scenePools.delete(scene);
  }

  update(dt: number): void {
    const globalScaledDt = dt * this.timeScale;

    // Engine-global processes — global timeScale only, not scene-bound.
    for (const p of this.globalProcesses) {
      p._update(globalScaledDt);
      if (p.completed) {
        this.globalProcesses.delete(p);
      }
    }

    // Per-scene work: entity ProcessComponents AND scene-scoped processes.
    // Both share the same activeScenes gating + per-scene timeScale, so a
    // layer-scope fade pauses with the scene exactly like an entity fade.
    for (const scene of this.sceneManager.activeScenes) {
      const effectiveDt = globalScaledDt * scene.timeScale;

      const pool = this.scenePools.get(scene);
      if (pool) {
        for (const p of pool) {
          p._update(effectiveDt);
          if (p.completed) pool.delete(p);
        }
        if (pool.size === 0) this.scenePools.delete(scene);
      }

      for (const entity of scene.getEntities()) {
        if (entity.isDestroyed) continue;
        const pc = entity.tryGet(ProcessComponent);
        if (!pc) continue;
        pc._tick(effectiveDt);
      }
    }
  }
}
