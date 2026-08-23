import { AudioManagerKey, type AudioPlayOptions } from "@yagejs/audio";
import { defineFeelEffect } from "../core/node.js";
import type { FeelNode, FeelRange } from "../core/types.js";

export interface FeelSoundOptions extends Omit<
  AudioPlayOptions,
  "loop" | "onEnd" | "speed"
> {
  alias: string;
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
      "feelSound: looping audio has no cue-owned lifetime. Use a SoundComponent for loops.",
    );
  }
  return defineFeelEffect(0, (context) => ({
    start: () => {
      const manager = context.resolve(AudioManagerKey);
      const onEnd = options.onEnd;
      const speed =
        typeof options.speed === "number"
          ? options.speed
          : options.speed
            ? context.random.range(options.speed[0], options.speed[1])
            : 1;
      const playOptions: AudioPlayOptions = {
        ...(options.channel !== undefined ? { channel: options.channel } : {}),
        ...(options.volume !== undefined
          ? { volume: options.volume * context.intensity }
          : { volume: context.intensity }),
        ...(onEnd !== undefined
          ? {
              onEnd: () => context.invoke("sound onEnd", onEnd),
            }
          : {}),
        speed,
      };
      if (options.once) manager.playOnce(options.alias, playOptions);
      else manager.play(options.alias, playOptions);
    },
  }));
}
