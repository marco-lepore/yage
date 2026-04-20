import { Scene } from "./Scene.js";
import {
  EventBusKey,
  LoggerKey,
  SceneManagerKey,
} from "./EngineContext.js";
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
 *     this.startLoading();
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
   * loading starts (heavy constructors, side effects). The factory runs
   * before `assets.loadAll` so `target.preload` can be inspected.
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

  /**
   * Optional hook; fires if asset loading rejects. The scene stays mounted
   * whether or not this is set. When set, the hook is the recovery channel:
   * draw a retry UI, push an error scene, or call `this.startLoading()`
   * again to retry the load. When unset, the error is logged via the engine
   * logger and the scene remains mounted in a failed state with no
   * automatic recovery.
   *
   * The hook may still be running when the scene is replaced externally —
   * don't assume the scene is live (check `this.context.tryResolve` rather
   * than `this.service` before touching engine services, and avoid spawning
   * new entities after an `await`).
   */
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
   * Kick off asset loading. While a load is in flight, subsequent calls
   * are no-ops. After a load failure the guard is released, so calling
   * `startLoading()` from `onLoadError` (or from a retry button) kicks off
   * a fresh load against the same target.
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
    // `_run` is fire-and-forget — the scene is already mounted, so there's
    // no `push`/`replace` caller to propagate errors to. The catch is the
    // final terminus for anything `_run` rethrows (target factory failure,
    // `scenes.replace` failure, or a load error with no `onLoadError`
    // override). Log it so the failure doesn't vanish into the browser's
    // unhandled-rejection channel.
    this._run().catch((err) => {
      if (!this._active) return;
      const logger = this.context.tryResolve(LoggerKey);
      if (logger) {
        logger.error("LoadingScene", "loading failed", { error: err });
      } else {
        console.error("[LoadingScene] loading failed:", err);
      }
    });
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

    // `onLoadError` is specifically for asset-load failures. Narrow the
    // try/catch to the load phase so target-factory errors and
    // scenes.replace errors aren't silently swallowed through it.
    try {
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
    } catch (err) {
      // Scene exited mid-await → thrown error is incidental. Swallow.
      if (!this._active) return;
      const error = err instanceof Error ? err : new Error(String(err));
      // Release the start guard so the hook (or anyone with a reference)
      // can call startLoading() again to retry.
      this._started = false;
      if (this.onLoadError) {
        await this.onLoadError(error);
        return;
      }
      throw error;
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
  }
}
