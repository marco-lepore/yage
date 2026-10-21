/** Encode mono PCM16 with a fixed RIFF header and no timestamps. */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const data = new DataView(bytes.buffer);
  const text = (at: number, value: string): void => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  data.setUint32(4, bytes.length - 8, true);
  text(8, "WAVEfmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, sampleRate, true);
  data.setUint32(28, sampleRate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  text(36, "data");
  data.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!;
    data.setInt16(
      44 + i * 2,
      Math.round(sample * (sample < 0 ? 32768 : 32767)),
      true,
    );
  }
  return bytes;
}
