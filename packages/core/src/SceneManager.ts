import type { Scene } from "./Scene.js";
import type { EngineContext } from "./EngineContext.js";
import type { EventBus, EngineEvents } from "./EventBus.js";
import { EventBusKey } from "./EngineContext.js";

/** Stack-based scene manager with push/pop/replace semantics. */
export class SceneManager {
  private stack: Scene[] = [];
  private _context!: EngineContext;
  private bus: EventBus<EngineEvents> | undefined;

  /**
   * Set the engine context.
   * @internal
   */
  _setContext(context: EngineContext): void {
    this._context = context;
    this.bus = context.tryResolve(EventBusKey) as
      | EventBus<EngineEvents>
      | undefined;
  }

  /** The topmost (active) scene. */
  get active(): Scene | undefined {
    return this.stack[this.stack.length - 1];
  }

  /** All scenes in the stack, bottom to top. */
  get all(): readonly Scene[] {
    return this.stack;
  }

  /** Push a scene onto the stack. Previous scene receives onPause(). */
  push(scene: Scene): void {
    const previous = this.active;
    if (previous && scene.pauseBelow) {
      previous._setPaused(true);
      previous.onPause?.();
    }

    scene._setContext(this._context);
    this.stack.push(scene);
    scene.onEnter?.();

    this.bus?.emit("scene:pushed", { scene });
  }

  /** Pop the top scene. Next scene receives onResume(). */
  pop(): Scene | undefined {
    const removed = this.stack.pop();
    if (!removed) return undefined;

    removed.onExit?.();
    removed._destroyAllEntities();

    const next = this.active;
    if (next && next.paused) {
      next._setPaused(false);
      next.onResume?.();
    }

    this.bus?.emit("scene:popped", { scene: removed });

    return removed;
  }

  /**
   * Replace the top scene. Old scene receives onExit().
   * New scene receives onEnter().
   */
  replace(scene: Scene): void {
    const old = this.stack.pop();
    if (old) {
      old.onExit?.();
      old._destroyAllEntities();
    }

    scene._setContext(this._context);
    this.stack.push(scene);
    scene.onEnter?.();

    if (old) {
      this.bus?.emit("scene:replaced", { oldScene: old, newScene: scene });
    } else {
      this.bus?.emit("scene:pushed", { scene });
    }
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

}
