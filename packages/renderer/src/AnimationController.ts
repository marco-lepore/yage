import { Component, serializable } from "@yagejs/core";
import { AnimatedSpriteComponent } from "./AnimatedSpriteComponent.js";
import type { Texture } from "pixi.js";
import { resolveFrames } from "./spritesheet.js";
import type { FrameSource } from "./spritesheet.js";
import { routeAnimationSpeedChange } from "./internal/animationSpeedGroup.js";

/** Definition for a single named animation. */
export interface AnimationDef {
  /** Serializable frame source (sheet grid or atlas animation). */
  source: FrameSource;
  /** PixiJS animationSpeed value (e.g. 0.15). */
  speed: number;
  /** Whether the animation loops. Default: true. */
  loop?: boolean;
  /** Per-animation anchor override. */
  anchor?: { x: number; y: number };
}

/** Serializable snapshot of an AnimationController. */
export interface AnimationControllerData {
  animations: Record<
    string,
    {
      source: FrameSource;
      speed: number;
      loop?: boolean;
      anchor?: { x: number; y: number };
    }
  >;
  current: string;
  speed: number;
}

// Internal: AnimationDef with frames resolved from its source.
interface ResolvedAnimDef {
  source: FrameSource;
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
@serializable
export class AnimationController<
  T extends string = string,
> extends Component {
  // onAdd() drives the sibling AnimatedSpriteComponent's sprite.
  static restorePriority = 40;

  private readonly _anims: Record<T, ResolvedAnimDef>;
  private readonly _sprite = this.sibling(AnimatedSpriteComponent);

  private _current: T | "" = "";
  private _locked = false;
  private _lockTimer = 0;
  private _lockDuration = 0;
  private _lockUsesAnimationDuration = false;
  private _onComplete: (() => void) | undefined;
  private _speed = 1;

  constructor(animations: Record<T, AnimationDef>) {
    super();

    const resolved = {} as Record<T, ResolvedAnimDef>;
    for (const name of Object.keys(animations) as T[]) {
      const def = animations[name];
      resolved[name] = {
        source: def.source,
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
        ? this.calcDurationAtSpeed(this._current, value)
        : null;
    const lockProgress =
      this._locked && this._lockUsesAnimationDuration && this._lockDuration > 0
        ? Math.min(this._lockTimer / this._lockDuration, 1)
        : 0;
    this._speed = value;
    if (!this._current) return;
    this._sprite.animatedSprite.animationSpeed =
      this._anims[this._current].speed * value;
    if (nextLockDuration !== null) {
      this._lockDuration = nextLockDuration;
      this._lockTimer = this._lockDuration * lockProgress;
    }
  }

  /** Play a named animation. No-op if already current or locked. */
  play(name: T): void {
    if (this._current === name || this._locked) return;
    this._apply(name);
  }

  /** Play an animation as a one-shot, locking out other plays until complete.
   *  No-op if already locked on the same animation (prevents restart flicker).
   *
   *  When `options.duration` is omitted, the lock duration is auto-calculated
   *  from this controller's own frame count and speed via {@link calcDuration}.
   *  Pass an explicit `duration` to synchronise lock release across multiple
   *  controllers (see {@link LayeredAnimationController}). */
  playOneShot(
    name: T,
    options?: { duration?: number; onComplete?: () => void },
  ): void {
    if (this._locked && this._current === name) return;
    const duration = options?.duration ?? this.calcDuration(name);
    this._apply(name);
    this._sprite.animatedSprite.loop = false;
    this._locked = true;
    this._lockTimer = 0;
    this._lockDuration = duration;
    this._lockUsesAnimationDuration = options?.duration === undefined;
    this._onComplete = options?.onComplete;
  }

  /** Clear lock and force-switch to the given animation. */
  forcePlay(name: T): void {
    this.unlock();
    this._apply(name);
  }

  /** Manually release the one-shot lock. */
  unlock(): void {
    this._locked = false;
    this._lockTimer = 0;
    this._lockDuration = 0;
    this._lockUsesAnimationDuration = false;
    this._onComplete = undefined;
  }

  /**
   * Calculate the engine-scaled duration (seconds) of a named animation.
   *
   * Frame-rate independent: PixiJS normalises `deltaTime` via
   * `Ticker.targetFPMS` (0.06), so the formula holds at any actual fps. The
   * controller timer and animated sprite both receive engine-scaled time.
   * Throws unless the effective speed is positive and produces a finite
   * duration. Use an explicit one-shot duration for paused or reverse playback.
   */
  calcDuration(name: T): number {
    return this.calcDurationAtSpeed(name, this._speed);
  }

  private calcDurationAtSpeed(name: T, controllerSpeed: number): number {
    const def = this._anims[name];
    const effectiveSpeed = def.speed * controllerSpeed;
    const duration = (def.frames.length * (1 / 60)) / effectiveSpeed;
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

  serialize(): AnimationControllerData {
    const animations: AnimationControllerData["animations"] = {};
    for (const [name, def] of Object.entries<ResolvedAnimDef>(this._anims)) {
      animations[name] = {
        source: def.source,
        speed: def.speed,
        ...(def.loop != null && { loop: def.loop }),
        ...(def.anchor && { anchor: def.anchor }),
      };
    }
    return { animations, current: this._current, speed: this._speed };
  }

  static fromSnapshot(data: AnimationControllerData): AnimationController {
    const anims: Record<string, AnimationDef> = {};
    for (const [name, def] of Object.entries(data.animations)) {
      anims[name] = {
        source: def.source,
        speed: def.speed,
        ...(def.loop != null && { loop: def.loop }),
        ...(def.anchor && { anchor: def.anchor }),
      };
    }
    const ctrl = new AnimationController(anims);
    ctrl._current = data.current;
    ctrl._speed = data.speed;
    return ctrl;
  }

  /** Auto-play the first defined animation (respects prior restore). */
  onAdd(): void {
    const names = Object.keys(this._anims) as T[];
    if (names.length > 0) {
      const target = (this._current && this._current in this._anims)
        ? this._current as T
        : names[0]!;
      this._apply(target);
    }
  }

  /** Tick the one-shot lock timer. */
  update(dt: number): void {
    if (!this._locked) return;
    this._lockTimer += dt;
    if (this._lockTimer >= this._lockDuration) {
      const cb = this._onComplete;
      this.unlock();
      cb?.();
    }
  }

  private _apply(name: T): void {
    this._current = name;
    const def = this._anims[name];
    const sprite = this._sprite.animatedSprite;
    sprite.textures = def.frames;
    if (def.anchor) {
      sprite.anchor.set(def.anchor.x, def.anchor.y);
    }
    sprite.animationSpeed = def.speed * this._speed;
    sprite.loop = def.loop ?? true;
    sprite.gotoAndPlay(0);
  }
}
