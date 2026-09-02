import { Component } from "@yagejs/core";
import { AnimatedSpriteComponent } from "./AnimatedSpriteComponent.js";
import type { Texture } from "pixi.js";
import { resolveFrames } from "./spritesheet.js";
import type { FrameSource } from "./spritesheet.js";
import { routeAnimationSpeedChange } from "./internal/animationSpeedGroup.js";
import { runAttributed } from "./internal/attribution.js";

/** Definition for a single named animation. */
export interface AnimationDef {
  /** Frame source (sheet grid or atlas animation). */
  source: FrameSource;
  /** PixiJS animationSpeed value (e.g. 0.15). */
  speed: number;
  /** Whether the animation loops. Default: true. */
  loop?: boolean;
  /** Per-animation anchor override. */
  anchor?: { x: number; y: number };
}

/** Options for a one-shot play. */
export interface AnimationOneShotOptions {
  /** Frame to start from (integer, 0 to the last frame). Default: 0. */
  startFrame?: number;
  /**
   * Playback multiplier for this one-shot only, on top of the controller's
   * `speed`. Finite and greater than 0. Default: 1.
   */
  speed?: number;
  /** Explicit lock duration in seconds, replacing the automatic calculation. */
  duration?: number;
  /** Called when the one-shot plays out. */
  onComplete?: () => void;
  /** Called when anything else ends the one-shot first. */
  onCancel?: () => void;
}

/** Options that change how long a one-shot takes to play. */
export interface AnimationTimingOptions {
  /** Frame the play starts from. Default: 0. */
  startFrame?: number;
  /** Per-play speed multiplier. Default: 1. */
  speed?: number;
}

// Internal: AnimationDef with frames resolved from its source.
interface ResolvedAnimDef {
  frames: Texture[];
  speed: number;
  loop?: boolean;
  anchor?: { x: number; y: number };
}

/**
 * High-level animation controller that manages named animations on top of
 * a sibling {@link AnimatedSpriteComponent}.
 *
 * Provides one-shot locking, per-animation anchors, and type-safe animation
 * names via the generic parameter.
 *
 * **Narrowing the animation-name type** — `entity.get(AnimationController)`
 * returns `AnimationController<string>` (the default `T`); the runtime class
 * isn't generic, and a string-typed instance can't substitute for a narrower
 * one (the `current: T | ""` getter is covariant on `T`). Cast at the field
 * declaration so every consumer downstream sees the narrow type:
 *
 * ```ts
 * type Anim = "idle" | "walk" | "shoot";
 *
 * class HeroController extends Component {
 *   private readonly _anim = this.sibling(AnimationController) as
 *     AnimationController<Anim>;
 * }
 * ```
 *
 * For multi-sprite (head + body + outfit) characters, see
 * {@link LayeredAnimationController} — it fans `play()`/`playOneShot()` across
 * a list of sibling controllers with a single shared lock timer.
 */
export class AnimationController<T extends string = string> extends Component {
  private readonly _anims: Record<T, ResolvedAnimDef>;
  private readonly _sprite = this.sibling(AnimatedSpriteComponent);

  private _current: T | "" = "";
  private _locked = false;
  private _lockTimer = 0;
  private _lockDuration = 0;
  private _lockUsesAnimationDuration = false;
  private _lockStartFrame = 0;
  private _shotSpeed = 1;
  private _onComplete: (() => void) | undefined;
  private _onCancel: (() => void) | undefined;
  private _speed = 1;

  constructor(animations: Record<T, AnimationDef>) {
    super();

    const resolved = {} as Record<T, ResolvedAnimDef>;
    for (const name of Object.keys(animations) as T[]) {
      const def = animations[name];
      resolved[name] = {
        frames: resolveFrames(def.source),
        speed: def.speed,
        ...(def.loop != null && { loop: def.loop }),
        ...(def.anchor && { anchor: def.anchor }),
      };
    }

    this._anims = resolved;
  }

  /** Currently playing animation name, or "" if none. */
  get current(): T | "" {
    return this._current;
  }

  /** True if a one-shot animation is blocking. */
  get locked(): boolean {
    return this._locked;
  }

  /** Current frame index of the underlying AnimatedSprite. */
  get frame(): number {
    return this._sprite.animatedSprite.currentFrame;
  }

  /**
   * Runtime speed multiplier (default 1). A controller owned by a
   * {@link LayeredAnimationController} shares this value with every layer.
   */
  get speed(): number {
    return this._speed;
  }

  set speed(value: number) {
    if (routeAnimationSpeedChange(this, value)) return;
    if (!Number.isFinite(value)) {
      throw new Error(
        `AnimationController.speed must be finite, got ${value}.`,
      );
    }
    const nextLockDuration =
      this._locked && this._lockUsesAnimationDuration && this._current
        ? this.calcDurationAtSpeed(
            this._current,
            value,
            this._shotSpeed,
            this._lockStartFrame,
          )
        : null;
    const lockProgress =
      this._locked && this._lockUsesAnimationDuration && this._lockDuration > 0
        ? Math.min(this._lockTimer / this._lockDuration, 1)
        : 0;
    this._speed = value;
    if (!this._current) return;
    this._sprite.animatedSprite.animationSpeed =
      this._anims[this._current].speed * value * this._shotSpeed;
    if (nextLockDuration !== null) {
      this._lockDuration = nextLockDuration;
      this._lockTimer = this._lockDuration * lockProgress;
    }
  }

  /** Whether this controller defines the given animation name. */
  has(name: string): name is T {
    return Object.hasOwn(this._anims, name);
  }

  /** Play a named animation. No-op if already current or locked. */
  play(name: T): void {
    const def = this._def(name, "play");
    if (this._current === name || this._locked) return;
    this._apply(name, def);
  }

  /** Play an animation as a one-shot, locking out other plays until complete.
   *  No-op if already locked on the same animation (prevents restart flicker).
   *
   *  Exactly one of `onComplete` and `onCancel` runs per one-shot:
   *  `onComplete` when the lock timer plays out, `onCancel` when another
   *  one-shot, `forcePlay`, `unlock` or component destruction ends it first.
   *  A cancel callback runs after the new state is in place, so calling
   *  `playOneShot` from inside it takes effect.
   *
   *  When `options.duration` is omitted, the lock duration is auto-calculated
   *  from the frames that will actually play — the frame count from
   *  `startFrame` on, at the controller speed times `options.speed`. Pass an
   *  explicit `duration` to synchronise lock release across multiple
   *  controllers (see {@link LayeredAnimationController}). */
  playOneShot(name: T, options?: AnimationOneShotOptions): void {
    const def = this._def(name, "playOneShot");
    if (this._locked && this._current === name) return;
    const startFrame = options?.startFrame ?? 0;
    const shotSpeed = options?.speed ?? 1;
    this._validateTiming(def, startFrame, shotSpeed, "playOneShot");
    const duration =
      options?.duration ??
      this.calcDurationAtSpeed(name, this._speed, shotSpeed, startFrame);

    const cancelled = this._onCancel;
    this._apply(name, def, { startFrame, speed: shotSpeed });
    this._sprite.animatedSprite.loop = false;
    this._locked = true;
    this._lockTimer = 0;
    this._lockDuration = duration;
    this._lockUsesAnimationDuration = options?.duration === undefined;
    this._lockStartFrame = startFrame;
    this._onComplete = options?.onComplete;
    this._onCancel = options?.onCancel;
    // Notify last: the new lock is fully installed, so a re-entrant
    // playOneShot from inside the cancelled callback wins.
    if (cancelled) runAttributed(this, "Animation onCancel", cancelled);
  }

  /** Clear lock and force-switch to the given animation. */
  forcePlay(name: T): void {
    const def = this._def(name, "forcePlay");
    const cancelled = this._onCancel;
    this._clearLock();
    this._apply(name, def);
    if (cancelled) runAttributed(this, "Animation onCancel", cancelled);
  }

  /** Manually release the one-shot lock, firing a pending `onCancel`. */
  unlock(): void {
    const cancelled = this._onCancel;
    this._clearLock();
    if (cancelled) runAttributed(this, "Animation onCancel", cancelled);
  }

  /**
   * Calculate the engine-scaled duration (seconds) a one-shot of this
   * animation would take, matching what `playOneShot` locks for.
   *
   * Frame-rate independent: PixiJS normalises `deltaTime` via
   * `Ticker.targetFPMS` (0.06), so the formula holds at any actual fps. The
   * controller timer and animated sprite both receive engine-scaled time.
   * Throws unless the effective speed is positive and produces a finite
   * duration. Use an explicit one-shot duration for paused or reverse playback.
   */
  calcDuration(name: T, options?: AnimationTimingOptions): number {
    const def = this._def(name, "calcDuration");
    const startFrame = options?.startFrame ?? 0;
    const shotSpeed = options?.speed ?? 1;
    this._validateTiming(def, startFrame, shotSpeed, "calcDuration");
    return this.calcDurationAtSpeed(name, this._speed, shotSpeed, startFrame);
  }

  private calcDurationAtSpeed(
    name: T,
    controllerSpeed: number,
    shotSpeed: number,
    startFrame: number,
  ): number {
    const def = this._anims[name];
    const effectiveSpeed = def.speed * controllerSpeed * shotSpeed;
    const duration =
      ((def.frames.length - startFrame) * (1 / 60)) / effectiveSpeed;
    if (
      !Number.isFinite(effectiveSpeed) ||
      effectiveSpeed <= 0 ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      throw new Error(
        "An automatically timed one-shot requires a positive effective speed that produces a finite duration. " +
          "Pass an explicit duration to playOneShot() to pause or reverse it.",
      );
    }
    return duration;
  }

  /** Check whether the current frame is within [start, end] inclusive. */
  inFrameRange(start: number, end: number): boolean {
    const f = this.frame;
    return f >= start && f <= end;
  }

  /** Auto-play the first defined animation. */
  onAdd(): void {
    const names = Object.keys(this._anims) as T[];
    const first = names[0];
    if (first !== undefined) {
      this._apply(first, this._anims[first]);
    }
  }

  /** A live one-shot ends with the component, so its `onCancel` still runs. */
  onDestroy(): void {
    this.unlock();
  }

  /** Tick the one-shot lock timer. */
  update(dt: number): void {
    if (!this._locked) return;
    this._lockTimer += dt;
    if (this._lockTimer >= this._lockDuration) {
      const cb = this._onComplete;
      this._clearLock();
      if (cb) runAttributed(this, "Animation onComplete", cb);
    }
  }

  /** Drop the lock and both of its callbacks without notifying either. */
  private _clearLock(): void {
    this._locked = false;
    this._lockTimer = 0;
    this._lockDuration = 0;
    this._lockUsesAnimationDuration = false;
    this._lockStartFrame = 0;
    this._onComplete = undefined;
    this._onCancel = undefined;
  }

  /** Resolve a caller-supplied name, naming the entry it was passed to. */
  private _def(name: T, method: string): ResolvedAnimDef {
    if (!Object.hasOwn(this._anims, name)) {
      const defined = Object.keys(this._anims);
      throw new Error(
        `AnimationController.${method}: unknown animation "${name}", ` +
          `expected one of ${defined.length > 0 ? defined.join(", ") : "(none defined)"}.`,
      );
    }
    return this._anims[name];
  }

  private _validateTiming(
    def: ResolvedAnimDef,
    startFrame: number,
    speed: number,
    method: string,
  ): void {
    const last = def.frames.length - 1;
    if (!Number.isInteger(startFrame)) {
      throw new Error(
        `AnimationController.${method}: startFrame must be an integer, got ${startFrame}.`,
      );
    }
    if (startFrame < 0 || startFrame > last) {
      throw new Error(
        `AnimationController.${method}: startFrame ${startFrame} is out of range (0-${last}).`,
      );
    }
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new Error(
        `AnimationController.${method}: speed must be a finite number greater than 0, got ${speed}.`,
      );
    }
  }

  private _apply(
    name: T,
    def: ResolvedAnimDef,
    options?: { startFrame: number; speed: number },
  ): void {
    this._current = name;
    this._shotSpeed = options?.speed ?? 1;
    const sprite = this._sprite.animatedSprite;
    sprite.textures = def.frames;
    if (def.anchor) {
      sprite.anchor.set(def.anchor.x, def.anchor.y);
    }
    sprite.animationSpeed = def.speed * this._speed * this._shotSpeed;
    sprite.loop = def.loop ?? true;
    // A completion callback belongs to the play that installed it, so a
    // switch must not carry it into an animation its author never saw.
    delete sprite.onComplete;
    sprite.gotoAndPlay(options?.startFrame ?? 0);
  }
}
