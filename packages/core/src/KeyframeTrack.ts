import { Process, easeLinear } from "./Process.js";
import { interpolate } from "./interpolate.js";
import type { ProcessOptions } from "./Process.js";
import type { Interpolatable } from "./interpolate.js";
import type { EasingFunction } from "./types.js";

/** A single keyframe in an animation track. */
export interface Keyframe<T extends Interpolatable> {
  /** Time in ms from the start of the track. */
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
  /** At least 2 keyframes, sorted by time. */
  keyframes: Keyframe<T>[];
  /** Called each frame with the interpolated value. */
  setter: (value: T) => void;
  /** Total duration in ms. Defaults to the last keyframe's time. */
  duration?: number;
  /** Whether to loop the track. */
  loop?: boolean;
  /** Playback speed multiplier (default 1). */
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

  const duration = options.duration ?? keyframes[keyframes.length - 1]!.time;
  if (duration <= 0) {
    throw new Error("createKeyframeTrack: duration must be > 0");
  }
  const loop = options.loop ?? false;

  let internalElapsed = 0;
  const firedEvents = new Set<number>();

  const processOpts: ProcessOptions = {
    update(dt) {
      internalElapsed += dt * speed;

      // Handle completion / looping
      if (internalElapsed >= duration) {
        if (loop) {
          // Complete the pass — fire any events that haven't fired this cycle
          for (let i = 0; i < keyframes.length; i++) {
            if (keyframes[i]!.event && !firedEvents.has(i)) {
              keyframes[i]!.event!();
            }
          }
          internalElapsed = internalElapsed % duration;
          firedEvents.clear();
          return;
        } else {
          // Clamp to final value
          setter(keyframes[keyframes.length - 1]!.data);
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

      // Find the current segment (linear scan — tracks are small)
      let segIdx = 0;
      for (let i = 0; i < keyframes.length - 1; i++) {
        if (internalElapsed >= keyframes[i]!.time) {
          segIdx = i;
        }
      }

      const kfA = keyframes[segIdx]!;
      const kfB = keyframes[segIdx + 1]!;
      const segDuration = kfB.time - kfA.time;
      const segT =
        segDuration > 0
          ? Math.min((internalElapsed - kfA.time) / segDuration, 1)
          : 1;
      const segEasing = kfA.easing ?? defaultEasing;

      setter(interpolate(kfA.data, kfB.data, segT, segEasing));
    },
  };
  if (onComplete) processOpts.onComplete = onComplete;

  return new Process(processOpts);
}
