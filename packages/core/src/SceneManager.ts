import type { Scene } from "./Scene.js";
import type { EngineContext } from "./EngineContext.js";
import type { EventBus, EngineEvents } from "./EventBus.js";
import type { AssetManager } from "./AssetManager.js";
import { EventBusKey, AssetManagerKey, LoggerKey } from "./EngineContext.js";
import type { SceneHookRegistry } from "./SceneHooks.js";
import { SceneHookRegistryKey } from "./SceneHooks.js";
import type { Logger } from "./Logger.js";
import {
  resolveTransition,
  type SceneTransition,
  type SceneTransitionContext,
  type SceneTransitionKind,
  type SceneTransitionOptions,
} from "./SceneTransition.js";

interface TransitionRun {
  kind: SceneTransitionKind;
  transition: SceneTransition;
  elapsed: number;
  fromScene: Scene | undefined;
  toScene: Scene | undefined;
  resolve: () => void;
}

/** Stack-based scene manager with push/pop/replace semantics. */
export class SceneManager {
  private stack: Scene[] = [];
  private _context!: EngineContext;
  private bus: EventBus<EngineEvents> | undefined;
  private assetManager: AssetManager | undefined;
  private hookRegistry: SceneHookRegistry | undefined;
  private logger: Logger | undefined;
  private _currentRun: TransitionRun | undefined;
  private _pendingChain: Promise<void> = Promise.resolve();
  private _mutationDepth = 0;
  private _destroyed = false;

  private _autoPauseOnBlur = false;
  private _isBlurred = false;
  private readonly _visibilityPausedScenes = new Set<Scene>();
  private _visibilityListenerCleanup: (() => void) | undefined;

  /**
   * Pause all non-paused scenes when `document.hidden` becomes `true`; restore
   * them on focus. Default: `false`. Only scenes paused by this mechanism are
   * restored — user-paused scenes (manual `scene.paused = true` or `pauseBelow`
   * cascade) are never touched.
   */
  get autoPauseOnBlur(): boolean {
    return this._autoPauseOnBlur;
  }

  set autoPauseOnBlur(value: boolean) {
    if (this._autoPauseOnBlur === value) return;
    this._autoPauseOnBlur = value;
    if (!this._isBlurred) return;
    if (value) {
      this._applyBlurPause();
    } else if (this._visibilityPausedScenes.size > 0) {
      this._restoreBlurPause();
    }
  }

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
    this.logger = context.tryResolve(LoggerKey);

    if (this._visibilityListenerCleanup || typeof document === "undefined") {
      return;
    }
    const onVisibilityChange = (): void => {
      this._handleVisibilityChange(document.hidden);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    this._visibilityListenerCleanup = () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }

  /**
   * React to a visibility change. Parameterised on `hidden` so unit tests can
   * drive it without a real `document`.
   * @internal
   */
  _handleVisibilityChange(hidden: boolean): void {
    if (hidden && !this._isBlurred) {
      this._isBlurred = true;
      if (this._autoPauseOnBlur) this._applyBlurPause();
    } else if (!hidden && this._isBlurred) {
      this._isBlurred = false;
      if (this._visibilityPausedScenes.size > 0) this._restoreBlurPause();
    }
  }

  private _applyBlurPause(): void {
    for (const scene of this.activeScenes) {
      scene.paused = true;
      this._visibilityPausedScenes.add(scene);
    }
  }

  private _restoreBlurPause(): void {
    for (const scene of this._visibilityPausedScenes) {
      scene.paused = false;
    }
    this._visibilityPausedScenes.clear();
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
    return this.stack.filter((scene) => !scene.isPaused);
  }

  /** Whether a scene transition is currently running. */
  get isTransitioning(): boolean {
    return this._currentRun !== undefined;
  }

  /**
   * Push a scene onto the stack. Scenes below may receive onPause().
   * If the scene declares a `preload` array, assets are loaded before onEnter().
   */
  async push(scene: Scene, opts?: SceneTransitionOptions): Promise<void> {
    this._assertNotMutating("push");
    await this._enqueue(async () => {
      const fromScene = this.active;
      await this._pushScene(scene);

      const transition = resolveTransition(opts?.transition, scene);
      if (!transition) return;

      await this._runTransition("push", transition, fromScene, scene);
    });
  }

  /** Pop the top scene. Scenes below may receive onResume(). */
  async pop(opts?: SceneTransitionOptions): Promise<Scene | undefined> {
    this._assertNotMutating("pop");
    return this._enqueue(async () => {
      if (this.stack.length === 0) return undefined;

      const fromScene = this.active;
      const destination =
        this.stack.length > 1 ? this.stack[this.stack.length - 2] : undefined;
      const transition = resolveTransition(opts?.transition, destination);

      if (transition) {
        await this._runTransition("pop", transition, fromScene, destination);
      }

      return this._popScene();
    });
  }

  /**
   * Replace the top scene. Without a transition the old scene exits first,
   * then the new scene enters. With a transition the new scene is pushed
   * first, both scenes coexist for the transition duration, then the old
   * scene is removed at the end.
   */
  async replace(scene: Scene, opts?: SceneTransitionOptions): Promise<void> {
    this._assertNotMutating("replace");
    await this._enqueue(async () => {
      const transition = resolveTransition(opts?.transition, scene);

      if (!transition) {
        await this._replaceScene(scene);
        return;
      }

      const old = this.active;
      await this._pushScene(scene, true);
      await this._runTransition("replace", transition, old, scene);

      if (old) {
        this._removeScene(old, true);
      }
      this.bus?.emit("scene:replaced", {
        oldScene: old ?? scene,
        newScene: scene,
      });
    });
  }

  /**
   * Pop every scene on the stack, top to bottom. Each receives onExit().
   * Queued like push/pop/replace — runs after any in-flight transition.
   * Use for "restart from menu"-style flows. Does not run transitions.
   */
  async popAll(): Promise<void> {
    this._assertNotMutating("popAll");
    await this._enqueue(async () => {
      this._withMutationSync(() => {
        while (this.stack.length > 0) {
          const scene = this.stack.pop();
          if (!scene) break;
          this._teardownScene(scene);
          this.bus?.emit("scene:popped", { scene });
        }
      });
    });
  }

  /**
   * Run the full scene-enter lifecycle (beforeEnter hooks, preload, onEnter)
   * for a scene that is NOT placed on the stack. Used by infrastructure
   * plugins like DebugPlugin that render a scene off-stack.
   * @internal
   */
  async _mountDetached(scene: Scene): Promise<void> {
    await this._withMutation(async () => {
      scene._setContext(this._context);
      await this.hookRegistry?.runBeforeEnter(scene);
      await this._preloadScene(scene);
      scene.onEnter?.();
    });
  }

  /**
   * Run the scene-exit lifecycle (onExit, entity destruction, afterExit
   * hooks, scoped-service clear) for a detached scene.
   * @internal
   */
  _unmountDetached(scene: Scene): void {
    this._withMutationSync(() => {
      this._teardownScene(scene);
    });
  }

  /**
   * Mark the manager destroyed and synchronously tear down every scene.
   * Called by Engine.destroy(). Any queued async work short-circuits on
   * resume; in-flight transitions' pending promises are resolved via
   * _cleanupRun so they don't leak.
   * @internal
   */
  _destroy(): void {
    this._destroyed = true;
    if (this._currentRun) {
      this._cleanupRun(this._currentRun);
    }
    this._pendingChain = Promise.resolve();

    this._visibilityListenerCleanup?.();
    this._visibilityListenerCleanup = undefined;
    this._visibilityPausedScenes.clear();

    this._withMutationSync(() => {
      while (this.stack.length > 0) {
        const scene = this.stack.pop();
        if (!scene) break;
        this._teardownScene(scene);
        this.bus?.emit("scene:popped", { scene });
      }
    });
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

  /**
   * Advance the active transition by `dt` ms. Called by Engine's earlyUpdate
   * callback with raw (unscaled) wall-clock dt.
   * @internal
   */
  _tickTransition(dt: number): void {
    const run = this._currentRun;
    if (!run) return;

    const remaining = run.transition.duration - run.elapsed;
    const consume = Math.min(dt, remaining);
    run.elapsed += consume;
    this._safeTick(run, consume);

    if (run.elapsed >= run.transition.duration) {
      this._cleanupRun(run);
    }
  }

  // ---- Private helpers ----

  private _enqueue<T>(work: () => Promise<T>): Promise<T | undefined> {
    if (this._destroyed) return Promise.resolve(undefined);
    const next = this._pendingChain.then(async () => {
      if (this._destroyed) return undefined;
      return work();
    });

    this._pendingChain = next.then(
      () => undefined,
      () => undefined,
    );

    return next;
  }

  private async _pushScene(
    scene: Scene,
    suppressEvent = false,
  ): Promise<void> {
    const wasPaused = this._snapshotPauseStates();

    await this._withMutation(async () => {
      scene._setContext(this._context);
      await this.hookRegistry?.runBeforeEnter(scene);
      // Preload before pushing so a failed asset load doesn't leave an
      // un-entered scene on the stack.
      await this._preloadScene(scene);
      this.stack.push(scene);
      scene.onEnter?.();
      this._firePauseTransitions(wasPaused);
      if (!suppressEvent) {
        this.bus?.emit("scene:pushed", { scene });
      }
    });
  }

  private _popScene(suppressEvent = false): Scene | undefined {
    const wasPaused = this._snapshotPauseStates();

    return this._withMutationSync(() => {
      const removed = this.stack.pop();
      if (!removed) return undefined;

      this._teardownScene(removed);
      this._fireResumeTransitions(wasPaused);
      if (!suppressEvent) {
        this.bus?.emit("scene:popped", { scene: removed });
      }
      return removed;
    });
  }

  private async _replaceScene(scene: Scene): Promise<void> {
    const wasPaused = this._snapshotPauseStates();

    await this._withMutation(async () => {
      scene._setContext(this._context);
      await this.hookRegistry?.runBeforeEnter(scene);
      // Preload before mutating the stack so a failed asset load doesn't
      // tear down the old scene without a working replacement.
      await this._preloadScene(scene);

      const old = this.stack.pop();
      if (old) this._teardownScene(old);
      this.stack.push(scene);
      scene.onEnter?.();

      this._firePauseTransitions(wasPaused);
      this._fireResumeTransitions(wasPaused);
      this.bus?.emit("scene:replaced", {
        oldScene: old ?? scene,
        newScene: scene,
      });
    });
  }

  private _removeScene(scene: Scene, suppressEvent = false): void {
    this._withMutationSync(() => {
      const idx = this.stack.indexOf(scene);
      if (idx === -1) return;

      const wasPaused = this._snapshotPauseStates();
      this.stack.splice(idx, 1);
      this._teardownScene(scene);
      this._firePauseTransitions(wasPaused);
      this._fireResumeTransitions(wasPaused);
      if (!suppressEvent) {
        this.bus?.emit("scene:popped", { scene });
      }
    });
  }

  private async _preloadScene(scene: Scene): Promise<void> {
    if (!scene.preload?.length || !this.assetManager) return;
    await this.assetManager.loadAll(
      scene.preload,
      scene.onProgress?.bind(scene),
    );
  }

  private _teardownScene(scene: Scene): void {
    scene.onExit?.();
    scene._destroyAllEntities();
    this.hookRegistry?.runAfterExit(scene);
    scene._clearScopedServices();
    this._visibilityPausedScenes.delete(scene);
  }

  private async _runTransition(
    kind: SceneTransitionKind,
    transition: SceneTransition,
    fromScene: Scene | undefined,
    toScene: Scene | undefined,
  ): Promise<void> {
    // If destroy() landed between this op's prior await and here, bail
    // before registering a _currentRun whose promise would never resolve
    // (the loop is stopped, so _tickTransition won't fire).
    if (this._destroyed) return;

    let resolveRun!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });

    const run: TransitionRun = {
      kind,
      transition,
      elapsed: 0,
      fromScene,
      toScene,
      resolve: resolveRun,
    };
    this._currentRun = run;
    this.bus?.emit("scene:transition:started", {
      kind,
      fromScene,
      toScene,
    });

    // Fire begin synchronously so the transition can paint its start state
    // before any render happens. For push/replace this lets built-ins hide
    // the incoming scene before a frame could show it covering the old one.
    this._safeCall(run, "begin");

    // Reject NaN and Infinity (Infinity > 0 is true, so the naive check
    // lets it through and _tickTransition would loop forever without ever
    // reaching elapsed >= duration, hanging the _pendingChain).
    if (!Number.isFinite(transition.duration) || transition.duration <= 0) {
      this._cleanupRun(run);
      return;
    }

    await promise;
  }

  private _cleanupRun(run: TransitionRun): void {
    if (this._currentRun !== run) return;

    this._safeCall(run, "end");
    this._currentRun = undefined;
    this.bus?.emit("scene:transition:ended", {
      kind: run.kind,
      fromScene: run.fromScene,
      toScene: run.toScene,
    });
    run.resolve();
  }

  private _safeTick(run: TransitionRun, dt: number): void {
    try {
      run.transition.tick(dt, this._makeContext(run));
    } catch (err: unknown) {
      this.logger?.warn(
        "SceneManager",
        `Transition tick error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private _safeCall(run: TransitionRun, method: "begin" | "end"): void {
    try {
      run.transition[method]?.(this._makeContext(run));
    } catch (err: unknown) {
      this.logger?.warn(
        "SceneManager",
        `Transition ${method} error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private _makeContext(run: TransitionRun): SceneTransitionContext {
    return {
      elapsed: run.elapsed,
      kind: run.kind,
      engineContext: this._context,
      fromScene: run.fromScene,
      toScene: run.toScene,
    };
  }

  private _snapshotPauseStates(): Map<Scene, boolean> {
    return new Map(
      this.stack.map((scene) => [scene, scene.isPaused] as const),
    );
  }

  private _assertNotMutating(method: string): void {
    if (this._mutationDepth === 0) return;
    throw new Error(
      `SceneManager.${method}() called reentrantly from a scene lifecycle hook ` +
        "(onEnter/onExit/onPause/onResume or a beforeEnter/afterExit hook). " +
        "Defer the call outside the hook, e.g. via queueMicrotask() or from a component update().",
    );
  }

  private async _withMutation<T>(work: () => Promise<T>): Promise<T> {
    this._mutationDepth++;
    try {
      return await work();
    } finally {
      this._mutationDepth--;
    }
  }

  private _withMutationSync<T>(work: () => T): T {
    this._mutationDepth++;
    try {
      return work();
    } finally {
      this._mutationDepth--;
    }
  }

  /** Fire onPause() for scenes that transitioned from not-paused to paused. */
  private _firePauseTransitions(wasPaused: Map<Scene, boolean>): void {
    for (const scene of this.stack) {
      const was = wasPaused.get(scene) ?? false;
      if (scene.isPaused && !was) {
        scene.onPause?.();
      }
    }
  }

  /** Fire onResume() for scenes that transitioned from paused to not-paused. */
  private _fireResumeTransitions(wasPaused: Map<Scene, boolean>): void {
    for (const scene of this.stack) {
      const was = wasPaused.get(scene) ?? false;
      if (!scene.isPaused && was) {
        scene.onResume?.();
      }
    }
  }
}
