import { Component, serializable } from "@yagejs/core";
import { AnimationController } from "./AnimationController.js";

/** Options for {@link LayeredAnimationController}. */
export interface LayeredAnimationControllerOptions<T extends string> {
  /**
   * Sibling controllers to drive in lockstep. Typically one per visual layer
   * (head, body, outfit) of a layered character, each living on its own child
   * entity with its own {@link AnimatedSpriteComponent}.
   */
  controllers: AnimationController<T>[];
}

/**
 * Fan-out wrapper around N sibling {@link AnimationController} instances.
 *
 * Use this when a single logical character is composed of multiple sprite
 * layers (head + body + outfit) — each layer has its own
 * `AnimatedSpriteComponent` + `AnimationController`, but they all need to
 * `play("walk")` or `playOneShot("attack")` in unison.
 *
 * - `play(name)` is forwarded to every child controller.
 * - `playOneShot(name, opts)` computes a single shared duration from the
 *   first child (or `opts.duration`) and passes it to every child as
 *   `options.duration` — so all layers unlock on the same frame regardless
 *   of per-layer frame counts.
 * - The wrapper owns the master lock timer and fires the user's
 *   `onComplete` exactly once.
 *
 * ```ts
 * class Hero extends Entity {
 *   setup() {
 *     this.add(new Transform());
 *     const body = this.spawnChild("body", HeroLayer, { sheet: "body.png" });
 *     const head = this.spawnChild("head", HeroLayer, { sheet: "head.png" });
 *     this.add(new LayeredAnimationController({
 *       controllers: [body.get(AnimationController), head.get(AnimationController)],
 *     }));
 *   }
 * }
 * ```
 */
@serializable
export class LayeredAnimationController<
  T extends string = string,
> extends Component {
  private readonly _controllers: AnimationController<T>[];
  private _current: T | "" = "";
  private _locked = false;
  private _lockTimer = 0;
  private _lockDuration = 0;
  private _onComplete: (() => void) | undefined;

  constructor(options: LayeredAnimationControllerOptions<T>) {
    super();
    if (options.controllers.length === 0) {
      throw new Error(
        "LayeredAnimationController requires at least one controller.",
      );
    }
    this._controllers = options.controllers;
  }

  /** Sibling controllers being driven. */
  get controllers(): readonly AnimationController<T>[] {
    return this._controllers;
  }

  /** Currently playing animation name, or "" if none. */
  get current(): T | "" {
    return this._current;
  }

  /** True if a one-shot animation is blocking. */
  get locked(): boolean {
    return this._locked;
  }

  /** Play a named animation on every layer. No-op if already current or locked. */
  play(name: T): void {
    if (this._current === name || this._locked) return;
    this._current = name;
    for (const c of this._controllers) c.play(name);
  }

  /** Play a one-shot on every layer with a shared lock duration.
   *
   * If `options.duration` is omitted, the duration is computed once from the
   * first controller via {@link AnimationController.calcDuration} and stored
   * on this wrapper as the single source of truth. Children are given an
   * `Infinity` per-controller duration so their own lock timers never expire
   * independently — clearing them happens through this wrapper's
   * {@link unlock} when the master timer fires. This avoids a race where a
   * child's `update()` could tick out a frame before the wrapper's (e.g. if
   * components are ordered differently in the scheduler, or accumulated
   * float drift makes one timer cross the threshold a frame earlier). */
  playOneShot(
    name: T,
    options?: { duration?: number; onComplete?: () => void },
  ): void {
    if (this._locked && this._current === name) return;
    const duration =
      options?.duration ?? this._controllers[0]!.calcDuration(name);
    this._current = name;
    this._locked = true;
    this._lockTimer = 0;
    this._lockDuration = duration;
    this._onComplete = options?.onComplete;
    // Children lock indefinitely (Infinity > finite for all finite _lockTimer
    // values), so only the master timer expires. `unlock()` clears them.
    for (const c of this._controllers) {
      c.playOneShot(name, { duration: Number.POSITIVE_INFINITY });
    }
  }

  /** Clear the lock and force-switch every layer to the given animation. */
  forcePlay(name: T): void {
    this.unlock();
    this._current = name;
    for (const c of this._controllers) c.forcePlay(name);
  }

  /** Manually release the one-shot lock on this wrapper and every child. */
  unlock(): void {
    this._locked = false;
    this._lockTimer = 0;
    this._lockDuration = 0;
    this._onComplete = undefined;
    for (const c of this._controllers) c.unlock();
  }

  /** Tick the shared one-shot lock timer. */
  update(dt: number): void {
    if (!this._locked) return;
    this._lockTimer += dt;
    if (this._lockTimer >= this._lockDuration) {
      const cb = this._onComplete;
      this.unlock();
      cb?.();
    }
  }

  // The wrapper holds references to sibling controllers, which are not
  // serializable across save/load (no stable identifier exists for an
  // arbitrary other component). Restore by re-running the same `setup()` path
  // that built the layered character.
  serialize(): null {
    return null;
  }
}
