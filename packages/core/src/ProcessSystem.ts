import { System } from "./System.js";
import { Phase } from "./types.js";
import type { EngineContext } from "./EngineContext.js";
import type { Scene } from "./Scene.js";
import type { SceneManager } from "./SceneManager.js";
import type { Process, ProcessClock } from "./Process.js";
import { tickProcessGuarded } from "./Process.js";
import { ProcessComponent } from "./ProcessComponent.js";
import { SceneManagerKey, ErrorBoundaryKey } from "./EngineContext.js";
import type { ErrorBoundary } from "./ErrorBoundary.js";
import { SceneHookRegistryKey } from "./SceneHooks.js";
import { SceneTimeKey } from "./SceneTime.js";

/** Cancel and remove every process in `pool`, or only those carrying `tag`. */
function cancelMatching(pool: Set<Process>, tag: string | undefined): void {
  for (const p of pool) {
    if (tag === undefined || p.tags.includes(tag)) {
      p.cancel();
      pool.delete(p);
    }
  }
}

/**
 * Built-in system that ticks the `"frame"`-clock processes of all
 * ProcessComponents on entities in non-paused scenes, plus the frame-clock
 * entries of the engine-global and scene-bound process pools.
 *
 * `ProcessSystem` holds all four engine-level pools — engine-global and
 * scene-bound, one of each per clock. `ProcessFixedUpdateSystem` advances the
 * two fixed-clock pools and every `"fixed"`-clock entity process.
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
  private errorBoundary: ErrorBoundary | undefined;
  private globalProcesses = new Set<Process>();
  private scenePools = new Map<Scene, Set<Process>>();
  private fixedGlobalProcesses = new Set<Process>();
  private fixedScenePools = new Map<Scene, Set<Process>>();
  private _unregisterSceneHook: (() => void) | null = null;

  override onRegister(context: EngineContext): void {
    this.sceneManager = context.resolve(SceneManagerKey);
    this.errorBoundary = context.tryResolve(ErrorBoundaryKey);
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
    for (const pool of [this.globalProcesses, this.fixedGlobalProcesses]) {
      for (const p of pool) {
        if (!p.completed) p.cancel();
      }
      pool.clear();
    }
    for (const pools of [this.scenePools, this.fixedScenePools]) {
      for (const pool of pools.values()) {
        for (const p of pool) {
          if (!p.completed) p.cancel();
        }
      }
      pools.clear();
    }
  }

  /**
   * Add an engine-global process. Ticked under the global timeScale only;
   * NOT gated by per-scene pause or scaled by per-scene timeScale. Use this
   * for cross-scene effects (e.g. screen-scope filter fades on `app.stage`)
   * or processes that have no owning scene.
   *
   * `options.clock` picks the clock that advances the process (default
   * `"frame"`, rendered-frame time; see `ProcessClock`). `"fixed"` advances it
   * on the fixed timestep through `ProcessFixedUpdateSystem`.
   */
  add(process: Process, options?: { clock?: ProcessClock }): Process {
    const pool =
      options?.clock === "fixed"
        ? this.fixedGlobalProcesses
        : this.globalProcesses;
    pool.add(process);
    return process;
  }

  /**
   * Add a process bound to a specific scene's lifecycle. Ticked only while
   * the scene is active (not paused) and scaled by the scene's `timeScale`,
   * exactly like an entity-owned `ProcessComponent`. Use this for layer or
   * scene-scope effect fades that should pause with the scene.
   *
   * `options.clock` picks the clock that advances the process (default
   * `"frame"`, rendered-frame time; see `ProcessClock`). `"fixed"` advances it
   * on the fixed timestep through `ProcessFixedUpdateSystem`. The pool pauses
   * with its scene and follows the scene's scale on either clock.
   */
  addForScene(
    scene: Scene,
    process: Process,
    options?: { clock?: ProcessClock },
  ): Process {
    const pools =
      options?.clock === "fixed" ? this.fixedScenePools : this.scenePools;
    let pool = pools.get(scene);
    if (!pool) {
      pool = new Set();
      pools.set(scene, pool);
    }
    pool.add(process);
    return process;
  }

  /** Cancel engine-global processes on both clocks, optionally by tag. */
  cancel(tag?: string): void {
    cancelMatching(this.globalProcesses, tag);
    cancelMatching(this.fixedGlobalProcesses, tag);
  }

  /** Cancel every scene-bound process for `scene` on both clocks, optionally by tag. */
  cancelForScene(scene: Scene, tag?: string): void {
    this._cancelScenePool(this.scenePools, scene, tag);
    this._cancelScenePool(this.fixedScenePools, scene, tag);
  }

  update(dt: number): void {
    const globalScaledDt = dt * this.timeScale;

    // Engine-global processes — global timeScale only, not scene-bound.
    this._drainGlobalPool(this.globalProcesses, globalScaledDt);

    // Per-scene work: entity ProcessComponents AND scene-scoped processes.
    // Both share the same activeScenes gating + per-scene timeScale, so a
    // layer-scope fade pauses with the scene exactly like an entity fade.
    for (const scene of this.sceneManager.activeScenes) {
      // SceneTime folds active freeze/slow-mo requests into the scene scale.
      // The pool has no owning entity, so it runs at the full effective
      // scale; entity ProcessComponents get the per-entity value so request
      // exclusions apply. Falls back to the plain scene.timeScale when the
      // scene has no SceneTime (scenes never entered through the engine's
      // scene hooks).
      const time = scene.tryResolveScoped(SceneTimeKey);
      const effectiveDt =
        globalScaledDt * (time?.effectiveScale ?? scene.timeScale);

      this._drainScenePool(this.scenePools, scene, effectiveDt);

      for (const entity of scene.getEntities()) {
        if (entity.isDestroyed || !entity.isActive) continue;
        const pc = entity.tryGet(ProcessComponent);
        if (!pc) continue;
        // Entity ProcessComponents compose the per-entity timeScale on top of
        // the global + per-scene scaling.
        const entityDt =
          globalScaledDt *
          (time?.effectiveScaleForUpdates(entity) ?? scene.timeScale) *
          entity.timeScale;
        pc._tick(entityDt, scene.name, "frame");
      }
    }
  }

  /**
   * Advance the engine-global fixed-clock pool by one fixed step. `dt` arrives
   * already scaled.
   * @internal Called by `ProcessFixedUpdateSystem`.
   */
  _tickFixedGlobal(dt: number): void {
    this._drainGlobalPool(this.fixedGlobalProcesses, dt);
  }

  /**
   * Advance one scene's fixed-clock pool by one fixed step. `dt` arrives
   * already scaled.
   * @internal Called by `ProcessFixedUpdateSystem`.
   */
  _tickFixedScene(scene: Scene, dt: number): void {
    this._drainScenePool(this.fixedScenePools, scene, dt);
  }

  private _drainGlobalPool(pool: Set<Process>, dt: number): void {
    for (const p of pool) {
      this._tickProcess(p, dt);
      if (p.completed) pool.delete(p);
    }
  }

  /** Drops the map entry when the pool empties, so a dead Scene key is released. */
  private _drainScenePool(
    pools: Map<Scene, Set<Process>>,
    scene: Scene,
    dt: number,
  ): void {
    const pool = pools.get(scene);
    if (!pool) return;
    for (const p of pool) {
      this._tickProcess(p, dt, scene.name);
      if (p.completed) pool.delete(p);
    }
    if (pool.size === 0) pools.delete(scene);
  }

  /** Drops the map entry when the pool empties, so a dead Scene key is released. */
  private _cancelScenePool(
    pools: Map<Scene, Set<Process>>,
    scene: Scene,
    tag: string | undefined,
  ): void {
    const pool = pools.get(scene);
    if (!pool) return;
    cancelMatching(pool, tag);
    if (pool.size === 0) pools.delete(scene);
  }

  /**
   * Advance one process through the error boundary, via the same
   * `tickProcessGuarded` path `ProcessComponent` uses for entity-owned
   * processes. `scene` is omitted for engine-global processes, which have no
   * owning scene.
   */
  private _tickProcess(p: Process, dt: number, scene?: string): void {
    tickProcessGuarded(
      this.errorBoundary,
      () => p._update(dt),
      scene !== undefined ? { kind: "Process callback", scene } : { kind: "Process callback" },
    );
  }
}

/**
 * Companion to `ProcessSystem` for the fixed clock: advances every entity
 * `ProcessComponent`'s `"fixed"`-clock processes once per fixed step.
 *
 * Runs at Phase.FixedUpdate with priority 500 — after the physics step
 * (priority 0), before ComponentFixedUpdateSystem (priority 1000) — so
 * fixed-clock values are fresh when component `fixedUpdate(dt)` reads them,
 * mirroring ProcessSystem's position in the update phase.
 *
 * The dt composition matches ProcessSystem's frame pass — the owning
 * ProcessSystem's global `timeScale`, the scene's effective scale, and the
 * entity's `timeScale` — with the fixed timestep as the base dt.
 *
 * The system also drains the engine-global and scene-bound fixed pools held
 * by the owning `ProcessSystem`: the scene pool inside the active-scene loop
 * under the scene's effective scale, the global pool once per fixed step
 * outside it.
 */
export class ProcessFixedUpdateSystem extends System {
  override readonly phase = Phase.FixedUpdate;
  override readonly priority = 500;

  private sceneManager!: SceneManager;

  constructor(private readonly owner: ProcessSystem) {
    super();
  }

  override onRegister(context: EngineContext): void {
    this.sceneManager = context.resolve(SceneManagerKey);
  }

  update(dt: number): void {
    const globalScaledDt = dt * this.owner.timeScale;

    // Engine-global processes are not gated by per-scene pause, so they drain
    // once per fixed step rather than once for each active scene.
    this.owner._tickFixedGlobal(globalScaledDt);

    for (const scene of this.sceneManager.activeScenes) {
      const time = scene.tryResolveScoped(SceneTimeKey);
      // The scene pool has no owning entity, so it runs at the full effective
      // scale — no per-entity exclusion, matching the frame pass.
      this.owner._tickFixedScene(
        scene,
        globalScaledDt * (time?.effectiveScale ?? scene.timeScale),
      );
      for (const entity of scene.getEntities()) {
        if (entity.isDestroyed || !entity.isActive) continue;
        const pc = entity.tryGet(ProcessComponent);
        if (!pc) continue;
        const entityDt =
          globalScaledDt *
          (time?.effectiveScaleForUpdates(entity) ?? scene.timeScale) *
          entity.timeScale;
        pc._tick(entityDt, scene.name, "fixed");
      }
    }
  }
}
