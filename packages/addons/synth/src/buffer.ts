import { renderSynthSound, SYNTH_SAMPLE_RATE } from "./core/render.js";
import type { SynthSound } from "./core/types.js";

/**
 * Render a sound and wrap it in a mono `AudioBuffer`, ready for
 * `registerSound(alias, buffer)` from `@yagejs/audio`.
 *
 * `SynthPlugin` does this for everything in its config; call it directly for
 * sounds a game builds at runtime:
 *
 * ```ts
 * import { registerSound } from "@yagejs/audio";
 * import { synthBuffer, synthPresets } from "@yagejs-addons/synth";
 *
 * registerSound("boss-hit", synthBuffer(synthPresets.hit({ frequency: 180 })));
 * ```
 *
 * The `AudioBuffer` constructor needs no `AudioContext`, so this works before
 * the browser's first-gesture unlock. Playback resamples if the output device
 * runs at a different rate.
 */
export function synthBuffer(
  sound: SynthSound,
  sampleRate: number = SYNTH_SAMPLE_RATE,
): AudioBuffer {
  const samples = renderSynthSound(sound, sampleRate);
  const buffer = new AudioBuffer({
    numberOfChannels: 1,
    length: samples.length,
    sampleRate,
  });
  buffer.getChannelData(0).set(samples);
  return buffer;
}
