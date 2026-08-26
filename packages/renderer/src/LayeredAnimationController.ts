import { Component, serializable } from "@yagejs/core";
import { AnimationController } from "./AnimationController.js";
import {
  registerAnimationSpeedOwner,
  withoutAnimationSpeedOwner,
} from "./internal/animationSpeedGroup.js";

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
 * - `speed` writes the same runtime multiplier to every child.
 * - `playOneShot(name, opts)` uses the first child as the shared timer and
 *   keeps every other child locked until that timer completes.
 * - The wrapper fires the user's `onComplete` exactly once.
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
  private readonly _leader: AnimationController<T>;
  private _current: T | "" = "";
  private _locked = false;
  private _onComplete: (() => void) | undefined;

  constructor(options: LayeredAnimationControllerOptions<T>) {
    super();
    const [leader] = options.controllers;
    if (!leader) {
      throw new Error(
        "LayeredAnimationController requires at least one controller.",
      );
    }
    this._controllers = [...options.controllers];
    this._leader = leader;
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

  /**
   * Shared runtime speed multiplier, read from the first controller and
   * applied to every controller. Writes to any participating controller's
   * `speed` property route through this group while the wrapper is attached.
   */
  get speed(): number {
    return this._leader.speed;
  }

  set speed(value: number) {
    for (const controller of this._controllers) {
      withoutAnimationSpeedOwner(controller, () => {
        controller.speed = value;
      });
    }
  }

  onAdd(): void {
    this.addCleanup(
      registerAnimationSpeedOwner(this._controllers, (value) => {
        this.speed = value;
      }),
    );
  }

  /** Play a named animation on every layer. No-op if already current or locked. */
  play(name: T): void {
    if (this._current === name || this._locked) return;
    this._current = name;
    for (const c of this._controllers) c.play(name);
  }

  /** Play a one-shot on every layer with a shared lock duration.
   *
   * The first controller owns the shared timer. Its normal automatic timing
   * keeps the lock aligned when its speed changes. Other controllers receive
   * an infinite lock duration and are released with the wrapper. Pass an
   * explicit duration to keep the shared timer independent of playback speed. */
  playOneShot(
    name: T,
    options?: { duration?: number; onComplete?: () => void },
  ): void {
    if (this._locked && this._current === name) return;
    const leader = this._leader;
    if (options?.duration === undefined) leader.calcDuration(name);
    for (const controller of this._controllers) controller.unlock();

    this._current = name;
    this._locked = true;
    this._onComplete = options?.onComplete;

    leader.playOneShot(name, {
      ...(options?.duration !== undefined && { duration: options.duration }),
      onComplete: () => this.completeOneShot(),
    });
    for (const controller of this._controllers.slice(1)) {
      controller.playOneShot(name, {
        duration: Number.POSITIVE_INFINITY,
      });
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
    this._onComplete = undefined;
    for (const c of this._controllers) c.unlock();
  }

  private completeOneShot(): void {
    if (!this._locked) return;
    const cb = this._onComplete;
    this.unlock();
    cb?.();
  }

  // The wrapper holds references to sibling controllers, which are not
  // serializable across save/load (no stable identifier exists for an
  // arbitrary other component). Restore by re-running the same `setup()` path
  // that built the layered character.
  serialize(): null {
    return null;
  }
}
