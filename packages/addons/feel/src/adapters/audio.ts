import {
  AudioManagerKey,
  type AudioPlayOptions,
  type SoundHandle,
  type SoundRequestHandle,
} from "@yagejs/audio";
import { defineFeelEffect } from "../core/node.js";
import type { FeelNode, FeelRange } from "../core/types.js";

interface OwnedSound {
  active(): boolean;
  release(): void;
}

export interface FeelSoundOptions extends Omit<
  AudioPlayOptions,
  "loop" | "onEnd" | "speed"
> {
  /** Alias or non-empty list sampled from the scene random source per play. */
  alias: string | readonly string[];
  /** Whether release and cancellation stop the recording. Default: "cue". */
  lifetime?: "cue" | "sound";
  /** Fade seconds when cue-owned audio stops. Finite and non-negative. Default: 0. */
  fadeOut?: number;
  /** Fixed or randomized playback speed. Default: 1. */
  speed?: FeelRange;
  /** Reuse a still-playing sound with the same alias. Default: false. */
  once?: boolean;
  /** Called when the sound finishes on its own. */
  onEnd?: () => void;
}

/** Play one preloaded sound through YAGE's audio manager. */
export function feelSound(options: FeelSoundOptions): FeelNode {
  if ("loop" in options && options.loop === true) {
    throw new Error(
      "feelSound: use feelLoop(feelSound(...), gap) with a positive gap for repeated cue sounds, or SoundComponent for continuous looping audio.",
    );
  }
  const aliases =
    typeof options.alias === "string" ? options.alias : [...options.alias];
  if (typeof aliases !== "string" && aliases.length === 0) {
    throw new Error("feelSound: alias list must not be empty.");
  }
  const lifetime = options.lifetime ?? "cue";
  const fadeOut = options.fadeOut ?? 0;
  if (!Number.isFinite(fadeOut) || fadeOut < 0) {
    throw new Error(
      `feelSound: fadeOut must be a finite number >= 0 in seconds, got ${fadeOut}.`,
    );
  }
  if (lifetime === "sound" && fadeOut > 0) {
    throw new Error('feelSound: fadeOut requires lifetime "cue".');
  }
  return defineFeelEffect(0, (context) => {
    let owned: OwnedSound;
    let released = false;
    const release = (): void => {
      if (lifetime === "cue") {
        owned.release();
        released = true;
      }
    };
    return {
      start: () => {
        const manager = context.resolve(AudioManagerKey);
        const alias =
          typeof aliases === "string" ? aliases : context.random.pick(aliases);
        const onEnd = options.onEnd;
        const speed =
          typeof options.speed === "number"
            ? options.speed
            : options.speed
              ? context.random.range(options.speed[0], options.speed[1])
              : 1;
        const playOptions: AudioPlayOptions = {
          ...(options.channel !== undefined
            ? { channel: options.channel }
            : {}),
          ...(options.volume !== undefined
            ? { volume: options.volume * context.intensity }
            : { volume: context.intensity }),
          ...(onEnd !== undefined
            ? {
                onEnd: () => {
                  if (!released) context.invoke("sound onEnd", onEnd);
                },
              }
            : {}),
          speed,
        };
        owned = options.once
          ? ownRequest(manager.requestOnce(alias, playOptions), fadeOut)
          : ownHandle(manager.play(alias, playOptions), fadeOut);
      },
      release,
      isComplete: () => !owned.active(),
      finish: (cancelled) => {
        if (cancelled) release();
      },
    };
  });
}

function ownRequest(request: SoundRequestHandle, fadeOut: number): OwnedSound {
  return {
    active: () => request.active,
    release: () => request.release({ fadeOut }),
  };
}

function ownHandle(handle: SoundHandle, fadeOut: number): OwnedSound {
  let released = false;
  return {
    active: () => handle.playing,
    release: () => {
      if (released || !handle.playing) return;
      if (fadeOut > 0) {
        handle.fadeTo(0, { duration: fadeOut, stopOnComplete: true });
      } else {
        handle.stop();
      }
      released = true;
    },
  };
}
