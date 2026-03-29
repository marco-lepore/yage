import { Component } from "@yage/core";
import { AnimatedSpriteComponent } from "./AnimatedSpriteComponent.js";
import type { Texture } from "pixi.js";

/** Definition for a single named animation. */
export interface AnimationDef {
  /** Array of frame textures. */
  frames: Texture[];
  /** PixiJS animationSpeed value (e.g. 0.15). */
  speed: number;
  /** Whether the animation loops. Default: true. */
  loop?: boolean;
  /** Per-animation anchor override. */
  anchor?: { x: number; y: number };
}

/**
 * High-level animation controller that manages named animations on top of
 * a sibling {@link AnimatedSpriteComponent}.
 *
 * Provides one-shot locking, per-animation anchors, and type-safe animation
 * names via the generic parameter.
 */
export class AnimationController<
  T extends string = string,
> extends Component {
  private readonly _anims: Record<T, AnimationDef>;
  private readonly _sprite = this.sibling(AnimatedSpriteComponent);

  private _current: T | "" = "";
  private _locked = false;
  private _lockTimer = 0;
  private _lockDuration = 0;
  private _onComplete: (() => void) | undefined;
  private _speed = 1;

  constructor(animations: Record<T, AnimationDef>) {
    super();
    this._anims = animations;
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

  /** Runtime speed multiplier (default 1). */
  get speed(): number {
    return this._speed;
  }

  set speed(value: number) {
    this._speed = value;
  }

  /** Play a named animation. No-op if already current or locked. */
  play(name: T): void {
    if (this._current === name || this._locked) return;
    this._apply(name);
  }

  /** Play an animation as a one-shot, locking out other plays until complete.
   *  No-op if already locked on the same animation (prevents restart flicker). */
  playOneShot(
    name: T,
    options?: { duration?: number; onComplete?: () => void },
  ): void {
    if (this._locked && this._current === name) return;
    this._apply(name);
    this._sprite.animatedSprite.loop = false;
    this._locked = true;
    this._lockTimer = 0;
    this._lockDuration = options?.duration ?? this.calcDuration(name);
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
    this._onComplete = undefined;
  }

  /**
   * Calculate the wall-clock duration (ms) of a named animation.
   *
   * Frame-rate independent: PixiJS normalises `deltaTime` via
   * `Ticker.targetFPMS` (0.06), so the formula holds at any actual fps.
   * Inaccurate only if `Ticker.shared.speed` is changed from 1.
   */
  calcDuration(name: T): number {
    const def = this._anims[name];
    return (def.frames.length * (1000 / 60)) / (def.speed * this._speed);
  }

  /** Check whether the current frame is within [start, end] inclusive. */
  inFrameRange(start: number, end: number): boolean {
    const f = this.frame;
    return f >= start && f <= end;
  }

  /**
   * Serialise runtime state for save/load.
   * Returns the current animation name and speed — animation defs contain
   * Texture references which are not serializable. Entities must reconstruct
   * this component in their afterRestore() and can use this data to restore
   * the current animation and speed.
   */
  serialize(): { current: string; speed: number } {
    return { current: this._current, speed: this._speed };
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
