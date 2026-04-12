import type { Scene } from "./Scene.js";
import type { EngineContext } from "./EngineContext.js";
import type { EventBus, EngineEvents } from "./EventBus.js";
import type { AssetManager } from "./AssetManager.js";
import { EventBusKey, AssetManagerKey } from "./EngineContext.js";

/** Stack-based scene manager with push/pop/replace semantics. */
export class SceneManager {
  private stack: Scene[] = [];
  private _context!: EngineContext;
  private bus: EventBus<EngineEvents> | undefined;
  private assetManager: AssetManager | undefined;

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
   * Await the returned promise when using preloaded scenes.
   */
  push(scene: Scene): Promise<void> {
    // Snapshot isPaused state before push
    const wasPaused = new Map(this.stack.map((s) => [s, s.isPaused]));

    scene._setContext(this._context);
    this.stack.push(scene);

    // Fire onPause for scenes that transitioned to paused
    this._firePauseTransitions(wasPaused);

    if (scene.preload?.length && this.assetManager) {
      return this.assetManager
        .loadAll(scene.preload, scene.onProgress?.bind(scene))
        .then(() => {
          scene.onEnter?.();
          this.bus?.emit("scene:pushed", { scene });
        });
    }

    scene.onEnter?.();
    this.bus?.emit("scene:pushed", { scene });
    return Promise.resolve();
  }

  /** Pop the top scene. Scenes below may receive onResume(). */
  pop(): Scene | undefined {
    // Snapshot isPaused state before pop
    const wasPaused = new Map(this.stack.map((s) => [s, s.isPaused]));

    const removed = this.stack.pop();
    if (!removed) return undefined;

    removed.onExit?.();
    removed._destroyAllEntities();

    // Fire onResume for scenes that transitioned from paused to active
    this._fireResumeTransitions(wasPaused);

    this.bus?.emit("scene:popped", { scene: removed });

    return removed;
  }

  /**
   * Replace the top scene. Old scene receives onExit().
   * New scene receives onEnter() (after preload, if declared).
   */
  replace(scene: Scene): Promise<void> {
    // Snapshot before
    const wasPaused = new Map(this.stack.map((s) => [s, s.isPaused]));

    const old = this.stack.pop();
    if (old) {
      old.onExit?.();
      old._destroyAllEntities();
    }

    scene._setContext(this._context);
    this.stack.push(scene);

    // Fire transitions for the replace (both directions possible)
    this._firePauseTransitions(wasPaused);
    this._fireResumeTransitions(wasPaused);

    if (scene.preload?.length && this.assetManager) {
      return this.assetManager
        .loadAll(scene.preload, scene.onProgress?.bind(scene))
        .then(() => {
          scene.onEnter?.();
          if (old) {
            this.bus?.emit("scene:replaced", {
              oldScene: old,
              newScene: scene,
            });
          } else {
            this.bus?.emit("scene:pushed", { scene });
          }
        });
    }

    scene.onEnter?.();
    if (old) {
      this.bus?.emit("scene:replaced", { oldScene: old, newScene: scene });
    } else {
      this.bus?.emit("scene:pushed", { scene });
    }
    return Promise.resolve();
  }

  /** Clear all scenes. Each receives onExit() from top to bottom. */
  clear(): void {
    while (this.stack.length > 0) {
      const scene = this.stack.pop();
      if (!scene) break;
      scene.onExit?.();
      scene._destroyAllEntities();
      this.bus?.emit("scene:popped", { scene });
    }
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
