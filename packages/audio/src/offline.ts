import { AudioManager } from "./AudioManager.js";
import type { AudioConfig } from "./types.js";
import { assertPositive } from "./internal/validation.js";

export interface AudioMeasurements {
  readonly duration: number;
  readonly samplePeak: number;
  readonly rms: number;
  readonly clippedSamples: number;
  readonly nonFiniteSamples: number;
}
export interface OfflineAudioOptions {
  duration: number;
  sampleRate?: number;
  channels?: number;
  mix?: AudioConfig;
}
/** Render the same voice/channel graph as live audio. The plan books every operation before rendering. */
export async function renderAudio(
  options: OfflineAudioOptions,
  plan: (audio: AudioManager) => void,
): Promise<AudioBuffer> {
  assertPositive("renderAudio.duration", options.duration);
  const sampleRate = options.sampleRate ?? 44100;
  assertPositive("renderAudio.sampleRate", sampleRate);
  const channels = options.channels ?? 2;
  if (!Number.isInteger(channels) || channels < 1 || channels > 32)
    throw new Error(
      `renderAudio: channels must be an integer from 1 to 32, got ${channels}.`,
    );
  const context = new OfflineAudioContext(
    channels,
    Math.ceil(options.duration * sampleRate),
    sampleRate,
  );
  const audio = new AudioManager(context, options.mix);
  // No interval, unlock or browser listeners are installed in an offline render.
  audio.invoke("Offline audio plan", () => plan(audio));
  const buffer = await context.startRendering();
  audio.dispose();
  return buffer;
}
/** Sample statistics, not a perceptual-quality or true-peak measurement. */
export function measureAudio(
  channels: readonly Float32Array[],
  sampleRate: number,
): AudioMeasurements {
  assertPositive("measureAudio.sampleRate", sampleRate);
  let peak = 0;
  let square = 0;
  let count = 0;
  let clipped = 0;
  let nonFinite = 0;
  for (const channel of channels)
    for (const value of channel) {
      count++;
      if (!Number.isFinite(value)) {
        nonFinite++;
        continue;
      }
      peak = Math.max(peak, Math.abs(value));
      square += value * value;
      if (Math.abs(value) >= 1) clipped++;
    }
  return {
    duration: (channels[0]?.length ?? 0) / sampleRate,
    samplePeak: peak,
    rms: count ? Math.sqrt(square / count) : 0,
    clippedSamples: clipped,
    nonFiniteSamples: nonFinite,
  };
}
