import { Process } from "./Process.js";
import { easeLinear } from "./easing.js";
import {
  assertDuration,
  durationReached,
  loopRemainder,
} from "./internal/duration.js";
import { interpolate } from "./interpolate.js";
import { MathUtils } from "./MathUtils.js";
import type { ProcessOptions } from "./Process.js";
import type { Interpolatable } from "./interpolate.js";
import type { EasingFunction } from "./types.js";

/** A single keyframe in an animation track. */
export interface Keyframe<T extends Interpolatable> {
  /** Time in seconds from the start of the track. */
  time: number;
  /** Value at this keyframe. */
  data: T;
  /** Easing from this keyframe to the next (overrides track default). */
  easing?: EasingFunction;
  /** Fired once when playback passes this keyframe's time. */
  event?: () => void;
}

/** Options for creating a keyframe track. */
export interface KeyframeTrackOptions<T extends Interpolatable> {
  /**
   * At least 2 keyframes, sorted by time. A track interpolates between
   * control points, so fewer than 2 is rejected.
   */
  keyframes: Keyframe<T>[];
  /**
   * Called with the interpolated value on every tick of the clock the track
   * is scheduled on. The tick that wraps a looping track back to time 0 skips
   * the setter, so the previous value holds for one tick. Optional — omit to
   * run the track purely for its keyframe `event` callbacks (a "timeline" of
   * side-effects with no per-tick value).
   */
  setter?: (value: T) => void;
  /**
   * Total duration in seconds, finite and > 0. Defaults to the last
   * keyframe's time.
   */
  duration?: number;
  /** Whether to loop the track. */
  loop?: boolean;
  /** Playback speed multiplier (default 1). Finite and > 0. */
  speed?: number;
  /** Default easing between keyframes (default easeLinear). */
  easing?: EasingFunction;
  /** Called when the track completes (non-looping only). */
  onComplete?: () => void;
}

/**
 * Create a Process that animates through keyframes.
 * Returns a standard Process — composable with Sequence, ProcessComponent.run(), etc.
 */
export function createKeyframeTrack<T extends Interpolatable>(
  options: KeyframeTrackOptions<T>,
): Process {
  const {
    keyframes,
    setter,
    speed = 1,
    easing: defaultEasing = easeLinear,
    onComplete,
  } = options;

  if (keyframes.length < 2) {
    throw new Error(
      `createKeyframeTrack: keyframes must hold at least 2 entries to interpolate between, got ${keyframes.length}.`,
    );
  }
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error(
      `createKeyframeTrack: speed must be a finite number > 0, got ${speed}.`,
    );
  }
  // The segment scan and the event comparisons both read `time` as an ordered
  // axis. A non-finite or out-of-order entry picks the wrong segment and skips
  // events instead of failing, so both are rejected here.
  for (let i = 0; i < keyframes.length; i++) {
    const time = keyframes[i]!.time;
    if (!Number.isFinite(time)) {
      throw new Error(
        `createKeyframeTrack: keyframe ${i} must have a finite time in seconds, got ${time}.`,
      );
    }
    const previous = keyframes[i - 1]?.time;
    if (previous !== undefined && time < previous) {
      throw new Error(
        `createKeyframeTrack: keyframes must be sorted by time, but keyframe ${i} is at ${time} after ${previous}.`,
      );
    }
  }
  const duration = options.duration ?? keyframes[keyframes.length - 1]!.time;
  assertDuration("createKeyframeTrack", duration);
  const loop = options.loop ?? false;

  let internalElapsed = 0;
  const firedEvents = new Set<number>();

  const processOpts: ProcessOptions = {
    update(dt) {
      internalElapsed += dt * speed;

      // Handle completion / looping
      if (durationReached(internalElapsed, duration)) {
        if (loop) {
          // Complete the pass — fire any events that haven't fired this cycle
          for (let i = 0; i < keyframes.length; i++) {
            if (keyframes[i]!.event && !firedEvents.has(i)) {
              keyframes[i]!.event!();
            }
          }
          internalElapsed = loopRemainder(internalElapsed, duration);
          firedEvents.clear();
          return;
        } else {
          // Clamp to final value
          setter?.(keyframes[keyframes.length - 1]!.data);
          // Fire any remaining events
          for (let i = 0; i < keyframes.length; i++) {
            if (!firedEvents.has(i) && keyframes[i]!.event) {
              keyframes[i]!.event!();
            }
          }
          // Return true to complete — Process calls onComplete for us
          return true;
        }
      }

      // Fire events for keyframes we've passed
      for (let i = 0; i < keyframes.length; i++) {
        if (
          !firedEvents.has(i) &&
          keyframes[i]!.event &&
          internalElapsed >= keyframes[i]!.time
        ) {
          firedEvents.add(i);
          keyframes[i]!.event!();
        }
      }

      setter?.(sampleKeyframes(keyframes, internalElapsed, defaultEasing));
    },
  };
  if (onComplete) processOpts.onComplete = onComplete;

  return new Process(processOpts);
}

/**
 * Read a track at a time without advancing a Process or dispatching events.
 * Keys must be nonempty, finite and sorted. Values hold outside the key range.
 * The result is undefined for a non-finite query time.
 */
export function sampleKeyframes<T extends Interpolatable>(
  keyframes: readonly Keyframe<T>[],
  time: number,
  defaultEasing: EasingFunction = easeLinear,
): T {
  if (keyframes.length === 0) {
    throw new Error("sampleKeyframes: at least one keyframe is required.");
  }
  const last = keyframes[keyframes.length - 1]!;
  if (time >= last.time || keyframes.length === 1) return last.data;
  let index = 0;
  for (let i = 0; i < keyframes.length - 1; i++) {
    if (time >= keyframes[i]!.time) index = i;
  }
  const a = keyframes[index]!;
  const b = keyframes[index + 1]!;
  const t = b.time > a.time ? MathUtils.inverseLerp(a.time, b.time, time) : 1;
  return interpolate(a.data, b.data, t, a.easing ?? defaultEasing);
}
