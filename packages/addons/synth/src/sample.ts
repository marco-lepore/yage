import type { SynthSample } from "./core/instruments.js";
export function sampleBuffer(sample: SynthSample): AudioBuffer {
  const buffer = new AudioBuffer({
    numberOfChannels: 1,
    length: sample.samples.length,
    sampleRate: sample.sampleRate,
  });
  buffer.getChannelData(0).set(sample.samples);
  return buffer;
}
