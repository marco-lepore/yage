import { Component } from "./Component.js";
import { ProcessComponent } from "./ProcessComponent.js";
import { createKeyframeTrack } from "./KeyframeTrack.js";
import { tickProcessGuarded } from "./Process.js";
import { ErrorBoundaryKey } from "./EngineContext.js";
import type { Keyframe, KeyframeTrackOptions } from "./KeyframeTrack.js";
import type { Process, ProcessClock } from "./Process.js";
import type { ErrorBoundary } from "./ErrorBoundary.js";
import type { Interpolatable } from "./interpolate.js";
import type { EasingFunction } from "./types.js";
import { serializable } from "./Serializable.js";

/** Definition for a named keyframe animation. */
export interface KeyframeAnimationDef<T extends Interpolatable = Interpolatable> {
  /**
   * At least 2 keyframes, sorted by time. A track interpolates between
   * control points, so `play()` throws on fewer than 2.
   */
  keyframes: Keyframe<T>[];
  /**
   * Receives the interpolated value on every tick of the animation's clock —
   * each rendered frame by default. The tick that wraps a looping animation
   * back to time 0 skips the setter, so the previous value holds for one tick.
   * Optional — when omitted the animator only fires keyframe `event` callbacks
   * (pure-timeline use case).
   *
   * Declared as a method signature (rather than a `(value: T) => void`
   * property) so the parameter type is bivariant — this is what lets a
   * `Record<string, KeyframeAnimationDef<number>>` literal flow into the
   * `KeyframeAnimator` constructor without per-key casts.
   */
  setter?(value: T): void;
  /**
   * Clock that advances this animation's playback (see `ProcessClock`),
   * default `"frame"`.
   *
   * `"frame"` is rendered-frame time, right for setter-driven visuals.
   * `"fixed"` is the fixed timestep, right for timing that must stay in step
   * with a fixed-step simulation — typically a setter-less timeline whose
   * keyframe `event` callbacks drive gameplay. The choice is per animation, so
   * one animator can hold a frame-clock walk cycle and a fixed-clock event
   * timeline.
   *
   * A setter on `"fixed"` is written on fixed steps, so a rendered frame that
   * runs no fixed step shows the previous value.
   */
  clock?: ProcessClock;
  loop?: boolean;
  /** Playback speed multiplier (default 1). Finite and > 0. */
  speed?: number;
  /** Track length in seconds, finite and > 0. Defaults to the last keyframe's time. */
  duration?: number;
  easing?: EasingFunction;
  onEnter?: () => void;
  onExit?: (complete: boolean) => void;
}

/**
 * Component that manages named keyframe animations.
 *
 * Multiple animations can play concurrently (bob + pulse).
 * Each animation runs as a Process on the sibling ProcessComponent.
 * Requires a sibling ProcessComponent on the same entity.
 */
@serializable
export class KeyframeAnimator<T extends string = string> extends Component {
  private readonly defs: Record<string, KeyframeAnimationDef>;
  private readonly active = new Map<string, Process>();
  private readonly pc = this.sibling(ProcessComponent);
  private errorBoundary: ErrorBoundary | undefined;

  constructor(animations: Record<T, KeyframeAnimationDef>) {
    super();
    this.defs = animations;
  }

  /** Start (or restart) a named animation. */
  play(name: T): void {
    const def = this.defs[name];
    if (!def) return;

    // Restart if already playing
    if (this.active.has(name)) {
      this.stopInternal(name, false);
    }

    if (def.onEnter) this.runGuarded(def.onEnter, "Animation onEnter");

    const opts: KeyframeTrackOptions<Interpolatable> = {
      keyframes: def.keyframes,
      onComplete: () => {
        this.active.delete(name);
        const onExit = def.onExit;
        if (onExit) this.runGuarded(() => onExit(true), "Animation onExit");
      },
    };
    if (def.setter) opts.setter = def.setter;
    if (def.loop !== undefined) opts.loop = def.loop;
    if (def.speed !== undefined) opts.speed = def.speed;
    if (def.duration !== undefined) opts.duration = def.duration;
    if (def.easing !== undefined) opts.easing = def.easing;

    const process = createKeyframeTrack(opts);

    this.active.set(name, process);
    this.pc.run(process, { clock: def.clock ?? "frame" });
  }

  /** Stop a named animation. */
  stop(name: T): void {
    this.stopInternal(name, false);
  }

  /** Stop all playing animations. */
  stopAll(): void {
    for (const name of [...this.active.keys()]) {
      this.stopInternal(name, false);
    }
  }

  /** Whether a named animation is currently playing. */
  isPlaying(name: T): boolean {
    return this.active.has(name);
  }

  override onDestroy(): void {
    this.stopAll();
  }

  serialize(): null {
    return null;
  }

  private stopInternal(name: string, complete: boolean): void {
    const process = this.active.get(name);
    if (!process) return;
    process.cancel();
    this.active.delete(name);
    const onExit = this.defs[name]?.onExit;
    if (onExit) this.runGuarded(() => onExit(complete), "Animation onExit");
  }

  /**
   * `onEnter`/`onExit` are invoked from `play()`/`stop()` rather than from a
   * process tick, so they need their own route to the error boundary to be
   * attributed to this animator instead of to the caller.
   */
  private runGuarded(fn: () => void, kind: string): void {
    const scene = this.entity?.tryScene;
    this.errorBoundary ??= scene?.context?.tryResolve(ErrorBoundaryKey);
    tickProcessGuarded(this.errorBoundary, fn, {
      kind,
      ...(this.entity?.name !== undefined ? { entity: this.entity.name } : {}),
      ...(scene ? { scene: scene.name } : {}),
    });
  }
}
