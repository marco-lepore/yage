import { Component } from "@yagejs/core";
import { AnimationController } from "./AnimationController.js";
import type { AnimationOneShotOptions } from "./AnimationController.js";
import {
  registerAnimationSpeedOwner,
  withoutAnimationSpeedOwner,
} from "./internal/animationSpeedGroup.js";
import { runAttributed } from "./internal/attribution.js";

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
 * - The wrapper fires exactly one of the user's `onComplete` / `onCancel`.
 * - Every layer must define every name played through the wrapper; a missing
 *   name throws before any layer switches, and so does a `startFrame` or
 *   `speed` that any layer rejects when the timing is automatic.
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
export class LayeredAnimationController<
  T extends string = string,
> extends Component {
  private readonly _controllers: AnimationController<T>[];
  private readonly _leader: AnimationController<T>;
  private _current: T | "" = "";
  private _locked = false;
  private _onComplete: (() => void) | undefined;
  private _onCancel: (() => void) | undefined;

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
    this._assertEveryLayerHas(name, "play");
    if (this._current === name || this._locked) return;
    this._current = name;
    for (const c of this._controllers) c.play(name);
  }

  /** Play a one-shot on every layer with a shared lock duration.
   *
   * The first controller owns the shared timer. Its normal automatic timing
   * keeps the lock aligned when its speed changes. Other controllers receive
   * an infinite lock duration and are released with the wrapper. Pass an
   * explicit duration to keep the shared timer independent of playback speed.
   *
   * With automatic timing the shared `startFrame` and `speed` are checked
   * against every layer first, so a value one layer rejects throws with every
   * layer still on its previous animation.
   *
   * The wrapper owns the interruption signal: exactly one of `onComplete` and
   * `onCancel` runs per one-shot, and layers never receive a cancel of their
   * own. */
  playOneShot(name: T, options?: AnimationOneShotOptions): void {
    this._assertEveryLayerHas(name, "playOneShot");
    if (this._locked && this._current === name) return;
    const leader = this._leader;
    const timing = {
      ...(options?.startFrame !== undefined && {
        startFrame: options.startFrame,
      }),
      ...(options?.speed !== undefined && { speed: options.speed }),
    };
    // Layers can define the same name with different frame counts, so a
    // startFrame legal for one is out of range for another. Validate the
    // shared timing against every layer before anything mutates.
    if (options?.duration === undefined) {
      for (const controller of this._controllers) {
        controller.calcDuration(name, timing);
      }
    }

    const cancelled = this._onCancel;
    this._clearLock();

    leader.playOneShot(name, {
      ...timing,
      ...(options?.duration !== undefined && { duration: options.duration }),
      onComplete: () => this.completeOneShot(),
    });
    for (const controller of this._controllers.slice(1)) {
      controller.playOneShot(name, {
        ...timing,
        duration: Number.POSITIVE_INFINITY,
      });
    }

    // Commit the wrapper's own lock only once every layer has accepted the
    // play, so a layer that rejects the timing cannot leave the wrapper
    // locked on an animation no leader timer will ever complete.
    this._current = name;
    this._locked = true;
    this._onComplete = options?.onComplete;
    this._onCancel = options?.onCancel;
    // Notify last, so a re-entrant playOneShot from inside the cancelled
    // callback replaces what was just installed instead of being clobbered.
    if (cancelled) runAttributed(this, "Animation onCancel", cancelled);
  }

  /** Clear the lock and force-switch every layer to the given animation. */
  forcePlay(name: T): void {
    this._assertEveryLayerHas(name, "forcePlay");
    const cancelled = this._onCancel;
    this._clearLock();
    this._current = name;
    for (const c of this._controllers) c.forcePlay(name);
    if (cancelled) runAttributed(this, "Animation onCancel", cancelled);
  }

  /** Manually release the one-shot lock on this wrapper and every child. */
  unlock(): void {
    const cancelled = this._onCancel;
    this._clearLock();
    if (cancelled) runAttributed(this, "Animation onCancel", cancelled);
  }

  /** A live one-shot ends with the component, so its `onCancel` still runs. */
  onDestroy(): void {
    this.unlock();
  }

  private completeOneShot(): void {
    if (!this._locked) return;
    const cb = this._onComplete;
    this._clearLock();
    if (cb) runAttributed(this, "Animation onComplete", cb);
  }

  /** Release the lock on this wrapper and every layer, notifying nobody. */
  private _clearLock(): void {
    this._locked = false;
    this._onComplete = undefined;
    this._onCancel = undefined;
    for (const c of this._controllers) c.unlock();
  }

  private _assertEveryLayerHas(name: T, method: string): void {
    for (let i = 0; i < this._controllers.length; i++) {
      if (!this._controllers[i]!.has(name)) {
        throw new Error(
          `LayeredAnimationController.${method}: layer ${i} has no animation ` +
            `"${name}"; every layer must define it.`,
        );
      }
    }
  }
}
