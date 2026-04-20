import { Scene } from "./Scene.js";
import { EventBusKey, SceneManagerKey } from "./EngineContext.js";
import type { SceneTransition } from "./SceneTransition.js";

/**
 * Base class for a progress-bar style loading screen.
 *
 * Preloads the target scene's assets through the `AssetManager`, exposes
 * `progress` and emits `scene:loading:progress` / `scene:loading:done` on
 * the engine event bus, enforces `minDuration` to prevent flicker on cached
 * loads, then replaces itself with `target` — optionally through a
 * transition.
 *
 * LoadingScene owns orchestration only. It does not render anything. To show
 * a progress UI, spawn an entity that subscribes to the loading events (the
 * canonical default is `LoadingSceneProgressBar` in `@yagejs/ui`, or any
 * custom component). The loading scene is a normal Scene, so you can use
 * `onEnter` to spawn whatever you want.
 *
 * ```ts
 * class Boot extends LoadingScene {
 *   readonly target = new GameScene();
 *   readonly minDuration = 500;
 *   readonly transition = fade({ duration: 300 });
 *   override onEnter() {
 *     this.spawn(LoadingSceneProgressBar);
 *   }
 * }
 *
 * await engine.scenes.replace(new Boot());
 * ```
 *
 * Set `autoContinue = false` to gate the handoff behind a `continue()` call
 * — useful for "press any key to continue" flows. `scene:loading:done`
 * still fires so UI can react (show a prompt), and whoever eventually
 * calls `this.continue()` triggers the transition.
 */
export abstract class LoadingScene extends Scene {
  override readonly name: string = "loading";

  /**
   * Scene to load and transition to. Accepts an instance or a factory —
   * use a factory when target construction should be deferred until
   * loading finishes (heavy constructors, side effects).
   */
  abstract readonly target: Scene | (() => Scene);

  /**
   * Minimum wall-clock ms the scene stays visible before handing off.
   * Prevents flicker on cached loads. Default 0.
   */
  readonly minDuration: number = 0;

  /** Transition used for the loading → target handoff. */
  readonly transition?: SceneTransition;

  /**
   * When true (default), the handoff fires automatically after loading and
   * `minDuration`. Set false to gate it behind `continue()` — useful when
   * the loading scene also asks the player to press a key or click.
   */
  readonly autoContinue: boolean = true;

  /** Optional hook; fires if asset loading rejects. Default: rethrow. */
  onLoadError?(error: Error): void | Promise<void>;

  private _progress = 0;
  private _started = false;
  private _active = true;
  private _continueRequested = false;
  private _continueGate?: () => void;

  /** Current load progress, 0 → 1. Updated as the AssetManager reports progress. */
  get progress(): number {
    return this._progress;
  }

  /**
   * Kick off asset loading. Idempotent — subsequent calls are no-ops.
   *
   * Usually called once from `onEnter` after spawning the loading UI:
   * ```ts
   * override onEnter() {
   *   this.spawn(LoadingSceneProgressBar);
   *   this.startLoading();
   * }
   * ```
   *
   * Deferring the call lets you gate the start of the load behind a
   * title screen, "press any key" prompt, intro animation, etc.
   */
  startLoading(): void {
    if (this._started) return;
    this._started = true;
    void this._run();
  }

  /**
   * Trigger the handoff to `target`. No-op if already called or if
   * `autoContinue` already fired it. If called before loading finishes,
   * the handoff runs as soon as loading + `minDuration` complete.
   */
  continue(): void {
    if (this._continueRequested) return;
    this._continueRequested = true;
    this._continueGate?.();
  }

  override onExit(): void {
    // Flip the run-guard so any in-flight _run() resumption short-circuits
    // instead of firing events or scheduling scenes.replace on a stack
    // that has already moved on. Also unblocks an autoContinue=false gate
    // so the promise resolves and the async function can terminate.
    this._active = false;
    this._continueGate?.();
  }

  private async _run(): Promise<void> {
    try {
      // Yield past the push-mutation window onEnter runs inside. Without
      // this, a target with empty or cached preload resumes the handoff
      // while SceneManager is still mid-mutation, and scenes.replace
      // would reject as reentrant.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!this._active) return;

      const target =
        typeof this.target === "function" ? this.target() : this.target;
      const startedAt = performance.now();
      const bus = this.context.resolve(EventBusKey);

      await this.assets.loadAll(target.preload ?? [], (ratio) => {
        if (!this._active) return;
        this._progress = ratio;
        bus.emit("scene:loading:progress", { scene: this, ratio });
      });
      if (!this._active) return;

      const elapsed = performance.now() - startedAt;
      const remaining = this.minDuration - elapsed;
      if (remaining > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
        if (!this._active) return;
      }

      bus.emit("scene:loading:done", { scene: this });

      if (!this.autoContinue && !this._continueRequested) {
        await new Promise<void>((resolve) => {
          this._continueGate = resolve;
        });
        if (!this._active) return;
      }

      const scenes = this.context.resolve(SceneManagerKey);
      await scenes.replace(
        target,
        this.transition ? { transition: this.transition } : undefined,
      );
    } catch (err) {
      // If the scene was exited mid-await, any thrown error is incidental
      // (e.g. from a rejected loader that no longer matters). Swallow.
      if (!this._active) return;
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.onLoadError) {
        await this.onLoadError(error);
        return;
      }
      throw error;
    }
  }
}
