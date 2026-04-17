import type { Scene } from "./Scene.js";
import type { EngineContext } from "./EngineContext.js";
import type { EventBus, EngineEvents } from "./EventBus.js";
import type { AssetManager } from "./AssetManager.js";
import { EventBusKey, AssetManagerKey } from "./EngineContext.js";
import type { SceneHookRegistry } from "./SceneHooks.js";
import { SceneHookRegistryKey } from "./SceneHooks.js";

/** Stack-based scene manager with push/pop/replace semantics. */
export class SceneManager {
  private stack: Scene[] = [];
  private _context!: EngineContext;
  private bus: EventBus<EngineEvents> | undefined;
  private assetManager: AssetManager | undefined;
  private hookRegistry: SceneHookRegistry | undefined;
  private _transitioning = false;

  /**
   * Set the engine context.
   * @internal
   */
  _setContext(context: EngineContext): void {
    this._context = context;
    this.bus = context.tryResolve(EventBusKey) as
      | EventBus<EngineEvents>
      | undefined;
    this.assetManager = context.tryResolve(AssetManagerKey);
    this.hookRegistry = context.tryResolve(SceneHookRegistryKey);
  }

  /** The topmost (active) scene. */
  get active(): Scene | undefined {
    return this.stack[this.stack.length - 1];
  }

  /** All scenes in the stack, bottom to top. */
  get all(): readonly Scene[] {
    return this.stack;
  }

  /** All non-paused scenes in the stack, bottom to top. */
  get activeScenes(): readonly Scene[] {
    return this.stack.filter((s) => !s.isPaused);
  }

  /**
   * Push a scene onto the stack. Scenes below may receive onPause().
   * If the scene declares a `preload` array, assets are loaded before onEnter().
   * Await the returned promise to observe onEnter / scene:pushed.
   */
  async push(scene: Scene): Promise<void> {
    this._assertNotTransitioning("push");
    this._transitioning = true;
    try {
      await this._pushInner(scene);
    } finally {
      this._transitioning = false;
    }
  }

  private async _pushInner(scene: Scene): Promise<void> {
    const wasPaused = new Map(this.stack.map((s) => [s, s.isPaused]));

    scene._setContext(this._context);
    await this.hookRegistry?.runBeforeEnter(scene);
    this.stack.push(scene);

    if (scene.preload?.length && this.assetManager) {
      await this.assetManager.loadAll(
        scene.preload,
        scene.onProgress?.bind(scene),
      );
    }

    scene.onEnter?.();
    this._firePauseTransitions(wasPaused);
    this.bus?.emit("scene:pushed", { scene });
  }

  /** Pop the top scene. Scenes below may receive onResume(). */
  pop(): Scene | undefined {
    this._assertNotTransitioning("pop");
    const wasPaused = new Map(this.stack.map((s) => [s, s.isPaused]));

    const removed = this.stack.pop();
    if (!removed) return undefined;

    removed.onExit?.();
    removed._destroyAllEntities();
    this.hookRegistry?.runAfterExit(removed);
    removed._clearScopedServices();

    this._fireResumeTransitions(wasPaused);
    this.bus?.emit("scene:popped", { scene: removed });

    return removed;
  }

  /**
   * Replace the top scene. Old scene receives onExit().
   * New scene receives onEnter() (after preload, if declared).
   */
  async replace(scene: Scene): Promise<void> {
    this._assertNotTransitioning("replace");
    this._transitioning = true;
    try {
      await this._replaceInner(scene);
    } finally {
      this._transitioning = false;
    }
  }

  private async _replaceInner(scene: Scene): Promise<void> {
    const wasPaused = new Map(this.stack.map((s) => [s, s.isPaused]));

    const old = this.stack.pop();
    if (old) {
      old.onExit?.();
      old._destroyAllEntities();
      this.hookRegistry?.runAfterExit(old);
      old._clearScopedServices();
    }

    scene._setContext(this._context);
    await this.hookRegistry?.runBeforeEnter(scene);
    this.stack.push(scene);

    if (scene.preload?.length && this.assetManager) {
      await this.assetManager.loadAll(
        scene.preload,
        scene.onProgress?.bind(scene),
      );
    }

    scene.onEnter?.();
    this._firePauseTransitions(wasPaused);
    this._fireResumeTransitions(wasPaused);

    if (old) {
      this.bus?.emit("scene:replaced", { oldScene: old, newScene: scene });
    } else {
      this.bus?.emit("scene:pushed", { scene });
    }
  }

  /** Clear all scenes. Each receives onExit() from top to bottom. */
  clear(): void {
    this._assertNotTransitioning("clear");
    while (this.stack.length > 0) {
      const scene = this.stack.pop();
      if (!scene) break;
      scene.onExit?.();
      scene._destroyAllEntities();
      this.hookRegistry?.runAfterExit(scene);
      scene._clearScopedServices();
      this.bus?.emit("scene:popped", { scene });
    }
  }

  /**
   * Run the full scene-enter lifecycle (beforeEnter hooks, preload, onEnter)
   * for a scene that is NOT placed on the stack. Used by infrastructure
   * plugins like DebugPlugin that render a scene off-stack.
   * @internal
   */
  async _mountDetached(scene: Scene): Promise<void> {
    scene._setContext(this._context);
    await this.hookRegistry?.runBeforeEnter(scene);
    if (scene.preload?.length && this.assetManager) {
      await this.assetManager.loadAll(
        scene.preload,
        scene.onProgress?.bind(scene),
      );
    }
    scene.onEnter?.();
  }

  /**
   * Run the scene-exit lifecycle (onExit, entity destruction, afterExit
   * hooks, scoped-service clear) for a detached scene.
   * @internal
   */
  _unmountDetached(scene: Scene): void {
    scene.onExit?.();
    scene._destroyAllEntities();
    this.hookRegistry?.runAfterExit(scene);
    scene._clearScopedServices();
  }

  /**
   * Flush destroy queues for all active scenes.
   * Called by the engine during endOfFrame.
   * @internal
   */
  _flushDestroyQueues(): void {
    for (const scene of this.stack) {
      scene._flushDestroyQueue();
    }
  }

  private _assertNotTransitioning(method: string): void {
    if (this._transitioning) {
      throw new Error(
        `SceneManager.${method}() called during an in-progress transition. ` +
          "Await the current push/replace before starting another.",
      );
    }
  }

  /** Fire onPause() for scenes that transitioned from not-paused to paused. */
  private _firePauseTransitions(wasPaused: Map<Scene, boolean>): void {
    for (const s of this.stack) {
      const was = wasPaused.get(s) ?? false;
      if (s.isPaused && !was) {
        s.onPause?.();
      }
    }
  }

  /** Fire onResume() for scenes that transitioned from paused to not-paused. */
  private _fireResumeTransitions(wasPaused: Map<Scene, boolean>): void {
    for (const s of this.stack) {
      const was = wasPaused.get(s) ?? false;
      if (!s.isPaused && was) {
        s.onResume?.();
      }
    }
  }
}
